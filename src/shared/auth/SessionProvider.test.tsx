import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeDto, SessionDto } from '../contracts';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), cancel: vi.fn(), clear: vi.fn(), csrf: vi.fn(), renew: vi.fn(), token: vi.fn(), expired: vi.fn() }));
const authContract = vi.hoisted(() => ({ kind: 'adapter', mePath: '/me' }));
vi.mock('../api/auth-contract', () => ({ AUTH_CONTRACT: authContract }));
vi.mock('../api/client', async (original) => ({
  ...await original<typeof import('../api/client')>(),
  api: { get: http.get, post: http.post }, cancelAllRequests: http.cancel, clearCredentials: http.clear,
  obtainCsrf: http.csrf, renewSession: http.renew, setAccessToken: http.token, setExpiredHandler: http.expired,
}));
import { SessionProvider, useSession } from './SessionProvider';
import { ApiError } from '../api/client';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (value: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const session: SessionDto = { accessToken: 'access-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
const identity: MeDto = { user: { id: 'user-new', displayName: 'Usuário atual', email: 'atual@example.test' }, roles: ['TECNICO'], permissions: ['trabalhador:ler'], scope: { companyIds: ['company-1'], unitIds: ['unit-1', 'unit-2'], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt };
let current!: ReturnType<typeof useSession>;
function Probe() { current = useSession(); return <><output aria-label="Status">{current.status}</output><output aria-label="Identidade">{current.me?.user.displayName}</output><output aria-label="Erro">{current.sessionError}</output></>; }
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><SessionProvider><Probe/></SessionProvider></QueryClientProvider>); }

beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear();
  authContract.kind = 'adapter'; authContract.mePath = '/me';
  http.csrf.mockResolvedValue(undefined); http.renew.mockResolvedValue(session); http.post.mockResolvedValue(session); http.get.mockResolvedValue(identity);
});
afterEach(() => { vi.useRealTimers(); });

