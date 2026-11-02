import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeOrganizationPage } from './NativeOrganizationPage';
import { checkedOrganization } from './native-organization';
import { api } from '../../shared/api/client';

const state = vi.hoisted(() => ({ allowed: true, restore: vi.fn() }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'organization-test', can: () => state.allowed, restore: state.restore }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const companyId = '10000000-0000-4000-8000-000000000001', unitId = '10000000-0000-4000-8000-000000000002';
const empty = { canCreateCompany: true, companies: [], units: [], departments: [], positions: [] };
const company = { id: companyId, name: 'Empresa cadastrada', canCreateUnit: true, canCreatePosition: true };
const unit = { id: unitId, name: 'Unidade local', companyId, code: 'MATRIZ', canCreateDepartment: true };
const context = { ...empty, companies: [company], units: [unit] };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><NativeOrganizationPage/></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); state.allowed = true; vi.mocked(api.get).mockResolvedValue(empty as never); });

describe('cadastro da organização na API real', () => {
  it('permite iniciar uma instalação vazia pelo cadastro da primeira empresa', async () => {
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar empresa' }));
    fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Empresa cadastrada LTDA' } });
    fireEvent.change(screen.getByLabelText('Nome fantasia'), { target: { value: company.name } });
    fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '11.222.333/0001-81' } });
    const receipt = { id: companyId, corporateName: 'Empresa cadastrada LTDA', fantasyName: company.name, cnpj: '11222333000181', tipoEmpresa: 'INTERNA', email: null, phone: null, active: true };
    vi.mocked(api.post).mockResolvedValue(receipt as never);
    vi.mocked(api.get).mockImplementation(async path => (path === `/companies/${companyId}` ? receipt : path === '/organization-management' ? { ...empty, companies: [company] } : undefined) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/companies', { corporateName: receipt.corporateName, fantasyName: company.name, cnpj: receipt.cnpj, tipoEmpresa: 0, email: null, phone: null }, expect.objectContaining({ idempotencyKey: undefined, signal: expect.any(AbortSignal) }));
    expect(state.restore).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(company.name)).toBeVisible();
  });
  it('oferece somente os cadastros publicados e organiza vínculos em tabela', async () => {
    vi.mocked(api.get).mockResolvedValue(context as never); show();
    await screen.findByText(company.name); fireEvent.click(screen.getByRole('button', { name: /Unidades/ }));
    expect(screen.getByRole('table')).toBeVisible(); expect(screen.getByText(unit.name)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Estabelecimentos|Centros de trabalho|Funções/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar cadastro'), { target: { value: 'não existe' } });
    expect(screen.queryByText(unit.name)).not.toBeInTheDocument();
  });
  it('não oferece criação de unidades sem autorização da empresa inteira', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...context, companies: [{ ...company, canCreateUnit: false }] } as never); show();
    await screen.findByText(company.name); fireEvent.click(screen.getByRole('button', { name: /Unidades/ }));
    expect(screen.queryByRole('button', { name: 'Cadastrar unidade' })).not.toBeInTheDocument();
  });
  it('bloqueia envio se o local perder autorização durante o preenchimento', async () => {
    vi.mocked(api.get).mockResolvedValue(context as never); show();
    await screen.findByText(company.name); fireEvent.click(screen.getByRole('button', { name: /Cargos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar cargo' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Cargo da equipe' } });
    vi.mocked(api.get).mockResolvedValue({ ...context, companies: [{ ...company, canCreatePosition: false }] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permissões mudaram'); expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nome')).toHaveValue('Cargo da equipe');
  });
  it('não confirma criação se a leitura persistida divergir do recibo', async () => {
    vi.mocked(api.get).mockResolvedValue(context as never); show(); await screen.findByText(company.name);
    fireEvent.click(screen.getByRole('button', { name: /Setores/ })); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar setor' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Novo setor' } });
    const receipt = { id: companyId, name: 'Novo setor', unitId, description: null, active: true };
    vi.mocked(api.post).mockResolvedValue(receipt as never);
    vi.mocked(api.get).mockImplementation(async path => (path === '/organization-management' ? context : { ...receipt, unitId: companyId }) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou'); expect(state.restore).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled();
  });
  it.each([{ ...context, companies: [company, company] }, { ...context, companies: [] }, { ...context, departments: [{ id: companyId, name: 'Órfão', unitId: companyId }] }, { ...context, canCreateCompany: 'true' }])('recusa respostas inconsistentes: %j', value => {
    expect(() => checkedOrganization(value)).toThrow();
  });
});
