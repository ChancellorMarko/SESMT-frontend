import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeDto, OrganizationDto, UserDto } from '../../shared/contracts';
import type { TeamDto } from '../../shared/contracts/work-permits';
import { api, ApiError } from '../../shared/api/client';
import { UsersPage } from './UsersPage';

const session = vi.hoisted(() => ({ me: null as MeDto | null, sessionKey: 'session-a', unitId: 'unit-a' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.me?.permissions.includes(permission) ?? false }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const organization: OrganizationDto = {
  companies: ['a', 'b', 'outside'].map(key => ({ id: `company-${key}`, name: `Empresa ${key.toUpperCase()}`, status: 'ACTIVE', revision: 1 })),
  units: ['a', 'b', 'outside'].map(key => ({ id: `unit-${key}`, name: `Unidade ${key.toUpperCase()}`, companyId: `company-${key}`, status: 'ACTIVE', revision: 1 })),
  sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [],
};
const teams: TeamDto[] = ['a', 'b', 'outside'].map(key => ({ id: `team-${key}`, name: `Equipe ${key.toUpperCase()}`, unitId: `unit-${key}`, companyId: `company-${key}`, chiefId: 'chief', members: [], revision: 1, status: 'ACTIVE' }));
const record: UserDto = { id: 'user-a', displayName: 'Pessoa do teste', email: 'pessoa@example.invalid', status: 'ACTIVE', roles: ['HR'], scope: { companyIds: ['company-a'], unitIds: ['unit-a'], sectorIds: [], teamIds: ['team-a'], ownOnly: false }, revision: 7, mfaRequired: false };
let currentRecord: UserDto;
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  session.me = { user: { id: 'admin', displayName: 'Administrador do teste', email: 'admin@example.invalid' }, roles: ['ADMIN'], permissions: ['users.manage', 'organization.read', 'teams.read'], scope: { companyIds: ['company-a', 'company-b'], unitIds: ['unit-a', 'unit-b'], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: '2099-01-01T00:00:00Z' };
  session.unitId = 'unit-a'; session.sessionKey = 'session-a'; currentRecord = structuredClone(record);
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/users') return { items: [structuredClone(currentRecord)], total: 1, page: 1, pageSize: 20 } as never;
    if (path === '/roles') return [{ code: 'HR', label: 'Recursos Humanos', permissions: [] }] as never;
    if (path === '/organization') return structuredClone(organization) as never;
    if (path === '/teams') return structuredClone(teams) as never;
    throw new Error(`Unexpected path: ${path}`);
  });
  vi.mocked(api.patch).mockResolvedValue(record as never); vi.mocked(api.post).mockResolvedValue(record as never);
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><UsersPage /></QueryClientProvider>);
  return client;
}
async function edit() {
  show(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Alterar acesso' }));
  await screen.findByLabelText('Empresa A'); return user;
}

describe('Escopo autorizado e desativação explícita de usuários', () => {
  it('limpar prazo opcional envia remoção explícita, sem alterar os demais vínculos', async () => {
    currentRecord.scope.expiresAt = new Date(Date.now() + 86400000).toISOString();
    const user = await edit();
    fireEvent.change(screen.getByLabelText('Concessão válida até (São Paulo)'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ scope: { companyIds: ['company-a'], unitIds: ['unit-a'], teamIds: ['team-a'], expiresAt: null } });
  });
  it('filtra empresas, unidades e equipes e exige o vínculo selecionado', async () => {
    const user = await edit();
    expect(screen.queryByLabelText('Empresa OUTSIDE')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Unidade B')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Equipe B')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Empresa B'));
    await user.click(await screen.findByLabelText('Unidade B'));
    await user.click(await screen.findByLabelText('Equipe B'));
    expect(screen.queryByLabelText('Equipe OUTSIDE')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0]).toMatchObject(['/users/user-a/access', { scope: { companyIds: ['company-a', 'company-b'], unitIds: ['unit-a', 'unit-b'], teamIds: ['team-a', 'team-b'], sectorIds: [], ownOnly: false } }, { etag: '"7"' }]);
  });
  it('envia somente a empresa e equipe escolhidas no novo convite', async () => {
    show(); const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: 'Convidar usuário' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Nova pessoa' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@example.invalid' } });
    await user.click(await screen.findByLabelText('Recursos Humanos'));
    await user.click(screen.getByLabelText('Empresa B'));
    await user.click(await screen.findByLabelText('Unidade B'));
    await user.click(await screen.findByLabelText('Equipe B'));
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ displayName: 'Nova pessoa', email: 'nova@example.invalid', scope: { companyIds: ['company-b'], unitIds: ['unit-b'], teamIds: ['team-b'] } });
  });
  it('mantém seleções incompatíveis até remoção explícita e não amplia equipes silenciosamente', async () => {
    const user = await edit(); await user.click(screen.getByLabelText('Empresa B')); await user.click(screen.getByLabelText('Empresa A'));
    expect(screen.getByLabelText('Unidade incompatível · Unidade A')).toBeChecked();
    expect(screen.getByLabelText('Equipe incompatível · Equipe A')).toBeChecked();
    await user.click(screen.getByLabelText('Unidade B'));
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await screen.findByText(/As unidades devem pertencer às empresas selecionadas/);
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Equipe incompatível · Equipe A')).toBeChecked();
  });
  it('revisa pessoa, escopo e revisão antes de desativar, e cancelar não envia', async () => {
    const user = await edit(); await user.selectOptions(screen.getByLabelText('Situação'), 'DISABLED');
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmar desativação do acesso' });
    expect(confirmation).toHaveTextContent('Pessoa do teste · pessoa@example.invalid');
    expect(confirmation).toHaveTextContent('Empresa A'); expect(confirmation).toHaveTextContent('Unidade A'); expect(confirmation).toHaveTextContent('Equipe A');
    expect(within(confirmation).getByText('7')).toBeInTheDocument(); expect(api.patch).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole('button', { name: 'Voltar à edição' }));
    expect(screen.queryByRole('dialog', { name: 'Confirmar desativação do acesso' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Situação')).toHaveValue('DISABLED'); expect(api.patch).not.toHaveBeenCalled();
  });
  it('bloqueia edição e saída enquanto a desativação está sendo confirmada pela API', async () => {
    let finish!: (value: UserDto) => void; vi.mocked(api.patch).mockImplementation(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    const user = await edit(); await user.selectOptions(screen.getByLabelText('Situação'), 'DISABLED');
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar desativação' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Situação')).toBeDisabled(); expect(screen.getByLabelText('Empresa A')).toBeDisabled();
    expect(vi.mocked(api.patch).mock.calls[0]).toMatchObject(['/users/user-a/access', { status: 'DISABLED' }, { etag: '"7"' }]);
    const change = new Event('sesmt:before-context-change', { cancelable: true }); act(() => window.dispatchEvent(change)); expect(change.defaultPrevented).toBe(true);
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog', { name: 'Confirmar desativação do acesso' })).toBeInTheDocument();
    await act(async () => finish({ ...record, status: 'DISABLED', revision: 8 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('preserva o preenchimento após 412 e impede reenvio com a revisão antiga', async () => {
    const user = await edit(); await user.click(screen.getByLabelText('Empresa B')); await user.click(screen.getByLabelText('Unidade B')); await user.click(screen.getByLabelText('Equipe B'));
    currentRecord = { ...structuredClone(record), revision: 8 };
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Outra pessoa mudou este acesso.', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await screen.findByText(/Outra pessoa mudou este acesso/);
    expect(screen.getByLabelText('Empresa B')).toBeChecked(); expect(screen.getByLabelText('Equipe B')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Salvar acesso' })).toBeDisabled();
    expect(vi.mocked(api.patch).mock.calls[0][2]).toMatchObject({ etag: '"7"' });
    expect(api.patch).toHaveBeenCalledOnce();
  });
  it('recusa salvar uma concessão histórica que excede a autoridade do administrador', async () => {
    session.me!.scope.teamIds = ['team-b']; const user = await edit();
    expect(screen.getByText(/O acesso existente contém restrições fora da sua autoridade/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar acesso' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' })); expect(api.patch).not.toHaveBeenCalled();
  });
});