describe('isolamento do ciclo da sessão', () => {
  it('relê permissões e escopos sem rotacionar o refresh token nem trocar a chave da sessão', async () => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    const key = current.sessionKey; act(() => current.setUnitId('unit-2'));
    http.renew.mockClear(); http.post.mockClear(); http.clear.mockClear();
    const expanded = { ...identity, permissions: ['trabalhador:ler', 'unidade:criar'], scope: { ...identity.scope, companyIds: ['company-1', 'company-2'], unitIds: ['unit-1', 'unit-2', 'unit-3'] } };
    http.get.mockResolvedValue(expanded);
    await act(() => current.reloadIdentity());
    expect(http.renew).not.toHaveBeenCalled(); expect(http.post).not.toHaveBeenCalled(); expect(http.clear).not.toHaveBeenCalled();
    expect(current.me).toEqual(expanded); expect(current.can('unidade:criar')).toBe(true);
    expect(current.sessionKey).toBe(key); expect(current.unitId).toBe('unit-2'); expect(current.status).toBe('authenticated');
  });
  it('na releitura, troca a unidade removida do escopo e restaura a sessão se a conta mudou', async () => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    act(() => current.setUnitId('unit-2'));
    http.get.mockResolvedValue({ ...identity, scope: { ...identity.scope, unitIds: ['unit-1'] } });
    await act(() => current.reloadIdentity());
    expect(current.unitId).toBe('unit-1');
    http.renew.mockClear();
    http.get.mockResolvedValue({ ...identity, user: { ...identity.user, id: 'other-user' } });
    await act(() => current.reloadIdentity());
    expect(http.renew).toHaveBeenCalledTimes(1);
  });
  it('aceita o catálogo nativo de uma função nova, preserva o contrato original e não concede escrita', async () => {
    const native = { ...identity, roles: ['PERFIL_CRIADO_NA_API'], permissions: ['documento:ler', 'recurso_novo:consultar'] };
    http.get.mockResolvedValue(native);
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    expect(current.me?.permissions).toEqual(native.permissions);
    expect(current.can('documents.read')).toBe(true);
    expect(current.can('recurso_novo:consultar')).toBe(true);
    expect(current.can('documents.write')).toBe(false);
    expect(current.can('users.manage')).toBe(false);
  });
  it.each([{ kind: 'native', path: '/auth/me' }, { kind: 'adapter', path: '/me' }])('consulta a identidade pelo contrato $kind configurado', async ({ kind, path }) => {
    authContract.kind = kind; authContract.mePath = path;
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    expect(http.get).toHaveBeenCalledWith(path);
    expect(current.me).toEqual(identity);
  });

  it('mantém a restauração anônima quando a API nativa retorna somente userId', async () => {
    authContract.kind = 'native'; authContract.mePath = '/auth/me';
    http.get.mockResolvedValue({ userId: 'user-new' });
    mount(); await waitFor(() => expect(current.status).toBe('anonymous'));
    expect(current.sessionError).toContain('carregar seu perfil e suas permissões');
    expect(current.me).toBeNull(); expect(current.unitId).toBeUndefined();
    expect(current.can('trabalhador:ler')).toBe(false); expect(http.clear).toHaveBeenCalled();
  });

  it('remove identidade e permissões anteriores se o novo login não carrega um perfil completo', async () => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    expect(current.can('trabalhador:ler')).toBe(true);
    http.clear.mockClear(); http.get.mockResolvedValueOnce({ userId: 'another-account', roles: ['ADMIN'] });
    await act(async () => { await expect(current.login('outro@example.test', 'secret')).rejects.toThrow('carregar seu perfil e suas permissões'); });
    expect(current.status).toBe('anonymous'); expect(current.me).toBeNull();
    expect(current.unitId).toBeUndefined(); expect(current.can('trabalhador:ler')).toBe(false);
    expect(http.clear).toHaveBeenCalledTimes(2);
  });

  it.each(['native', 'adapter'])('explica perfil indisponível quando a rota de identidade retorna 404 no contrato %s', async kind => {
    authContract.kind = kind; authContract.mePath = kind === 'native' ? '/auth/me' : '/me';
    http.get.mockRejectedValue(new ApiError(404, { code: 'NOT_FOUND', message: 'Recurso não encontrado.', requestId: 'test' }));
    mount(); await waitFor(() => expect(current.status).toBe('anonymous'));
    expect(current.sessionError).toContain('carregar seu perfil e suas permissões');
    expect(current.me).toBeNull(); expect(http.clear).toHaveBeenCalled();
  });

  it('preserva a mensagem de indisponibilidade temporária ao carregar a identidade', async () => {
    http.get.mockRejectedValue(new ApiError(503, { code: 'SERVICE_UNAVAILABLE', message: 'Serviço temporariamente indisponível.', requestId: 'test' }));
    mount(); await waitFor(() => expect(current.status).toBe('anonymous'));
    expect(current.sessionError).toBe('Serviço temporariamente indisponível.');
    expect(current.me).toBeNull();
  });

  it('explica MFA_REQUIRED nativo sem criar desafio ou autenticar a conta', async () => {
    authContract.kind = 'native'; authContract.mePath = '/auth/me';
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    http.get.mockClear(); http.post.mockRejectedValueOnce(new ApiError(403, { code: 'MFA_REQUIRED', message: 'Não foi possível autenticar.', requestId: 'test' }));
    await act(async () => { await expect(current.login('atual@example.test', 'secret')).rejects.toThrow('Sua conta exige uma verificação adicional. Procure o administrador para concluir o acesso.'); });
    expect(http.get).not.toHaveBeenCalled(); expect(current.status).toBe('anonymous'); expect(current.me).toBeNull();
  });

  it('recusa uma concessão já expirada mesmo quando o perfil completo é válido', async () => {
    http.get.mockResolvedValue({ ...identity, scope: { ...identity.scope, expiresAt: '2020-01-01T00:00:00Z' } });
    mount(); await waitFor(() => expect(current.status).toBe('anonymous'));
    expect(current.sessionError).toContain('concessão de acesso expirou');
    expect(current.me).toBeNull(); expect(current.can('trabalhador:ler')).toBe(false);
  });

  it.each(['login', 'mfa'] as const)('sincroniza o CSRF rotacionado após %s antes de buscar a identidade', async method => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    const events: string[] = [];
    http.csrf.mockImplementation(async () => { events.push('csrf'); });
    http.post.mockImplementation(async (path: string) => { events.push(path); return session; });
    http.get.mockImplementation(async (path: string) => { events.push(path); return identity; });
    await act(async () => {
      if (method === 'login') await current.login('atual@example.test', 'secret');
      else await current.verifyMfa('challenge-1', '123456');
    });
    expect(events).toEqual(['csrf', method === 'login' ? '/auth/login' : '/auth/mfa/verify', 'csrf', '/me']);
    expect(current.status).toBe('authenticated');
  });

  it('um desafio MFA ainda não autenticado não sincroniza a proteção pós-login nem busca identidade', async () => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    http.csrf.mockClear(); http.get.mockClear();
    const challenge = { status: 'MFA_REQUIRED', challengeId: 'challenge-1', methods: ['TOTP'], expiresAt: '2099-01-01T00:00:00Z' };
    http.post.mockResolvedValueOnce(challenge);
    await act(async () => { expect(await current.login('atual@example.test', 'secret')).toEqual(challenge); });
    expect(http.csrf).toHaveBeenCalledTimes(1);
    expect(http.get).not.toHaveBeenCalled();
    expect(current.status).toBe('anonymous');
  });

  it.each(['login', 'mfa'] as const)('não estabelece a sessão se a sincronização CSRF após %s falhar', async method => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    http.csrf.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Não foi possível sincronizar o CSRF.'));
    http.get.mockClear(); http.token.mockClear();
    await act(async () => {
      const authentication = method === 'login' ? current.login('atual@example.test', 'secret') : current.verifyMfa('challenge-1', '123456');
      await expect(authentication).rejects.toThrow('Não foi possível sincronizar o CSRF.');
    });
    expect(http.get).not.toHaveBeenCalled(); expect(http.token).not.toHaveBeenCalled();
    expect(current.status).toBe('anonymous'); expect(current.me).toBeNull();
  });

  it.each(['login', 'mfa'] as const)('logout durante a sincronização CSRF após %s impede a autenticação antiga', async method => {
    mount(); await waitFor(() => expect(current.status).toBe('authenticated'));
    const rotated = deferred<void>();
    http.csrf.mockResolvedValueOnce(undefined).mockReturnValueOnce(rotated.promise);
    http.csrf.mockClear(); http.get.mockClear(); http.token.mockClear();
    let authentication!: Promise<unknown>;
    act(() => { authentication = method === 'login' ? current.login('atual@example.test', 'secret') : current.verifyMfa('challenge-1', '123456'); });
    const outcome = authentication.then(value => ({ value }), error => ({ error }));
    await waitFor(() => expect(http.csrf).toHaveBeenCalledTimes(2));
    await act(async () => { await current.logout(); });
    await act(async () => {
      rotated.resolve();
      expect(await outcome).toMatchObject({ error: { name: 'AbortError' } });
    });
    expect(http.get).not.toHaveBeenCalled(); expect(http.token).not.toHaveBeenCalledWith(session.accessToken);
    expect(current.status).toBe('anonymous'); expect(current.me).toBeNull();
  });

  it('remove o acesso local imediatamente mesmo quando a revogação remota ainda aguarda resposta', async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated'));
    const remote = deferred<unknown>(); http.post.mockReturnValueOnce(remote.promise);
    let logout!: Promise<void>;
    act(() => { logout = current.logout(); });
    expect(http.post).toHaveBeenCalledWith('/auth/logout');
    expect(screen.getByLabelText('Status')).toHaveTextContent('anonymous');
    expect(screen.getByLabelText('Identidade')).toBeEmptyDOMElement();
    expect(current.can('trabalhador:ler')).toBe(false);
    expect(http.token).toHaveBeenLastCalledWith(null);
    await act(async () => { remote.reject(new TypeError('Failed to fetch')); await logout; });
    expect(screen.getByLabelText('Erro')).toHaveTextContent('revogação na API não foi confirmada');
    expect(sessionStorage.getItem('sesmt.logoutPending')).toBe('1');
  });

  it('uma restauração antiga cancelada não encerra o login que já terminou', async () => {
    const oldRestore = deferred<SessionDto>(); http.renew.mockReturnValueOnce(oldRestore.promise);
    mount();
    await waitFor(() => expect(http.renew).toHaveBeenCalledTimes(1));
    await act(async () => { await current.login('atual@example.test', 'secret'); });
    expect(screen.getByLabelText('Identidade')).toHaveTextContent('Usuário atual');
    await act(async () => { oldRestore.reject(new DOMException('Sessão alterada.', 'AbortError')); });
    expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated');
    expect(screen.getByLabelText('Identidade')).toHaveTextContent('Usuário atual');
    expect(screen.getByLabelText('Erro')).toBeEmptyDOMElement();
  });

  it('um logout remoto antigo não limpa o acesso estabelecido depois', async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated'));
    const oldLogout = deferred<unknown>(); http.post.mockImplementation((path: string) => path === '/auth/logout' ? oldLogout.promise : Promise.resolve(session));
    let logout!: Promise<void>;
    act(() => { logout = current.logout(); });
    await act(async () => { await current.login('atual@example.test', 'secret'); });
    await act(async () => { oldLogout.reject(new DOMException('Requisição cancelada.', 'AbortError')); await logout; });
    expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated');
    expect(screen.getByLabelText('Identidade')).toHaveTextContent('Usuário atual');
    expect(screen.getByLabelText('Erro')).toBeEmptyDOMElement();
  });

  it('uma concessão de quarenta dias não expira imediatamente por overflow do temporizador', async () => {
    vi.useFakeTimers();
    http.get.mockResolvedValue({ ...identity, scope: { ...identity.scope, expiresAt: new Date(Date.now() + 40 * 86400000).toISOString() } });
    mount();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated');
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * 86400000); });
    expect(screen.getByLabelText('Status')).toHaveTextContent('anonymous');
    expect(screen.getByLabelText('Erro')).toHaveTextContent('concessão de acesso expirou');
  });

  it('trocar para a unidade já selecionada mantém as consultas e a sessão', async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated'));
    http.cancel.mockClear();
    act(() => current.setUnitId('unit-1'));
    expect(http.cancel).not.toHaveBeenCalled();
    expect(current.unitId).toBe('unit-1');
  });

  it('descarta a identidade que chega depois do logout sem restaurar permissões', async () => {
    const oldIdentity = deferred<MeDto>(); http.get.mockReturnValueOnce(oldIdentity.promise);
    mount(); await waitFor(() => expect(http.get).toHaveBeenCalledTimes(1));
    await act(async () => { await current.logout(); });
    await act(async () => { oldIdentity.resolve(identity); });
    expect(screen.getByLabelText('Status')).toHaveTextContent('anonymous');
    expect(screen.getByLabelText('Identidade')).toBeEmptyDOMElement();
    expect(current.can('trabalhador:ler')).toBe(false);
  });

  it('não aceita unidade fora do escopo e cancela as consultas ao mudar para outra permitida', async () => {
    mount(); await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated'));
    http.cancel.mockClear();
    act(() => current.setUnitId('unit-forbidden'));
    expect(current.unitId).toBe('unit-1');
    expect(http.cancel).not.toHaveBeenCalled();
    act(() => current.setUnitId('unit-2'));
    expect(current.unitId).toBe('unit-2');
    expect(http.cancel).toHaveBeenCalledTimes(1);
  });

  it('obtém novamente a proteção CSRF ao tentar outro código MFA depois de um código inválido', async () => {
    http.renew.mockRejectedValueOnce(new Error('Sem sessão inicial'));
    mount(); await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('anonymous'));
    http.post.mockResolvedValueOnce({ status: 'MFA_REQUIRED', challengeId: 'challenge-1', methods: ['TOTP'], expiresAt: '2099-01-01T00:00:00Z' });
    await act(async () => { await current.login('atual@example.test', 'secret'); });
    http.post.mockRejectedValueOnce(new Error('Código inválido'));
    await act(async () => { await expect(current.verifyMfa('challenge-1', '000000')).rejects.toThrow('Código inválido'); });
    http.csrf.mockClear();
    await act(async () => { await current.verifyMfa('challenge-1', '123456'); });
    expect(http.csrf).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Status')).toHaveTextContent('authenticated');
  });
});
