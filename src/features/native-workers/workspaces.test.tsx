import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, createNativeWorker } from '../../shared/api/client';
import { NativeWorkerCreate } from './NativeWorkerCreate';
import { workerDirectory, workerDraft, workerIds as ids, workerProfile, workerReceipt, workerScope } from '../../../tests/connection-ui/fixtures/native-workers';

const state = vi.hoisted(() => ({ grants: ['trabalhador:criar', 'workers.read', 'organization.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'worker-create-test', unitId: '71000000-0000-4000-8000-000000000002', me: { scope: workerScope }, can: (p: string) => state.grants.includes(p) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() }, createNativeWorker: vi.fn() }));
let directory = structuredClone(workerDirectory);
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/trabalhadores/novo']}><Routes><Route path="/app/trabalhadores/novo" element={<NativeWorkerCreate/>}/><Route path="/app/trabalhadores/:id" element={<h1>Trabalhador salvo</h1>}/></Routes></MemoryRouter></QueryClientProvider>); return client;
}
beforeEach(() => {
  vi.clearAllMocks(); state.grants = ['trabalhador:criar', 'workers.read', 'organization.read']; directory = structuredClone(workerDirectory);
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/organization') return structuredClone(directory) as never;
    if (path === `/workers/${ids.worker}`) return workerProfile() as never;
    throw new Error('Rota inesperada: ' + path);
  });
  vi.mocked(createNativeWorker).mockResolvedValue(workerReceipt() as never);
});
async function fill() {
  await screen.findByRole('option', { name: 'Técnico de manutenção' });
  for (const [label, value] of Object.entries({ 'Nome completo': workerDraft.name, Matrícula: workerDraft.enrollment, CPF: workerDraft.cpf, Nascimento: workerDraft.dateOfBirth, Admissão: workerDraft.admissionDate, Setor: ids.sector, Cargo: ids.position })) fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
}
it('cadastra com CPF apenas no comando e confirma o perfil sem cachear os dados pessoais da criação', async () => {
  const client = show(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' })); await screen.findByRole('heading', { name: 'Trabalhador salvo' });
  expect(createNativeWorker).toHaveBeenCalledWith({ ...workerDraft, companyId: ids.company, unitId: ids.unit, userId: null, dismissalDate: null }, expect.anything());
  const cached = JSON.stringify(client.getQueryCache().getAll().map(q => q.state.data)); expect(cached).not.toContain(workerDraft.cpf); expect(cached).not.toContain(workerDraft.dateOfBirth);
});
it('CPF incorreto é recusado antes do comando e permite correção', async () => {
  show(); await fill(); fireEvent.change(screen.getByLabelText(/^CPF/), { target: { value: '11111111111' } }); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confira os 11 dígitos'); expect(createNativeWorker).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeEnabled();
});
it('um cargo desativado durante o preenchimento impede a criação', async () => {
  show(); await fill(); directory.jobs[0].status = 'INACTIVE'; fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A organização foi alterada'); expect(createNativeWorker).not.toHaveBeenCalled(); expect(screen.getByLabelText(/^Matrícula/)).toHaveValue(workerDraft.enrollment);
});
it('resultado ambíguo conserva o formulário e impede uma segunda criação', async () => {
  vi.mocked(createNativeWorker).mockRejectedValue(new Error('Conexão interrompida')); show(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar'); expect(screen.getByLabelText(/^Matrícula/)).toHaveValue(workerDraft.enrollment); expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeDisabled(); expect(createNativeWorker).toHaveBeenCalledTimes(1);
});
it('recibo de outra empresa não confirma o cadastro nem repete o comando', async () => {
  vi.mocked(createNativeWorker).mockResolvedValue({ ...workerReceipt(), companyId: ids.foreign } as never); show(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A resposta não confirmou'); expect(screen.queryByRole('heading', { name: 'Trabalhador salvo' })).not.toBeInTheDocument(); expect(createNativeWorker).toHaveBeenCalledTimes(1);
});
it('permissão de leitura não habilita a criação por nome de perfil', async () => {
  state.grants = ['workers.read', 'organization.read']; show(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(await screen.findByText('Seu acesso não permite cadastrar trabalhadores.')).toBeVisible(); expect(createNativeWorker).not.toHaveBeenCalled();
});
it('recusa de acesso após abrir o formulário bloqueia o envio sem apagar o CPF preenchido', async () => {
  vi.mocked(createNativeWorker).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Não autorizado', requestId: 'test' })); show(); await fill(); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
  const dialog = screen.getByRole('dialog'); await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cadastrar' })).toBeDisabled()); expect(screen.getByLabelText(/^CPF/)).toHaveValue(workerDraft.cpf);
});
