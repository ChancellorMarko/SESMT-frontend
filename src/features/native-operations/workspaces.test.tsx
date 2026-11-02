import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativeAppointmentDetail } from './NativeAppointmentDetail';
import { NativeCreationDialog } from './NativeCreationDialog';
import { NativeTeamsPage } from './NativeTeamsPage';
import { NativeDesignationsPage } from './NativeDesignationsPage';
import { appointmentFixture, designationFixture, teamFixture, operationIds as ids, nativePersonFixture, nativeOrganizationFixture, nativeServicesFixture, nativeResponsibleFixture } from '../../../tests/connection-ui/fixtures/native-operations';

const state=vi.hoisted(()=>({grants:['pt:editar','pt:criar','users.read','organization.read','workers.read','equipe:ler'],companies:['61000000-0000-4000-8000-000000000001']}));
vi.mock('../../shared/auth/SessionProvider',()=>({useSession:()=>({sessionKey:'native-operation-test',unitId:ids.unit,me:{user:{id:ids.user},roles:['ADMIN'],scope:{companyIds:state.companies,unitIds:[ids.unit]}},can:(permission:string)=>state.grants.includes(permission)})}));
vi.mock('../../shared/api/client',async original=>({...await original<typeof import('../../shared/api/client')>(),api:{get:vi.fn(),post:vi.fn(),put:vi.fn()}}));
function show(component:React.ReactNode,path='/app/agenda/detail'){
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  const view=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/app/agenda/:id" element={component}/><Route path="*" element={component}/></Routes></MemoryRouter></QueryClientProvider>);
  return{...view,client};
}
beforeEach(()=>{
  vi.clearAllMocks();state.grants=['pt:editar','pt:criar','users.read','organization.read','workers.read','equipe:ler'];state.companies=[ids.company];
  vi.mocked(api.get).mockImplementation(async(path,options)=>{
    if(path==='/organization')return nativeOrganizationFixture as never;
    if(path==='/work-permits/services')return nativeServicesFixture as never;
    if(path==='/teams')return[teamFixture()] as never;
    if(path===`/teams/${ids.team}`)return teamFixture() as never;
    if(path===`/workers/${ids.worker}`)return nativePersonFixture as never;
    if(path==='/workers')return{items:[nativePersonFixture],total:1,page:options?.query?.page??1,pageSize:20} as never;
    if(path==='/users')return[nativeResponsibleFixture] as never;
    if(path==='/designations')return[designationFixture()] as never;
    if(path===`/appointments/${ids.appointment}`)return appointmentFixture() as never;
    throw new Error('Endpoint inesperado: '+path);
  });
});
describe('workspaces operacionais nativos',()=>{
  it('não oferece gestão pelo nome ADMIN, sem a permissão explícita',async()=>{
    state.grants=[];show(<NativeAppointmentDetail/>,`/app/agenda/${ids.appointment}`);
    await screen.findByRole('heading',{name:'Inspeção programada'});
    expect(screen.queryByRole('button',{name:/Reagendar|Cancelar agendamento|Confirmar agendamento/})).not.toBeInTheDocument();
  });
  it('preserva preenchimento e a versão original mesmo com nova leitura ao fundo e conflito',async()=>{
    const{client}=show(<NativeAppointmentDetail/>,`/app/agenda/${ids.appointment}`);
    fireEvent.click(await screen.findByRole('button',{name:'Reagendar'}));
    fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Ajuste de programação'}});
    const newer={...appointmentFixture(),version:2};
    vi.mocked(api.get).mockResolvedValueOnce(newer as never);
    await act(async()=>{await client.invalidateQueries({queryKey:['native-appointment']});});
    expect(screen.getByLabelText('Motivo')).toHaveValue('Ajuste de programação');
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409,{code:'DOMAIN_VIOLATION',message:'privado',requestId:'test'}));
    fireEvent.click(screen.getByRole('button',{name:'Salvar alteração'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seus dados foram mantidos');
    expect(api.post).toHaveBeenCalledWith(`/appointments/${ids.appointment}/reschedule`,expect.objectContaining({expectedVersion:1,reason:'Ajuste de programação'}),expect.anything());
    expect(screen.getByRole('button',{name:'Salvar alteração'})).toBeDisabled();
    expect(screen.getByLabelText('Motivo')).toHaveValue('Ajuste de programação');
  });
  it('confirma com ID de usuário, não de trabalhador',async()=>{
    const done={...appointmentFixture(),status:'CONFIRMED' as const,version:2,responsibleId:ids.responsible};
    vi.mocked(api.post).mockResolvedValueOnce(done as never);
    show(<NativeAppointmentDetail/>,`/app/agenda/${ids.appointment}`);
    fireEvent.click(await screen.findByRole('button',{name:'Confirmar agendamento'}));
    await screen.findByRole('option',{name:/Roberto Responsável/});
    fireEvent.change(screen.getByLabelText('Responsável (usuário)'),{target:{value:ids.responsible}});
    fireEvent.click(screen.getByRole('button',{name:'Salvar alteração'}));
    expect(await screen.findByText('Alteração confirmada pela API.')).toBeVisible();
    expect(api.post).toHaveBeenCalledWith(`/appointments/${ids.appointment}/confirm`,{expectedVersion:1,responsibleId:ids.responsible},expect.anything());
  });
  it('cria agendamento com trabalhadores reais da equipe e horários convertidos a UTC',async()=>{
    const done=vi.fn(async()=>{});const created={...appointmentFixture(),title:'Trabalho nativo'};
    vi.mocked(api.post).mockResolvedValueOnce(created as never);
    show(<NativeCreationDialog kind="appointment" onClose={()=>{}} onDone={done}/>);
    await screen.findByRole('option',{name:'Equipe de manutenção'});
    fireEvent.change(screen.getByLabelText('Equipe'),{target:{value:ids.team}});
    fireEvent.click(await screen.findByRole('checkbox',{name:/Alice Trabalhadora/}));
    fireEvent.change(screen.getByLabelText('Título'),{target:{value:'Trabalho nativo'}});
    fireEvent.change(screen.getByLabelText('Início (Brasília)'),{target:{value:'2099-11-20T09:00'}});
    fireEvent.change(screen.getByLabelText('Término (Brasília)'),{target:{value:'2099-11-20T10:00'}});
    fireEvent.click(screen.getByRole('checkbox',{name:'Trabalho em altura'}));
    fireEvent.click(screen.getByRole('button',{name:'Solicitar agendamento'}));
    await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/appointments',{companyId:ids.company,locationId:ids.unit,teamId:ids.team,title:'Trabalho nativo',startsAt:'2099-11-20T12:00:00.000Z',endsAt:'2099-11-20T13:00:00.000Z',serviceIds:[ids.service],participantIds:[ids.worker]},expect.anything());
  });
  it('configura contexto com PUT e expectedVersion sem alterar datas/título/local',async()=>{
    const done=vi.fn(async()=>{}),initial=appointmentFixture();vi.mocked(api.put).mockResolvedValueOnce({...initial,version:2} as never);
    show(<NativeCreationDialog kind="context" initial={initial} onClose={()=>{}} onDone={done}/>);
    await screen.findByRole('option',{name:'Equipe de manutenção'});fireEvent.change(screen.getByLabelText('Equipe'),{target:{value:ids.team}});
    fireEvent.click(await screen.findByRole('checkbox',{name:/Alice Trabalhadora/}));fireEvent.click(screen.getByRole('checkbox',{name:'Trabalho em altura'}));
    fireEvent.click(screen.getByRole('button',{name:'Salvar contexto'}));
    await waitFor(()=>expect(done).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith(`/appointments/${ids.appointment}/context`,{expectedVersion:1,teamId:ids.team,serviceIds:[ids.service],participantIds:[ids.worker]},expect.anything());
    expect(api.post).not.toHaveBeenCalled();
  });
  it('cria designação usando PersonId do trabalhador e confere o retorno ativo',async()=>{
    const done=vi.fn(async()=>{}),created={...designationFixture(),startsAt:'2099-11-20T12:00:00Z',endsAt:'2099-11-20T13:00:00Z'};
    vi.mocked(api.post).mockResolvedValueOnce(created as never);show(<NativeCreationDialog kind="designation" onClose={()=>{}} onDone={done}/>);
    await screen.findByRole('option',{name:/Alice Trabalhadora/});fireEvent.change(screen.getByLabelText('Trabalhador'),{target:{value:ids.worker}});
    fireEvent.change(screen.getByLabelText('Origem'),{target:{value:created.origin}});fireEvent.change(screen.getByLabelText('Início (Brasília)'),{target:{value:'2099-11-20T09:00'}});fireEvent.change(screen.getByLabelText('Término (Brasília)'),{target:{value:'2099-11-20T10:00'}});
    fireEvent.click(screen.getByRole('checkbox',{name:'Trabalho em altura'}));fireEvent.click(screen.getByRole('button',{name:'Criar designação'}));await waitFor(()=>expect(done).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/designations',expect.objectContaining({personId:ids.worker,locationIds:[ids.unit],serviceIds:[ids.service],type:'atender'}),expect.anything());
  });
  it('uma equipe incompatível é ocultada e nunca oferece edição nativa',async()=>{
    vi.mocked(api.get).mockImplementation(async path=>path==='/teams'?[teamFixture()] as never:{...teamFixture(),companyId:ids.otherCompany} as never);
    show(<NativeTeamsPage/>,'/app/equipes');expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir');
    expect(screen.queryByText('Equipe de manutenção')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/editar|criar|desativar/i})).not.toBeInTheDocument();
  });
  it('a revogação usa a versão consultada e relê a lista em vez de simular sucesso',async()=>{
    const updated={...designationFixture(),active:false,version:2,revokedBy:ids.user,revokedAt:'2026-10-31T13:00:00Z'};vi.mocked(api.post).mockResolvedValueOnce(updated as never);
    show(<NativeDesignationsPage/>,'/app/designacoes');fireEvent.click(await screen.findByRole('button',{name:'Revogar Escala operacional'}));
    vi.mocked(api.get).mockResolvedValueOnce([updated] as never);fireEvent.click(screen.getByRole('button',{name:'Confirmar revogação'}));
    expect(await screen.findByText('Revogada')).toBeVisible();expect(api.post).toHaveBeenCalledWith(`/designations/${ids.designation}/revoke`,{expectedVersion:1},expect.anything());
  });
});
