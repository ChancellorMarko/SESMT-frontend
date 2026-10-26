import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../shared/auth/SessionProvider';
import { api, obtainCsrf } from '../../shared/api/client';
import type { MfaChallengeDto } from '../../shared/contracts';
import { LoginPage, RecoveryPage, ResetPasswordPage } from './AuthPages';

const runtime = vi.hoisted(() => ({ mode: 'demo' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../shared/api/client', () => ({ get API_MODE() { return runtime.mode; }, obtainCsrf: vi.fn(), api: { post: vi.fn() } }));
vi.mock('../../shared/motion/MotionPreferences', () => ({ useAppReducedMotion: () => true }));
vi.mock('./LoginArrival', () => ({ useLoginArrival: () => 'ready', LoginPreloader: () => null }));

const challenge: MfaChallengeDto = { status: 'MFA_REQUIRED', challengeId: 'challenge-1', methods: ['TOTP'], expiresAt: '2099-01-01T00:00:00Z' };
const login = vi.fn<ReturnType<typeof useSession>['login']>();
const verifyMfa = vi.fn<ReturnType<typeof useSession>['verifyMfa']>();
const publicRecoveryMessage = 'Se houver uma conta para esse e-mail, enviaremos as instruções de recuperação.';
const recoveryCases = [
  { path: '/recuperar-acesso', action: 'Solicitar recuperação', endpoint: '/auth/password/forgot' },
  { path: '/redefinir-senha', action: 'Redefinir senha', endpoint: '/auth/password/reset' },
] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function authTree(path: string) {
  return <MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/recuperar-acesso" element={<RecoveryPage />} />
    <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
    <Route path="/app" element={<h1>Operação</h1>} />
  </Routes></MemoryRouter>;
}

function show(path = '/login') {
  render(authTree(path));
  return userEvent.setup();
}

async function enterCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('E-mail', { exact: true }), 'gestor@demo.sesmt.local');
  await user.type(screen.getByLabelText('Senha', { exact: true }), 'Demo123!');
  await user.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
  return screen.findByLabelText('Código de verificação', { exact: true });
}

async function fillRecoveryForm(user: ReturnType<typeof userEvent.setup>, path: string) {
  if (path === '/recuperar-acesso') await user.type(screen.getByLabelText('E-mail', { exact: true }), 'gestor@demo.sesmt.local');
  else {
    await user.type(screen.getByLabelText('Nova senha', { exact: true }), 'NovaSenha123!');
    await user.type(screen.getByLabelText('Confirmar nova senha', { exact: true }), 'NovaSenha123!');
  }
}

beforeEach(() => {
  runtime.mode = 'demo';
  login.mockReset().mockResolvedValue(challenge);
  verifyMfa.mockReset().mockResolvedValue(undefined);
  vi.mocked(obtainCsrf).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.post).mockReset();
  vi.mocked(useSession).mockReturnValue({
    me: null, unitId: undefined, sessionKey: 'auth-test', status: 'anonymous', sessionError: null,
    can: () => false, setUnitId: vi.fn(), login, verifyMfa, logout: vi.fn(), restore: vi.fn(),
  });
});

