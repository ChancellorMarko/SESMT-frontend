import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeUsersPage } from './NativeUsersPage';
import { checkedPasswordReset, passwordResetLink } from './NativeUserPasswordReset';
import { passwordResetTokenFromHash } from '../auth/password-recovery';
import { api, ApiError } from '../../shared/api/client';

const state = vi.hoisted(() => ({ edit: true, me: 'admin-id' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'reset-test', me: { user: { id: state.me } }, can: (permission: string) => permission === 'users.read' || (state.edit && permission === 'users.edit') }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const person = { id: '20000000-0000-4000-8000-000000000001', name: 'Carla Técnica', email: 'carla@example.invalid', active: true, roles: ['TECNICO'], scopeIds: ['20000000-0000-4000-8000-000000000002'] };
const token = 'k3Y-abc_DEF123ghiJKL456mnoPQR789stuVWX0yz';
const receipt = (overrides = {}) => ({ token, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), sessionsEnded: 2, ...overrides });
const reason = 'A pessoa esqueceu a senha e o e-mail não chegou.';

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={client}><NativeUsersPage/></QueryClientProvider>);
}
async function openDialog() {
  show();
  fireEvent.click(await screen.findByRole('button', { name: `Redefinir senha de ${person.name}` }));
  return screen.getByRole('dialog', { name: `Redefinir senha de ${person.name}` });
}
beforeEach(() => { vi.clearAllMocks(); state.edit = true; state.me = 'admin-id'; vi.mocked(api.get).mockResolvedValue([person] as never); });

describe('redefinição de senha pelo administrador', () => {
  it('só aparece para quem pode editar contas, e nunca para a própria conta', async () => {
    state.edit = false; const first = show();
    expect(await screen.findByText(person.name)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Redefinir senha/ })).not.toBeInTheDocument();
    first.unmount(); state.edit = true; state.me = person.id; show();
    expect(await screen.findByText(person.name)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Redefinir senha/ })).not.toBeInTheDocument();
  });

  it('exige motivo e confirmação antes de enviar', async () => {
    const dialog = await openDialog();
    const submit = within(dialog).getByRole('button', { name: 'Redefinir senha' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'curto' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: reason } });
    expect(submit).toBeEnabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('envia o motivo, mostra o link de uso único uma vez e não mostra nenhuma senha', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(receipt() as never);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: `  ${reason}  ` } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Redefinir senha' }));
    const result = await screen.findByRole('dialog', { name: `Link de redefinição de ${person.name}` });
    expect(api.post).toHaveBeenCalledWith(`/users/${person.id}/password-reset`, { reason, confirmation: true }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const link = within(result).getByLabelText('Link de uso único') as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/redefinir-senha#token=${token}`);
    expect(within(result).getByText(/2 sessões abertas foram encerradas/)).toBeVisible();
    expect(within(result).queryByText(/senha:/i)).not.toBeInTheDocument();
    fireEvent.click(within(result).getByRole('button', { name: 'Concluir' }));
    expect(await screen.findByText(`Senha de ${person.name} redefinida. A pessoa define a nova senha pelo link entregue.`)).toBeVisible();
    expect(screen.queryByDisplayValue(new RegExp(token))).not.toBeInTheDocument();
  });

  it('mantém o motivo quando a API recusa e não mostra link', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, { code: 'OWN_ACCOUNT', message: 'detalhe', requestId: 'r' }));
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Redefinir senha' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/mudaram/));
    expect((within(dialog).getByLabelText(/Motivo/) as HTMLTextAreaElement).value).toBe(reason);
    expect(screen.queryByLabelText('Link de uso único')).not.toBeInTheDocument();
  });

  it.each([{}, receipt({ token: 'tem espaço' }), receipt({ token: '' }), receipt({ sessionsEnded: -1 }), receipt({ expiresAt: 'amanhã' }), receipt({ expiresAt: new Date(Date.now() - 1000).toISOString() })])
  ('recusa recibos inválidos ou vencidos: %j', value => { expect(() => checkedPasswordReset(value)).toThrow(); });

  it('aceita a data no formato da API (.NET com fração de segundo e fuso)', () => {
    expect(checkedPasswordReset(receipt({ expiresAt: '2099-01-02T03:04:05.1234567+00:00' })).sessionsEnded).toBe(2);
  });

  it('o link gerado é lido pela tela de redefinição sem alterar o token', () => {
    const link = new URL(passwordResetLink(token, 'https://ampara.example'));
    expect(link.pathname).toBe('/redefinir-senha');
    expect(passwordResetTokenFromHash(link.hash)).toEqual({ token, invalid: false });
  });
});
