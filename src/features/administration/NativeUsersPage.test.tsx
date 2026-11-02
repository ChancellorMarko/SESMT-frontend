import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeUsersPage } from './NativeUsersPage';
import { checkedNativeUsers } from './native-users';
import { api, ApiError } from '../../shared/api/client';

const state = vi.hoisted(() => ({ allowed: true, writes: false, sessionKey: 'native-read-test' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: state.sessionKey, me: { user: { id: 'another-user' } }, can: (permission: string) => state.allowed && (permission === 'users.read' || state.writes) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const user = { id: '10000000-0000-4000-8000-000000000001', name: 'Pessoa da API', email: 'person@example.invalid', active: true, roles: ['PERFIL_CRIADO_NO_BACKEND'], scopeIds: ['10000000-0000-4000-8000-000000000002'] };
function show(client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  return { ...render(<QueryClientProvider client={client}><NativeUsersPage/></QueryClientProvider>), client };
}
beforeEach(() => { vi.clearAllMocks(); state.allowed = true; state.writes = false; vi.mocked(api.get).mockResolvedValue([user] as never); });

describe('consulta de usuários no contrato nativo', () => {
  it('consulta o endpoint publicado, mostra perfis dinâmicos e não oferece comandos incompatíveis', async () => {
    show();
    expect(await screen.findByText(user.name)).toBeVisible();
    expect(screen.getByText(user.roles[0])).toBeVisible();
    expect(api.get).toHaveBeenCalledWith('/users', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.queryByRole('button', { name: /convidar|editar|desativar/i })).not.toBeInTheDocument();
    expect(screen.getByText('Escopo da conta · somente leitura')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Buscar por nome, e-mail ou perfil'), { target: { value: 'outra pessoa' } });
    expect(screen.queryByText(user.name)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nenhuma conta encontrada' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('não consulta nem reutiliza contas do cache quando a permissão é retirada', () => {
    state.allowed = false;
    const client = new QueryClient(); client.setQueryData(['native-users', state.sessionKey], [user]);
    show(client);
    expect(screen.queryByText(user.name)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('uma recusa da API oculta a lista anteriormente consultada', async () => {
    const { client } = show(); await screen.findByText(user.name);
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Detalhe privado', requestId: 'denied' }));
    await act(async () => { await client.invalidateQueries({ queryKey: ['native-users', state.sessionKey] }); });
    await waitFor(() => expect(screen.queryByText(user.name)).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('A API não autorizou');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Detalhe privado');
  });

  it.each([{}, [null], [{ ...user, roles: null }], [{ ...user, active: 'true' }], [{ ...user, id: '../users' }], [user, user]])('recusa respostas inválidas sem inventar campos: %j', value => {
    expect(() => checkedNativeUsers(value)).toThrow();
  });

  it('descarta campos adicionais que não pertencem à consulta pública de usuários', () => {
    expect(checkedNativeUsers([{ ...user, passwordHash: 'not-public' }])).toEqual([user]);
  });

  it('edita somente nome/e-mail no contrato publicado e mantém os campos após conflito', async () => {
    state.writes = true; show();
    fireEvent.click(await screen.findByRole('button', { name: `Editar ${user.name}` }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Nome atualizado' } });
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(409, { code: 'DUPLICATE_EMAIL', message: 'privado', requestId: 'test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este e-mail já está em uso');
    expect(screen.getByLabelText('Nome')).toHaveValue('Nome atualizado');
    vi.mocked(api.patch).mockResolvedValueOnce({ ...user, name: 'Nome atualizado' } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.patch).toHaveBeenLastCalledWith(`/users/${user.id}`, { name: 'Nome atualizado', email: user.email }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('exige confirmação antes de desativar e relê a lista após 204', async () => {
    state.writes = true; show();
    fireEvent.click(await screen.findByRole('button', { name: `Desativar ${user.name}` }));
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    vi.mocked(api.get).mockResolvedValueOnce([{ ...user, active: false }] as never);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desativação' }));
    expect(await screen.findByText('Inativo')).toBeVisible();
    expect(api.post).toHaveBeenCalledWith(`/users/${user.id}/deactivate`, undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
