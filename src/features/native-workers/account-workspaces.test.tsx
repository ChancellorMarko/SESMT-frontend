import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError, nativeWorkerAccountApi } from '../../shared/api/client';
import { NativeWorkerAccountPage } from './NativeWorkerAccountPage';
import { bindingAccounts, bindingContext, bindingIds as ids, bindingPage } from '../../../tests/connection-ui/fixtures/native-account-binding';
import { workerScope } from '../../../tests/connection-ui/fixtures/native-workers';
const state = vi.hoisted(() => ({ grants: ['workers.read', 'trabalhador:editar', 'usuario:ler', 'usuario:editar'], ownOnly: false }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'binding-test', unitId: '71000000-0000-4000-8000-000000000002', me: { roles: ['ADMIN'], scope: { ...workerScope, ownOnly: state.ownOnly } }, can: (p: string) => state.grants.includes(p) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), nativeWorkerAccountApi: { context: vi.fn(), search: vi.fn(), candidate: vi.fn(), link: vi.fn() } }));
let current = bindingContext(), accounts = structuredClone(bindingAccounts);
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/trabalhadores/${ids.worker}/conta`]}><Routes><Route path="/app/trabalhadores/:id/conta" element={<NativeWorkerAccountPage/>}/><Route path="/app/trabalhadores/:id" element={<h1>Ficha do trabalhador</h1>}/></Routes></MemoryRouter></QueryClientProvider>); return client;
}
beforeEach(() => {
  vi.clearAllMocks(); state.grants = ['workers.read', 'trabalhador:editar', 'usuario:ler', 'usuario:editar']; state.ownOnly = false; current = bindingContext(); accounts = structuredClone(bindingAccounts);
  vi.mocked(nativeWorkerAccountApi.context).mockImplementation(async () => structuredClone(current) as never);
  vi.mocked(nativeWorkerAccountApi.search).mockImplementation(async () => ({ ...bindingPage(), items: accounts, total: accounts.length }) as never);
  vi.mocked(nativeWorkerAccountApi.candidate).mockImplementation(async (_worker, user) => structuredClone(accounts.find(a => a.id === user)) as never);
  vi.mocked(nativeWorkerAccountApi.link).mockImplementation(async (_worker, body) => { current = { ...current, revision: current.revision + 1, userId: (body as { userId: string }).userId }; return structuredClone(current) as never; });
});
async function choose() { fireEvent.click(await screen.findByRole('radio', { name: /Pessoa Fictícia titular@example.invalid/ })); fireEvent.click(screen.getByRole('checkbox')); }
it('vincula a seleção confirmada, verifica o recibo e o registro persistido e invalida a abertura de PT', async () => {
  const client = show(); client.setQueryData(['native-opening', 'binding-test', 'agenda'], { cached: true }); client.setQueryData(['native-opening', 'other-session'], { cached: true });
  await choose(); fireEvent.click(screen.getByRole('button', { name: 'Vincular conta' })); await screen.findByRole('heading', { name: 'Ficha do trabalhador' });
  expect(nativeWorkerAccountApi.link).toHaveBeenCalledWith(ids.worker, { expectedVersion: 1, userId: ids.account, expectedAccountName: bindingAccounts[0].name, expectedAccountEmail: bindingAccounts[0].email, confirmation: true }, expect.any(AbortSignal));
  expect(client.getQueryState(['native-opening', 'binding-test', 'agenda'])?.isInvalidated).toBe(true); expect(client.getQueryState(['native-opening', 'other-session'])?.isInvalidated).toBe(false);
  expect(JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data))).not.toContain('dateOfBirth');
});
it('exige confirmação de titularidade e a reinicia quando muda a seleção', async () => {
  show(); await screen.findByRole('radio', { name: /Pessoa Fictícia/ }); expect(screen.getByRole('button', { name: 'Vincular conta' })).toBeDisabled();
  await choose(); expect(screen.getByRole('button', { name: 'Vincular conta' })).toBeEnabled(); fireEvent.click(screen.getByRole('radio', { name: /Outra Pessoa/ })); expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('button', { name: 'Vincular conta' })).toBeDisabled();
});
it('revisão alterada no preflight preserva a seleção e impede PUT', async () => {
  show(); await choose(); current.revision = 2; fireEvent.click(screen.getByRole('button', { name: 'Vincular conta' })); expect(await screen.findByRole('alert')).toHaveTextContent('cadastro do trabalhador foi alterado');
  expect(screen.getByRole('radio', { name: /Pessoa Fictícia/ })).toBeChecked(); expect(nativeWorkerAccountApi.link).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Vincular conta' })).toBeDisabled();
});
it('mudança de e-mail depois da seleção exige nova conferência da pessoa', async () => {
  show(); await choose(); accounts[0].email = 'alterado@example.invalid'; fireEvent.click(screen.getByRole('button', { name: 'Vincular conta' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('dados da conta foram alterados'); expect(nativeWorkerAccountApi.link).not.toHaveBeenCalled();
});
it.each([409, 403, 500])('falha %s mantém a seleção e bloqueia repetição', async status => {
  vi.mocked(nativeWorkerAccountApi.link).mockRejectedValue(new ApiError(status, { code: 'CONFLICT', message: 'Recusa', requestId: 'test' })); show(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Vincular conta' }));
  await screen.findByRole('alert'); expect(screen.getByRole('radio', { name: /Pessoa Fictícia/ })).toBeChecked(); expect(screen.getByRole('button', { name: 'Vincular conta' })).toBeDisabled(); expect(nativeWorkerAccountApi.link).toHaveBeenCalledTimes(1);
});
it.each([{ userId: ids.secondAccount, revision: 2 }, { userId: ids.account, revision: 1 }, { userId: ids.account, revision: 2, unitId: ids.foreign }])('recibo incompatível não informa sucesso %j', changes => {
  vi.mocked(nativeWorkerAccountApi.link).mockResolvedValue({ ...bindingContext(), ...changes } as never);
  return (async () => { show(); await choose(); fireEvent.click(screen.getByRole('button', { name: 'Vincular conta' })); expect(await screen.findByRole('alert')).toHaveTextContent('resposta não confirmou'); expect(screen.queryByRole('heading', { name: 'Ficha do trabalhador' })).not.toBeInTheDocument(); })();
});
it.each(['workers.read', 'trabalhador:editar', 'usuario:ler', 'usuario:editar'])('ADMIN não substitui o grant %s', missing => {
  state.grants = state.grants.filter(p => p !== missing); show(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(nativeWorkerAccountApi.context).not.toHaveBeenCalled();
});
it('não habilita gestão de contas com escopo próprio', () => { state.ownOnly = true; show(); expect(nativeWorkerAccountApi.context).not.toHaveBeenCalled(); });
it('não permite trocar a conta já vinculada', async () => { current.userId = ids.account; show(); expect(await screen.findByText('Este trabalhador já possui uma conta vinculada.')).toBeVisible(); expect(nativeWorkerAccountApi.search).not.toHaveBeenCalled(); });
it('não permite vincular trabalhador desligado', async () => { current.active = false; show(); expect(await screen.findByText('O vínculo profissional precisa estar ativo para associar uma conta.')).toBeVisible(); expect(nativeWorkerAccountApi.search).not.toHaveBeenCalled(); });
it('Enter busca contas sem enviar o vínculo', async () => {
  show(); await choose(); const input = screen.getByLabelText('Buscar conta por nome ou e-mail'); fireEvent.change(input, { target: { value: 'Pessoa' } }); fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(nativeWorkerAccountApi.search).toHaveBeenCalledWith(ids.worker, 'Pessoa', 1, expect.any(AbortSignal))); expect(nativeWorkerAccountApi.link).not.toHaveBeenCalled();
});
