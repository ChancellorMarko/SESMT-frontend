import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { nativeId, checkedNativeAgenda, checkedNativeAppointment, checkedNativeDesignations, checkedNativeTeam, nativeAgendaCriteria, nativeAgendaQuery } from './contracts';
import { loadNativeTeams } from './queries';
import { checkedNativeDirectory, checkedNativePeople, checkedNativeTeamPeople } from './directory';
import { nativeAgendaReturn } from './NativeAppointmentDetail';
import { appointmentFixture, designationFixture, teamFixture, operationIds as ids, nativePersonFixture, nativeOrganizationFixture } from '../../../tests/connection-ui/fixtures/native-operations';

vi.mock('../../shared/api/client', async original=>({...await original<typeof import('../../shared/api/client')>(),api:{get:vi.fn()}}));
const criteria={page:1,q:'',status:'',from:'',to:'',companyId:''};
beforeEach(()=>vi.clearAllMocks());
describe('contratos nativos de agenda/equipes/designações',()=>{
  it('aceita os IDs fixos do catálogo de serviços da PT, que não seguem a variante RFC',()=>{
    expect(nativeId.parse('10000000-0000-0000-0000-000000000001')).toBe('10000000-0000-0000-0000-000000000001');
    expect(nativeId.parse('ABCDEF00-0000-0000-0000-000000000005')).toBe('abcdef00-0000-0000-0000-000000000005');
    expect(nativeId.safeParse('00000000-0000-0000-0000-000000000000').success).toBe(false);
    expect(nativeId.safeParse('10000000-0000-0000-0000-00000000000').success).toBe(false);
  });
  it('preserva version, CANCELLED e os IDs sem converter para revision/estado legado',()=>{
    const item=appointmentFixture();item.status='CANCELLED';
    expect(checkedNativeAppointment(item,item.id).status).toBe('CANCELLED');
    expect(checkedNativeAppointment(item)).not.toHaveProperty('revision');
    expect(()=>checkedNativeAppointment({...item,status:'CANCELED'})).toThrow();
    expect(()=>checkedNativeAppointment(item,ids.team)).toThrow();
  });
  it('confere sobreposição de intervalo, não apenas início dentro do período',()=>{
    const item=appointmentFixture();item.startsAt='2099-11-20T02:00:00Z';item.endsAt='2099-11-20T04:00:00Z';
    const response={items:[item],total:1,page:1,pageSize:20};
    expect(checkedNativeAgenda(response,{...criteria,from:'2099-11-20',to:'2099-11-20'}).items).toHaveLength(1);
    expect(nativeAgendaQuery({...criteria,from:'2099-11-20',to:'2099-11-20'}).to).toBe('2099-11-21T03:00:00.000Z');
    expect(()=>checkedNativeAgenda(response,{...criteria,from:'2099-11-21'})).toThrow();
    for(const mismatch of[{status:'CONFIRMED'},{q:'outro título'},{companyId:ids.otherCompany},{page:2}])expect(()=>checkedNativeAgenda(response,{...criteria,...mismatch})).toThrow();
  });
  it.each(['page=0','page=999999999','q=a&q=b','unitId=unidade','status=CANCELED','from=2026-02-30','to=9999-12-31','from=2026-10-31&to=2026-01-01','companyId=../../'])('bloqueia filtro inválido antes do HTTP: %s',query=>{
    expect(nativeAgendaCriteria(new URLSearchParams(query))).toBeUndefined();
  });
  it.each([{},null,{...appointmentFixture(),version:0},{...appointmentFixture(),history:[{action:'CONFIRMED',version:99}]}])('rejeita resposta incompatível: %j',value=>expect(()=>checkedNativeAppointment(value)).toThrow());
  it('uma equipe precisa pertencer à unidade e empresa autorizadas',()=>{
    expect(checkedNativeTeam(teamFixture(),{id:ids.team,unitId:ids.unit,companyIds:[ids.company]}).name).toBe('Equipe de manutenção');
    for(const bad of[{companyId:ids.otherCompany},{localId:ids.otherUnit},{localId:null},{active:false}])expect(()=>checkedNativeTeam({...teamFixture(),...bad},{id:ids.team,unitId:ids.unit,companyIds:[ids.company]})).toThrow();
  });
  it('usa locationId/pageNumber e valida os detalhes antes de devolver a lista',async()=>{
    vi.mocked(api.get).mockResolvedValueOnce([teamFixture()] as never).mockResolvedValueOnce({...teamFixture(),companyId:ids.otherCompany} as never);
    await expect(loadNativeTeams({unitId:ids.unit,companyIds:[ids.company],page:1},new AbortController().signal)).rejects.toThrow();
    expect(api.get).toHaveBeenNthCalledWith(1,'/teams',expect.objectContaining({query:{locationId:ids.unit,pageNumber:1,pageSize:10}}));
    expect(api.get).toHaveBeenNthCalledWith(2,`/teams/${ids.team}`,expect.anything());
  });
  it('não consulta equipes sem contexto verificável',async()=>{
    await expect(loadNativeTeams({unitId:ids.unit,companyIds:[],page:1},new AbortController().signal)).rejects.toThrow();expect(api.get).not.toHaveBeenCalled();
  });
  it('não mistura usuário responsável com trabalhador designado e preserva revogação',()=>{
    const item=designationFixture();expect(checkedNativeDesignations([item])[0].personId).toBe(ids.worker);expect(item.personId).not.toBe(ids.user);
    for(const bad of[{serviceIds:[]},{locationIds:[ids.unit,ids.unit]},{active:true,revokedAt:'2026-10-31T13:00:00Z',revokedBy:ids.user},{revokedAt:'2026-10-31T13:00:00Z',revokedBy:null}])expect(()=>checkedNativeDesignations([{...item,...bad}])).toThrow();
    expect(()=>checkedNativeDesignations([item,item])).toThrow();
  });
  it('confere empresa/local das opções e não completa nomes ausentes',()=>{
    expect(checkedNativeDirectory(nativeOrganizationFixture).units[0].id).toBe(ids.unit);
    expect(()=>checkedNativeDirectory({...nativeOrganizationFixture,units:[{...nativeOrganizationFixture.units[0],companyId:ids.otherCompany}]})).toThrow();
    expect(checkedNativeTeamPeople([nativePersonFixture],teamFixture())[0].id).toBe(ids.worker);
    expect(()=>checkedNativeTeamPeople([{...nativePersonFixture,id:ids.user}],teamFixture())).toThrow();
    expect(()=>checkedNativePeople({items:[{...nativePersonFixture,companyId:ids.otherCompany}],total:1,page:1,pageSize:20},{unitId:ids.unit,companyId:ids.company,page:1})).toThrow();
  });
  it.each(['https://evil.invalid/app/agenda','//evil.invalid/app/agenda','http://[','/app/agenda?unitId=outra','/app/configuracoes/usuarios'])('recusa retorno externo ou incompatível: %s',path=>{
    expect(nativeAgendaReturn(path)).toBe('/app/agenda');
  });
  it('preserva filtros válidos no retorno à lista',()=>expect(nativeAgendaReturn('/app/agenda?q=Inspe%C3%A7%C3%A3o&status=REQUESTED&page=2')).toBe('/app/agenda?q=Inspe%C3%A7%C3%A3o&status=REQUESTED&page=2'));
});
