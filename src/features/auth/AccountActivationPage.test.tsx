import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, obtainCsrf } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AccountInvitationAcceptDto, AccountInvitationInspectDto } from '../../shared/contracts/account-invitations';
import { AccountActivationPage } from './AccountActivationPage';

const settings = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), API_MODE: 'demo', obtainCsrf: vi.fn(), api: { post: vi.fn() } }));
vi.mock('../../shared/motion/MotionPreferences', () => ({ useAppReducedMotion: () => true }));
vi.mock('./LoginArrival', () => ({ useLoginArrival: () => 'ready', LoginPreloader: () => null }));
vi.mock('./account-invitations', async original => ({ ...await original<typeof import('./account-invitations')>(), accountInvitationsEnabled: () => settings.enabled }));

const token = 'invite-test-token-123';
const password = 'Senha pessoal de teste';
const inspected: AccountInvitationInspectDto = {
  invitationId: 'invitation-1', displayName: 'Pessoa convidada', emailMasked: 'p•••••@example.invalid',
  expiresAt: '2099-01-01T00:00:00Z', mfaRequired: false, passwordPolicy: { minLength: 15, maxLength: 128 },
};
const accepted: AccountInvitationAcceptDto = { invitationId: 'invitation-1', nextStep: 'LOGIN' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function Navigation() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/ativar-acesso#token=another-invite-token-456')}>Trocar o link</button>;
}
function tree(path: string) {
  return <MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/ativar-acesso" element={<><AccountActivationPage /><Navigation /></>} />
    <Route path="/login" element={<h1>Login de teste</h1>} />
    <Route path="/app" element={<h1>Área protegida</h1>} />
  </Routes></MemoryRouter>;
}
function show(path = `/ativar-acesso#token=${token}`) {
  const view = render(tree(path));
  return { ...view, user: userEvent.setup() };
}
async function fillPasswords(user: ReturnType<typeof userEvent.setup>, value = password, confirmation = value) {
  const first = await screen.findByLabelText('Nova senha', { exact: true });
  await user.type(first, value);
  await user.type(screen.getByLabelText('Confirmar nova senha', { exact: true }), confirmation);
  return first;
}
const acceptanceCalls = () => vi.mocked(api.post).mock.calls.filter(([path]) => path === '/auth/invitations/accept');

beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); settings.enabled = true;
  vi.mocked(obtainCsrf).mockResolvedValue(undefined);
  vi.mocked(useSession).mockReturnValue({
    me: null, unitId: undefined, sessionKey: 'anonymous-a', status: 'anonymous', sessionError: null,
    can: () => false, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn(), reloadIdentity: vi.fn(),
  });
  vi.mocked(api.post).mockImplementation(async path => {
    if (path === '/auth/invitations/inspect') return structuredClone(inspected) as never;
    if (path === '/auth/invitations/accept') return structuredClone(accepted) as never;
    throw new Error(`Unexpected path: ${path}`);
  });
});

