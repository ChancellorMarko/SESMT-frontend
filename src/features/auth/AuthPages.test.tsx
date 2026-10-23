import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../shared/auth/SessionProvider';
import { api } from '../../shared/api/client';
import type { MfaChallengeDto } from '../../shared/contracts';
import { LoginPage, RecoveryPage, ResetPasswordPage } from './AuthPages';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../shared/api/client', () => ({ API_MODE: 'demo', api: { post: vi.fn() } }));
vi.mock('../../shared/motion/MotionPreferences', () => ({ useAppReducedMotion: () => true }));
vi.mock('./LoginArrival', () => ({ useLoginArrival: () => 'ready', LoginPreloader: () => null }));

const challenge: MfaChallengeDto = { status: 'MFA_REQUIRED', challengeId: 'challenge-1', methods: ['TOTP'], expiresAt: '2099-01-01T00:00:00Z' };
const login = vi.fn<ReturnType<typeof useSession>['login']>();
const verifyMfa = vi.fn<ReturnType<typeof useSession>['verifyMfa']>();

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

beforeEach(() => {
  login.mockReset().mockResolvedValue(challenge);
  verifyMfa.mockReset().mockResolvedValue(undefined);
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
    const success = 'Se houver uma conta, enviaremos as instruções.';
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
    expect(api.post).toHaveBeenCalledWith(endpoint, path === '/recuperar-acesso'
      ? { email: 'gestor@demo.sesmt.local' }
      : { token: 'demo-reset', newPassword: 'NovaSenha123!' });
    if (path === '/redefinir-senha') expect(await screen.findByRole('heading', { name: 'Tudo pronto.' })).toBeVisible();
    else expect(await screen.findByRole('status')).toHaveTextContent('Solicitação recebida.');
  });
});
