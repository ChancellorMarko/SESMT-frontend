import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentTypeDto, OrganizationDto, UserDto } from '../../shared/contracts';
import { api, ApiError } from '../../shared/api/client';
import { UsersPage } from './UsersPage';
import { DocumentTypesPage } from './DocumentTypesPage';
import { OrganizationPage } from '../organization/OrganizationPage';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: () => true, me: { scope: { companyIds: ['company-a', 'company-b'], unitIds: ['unit-a', 'unit-b'], sectorIds: [], teamIds: [], ownOnly: false } } }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

const userRecord: UserDto = { id: 'user-a', displayName: 'Pessoa de teste', email: 'pessoa@example.invalid', roles: ['HR'], scope: { companyIds: ['company-a'], unitIds: ['unit-a'], sectorIds: [], teamIds: [], ownOnly: false }, status: 'ACTIVE', mfaRequired: false, revision: 1 };
const typeRecord: DocumentTypeDto = { id: 'type-a', revision: 1, code: 'DOC', name: 'Documento de teste', category: 'Administrativo', requiredFields: ['title'], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 0 }, retentionPolicyReference: { code: 'POL', version: '1', source: 'Política de teste' }, workflow: { reviewRequired: true, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false } };
const organization: OrganizationDto = {
  companies: [{ id: 'company-a', name: 'Empresa Alfa', status: 'ACTIVE', revision: 1 }, { id: 'company-b', name: 'Empresa Beta', status: 'ACTIVE', revision: 1 }],
  units: [{ id: 'unit-a', name: 'Unidade Alfa', companyId: 'company-a', status: 'ACTIVE', revision: 1 }, { id: 'unit-b', name: 'Unidade Beta', companyId: 'company-b', status: 'ACTIVE', revision: 1 }],
  establishments: [], sectors: [], jobs: [], jobFunctions: [], workCenters: [],
};
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length });
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/users') return page([userRecord]) as never;
    if (path === '/document-types') return page([typeRecord]) as never;
    if (path === '/roles') return [{ code: 'HR', label: 'Recursos Humanos', permissions: [] }] as never;
    if (path === '/organization') return structuredClone(organization) as never;
    return page([]) as never;
  });
});
function show(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>) };
}
function contextAllowed() {
  const event = new Event('sesmt:before-context-change', { cancelable: true });
  act(() => { window.dispatchEvent(event); });
  return !event.defaultPrevented;
}

describe('Proteção dos formulários administrativos', () => {
  it('mantém o modal organizacional e seu preenchimento após falha de atualização', async () => {
    const { client } = show(<OrganizationPage />);
    await screen.findByRole('heading', { name: 'Cadastros organizacionais' });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar unidade' }));
    const name = screen.getByLabelText('Nome *');
    fireEvent.change(name, { target: { value: 'Unidade em preparação' } });
    vi.mocked(api.get).mockRejectedValue(new Error('Conexão interrompida.'));
    await act(async () => { await client.refetchQueries({ queryKey: ['organization'] }); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome *')).toHaveValue('Unidade em preparação');
  });

  it('preserva convite alterado ao fechar ou trocar contexto e libera depois de descartar', async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    show(<UsersPage />); await user.click(screen.getByRole('button', { name: 'Convidar usuário' }));
    fireEvent.change(await screen.findByLabelText('Nome'), { target: { value: 'Convite ainda não enviado' } });
    await user.click(screen.getByRole('button', { name: 'Fechar janela' }));
    expect(screen.getByRole('dialog', { name: 'Convidar usuário' })).toBeInTheDocument();
    expect(contextAllowed()).toBe(false);
    const exit = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(exit); expect(exit.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true); await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(contextAllowed()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('mantém o acesso aberto e os campos bloqueados enquanto a gravação está pendente', async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let finish!: (value: UserDto) => void;
    vi.mocked(api.patch).mockImplementation(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    show(<UsersPage />); await user.click(await screen.findByRole('button', { name: 'Alterar acesso' }));
    await user.click(await screen.findByLabelText('Restringir aos dados próprios'));
    await user.click(screen.getByRole('button', { name: 'Salvar acesso' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Restringir aos dados próprios')).toBeDisabled();
    await user.keyboard('{Escape}'); await user.click(screen.getByRole('button', { name: 'Fechar janela' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(contextAllowed()).toBe(false); expect(confirm).not.toHaveBeenCalled();
    await act(async () => { finish(userRecord); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(contextAllowed()).toBe(true);
  });
  it('protege alterações e gravação de políticas documentais', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'confirm').mockReturnValue(false);
    let finish!: (value: DocumentTypeDto) => void;
    vi.mocked(api.patch).mockImplementation(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    show(<DocumentTypesPage />); await user.click(await screen.findByRole('button', { name: 'Editar política' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Código' }), { target: { value: 'DOC-NOVO' } });
    await user.keyboard('{Escape}'); expect(screen.getByRole('textbox', { name: 'Código' })).toHaveValue('DOC-NOVO'); expect(contextAllowed()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Salvar política' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(screen.getByRole('textbox', { name: 'Código' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Fechar janela' })); expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { finish(typeRecord); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('recarrega a lista após conflito sem substituir os campos do editor aberto', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'confirm').mockReturnValue(true);
    show(<DocumentTypesPage />); await user.click(await screen.findByRole('button', { name: 'Editar política' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Código' }), { target: { value: 'MINHA-EDICAO' } });
    vi.mocked(api.get).mockResolvedValue(page([{ ...typeRecord, code: 'ATUALIZADO', revision: 2 }]) as never);
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Outra pessoa alterou a política.', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar política' }));
    await screen.findByText(/Outra pessoa alterou a política/);
    expect(screen.getByRole('textbox', { name: 'Código' })).toHaveValue('MINHA-EDICAO');
    await screen.findByText('ATUALIZADO');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Editar política' }));
    expect(screen.getByRole('textbox', { name: 'Código' })).toHaveValue('ATUALIZADO');
    vi.mocked(api.patch).mockResolvedValue({ ...typeRecord, revision: 3 } as never);
    await user.click(screen.getByRole('button', { name: 'Salvar política' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patch).mock.calls[1][2]).toMatchObject({ etag: '"2"' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('considera a troca isolada de empresa como alteração de cadastro organizacional', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'confirm').mockReturnValue(false);
    show(<OrganizationPage />); await screen.findByRole('heading', { name: 'Cadastros organizacionais' });
    await user.click(screen.getByRole('button', { name: 'Cadastrar unidade' }));
    await user.selectOptions(screen.getByLabelText('Empresa *'), 'company-b');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByLabelText('Empresa *')).toHaveValue('company-b'); expect(contextAllowed()).toBe(false);
  });
  it('considera a troca isolada de unidade como alteração de setor', async () => {
    const user = userEvent.setup(); vi.spyOn(window, 'confirm').mockReturnValue(false);
    show(<OrganizationPage />); await screen.findByRole('heading', { name: 'Cadastros organizacionais' });
    await user.click(screen.getByRole('button', { name: /Setores/ }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar setor' }));
    await user.selectOptions(screen.getByLabelText('Unidade *'), 'unit-b');
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Unidade *')).toHaveValue('unit-b'); expect(contextAllowed()).toBe(false);
  });
});