describe('primeiro acesso por convite de conta', () => {
  it('não consulta nem aceita enquanto a sessão está sendo restaurada', async () => {
    const anonymous = vi.mocked(useSession).getMockImplementation()!();
    vi.mocked(useSession).mockReturnValue({ ...anonymous, status: 'restoring' });
    const view = show();
    expect(screen.getByRole('heading', { name: 'Preparando seu primeiro acesso' })).toBeVisible();
    expect(api.post).not.toHaveBeenCalled(); expect(obtainCsrf).not.toHaveBeenCalled();
    vi.mocked(useSession).mockReturnValue(anonymous);
    view.rerender(tree(`/ativar-acesso#token=${token}`));
    expect(await screen.findByLabelText('Nova senha', { exact: true })).toBeVisible();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('não chama os contratos propostos quando a funcionalidade está desabilitada', () => {
    settings.enabled = false;
    show();
    expect(screen.getByRole('heading', { name: 'Ativação de conta' })).toBeVisible();
    expect(screen.getByText(/ainda não está disponível neste ambiente/)).toBeVisible();
    expect(api.post).not.toHaveBeenCalled(); expect(obtainCsrf).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Código do convite')).not.toBeInTheDocument();
  });

  it('pede encerramento explícito da conta aberta e não associa o convite à sessão atual', async () => {
    const anonymous = vi.mocked(useSession).getMockImplementation()!();
    const logout = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useSession).mockReturnValue({ ...anonymous, status: 'authenticated', logout, me: {
      user: { id: 'admin-1', displayName: 'Administrador atual', email: 'admin@example.invalid' }, roles: ['ADMIN'], permissions: ['users.manage'],
      scope: { companyIds: ['company-a'], unitIds: ['unit-a'], teamIds: [], sectorIds: [], ownOnly: false }, accessExpiresAt: '2099-01-01T00:00:00Z',
    } });
    const view = show();
    expect(screen.getByRole('heading', { name: 'Já existe uma conta aberta' })).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    await view.user.click(screen.getByRole('button', { name: 'Sair e continuar' }));
    expect(logout).toHaveBeenCalledTimes(1); expect(api.post).not.toHaveBeenCalled();
    vi.mocked(useSession).mockReturnValue({ ...anonymous, sessionKey: 'anonymous-b' });
    view.rerender(tree(`/ativar-acesso#token=${token}`));
    expect(await screen.findByLabelText('Nova senha', { exact: true })).toBeVisible();
  });

  it('confere o token do fragmento, mostra somente o e-mail mascarado e foca a senha', async () => {
    show();
    const input = await screen.findByLabelText('Nova senha', { exact: true });
    expect(api.post).toHaveBeenCalledWith('/auth/invitations/inspect', { token }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(obtainCsrf).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Pessoa convidada')).toBeVisible();
    expect(screen.getByText(inspected.emailMasked)).toBeVisible();
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText(/Use entre 15 e 128 caracteres/)).toBeVisible();
    expect(acceptanceCalls()).toHaveLength(0);
  });

  it('recebe código manual, recusa token com espaço interno e permite corrigir', async () => {
    const { user } = show('/ativar-acesso');
    const code = screen.getByLabelText('Código do convite');
    expect(code).toHaveAttribute('type', 'password'); expect(code).toHaveFocus();
    await user.type(code, 'invite com espaço');
    await user.click(screen.getByRole('button', { name: 'Conferir convite' }));
    expect(screen.getByRole('alert')).toHaveTextContent('sem espaços'); expect(api.post).not.toHaveBeenCalled();
    await user.clear(code); await user.type(code, token);
    await user.click(screen.getByRole('button', { name: 'Conferir convite' }));
    expect(await screen.findByLabelText('Nova senha', { exact: true })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('não usa um link com tokens repetidos e oferece o código manual', () => {
    show(`/ativar-acesso#token=${token}&token=another-token-123`);
    expect(screen.getByRole('alert')).toHaveTextContent('incompleto ou inválido');
    expect(screen.getByLabelText('Código do convite')).toHaveValue(''); expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    { ...inspected, expiresAt: '2020-01-01T00:00:00Z' },
    { ...inspected, passwordPolicy: { minLength: 50, maxLength: 15 } },
  ])('recusa metadados de inspeção incompatíveis antes de mostrar as senhas', async response => {
    vi.mocked(api.post).mockResolvedValueOnce(response as never);
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar os dados do convite');
    expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
    expect(acceptanceCalls()).toHaveLength(0);
  });

  it('explica falha de inspeção e deixa reenviar o mesmo código', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Não foi possível conferir agora.'));
    const { user } = show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir agora.');
    expect(screen.getByLabelText('Código do convite')).toHaveValue(token);
    await user.click(screen.getByRole('button', { name: 'Conferir convite' }));
    expect(await screen.findByLabelText('Nova senha', { exact: true })).toBeVisible();
  });

  it('valida política e confirmação, revela a senha sem alterá-la e não envia valores divergentes', async () => {
    const { user } = show();
    const first = await fillPasswords(user, 'curta', 'outra');
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByText('Use entre 15 e 128 caracteres.')).toBeVisible();
    expect(screen.getByText('As senhas devem ser iguais.')).toBeVisible();
    expect(first).toHaveAttribute('aria-invalid', 'true'); expect(acceptanceCalls()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Mostrar nova senha' }));
    expect(first).toHaveAttribute('type', 'text'); expect(first).toHaveValue('curta');
    await user.click(screen.getByRole('button', { name: 'Ocultar nova senha' }));
    expect(first).toHaveAttribute('type', 'password'); expect(first).toHaveValue('curta');
  });

  it('não duplica o aceite concorrente, limpa as senhas e leva o foco ao login sem autenticar automaticamente', async () => {
    const next = deferred<AccountInvitationAcceptDto>();
    vi.mocked(api.post).mockImplementation(async path => path === '/auth/invitations/inspect' ? structuredClone(inspected) as never : next.promise as never);
    const { user } = show(); const input = await fillPasswords(user);
    await act(async () => { fireEvent.submit(input.closest('form')!); fireEvent.submit(input.closest('form')!); });
    await waitFor(() => expect(acceptanceCalls()).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Preparando sua conta…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Usar outro convite' })).toBeDisabled();
    expect(acceptanceCalls()[0]).toMatchObject(['/auth/invitations/accept', { token, newPassword: password }, { idempotencyKey: expect.any(String) }]);
    expect(obtainCsrf).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve(accepted); });
    expect(await screen.findByRole('heading', { name: 'Sua conta está pronta' })).toBeVisible();
    const login = screen.getByRole('link', { name: 'Ir para o login' });
    await waitFor(() => expect(login).toHaveFocus());
    expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
    expect(vi.mocked(useSession).getMockImplementation()!().login).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Área protegida' })).not.toBeInTheDocument();
    await user.click(login); expect(screen.getByRole('heading', { name: 'Login de teste' })).toBeVisible();
  });

  it('reutiliza a chave de idempotência após falha transitória para a mesma senha e convite', async () => {
    let attempts = 0;
    vi.mocked(api.post).mockImplementation(async path => {
      if (path === '/auth/invitations/inspect') return structuredClone(inspected) as never;
      if (++attempts === 1) throw new Error('Conexão interrompida.');
      return structuredClone(accepted) as never;
    });
    const { user } = show(); await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Conexão interrompida.');
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByRole('heading', { name: 'Sua conta está pronta' })).toBeVisible();
    expect(acceptanceCalls()).toHaveLength(2);
    expect(acceptanceCalls()[0][2]?.idempotencyKey).toBe(acceptanceCalls()[1][2]?.idempotencyKey);
  });

  it('não inspeciona o convite sem proteção CSRF confirmada e permite nova tentativa', async () => {
    vi.mocked(obtainCsrf).mockRejectedValueOnce(new Error('Proteção de acesso indisponível.'));
    const { user } = show();
    expect(await screen.findByRole('alert')).toHaveTextContent('Proteção de acesso indisponível.');
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Conferir convite' }));
    expect(await screen.findByLabelText('Nova senha', { exact: true })).toBeVisible();
    expect(obtainCsrf).toHaveBeenCalledTimes(2);
  });

  it('não envia o aceite se a proteção CSRF falhar e conserva a senha para corrigir a conexão', async () => {
    const { user } = show(); await fillPasswords(user);
    vi.mocked(obtainCsrf).mockRejectedValueOnce(new Error('Não foi possível preparar a ativação.'));
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível preparar a ativação.');
    expect(acceptanceCalls()).toHaveLength(0);
    expect(screen.getByLabelText('Nova senha', { exact: true })).toHaveValue(password);
    expect(screen.getByRole('button', { name: 'Ativar minha conta' })).toBeEnabled();
  });

  it('não envia inspeção antiga quando a proteção CSRF termina depois de trocar o link', async () => {
    const protection = deferred<void>();
    vi.mocked(obtainCsrf).mockReturnValueOnce(protection.promise);
    const { user } = show();
    await waitFor(() => expect(obtainCsrf).toHaveBeenCalledOnce()); expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Trocar o link' }));
    expect(await screen.findByLabelText('Nova senha', { exact: true })).toBeVisible();
    await act(async () => { protection.resolve(undefined); });
    expect(api.post).toHaveBeenCalledOnce();
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ token: 'another-invite-token-456' });
  });

  it.each([
    { invitationId: 'outro-convite', nextStep: 'LOGIN' },
    { invitationId: inspected.invitationId, nextStep: 'DIRECT_ADMIN_SESSION' },
  ])('não confirma sucesso para recibo incompatível', async response => {
    vi.mocked(api.post).mockImplementation(async path => path === '/auth/invitations/inspect' ? structuredClone(inspected) as never : response as never);
    const { user } = show(); await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A resposta de ativação não pôde ser confirmada');
    expect(screen.queryByRole('heading', { name: 'Sua conta está pronta' })).not.toBeInTheDocument();
  });

  it.each(['MFA_SETUP_REQUIRED', 'WORKER_LINK_REQUIRED'] as const)('distingue senha definida de etapa %s ainda pendente e não abre a área interna', async nextStep => {
    vi.mocked(api.post).mockImplementation(async path => path === '/auth/invitations/inspect' ? { ...inspected, mfaRequired: nextStep === 'MFA_SETUP_REQUIRED' } as never : { ...accepted, nextStep } as never);
    const { user } = show(); await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByRole('heading', { name: 'Sua senha foi definida' })).toBeVisible();
    expect(screen.getByText(nextStep === 'MFA_SETUP_REQUIRED' ? /ainda depende da liberação deste ambiente/ : /Peça ao administrador para confirmar o vínculo com o trabalhador/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Sua conta está pronta' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para o login' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: /plataforma|área interna/i })).not.toBeInTheDocument();
  });

  it('limpa o preenchimento ao receber revogação e oferece outra conferência', async () => {
    vi.mocked(api.post).mockImplementation(async path => {
      if (path === '/auth/invitations/inspect') return structuredClone(inspected) as never;
      throw new ApiError(410, { code: 'INVITATION_REVOKED', message: 'Este convite foi revogado.', requestId: 'activation-test' });
    });
    const { user } = show(); await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este convite foi revogado.');
    expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar outro convite' }));
    expect(screen.getByLabelText('Código do convite')).toHaveValue('');
    await waitFor(() => expect(screen.getByLabelText('Código do convite')).toHaveFocus());
  });

  it('recusa aceite se a data expirar após a inspeção e apaga as senhas', async () => {
    const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(api.post).mockResolvedValueOnce({ ...inspected, expiresAt: new Date(now + 60_000).toISOString() } as never);
    const { user } = show(); await fillPasswords(user);
    clock.mockReturnValue(now + 60_001);
    await user.click(screen.getByRole('button', { name: 'Ativar minha conta' }));
    expect(await screen.findByText('O convite expirou. Solicite um novo convite ao administrador.')).toBeVisible();
    expect(acceptanceCalls()).toHaveLength(0);
    expect(screen.queryByLabelText('Nova senha', { exact: true })).not.toBeInTheDocument();
  });

  it('aborta a inspeção antiga ao trocar o link e não reapresenta sua resposta tardia', async () => {
    const old = deferred<AccountInvitationInspectDto>(); let previousSignal: AbortSignal | undefined;
    vi.mocked(api.post).mockImplementation(async (_path, body, options) => {
      if ((body as { token: string }).token === token) { previousSignal = options?.signal; return old.promise as never; }
      return { ...inspected, invitationId: 'invitation-2', displayName: 'Pessoa atual' } as never;
    });
    const { user } = show();
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Trocar o link' }));
    expect(await screen.findByText('Pessoa atual')).toBeVisible(); expect(previousSignal?.aborted).toBe(true);
    await act(async () => { old.resolve(inspected); });
    expect(screen.queryByText('Pessoa convidada')).not.toBeInTheDocument(); expect(screen.getByText('Pessoa atual')).toBeVisible();
  });
});
