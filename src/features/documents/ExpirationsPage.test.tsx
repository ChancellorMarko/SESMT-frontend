import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { dateOnly } from '../../shared/lib/format';
import type { DocumentDto } from '../../shared/contracts';
import { ExpirationsPage } from './ExpirationsPage';

vi.mock('../../shared/api/client', async importOriginal => ({...await importOriginal<typeof import('../../shared/api/client')>(),api:{get:vi.fn()}}));
vi.mock('../../shared/auth/SessionProvider',()=>({useSession:vi.fn()}));
const unitId='10000000-0000-4000-8000-000000000001';
const fixture:DocumentDto={id:'doc-1',code:'DOC-001',title:'Documento a renovar',companyId:unitId,unitId,typeId:'tipo-1',ownerId:'owner-1',accessClass:'INTERNAL',issueDate:'2026-01-01',validUntil:dateOnly(),status:'ACTIVE',activeVersionIds:[],availableActions:[],revision:1,workerIds:[],responsibleIds:[],keywords:[]};
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({me:null,unitId,sessionKey:'expiry-test',can:()=>true,status:'authenticated',sessionError:null,setUnitId:vi.fn(),login:vi.fn(),verifyMfa:vi.fn(),logout:vi.fn(),restore:vi.fn()});
  vi.mocked(api.get).mockResolvedValue({items:[fixture],page:1,pageSize:10,total:12});
});
function Harness(){const navigate=useNavigate();return <><button onClick={()=>navigate(-1)}>Voltar no teste</button><ExpirationsPage/></>;}
function show(query=''){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/vencimentos${query}`]}><Harness/></MemoryRouter></QueryClientProvider>);
}
describe('tela de vencimentos',()=>{
  it('consulta só a unidade e o período escolhidos, reinicia página e preserva filtros no repositório',async()=>{
    show('?days=7&page=2');
    await screen.findByRole('link',{name:'Documento a renovar'});
    expect(api.get).toHaveBeenCalledWith('/documents',expect.objectContaining({query:expect.objectContaining({unitId,status:'ACTIVE',page:2,validUntilFrom:dateOnly()})}));
    expect(screen.getByText('Vence hoje')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Antecedência'),{target:{value:'90'}});
    await waitFor(()=>expect(api.get).toHaveBeenCalledWith('/documents',expect.objectContaining({query:expect.objectContaining({page:1})})));
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'),{target:{value:' DOC-001 '}});
    fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
    await waitFor(()=>expect(api.get).toHaveBeenCalledWith('/documents',expect.objectContaining({query:expect.objectContaining({q:'DOC-001'})})));
    const link=new URL(screen.getByRole('link',{name:/Abrir no repositório/}).getAttribute('href')!,'http://localhost');
    expect(link.searchParams.get('status')).toBe('ACTIVE');
    expect(link.searchParams.get('q')).toBe('DOC-001');
    expect(link.searchParams.get('unitId')).toBe(unitId);
    fireEvent.click(screen.getByRole('button',{name:'Voltar no teste'}));
    await waitFor(()=>expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue(''));
  });
  it('consulta vencidos pelo estado do documento e remove o período anterior',async()=>{
    show();await screen.findByRole('link',{name:'Documento a renovar'});
    fireEvent.change(screen.getByLabelText('Consultar'),{target:{value:'expired'}});
    await waitFor(()=>expect(api.get).toHaveBeenCalledWith('/documents',expect.objectContaining({query:{unitId,page:1,pageSize:10,status:'EXPIRED'}})));
    expect(screen.queryByLabelText('Antecedência')).not.toBeInTheDocument();
  });
  it('não consulta sem unidade e oferece recuperação após erro',async()=>{
    const session=vi.mocked(useSession).getMockImplementation()!();
    vi.mocked(useSession).mockReturnValue({...session,unitId:undefined});
    const view=show();expect(screen.getByText('Selecione uma unidade para consultar os vencimentos.')).toBeVisible();expect(api.get).not.toHaveBeenCalled();view.unmount();
    vi.mocked(useSession).mockReturnValue(session);vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha de rede'));
    show();await screen.findByRole('button',{name:'Tentar novamente'});
    fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
    expect(await screen.findByRole('link',{name:'Documento a renovar'})).toBeVisible();
  });
  it('descarta a página associada à unidade anterior antes de consultar outro contexto',async()=>{
    show('?unitId=unidade-anterior&page=4&days=7');
    await screen.findByRole('link',{name:'Documento a renovar'});
    expect(vi.mocked(api.get).mock.calls.every(([,options])=>options?.query?.page===1&&options.query.unitId===unitId)).toBe(true);
  });
});
