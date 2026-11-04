import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { checkedEditProfile, checkedOrganizationHistory, fieldsForEdit, saveOrganizationEdit } from './native-organization-edit';
import { companyFields } from './native-organization';
vi.mock('../../shared/api/client',async original=>({...await original<typeof import('../../shared/api/client')>(),api:{get:vi.fn(),patch:vi.fn()}}));
const company='10000000-0000-4000-8000-000000000001',unit='10000000-0000-4000-8000-000000000002';
const raw={resource:'companies',id:company,companyId:company,unitId:null,version:'a'.repeat(64),values:{corporateName:'Empresa LTDA',fantasyName:'Empresa',cnpj:'11222333000181',tipoEmpresa:'INTERNA',email:null,phone:null}};
const read=(v:unknown)=>checkedEditProfile(v,'companies',company,[company],null);
const context={canCreateCompany:false,companies:[{id:company,name:'Empresa',canCreateUnit:false,canCreatePosition:false,canEdit:true}],units:[],departments:[],positions:[]};
beforeEach(()=>vi.clearAllMocks());
describe('edição organizacional',()=>{
  it('confere identidade, vínculo, versão opaca e campos conhecidos',()=>{
    expect(read(raw).version).toBe(raw.version);
    for(const patch of [{id:unit},{companyId:unit},{unitId:unit},{version:'1'},{resource:'positions'},{values:{...raw.values,active:false}}])expect(()=>read({...raw,...patch})).toThrow();
  });
  it('preenche opcionais vazios e conserva o responsável não editável do setor',()=>{
    const sector=checkedEditProfile({resource:'departments',id:company,companyId:company,unitId:unit,version:raw.version,values:{unitId:unit,name:'Manutenção',description:null,responsibleId:company}},'departments',company,[company],unit);
    expect(fieldsForEdit(sector)).toEqual({unitId:unit,name:'Manutenção',description:'',responsibleId:company});
  });
  it('não envia se a concessão ou a versão consultada mudar',async()=>{
    const opening=read(raw),fields={...fieldsForEdit(opening),fantasyName:'Correção'};
    vi.mocked(api.get).mockResolvedValue({...context,companies:[{...context.companies[0],canEdit:false}]} as never);
    await expect(saveOrganizationEdit(opening,fields,'Correção conferida',true,new AbortController().signal)).rejects.toThrow('acesso');expect(api.patch).not.toHaveBeenCalled();
    vi.mocked(api.get).mockImplementation(async path=>(path==='/organization-management'?context:{...raw,version:'b'.repeat(64)})as never);
    await expect(saveOrganizationEdit(opening,fields,'Correção conferida',true,new AbortController().signal)).rejects.toThrow('alterado');expect(api.patch).not.toHaveBeenCalled();
  });
  it('não confirma resposta incompatível nem leitura persistida divergente',async()=>{
    const opening=read(raw),fields={...fieldsForEdit(opening),fantasyName:'Correção'};let writes=0;
    vi.mocked(api.get).mockImplementation(async path=>(path==='/organization-management'?context:writes?{...raw,version:'b'.repeat(64),values:{...raw.values,fantasyName:'Outro valor'}}:raw)as never);
    vi.mocked(api.patch).mockImplementation(async()=>{writes++;return {...raw,version:'b'.repeat(64),values:{...raw.values,fantasyName:'Correção'}}as never;});
    await expect(saveOrganizationEdit(opening,fields,'Correção conferida',true,new AbortController().signal)).rejects.toThrow('não corresponde');expect(api.patch).toHaveBeenCalledOnce();
  });
  it('recusa motivo ausente, identidade trocada e telefone acima do limite do banco',async()=>{
    const opening=read(raw),fields=fieldsForEdit(opening);vi.mocked(api.get).mockImplementation(async path=>(path==='/organization-management'?context:raw)as never);
    await expect(saveOrganizationEdit(opening,fields,'',true,new AbortController().signal)).rejects.toThrow();
    await expect(saveOrganizationEdit(opening,{...fields,cnpj:'11444777000161'},'Correção conferida',true,new AbortController().signal)).rejects.toThrow('identidade');
    expect(companyFields.safeParse({...fields,phone:'1'.repeat(21)}).success).toBe(false);expect(api.patch).not.toHaveBeenCalled();
  });
  it('recusa histórico duplicado, versão inválida ou campos adicionais',()=>{
    const event={id:company,actorName:null,occurredAt:'2026-11-03T12:00:00Z',version:raw.version,reason:null};expect(checkedOrganizationHistory([event])).toHaveLength(1);
    for(const rows of [[event,event],[{...event,version:'123'}],[{...event,values:raw.values}]])expect(()=>checkedOrganizationHistory(rows)).toThrow();
  });
});
