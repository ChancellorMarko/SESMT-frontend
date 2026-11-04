import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeUserAccessEditor } from './NativeUserAccessEditor';
import { checkedUserAccess, checkedUserContext } from './native-users';
import { api, ApiError } from '../../shared/api/client';

const state = vi.hoisted(() => ({ allowed: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'access-test', can: () => state.allowed }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const id = '10000000-0000-4000-8000-000000000001', company = '10000000-0000-4000-8000-000000000002';
const role = { code: 'CUSTOM_ROLE', name: 'Perfil próprio da equipe', description: 'Descrição publicada pela API' };
const scope = { id: company, type: 'EMPRESA', name: 'Empresa autorizada', companyId: company, companyName: 'Empresa autorizada' };
const user = { id, name: 'Pessoa Cadastrada', email: 'pessoa@example.invalid', roles: [role.code], scopeIds: [company], active: true };
const context = { action: 'criar', target: null, accessVersion: null, roles: [role], scopes: [scope] };
const editing = { ...context, action: 'editar', target: { ...user, roles: [] }, accessVersion: 'a'.repeat(64) };
const saved = vi.fn(), close = vi.fn();
function show(userId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={client}><NativeUserAccessEditor userId={userId} onClose={close} onSaved={saved}/></QueryClientProvider>);
}
function choose() {
  fireEvent.click(screen.getByRole('checkbox', { name: /Perfil próprio/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Empresa autorizada/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo/ }));
}
beforeEach(() => { vi.clearAllMocks(); state.allowed = true; vi.mocked(api.get).mockResolvedValue(context as never); });

describe('gestão nativa de contas e acessos', () => {
  it('carrega o catálogo autorizado e cria uma conta sem solicitar ou enviar senha', async () => {
    show(); await screen.findByLabelText('Nome');
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: user.name } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'PESSOA@example.invalid' } });
    choose(); vi.mocked(api.post).mockResolvedValue(user as never);
    vi.mocked(api.get).mockResolvedValueOnce(context as never).mockResolvedValueOnce([user] as never);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar usuário' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(true));
    expect(api.post).toHaveBeenCalledWith('/users', { name: user.name, email: user.email, roles: [role.code], scopeIds: [company] }, expect.objectContaining({ signal: expect.any(AbortSignal), idempotencyKey: undefined }));
    expect(api.get).toHaveBeenLastCalledWith('/users', expect.anything());
  });

  it('exige confirmação e a retira quando os perfis ou locais mudam', async () => {
    show(); await screen.findByLabelText('Nome');
    expect(screen.getByRole('button', { name: 'Cadastrar usuário' })).toBeDisabled();
    choose(); expect(screen.getByRole('button', { name: 'Cadastrar usuário' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Perfil próprio/ }));
    expect(screen.getByRole('checkbox', { name: /Confirmo/ })).not.toBeChecked();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('mantém o preenchimento e permite corrigir e-mail duplicado', async () => {
    show(); await screen.findByLabelText('Nome');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: user.name } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } }); choose();
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, { code: 'DUPLICATE_EMAIL', message: 'privado', requestId: 'qa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar usuário' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe uma conta');
    expect(screen.getByLabelText('E-mail')).toHaveValue(user.email);
    expect(screen.getByRole('button', { name: 'Cadastrar usuário' })).toBeEnabled();
    expect(saved).not.toHaveBeenCalled();
  });

  it('impede cadastro quando não há locais e não fabrica opções', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...context, scopes: [] } as never); show();
    expect(await screen.findByText(/Não há locais disponíveis/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cadastrar usuário' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('recusa consulta e não reutiliza dados quando falta a permissão', () => {
    state.allowed = false; show();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
  });

  it('salva perfis e escopos em um único comando com a versão revisada', async () => {
    vi.mocked(api.get).mockResolvedValue(editing as never); show(id);
    await screen.findByRole('checkbox', { name: /Perfil próprio/ });
    fireEvent.click(screen.getByRole('checkbox', { name: /Perfil próprio/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo/ }));
    vi.mocked(api.put).mockResolvedValue({ user, accessVersion: 'b'.repeat(64) } as never);
    vi.mocked(api.get).mockResolvedValueOnce(editing as never).mockResolvedValueOnce([user] as never);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar acessos' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(false));
    expect(api.put).toHaveBeenCalledWith(`/users/${id}/access`, { roles: [role.code], scopeIds: [company], expectedVersion: editing.accessVersion, confirmation: true }, expect.anything());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('preserva a seleção e bloqueia gravação se outra pessoa alterar os acessos', async () => {
    vi.mocked(api.get).mockResolvedValue(editing as never); show(id);
    await screen.findByRole('checkbox', { name: /Perfil próprio/ });
    fireEvent.click(screen.getByRole('checkbox', { name: /Perfil próprio/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo/ }));
    vi.mocked(api.get).mockResolvedValue({ ...editing, accessVersion: 'c'.repeat(64) } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar acessos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('mudaram');
    expect(screen.getByRole('checkbox', { name: /Perfil próprio/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Salvar acessos' })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('não repete uma criação cujo resultado se perdeu', async () => {
    show(); await screen.findByLabelText('Nome');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: user.name } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } }); choose();
    vi.mocked(api.post).mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar usuário' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulte a lista atualizada');
    expect(screen.getByRole('button', { name: 'Cadastrar usuário' })).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
  });

  it('não confirma sucesso com um recibo válido que não corresponde aos acessos escolhidos', async () => {
    vi.mocked(api.get).mockResolvedValue(editing as never); show(id); await screen.findByRole('checkbox', { name: /Perfil próprio/ });
    fireEvent.click(screen.getByRole('checkbox', { name: /Perfil próprio/ })); fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo/ }));
    vi.mocked(api.put).mockResolvedValue({ user: { ...user, roles: [] }, accessVersion: 'b'.repeat(64) } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar acessos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou'); expect(saved).not.toHaveBeenCalled();
  });

  it.each([{ ...context, action: 'editar' }, { ...context, roles: [role, role] }, { ...context, scopes: [scope, scope] }, { ...editing, target: { ...user, scopeIds: [id] } }])('recusa catálogo inconsistente: %j', value => {
    expect(() => checkedUserContext(value, value.action === 'editar' ? 'editar' : 'criar', id)).toThrow();
  });
  it('recusa recibo de outra conta e versão que não mudou', () => {
    expect(() => checkedUserAccess({ user, accessVersion: 'a'.repeat(64) }, id, user.roles, user.scopeIds, 'a'.repeat(64))).toThrow();
    expect(() => checkedUserAccess({ user, accessVersion: 'b'.repeat(64) }, company, user.roles, user.scopeIds, 'a'.repeat(64))).toThrow();
  });
});
