import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { PermitOptionsDto } from '../../shared/contracts/work-permits';
import { AppointmentFormPage } from './AppointmentFormPage';
import { AgendaPage } from './AgendaPage';

const state = vi.hoisted(() => ({ unitId: 'unit-a' as string | undefined, allowed: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, can: () => state.allowed }) }));
vi.mock('../../shared/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const options: PermitOptionsDto = {
  teams: [{ id: 'team-a', companyId: 'company-a', unitId: 'unit-a', name: 'Equipe A', chiefId: 'worker-a', revision: 1, members: [{ workerId: 'worker-a', name: 'Ana Teste', serviceFunction: 'Inspeção' }] }],
  services: [{ id: 'service-a', name: 'Inspeção', description: '', templateVersion: '1', requirementVersion: '1' }],
  responsibles: [{ id: 'operator-a', name: 'Operador A' }],
};
function show(element = <AppointmentFormPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/agenda/novo']}><Routes><Route path="/app/agenda/novo" element={element} /><Route path="/app/agenda/:id" element={<p>Atendimento salvo</p>} /></Routes></MemoryRouter></QueryClientProvider>) };
}
async function fill() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Equipe *' }), 'team-a');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Serviço *' }), 'service-a');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Responsável pelo atendimento *' }), 'operator-a');
  await user.type(screen.getByRole('textbox', { name: 'Local do serviço *' }), 'Galpão A');
  fireEvent.change(screen.getByLabelText('Início previsto *'), { target: { value: '2099-10-11T09:00' } });
  fireEvent.change(screen.getByLabelText('Término previsto *'), { target: { value: '2099-10-11T10:00' } });
  await user.click(screen.getByRole('checkbox', { name: 'Ana Teste' }));
  return user;
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); state.unitId = 'unit-a'; state.allowed = true;
  vi.mocked(api.get).mockResolvedValue(options);
  vi.mocked(api.post).mockRejectedValue(new Error('Não foi possível confirmar o envio.'));
});

describe('novo agendamento', () => {
  it('preserva o preenchimento quando falha a atualização das opções', async () => {
    const { client } = show();
    fireEvent.change(await screen.findByLabelText('Local do serviço *'), { target: { value: 'Local em preenchimento' } });
    vi.mocked(api.get).mockRejectedValue(new Error('Conexão interrompida.'));
    await act(async () => { await client.refetchQueries({ queryKey: ['permit-options'] }); });
    expect(screen.getByLabelText('Local do serviço *')).toHaveValue('Local em preenchimento');
  });

  it.each([['cadastro', <AppointmentFormPage />], ['lista', <AgendaPage />]])('orienta a seleção de unidade no %s sem carregar indefinidamente', (_label, element) => {
    state.unitId = undefined; show(element);
    expect(screen.getByRole('heading', { name: 'Selecione uma unidade' })).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('pede confirmação ao descartar alterações por troca de unidade', async () => {
    show(); const user = userEvent.setup(); await user.type(await screen.findByRole('textbox', { name: 'Local do serviço *' }), 'Galpão A');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const rejected = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(rejected); });
    expect(rejected.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    const accepted = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(accepted); }); expect(accepted.defaultPrevented).toBe(false);
  });
  it('bloqueia campos, participantes e troca de unidade durante o envio', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: 'Local do serviço *' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Ana Teste' })).toBeDisabled();
    const confirm = vi.spyOn(window, 'confirm');
    const changed = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(changed); });
    expect(changed.defaultPrevented).toBe(true); expect(confirm).not.toHaveBeenCalled();
    await act(async () => { reject(new Error('Falha de conexão.')); });
    expect(await screen.findByText('Falha de conexão.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Local do serviço *' })).toBeEnabled();
  });
  it('reutiliza a chave na repetição idêntica e cria outra após alterar o preenchimento', async () => {
    show(); const user = await fill();
    const send = () => user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    await send(); await screen.findByText('Não foi possível confirmar o envio.');
    const original = vi.mocked(api.post).mock.calls[0][2]?.idempotencyKey;
    await send(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1][2]?.idempotencyKey).toBe(original);
    await user.type(screen.getByRole('textbox', { name: 'Local do serviço *' }), ' revisado');
    await send(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.post).mock.calls[2][2]?.idempotencyKey).not.toBe(original);
  });
  it('preserva o formulário quando a resposta pertence a outra unidade', async () => {
    vi.mocked(api.post).mockResolvedValue({ id: 'appointment-b', unitId: 'unit-b' });
    show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText(/O agendamento retornado pertence a outra unidade/)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Local do serviço *' })).toHaveValue('Galpão A');
    expect(screen.queryByText('Atendimento salvo')).not.toBeInTheDocument();
  });
});
