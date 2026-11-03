import{beforeEach,describe,expect,it,vi}from'vitest';
import{fireEvent,render,screen,waitFor,within}from'@testing-library/react';
import{MemoryRouter}from'react-router';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{api,nativeDocumentTypesApi}from'../../shared/api/client';
import{NativeDocumentTypesPage}from'./NativeDocumentTypesPage';
const state=vi.hoisted(()=>({canManage:true}));
vi.mock('../../shared/auth/SessionProvider',()=>({useSession:()=>({sessionKey:'native-types',can:()=>true})}));
vi.mock('../../shared/api/client',async original=>({...await original<typeof import('../../shared/api/client')>(),api:{get:vi.fn()},nativeDocumentTypesApi:{create:vi.fn(),rename:vi.fn()}}));
const id='10000000-0000-4000-8000-000000000001';
const original={version:'a'.repeat(64),item:{id,code:'CAP',name:'Capacitação',description:null as string|null,category:'OPERACIONAL',secrecyLevel:'RESTRITO',requiresSignature:true,requiresApproval:true,periodicityInDays:null,retentionPeriodInYears:null,metadataSchema:'{}',schemaVersion:1,active:true}};
let stored=original;
function show(){render(<MemoryRouter initialEntries={['/app/configuracoes/tipos-documentais']}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}})}><NativeDocumentTypesPage/></QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{vi.clearAllMocks();state.canManage=true;stored=original;vi.mocked(api.get).mockImplementation(async path=>(path.endsWith('/context')?{canManage:state.canManage}:path==='/document-type-management'?{items:[stored],total:1,page:1,pageSize:20}:path.endsWith('/history')?[]:stored)as never);});
describe('tipos documentais com a API nativa',()=>{
  it('mostra a política real em tabela e mantém consulta sem capacidades de gestão',async()=>{
    state.canManage=false;show();fireEvent.click(await screen.findByRole('link',{name:'Capacitação'}));const modal=await screen.findByRole('dialog',{name:'Tipo documental'});expect(within(modal).getByText('Restrito')).toBeVisible();expect(screen.queryByRole('button',{name:'Cadastrar tipo'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Editar identificação'})).not.toBeInTheDocument();expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/history'),expect.anything());
  });
  it('cadastra com os campos nativos, sem fabricar prazo ou enviar opções da demonstração',async()=>{
    show();fireEvent.click(await screen.findByRole('button',{name:'Cadastrar tipo'}));fireEvent.change(screen.getByLabelText('Código do tipo'),{target:{value:'INT'}});fireEvent.change(screen.getByLabelText('Nome do tipo'),{target:{value:'Instrução'}});fireEvent.change(screen.getByLabelText('Categoria'),{target:{value:'OPERACIONAL'}});fireEvent.click(screen.getByRole('checkbox',{name:'Conferi a identificação e as regras deste tipo.'}));
    vi.mocked(nativeDocumentTypesApi.create).mockImplementation(async body=>{stored={version:'b'.repeat(64),item:{...original.item,...body as object}as typeof original.item};return stored.item as never;});
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Cadastrar tipo'}));await screen.findByRole('dialog',{name:'Tipo documental'});
    expect(nativeDocumentTypesApi.create).toHaveBeenCalledWith(expect.objectContaining({code:'INT',name:'Instrução',periodicityInDays:null,retentionPeriodInYears:null,requiresApproval:true,requiresSignature:false,metadataSchema:'{}',schemaVersion:1}),expect.any(AbortSignal));expect(nativeDocumentTypesApi.create).toHaveBeenCalledOnce();
  });
  it('edita apenas identificação e conserva assinatura, sigilo e a versão de abertura',async()=>{
    show();fireEvent.click(await screen.findByRole('link',{name:'Capacitação'}));fireEvent.click(await screen.findByRole('button',{name:'Editar identificação'}));await screen.findByLabelText('Nome do tipo');fireEvent.change(screen.getByLabelText('Nome do tipo'),{target:{value:'Capacitação revisada'}});fireEvent.click(screen.getByRole('checkbox'));
    vi.mocked(nativeDocumentTypesApi.rename).mockImplementation(async(_id,_version,body)=>{stored={version:'b'.repeat(64),item:{...original.item,...body as object}as typeof original.item};return stored.item as never;});
    fireEvent.click(screen.getByRole('button',{name:'Salvar identificação'}));await screen.findByRole('dialog',{name:'Tipo documental'});expect(nativeDocumentTypesApi.rename).toHaveBeenCalledWith(id,original.version,expect.objectContaining({name:'Capacitação revisada',secrecyLevel:'RESTRITO',requiresSignature:true,requiresApproval:true,metadataSchema:'{}'}),expect.any(AbortSignal));
  });
  it('preserva texto e bloqueia envio quando a versão mudou',async()=>{
    show();fireEvent.click(await screen.findByRole('link',{name:'Capacitação'}));fireEvent.click(await screen.findByRole('button',{name:'Editar identificação'}));await screen.findByLabelText('Nome do tipo');fireEvent.change(screen.getByLabelText('Nome do tipo'),{target:{value:'Nome em andamento'}});fireEvent.click(screen.getByRole('checkbox'));stored={...original,version:'b'.repeat(64)};
    fireEvent.click(screen.getByRole('button',{name:'Salvar identificação'}));expect(await screen.findByRole('alert')).toHaveTextContent('tipo documental mudou');expect(screen.getByLabelText('Nome do tipo')).toHaveValue('Nome em andamento');expect(screen.getByRole('button',{name:'Salvar identificação'})).toBeDisabled();expect(nativeDocumentTypesApi.rename).not.toHaveBeenCalled();
  });
  it('não confirma criação cuja leitura persistida diverge',async()=>{
    show();fireEvent.click(await screen.findByRole('button',{name:'Cadastrar tipo'}));for(const[label,value]of[['Código do tipo','INT'],['Nome do tipo','Instrução'],['Categoria','OPERACIONAL']])fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.click(screen.getByRole('checkbox',{name:'Conferi a identificação e as regras deste tipo.'}));
    vi.mocked(nativeDocumentTypesApi.create).mockImplementation(async body=>({...original.item,...body as object})as never);fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Cadastrar tipo'}));expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou');await waitFor(()=>expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Cadastrar tipo'})).toBeDisabled());
  });
});
