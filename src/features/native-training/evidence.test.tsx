import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { NativeTrainingPage } from './NativeTrainingPage';
import { checkedEvidence, checkedEvidenceOptions, sameBinding, type EvidenceReceipt } from './evidence-contracts';
import type { Training } from './contracts';

const ids = { company:'76000000-0000-4000-8000-000000000001', unit:'76000000-0000-4000-8000-000000000002', worker:'76000000-0000-4000-8000-000000000003', training:'76000000-0000-4000-8000-000000000004', document:'76000000-0000-4000-8000-000000000005', version:'76000000-0000-4000-8000-000000000006' };
const state = vi.hoisted(() => ({ ownOnly:false }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({sessionKey:'evidence-test', unitId:'76000000-0000-4000-8000-000000000002', me:{workerId:'76000000-0000-4000-8000-000000000003',scope:{companyIds:['76000000-0000-4000-8000-000000000001'],ownOnly:state.ownOnly}},can:()=>true}) }));
vi.mock('../../shared/api/client', async original => ({...await original<typeof import('../../shared/api/client')>(),api:{get:vi.fn(),post:vi.fn(),put:vi.fn()}}));
const initial:Training={id:ids.training,companyId:ids.company,unitId:ids.unit,workerId:ids.worker,workerName:'Hugo Almeida',title:'Integração de segurança',reference:null,kind:'INITIAL',completedOn:'2026-01-05',renewalOn:null,durationMinutes:90,provider:null,instructor:null,venue:null,content:null,notes:null,revokedAt:null,revocationReason:null,revision:1};
const option={documentId:ids.document,versionId:ids.version,documentRevision:3,versionNumber:1,code:'CAP-001',title:'Comprovante de Hugo',fileHash:'a'.repeat(64)};
const linked={...option,linkedTrainingRevision:2,linkedAt:'2026-11-03T12:00:00Z'};
let training:Training,receipt:EvidenceReceipt;
beforeEach(()=>{
  vi.clearAllMocks();state.ownOnly=false;training={...initial};receipt={trainingId:ids.training,unitId:ids.unit,trainingRevision:1,canManage:true,state:'EMPTY',evidence:null};
  vi.mocked(api.get).mockImplementation(async path=>{
    if(path==='/trainings/context')return {unitId:ids.unit,companyId:ids.company,ownOnly:state.ownOnly,canCreate:!state.ownOnly,canEdit:!state.ownOnly,workers:[]} as never;
    if(path===`/trainings/${ids.training}`)return structuredClone(training) as never;
    if(path.endsWith('/evidence/options'))return {trainingId:ids.training,unitId:ids.unit,trainingRevision:training.revision,items:[option],total:1,page:1,pageSize:20} as never;
    if(path.endsWith('/evidence'))return structuredClone(receipt) as never;
    if(path.endsWith('/history'))return [] as never;
    return {items:[structuredClone(training)],total:1,page:1,pageSize:20} as never;
  });
  vi.mocked(api.post).mockImplementation(async path=>{
    training={...training,revision:training.revision+1};receipt=path.endsWith('/unlink')?{...receipt,trainingRevision:training.revision,state:'EMPTY',evidence:null}:{...receipt,trainingRevision:training.revision,state:'CURRENT',evidence:{...linked,linkedTrainingRevision:training.revision}};
    return structuredClone(receipt) as never;
  });
});
function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/treinamentos?registro=${ids.training}`]}><NativeTrainingPage/></MemoryRouter></QueryClientProvider>);}
async function fill(){fireEvent.click(await screen.findByRole('button',{name:'Vincular comprovante'}));const form=screen.getByRole('dialog',{name:'Vincular comprovante'});await within(form).findByRole('option',{name:/CAP-001/});fireEvent.change(within(form).getByLabelText('Versão do comprovante'),{target:{value:ids.version}});fireEvent.change(within(form).getByLabelText('Motivo da conferência'),{target:{value:'Conferência do comprovante desta turma'}});fireEvent.click(within(form).getByRole('checkbox'));return form;}

it('vincula a versão explícita, confere persistência e reabre os detalhes sem sobrepor janelas',async()=>{
  show();const form=await fill();expect(screen.getAllByRole('dialog')).toHaveLength(1);fireEvent.click(within(form).getByRole('button',{name:'Confirmar vínculo'}));
  const detail=await screen.findByRole('dialog',{name:'Detalhes do treinamento'});expect(await within(detail).findByText('Vínculo atualizado')).toBeInTheDocument();
  expect(within(detail).getByRole('link',{name:'Abrir documento'})).toHaveAttribute('href',`/app/documentos/${ids.document}?versao=${ids.version}&sha256=${option.fileHash}`);
  expect(api.post).toHaveBeenCalledWith(`/trainings/${ids.training}/evidence`,expect.objectContaining({expectedRevision:1,documentId:ids.document,versionId:ids.version,expectedDocumentRevision:3,confirmation:true}),expect.anything());
});
it('mudar o motivo retira a confirmação anterior',async()=>{
  show();const form=await fill();fireEvent.change(within(form).getByLabelText('Motivo da conferência'),{target:{value:'Outro motivo'}});expect(within(form).getByRole('button',{name:'Confirmar vínculo'})).toBeDisabled();
});
it('conflito mantém seleção e motivo e bloqueia reenvio automático',async()=>{
  show();const form=await fill();vi.mocked(api.post).mockRejectedValue(new ApiError(409,{code:'EVIDENCE_CHANGED',message:'privado',requestId:'qa'}));fireEvent.click(within(form).getByRole('button',{name:'Confirmar vínculo'}));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Seus dados foram mantidos');expect(within(form).getByLabelText('Versão do comprovante')).toHaveValue(ids.version);expect(within(form).getByRole('button',{name:'Confirmar vínculo'})).toBeDisabled();expect(api.post).toHaveBeenCalledTimes(1);
});
it('resposta ambígua não permite repetir a operação',async()=>{
  show();const form=await fill();vi.mocked(api.post).mockRejectedValue(new TypeError('network failure'));fireEvent.click(within(form).getByRole('button',{name:'Confirmar vínculo'}));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Não foi possível confirmar');expect(within(form).getByRole('button',{name:'Confirmar vínculo'})).toBeDisabled();
});
it('remove somente o vínculo, conferindo a nova revisão vazia',async()=>{
  training={...training,revision:2};receipt={...receipt,trainingRevision:2,state:'CURRENT',evidence:linked};show();fireEvent.click(await screen.findByRole('button',{name:'Remover vínculo'}));
  const form=screen.getByRole('dialog',{name:'Remover vínculo do comprovante'});fireEvent.change(within(form).getByLabelText('Motivo da remoção'),{target:{value:'Documento selecionado incorretamente'}});fireEvent.click(within(form).getByRole('checkbox'));fireEvent.click(within(form).getByRole('button',{name:'Confirmar remoção'}));
  const detail=await screen.findByRole('dialog',{name:'Detalhes do treinamento'});expect(await within(detail).findByText('Sem comprovante vinculado')).toBeInTheDocument();expect(within(detail).queryByRole('link',{name:'Abrir documento'})).not.toBeInTheDocument();
});
it('perda de acesso não revela o documento nem oferece gestão',async()=>{
  receipt={...receipt,state:'UNAVAILABLE',evidence:null,canManage:false};show();expect(await screen.findByText('Comprovante indisponível neste acesso')).toBeInTheDocument();expect(screen.queryByRole('link',{name:'Abrir documento'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Conferir ou substituir|Remover vínculo/})).not.toBeInTheDocument();
});
it('acesso próprio não recebe comandos de vínculo',async()=>{
  state.ownOnly=true;receipt={...receipt,canManage:false};show();expect(await screen.findByText('Sem comprovante vinculado')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Vincular comprovante'})).not.toBeInTheDocument();
});
it('recusa recibos de outro treinamento, revisão ou unidade e metadados proibidos',()=>{
  for(const patch of [{trainingId:ids.worker},{unitId:ids.worker},{trainingRevision:2},{state:'UNAVAILABLE',evidence:linked}])expect(()=>checkedEvidence({...receipt,...patch},initial,false)).toThrow();
  expect(()=>checkedEvidence(receipt,initial,true)).toThrow();
});
it('não troca automaticamente a versão vinculada pela mais recente',()=>{
  const revised={...initial,revision:2};const value=checkedEvidence({...receipt,trainingRevision:2,state:'DOCUMENT_CHANGED',evidence:linked},revised,false);
  expect(value.evidence?.versionId).toBe(ids.version);expect(sameBinding(value,{...option,versionNumber:2,versionId:ids.document})).toBe(false);
});
it('recusa opções de revisão errada, hash inválido e resultados repetidos',()=>{
  const options={trainingId:ids.training,unitId:ids.unit,trainingRevision:1,items:[option],total:1,page:1,pageSize:20};
  expect(checkedEvidenceOptions(options,initial,1,'CAP').items).toHaveLength(1);
  for(const patch of [{trainingRevision:2},{items:[{...option,fileHash:'http://invalid'}]},{items:[option,option],total:2}])expect(()=>checkedEvidenceOptions({...options,...patch},initial,1,'')).toThrow();
});