describe('continuidade do acesso', () => {
  it('mantém o retorno bloqueado durante MFA pendente e não duplica a verificação por submissão concorrente', async () => {
    const response = deferred<void>();
    verifyMfa.mockReturnValueOnce(response.promise);
    const user = show();
    const code = await enterCredentials(user);
    await user.type(code, '123456');
    const form = code.closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(verifyMfa).toHaveBeenCalledTimes(1));
    expect(verifyMfa).toHaveBeenCalledWith('challenge-1', '123456');
    const back = screen.getByRole('button', { name: 'Voltar ao login' });
    expect(back).toBeDisabled();
    await user.click(back);
    expect(screen.getByRole('heading', { name: 'Verifique seu acesso' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Operação' })).not.toBeInTheDocument();
    await act(async () => { response.resolve(undefined); });
    expect(await screen.findByRole('heading', { name: 'Operação' })).toBeVisible();
    expect(verifyMfa).toHaveBeenCalledTimes(1);
  });

  it('limpa erro e código ao voltar do MFA, preserva credenciais e transfere o foco para a senha e o novo código', async () => {
    verifyMfa.mockRejectedValueOnce(new Error('Código inválido. Confira seu autenticador.'));
    login.mockResolvedValueOnce(challenge).mockResolvedValueOnce({ ...challenge, challengeId: 'challenge-2' });
    const user = show();
    const code = await enterCredentials(user);
    await waitFor(() => expect(code).toHaveFocus());
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verificar e entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido.');
    await user.click(screen.getByRole('button', { name: 'Voltar ao login' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('E-mail', { exact: true })).toHaveValue('gestor@demo.sesmt.local');
    const password = screen.getByLabelText('Senha', { exact: true });
    expect(password).toHaveValue('Demo123!');
    await waitFor(() => expect(password).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Entrar na plataforma' }));
    const nextCode = await screen.findByLabelText('Código de verificação', { exact: true });
    expect(nextCode).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(nextCode).toHaveFocus());
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('aceita o código colado com espaço sem enviar a formatação para o serviço de identidade', async () => {
    const user = show();
    const code = await enterCredentials(user);
    await user.click(code);
    await user.paste('123 456');
    await user.click(screen.getByRole('button', { name: 'Verificar e entrar' }));
    await waitFor(() => expect(verifyMfa).toHaveBeenCalledWith('challenge-1', '123456'));
    expect(await screen.findByRole('heading', { name: 'Operação' })).toBeVisible();
  });

  it('remove o sucesso anterior durante um reenvio de recuperação e mantém somente a falha atual', async () => {
    const nextResponse = deferred<{ message: string }>();
    const success = publicRecoveryMessage;
    vi.mocked(api.post).mockResolvedValueOnce({ message: success }).mockReturnValueOnce(nextResponse.promise);
    const user = show('/recuperar-acesso');
    await user.type(screen.getByLabelText('E-mail', { exact: true }), 'gestor@demo.sesmt.local');
    await user.click(screen.getByRole('button', { name: 'Solicitar recuperação' }));
    expect(await screen.findByRole('status')).toHaveTextContent(success);
    await user.click(screen.getByRole('button', { name: 'Solicitar recuperação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(success)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    await act(async () => { nextResponse.reject(new Error('Não foi possível enviar agora.')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar agora.');
    expect(screen.queryByText(success)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solicitar recuperação' })).toBeEnabled();
    expect(screen.getByLabelText('E-mail', { exact: true })).toHaveValue('gestor@demo.sesmt.local');
  });

  it.each([
    { path: '/recuperar-acesso', action: 'Solicitar recuperação', endpoint: '/auth/password/forgot' },
    { path: '/redefinir-senha', action: 'Redefinir senha', endpoint: '/auth/password/reset' },
  ])('preserva o preenchimento e aguarda a restauração antes de enviar em $path', async ({ path, action, endpoint }) => {
    const anonymous = vi.mocked(useSession).getMockImplementation()!();
    vi.mocked(useSession).mockReturnValue({ ...anonymous, status: 'restoring' });
    vi.mocked(api.post).mockResolvedValue(endpoint.endsWith('/forgot') ? { message: 'Solicitação recebida.' } : undefined);
    const view = render(authTree(path));
    const user = userEvent.setup();
    if (path === '/recuperar-acesso') {
      await user.type(screen.getByLabelText('E-mail', { exact: true }), 'gestor@demo.sesmt.local');
    } else {
      await user.type(screen.getByLabelText('Nova senha', { exact: true }), 'NovaSenha123!');
      await user.type(screen.getByLabelText('Confirmar nova senha', { exact: true }), 'NovaSenha123!');
    }
    const preparing = screen.getByRole('button', { name: /Preparando/ });
    expect(preparing).toBeDisabled();
    await act(async () => { fireEvent.submit(preparing.closest('form')!); });
    expect(api.post).not.toHaveBeenCalled();

    vi.mocked(useSession).mockReturnValue(anonymous);
    view.rerender(authTree(path));
    if (path === '/recuperar-acesso') {
      expect(screen.getByLabelText('E-mail', { exact: true })).toHaveValue('gestor@demo.sesmt.local');
    } else {
      expect(screen.getByLabelText('Nova senha', { exact: true })).toHaveValue('NovaSenha123!');
      expect(screen.getByLabelText('Confirmar nova senha', { exact: true })).toHaveValue('NovaSenha123!');
    }
    const submit = screen.getByRole('button', { name: action });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0].slice(0, 2)).toEqual([endpoint, path === '/recuperar-acesso'
      ? { email: 'gestor@demo.sesmt.local' }
      : { token: 'demo-reset', newPassword: 'NovaSenha123!' }]);
    if (path === '/redefinir-senha') expect(await screen.findByRole('heading', { name: 'Tudo pronto.' })).toBeVisible();
    else expect(await screen.findByRole('status')).toHaveTextContent(publicRecoveryMessage);
  });

  it.each(recoveryCases)('aguarda CSRF e não duplica escritas concorrentes em $path', async ({ path, action, endpoint }) => {
    const csrf = deferred<void>();
    const response = deferred<unknown>();
    vi.mocked(obtainCsrf).mockReturnValueOnce(csrf.promise);
    vi.mocked(api.post).mockReturnValueOnce(response.promise);
    const user = show(path);
    await fillRecoveryForm(user, path);
    const form = screen.getByRole('button', { name: action }).closest('form')!;
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(obtainCsrf).toHaveBeenCalledOnce());
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: path === '/recuperar-acesso' ? 'Enviando…' : 'Salvando…' })).toBeDisabled();
    await act(async () => { csrf.resolve(undefined); });
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe(endpoint);
    expect(vi.mocked(obtainCsrf).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.post).mock.invocationCallOrder[0]);
    await act(async () => { response.resolve(path === '/recuperar-acesso' ? { message: 'Recebido.' } : undefined); });
    expect(await screen.findByRole('heading', { name: path === '/recuperar-acesso' ? 'Confira seu e-mail' : 'Tudo pronto.' })).toBeVisible();
  });

  it.each(recoveryCases)('não escreve sem CSRF e preserva o rascunho para tentar novamente em $path', async ({ path, action }) => {
    vi.mocked(obtainCsrf).mockRejectedValueOnce(new Error('Não foi possível preparar sua solicitação.'));
    vi.mocked(api.post).mockResolvedValue(path === '/recuperar-acesso' ? { message: 'Recebido.' } : undefined);
    const user = show(path);
    await fillRecoveryForm(user, path);
    await user.click(screen.getByRole('button', { name: action }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível preparar sua solicitação.');
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText(path === '/recuperar-acesso' ? 'E-mail' : 'Nova senha', { exact: true })).toHaveValue(path === '/recuperar-acesso' ? 'gestor@demo.sesmt.local' : 'NovaSenha123!');
    await user.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(obtainCsrf).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: path === '/recuperar-acesso' ? 'Confira seu e-mail' : 'Tudo pronto.' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(recoveryCases)('não inicia a escrita se sair da página durante a preparação em $path', async ({ path, action }) => {
    const csrf = deferred<void>();
    vi.mocked(obtainCsrf).mockReturnValueOnce(csrf.promise);
    const view = render(authTree(path));
    const user = userEvent.setup();
    await fillRecoveryForm(user, path);
    await user.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(obtainCsrf).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { csrf.resolve(undefined); });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reutiliza a chave de idempotência após falha de rede e cria outra quando a nova senha muda', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('A conexão caiu após enviar.'))
      .mockRejectedValueOnce(new Error('A conexão continua indisponível.'))
      .mockResolvedValueOnce(undefined);
    const user = show('/redefinir-senha');
    await fillRecoveryForm(user, '/redefinir-senha');
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A conexão caiu após enviar.');
    const firstKey = vi.mocked(api.post).mock.calls[0][2]?.idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(firstKey!.length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A conexão continua indisponível.');
    expect(vi.mocked(api.post).mock.calls[1][2]?.idempotencyKey).toBe(firstKey);
    const password = screen.getByLabelText('Nova senha', { exact: true });
    const confirm = screen.getByLabelText('Confirmar nova senha', { exact: true });
    await user.clear(password); await user.type(password, 'Outra senha pessoal 2026');
    await user.clear(confirm); await user.type(confirm, 'Outra senha pessoal 2026');
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    expect(await screen.findByRole('heading', { name: 'Tudo pronto.' })).toBeVisible();
    const newKey = vi.mocked(api.post).mock.calls[2][2]?.idempotencyKey;
    expect(newKey).toEqual(expect.any(String)); expect(newKey).not.toBe(firstKey);
    expect(vi.mocked(api.post).mock.calls[2].slice(0, 2)).toEqual(['/auth/password/reset', { token: 'demo-reset', newPassword: 'Outra senha pessoal 2026' }]);
  });

  it.each(recoveryCases)('não envia a solicitação antiga após mudar o contexto de sessão em $path', async ({ path, action }) => {
    const csrf = deferred<void>();
    vi.mocked(obtainCsrf).mockReturnValueOnce(csrf.promise);
    const originalSession = vi.mocked(useSession).getMockImplementation()!();
    const view = render(authTree(path));
    const user = userEvent.setup();
    await fillRecoveryForm(user, path);
    await user.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(obtainCsrf).toHaveBeenCalledOnce());
    vi.mocked(useSession).mockReturnValue({ ...originalSession, sessionKey: 'changed-session' });
    view.rerender(authTree(path));
    await act(async () => { csrf.resolve(undefined); });
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: /Confira seu e-mail|Tudo pronto/ })).not.toBeInTheDocument();
  });

  it.each(recoveryCases)('cancela a escrita em andamento e ignora sua resposta após mudar a sessão em $path', async ({ path, action }) => {
    const response = deferred<unknown>();
    vi.mocked(api.post).mockReturnValueOnce(response.promise);
    const originalSession = vi.mocked(useSession).getMockImplementation()!();
    const view = render(authTree(path));
    const user = userEvent.setup();
    await fillRecoveryForm(user, path);
    await user.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const signal = vi.mocked(api.post).mock.calls[0][2]?.signal;
    expect(signal?.aborted).toBe(false);
    vi.mocked(useSession).mockReturnValue({ ...originalSession, sessionKey: 'new-access-context' });
    view.rerender(authTree(path));
    expect(signal?.aborted).toBe(true);
    await act(async () => { response.resolve(path === '/recuperar-acesso' ? { message: 'Recebido.' } : undefined); });
    expect(screen.queryByRole('heading', { name: /Confira seu e-mail|Tudo pronto/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: action })).toBeEnabled();
  });

  it('apresenta uma confirmação pública, sem repetir mensagens que revelem a existência da conta', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ message: 'Conta gestor@demo.sesmt.local encontrada e e-mail enviado.' });
    const user = show('/recuperar-acesso');
    await fillRecoveryForm(user, '/recuperar-acesso');
    await user.click(screen.getByRole('button', { name: 'Solicitar recuperação' }));
    expect(await screen.findByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(publicRecoveryMessage);
    expect(screen.queryByText(/Conta gestor@demo.sesmt.local encontrada/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    const email = screen.getByLabelText('E-mail', { exact: true });
    expect(email).toHaveValue('gestor@demo.sesmt.local');
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.queryByRole('heading', { name: 'Confira seu e-mail' })).not.toBeInTheDocument();
  });

  it('não apresenta sucesso quando a resposta de recuperação não pode ser confirmada', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ message: '' });
    const user = show('/recuperar-acesso');
    await fillRecoveryForm(user, '/recuperar-acesso');
    await user.click(screen.getByRole('button', { name: 'Solicitar recuperação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a solicitação.');
    expect(screen.queryByRole('heading', { name: 'Confira seu e-mail' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('E-mail', { exact: true })).toHaveValue('gestor@demo.sesmt.local');
  });

  it('prepara o código do fragmento e envia seus bytes preservados com a nova senha', async () => {
    runtime.mode = 'api';
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    const token = 'Native_reset-token_123';
    const user = show(`/redefinir-senha#token=${token}`);
    expect(screen.getByText('Código do link preparado')).toBeVisible();
    await fillRecoveryForm(user, '/redefinir-senha');
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[0].slice(0, 2)).toEqual(['/auth/password/reset', { token, newPassword: 'NovaSenha123!' }]);
    expect(await screen.findByRole('heading', { name: 'Tudo pronto.' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Voltar ao login' })).toHaveFocus());
  });

  it('permite trocar o código do link sem reaproveitar as senhas anteriores', async () => {
    runtime.mode = 'api';
    const user = show('/redefinir-senha#token=Native_reset-token_123');
    await fillRecoveryForm(user, '/redefinir-senha');
    await user.click(screen.getByRole('button', { name: 'Usar outro código' }));
    const token = screen.getByLabelText('Código de recuperação', { exact: true });
    expect(token).toHaveValue(''); expect(token).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Nova senha', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('Confirmar nova senha', { exact: true })).toHaveValue('');
    await waitFor(() => expect(token).toHaveFocus());
    expect(screen.queryByText('Código do link preparado')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each(['#token=first&token=second', '#token=', '#token=invalid%20token'])('recusa um fragmento inválido e permite informar outro código (%s)', async hash => {
    runtime.mode = 'api';
    const user = show(`/redefinir-senha${hash}`);
    expect(screen.getByRole('alert')).toBeVisible();
    const token = screen.getByLabelText('Código de recuperação', { exact: true });
    expect(token).toHaveValue(''); expect(token).toHaveAttribute('type', 'password');
    await user.type(token, 'replacement_token');
    await fillRecoveryForm(user, '/redefinir-senha');
    vi.mocked(api.post).mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Redefinir senha' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[0].slice(0, 2)).toEqual(['/auth/password/reset', { token: 'replacement_token', newPassword: 'NovaSenha123!' }]);
  });

  it('não aceita o código da query e mantém o preenchimento manual protegido', async () => {
    runtime.mode = 'api';
    show('/redefinir-senha?token=query_secret');
    const token = screen.getByLabelText('Código de recuperação', { exact: true });
    expect(token).toHaveValue(''); expect(token).toHaveAttribute('type', 'password');
    expect(screen.queryByText('Código do link preparado')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
