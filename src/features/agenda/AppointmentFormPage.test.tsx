import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cloneElement } from 'react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { AppointmentDto, AppointmentWriteDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { AppointmentFormPage } from './AppointmentFormPage';
import { AgendaPage } from './AgendaPage';

const state = vi.hoisted(() => ({ sessionKey: 'session', unitId: 'unit-a' as string | undefined, allowed: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: state.sessionKey, unitId: state.unitId, can: () => state.allowed }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const options: PermitOptionsDto = {
  teams: [{ id: 'team-a', companyId: 'company-a', unitId: 'unit-a', name: 'Equipe A', chiefId: 'worker-a', revision: 1, members: [{ workerId: 'worker-a', name: 'Ana Teste', serviceFunction: 'Inspeção' }] }],
  services: [
    { id: 'service-a', name: 'Inspeção', description: '', templateVersion: '1', requirementVersion: '1' },
    { id: 'service-hot', name: 'Trabalho a quente', description: 'Soldagem e corte.', templateVersion: '2', requirementVersion: '3' },
    { id: 'service-confined', name: 'Espaço confinado', description: 'Entrada em espaço confinado.', templateVersion: '4', requirementVersion: '5' },
  ],
  responsibles: [{ id: 'operator-a', name: 'Operador A' }],
};
function show(element = <AppointmentFormPage />, existingClient?: QueryClient) {
  const client = existingClient || new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/agenda/novo']}><Routes><Route path="/app/agenda/novo" element={cloneElement(element)} /><Route path="/app/agenda/:id" element={<p>Atendimento salvo</p>} /></Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, ...view, update: () => view.rerender(tree()) };
}
function receipt(input: AppointmentWriteDto, overrides: Partial<AppointmentDto> = {}): AppointmentDto {
  return { ...input, id: 'appointment-a', companyId: 'company-a', code: 'AG-A', teamName: 'Equipe A', responsibleName: 'Operador A', serviceLabel: 'Serviços selecionados', status: 'REQUESTED', revision: 1, availableActions: [], history: [], ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
async function fill() {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Equipe *' }), 'team-a');
  await user.click(screen.getByRole('checkbox', { name: 'Inspeção' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Responsável pelo atendimento *' }), 'operator-a');
  await user.type(screen.getByRole('textbox', { name: 'Local do serviço *' }), 'Galpão A');
  fireEvent.change(screen.getByLabelText('Início previsto *'), { target: { value: '2099-10-11T09:00' } });
  fireEvent.change(screen.getByLabelText('Término previsto *'), { target: { value: '2099-10-11T10:00' } });
  await user.click(screen.getByRole('checkbox', { name: 'Ana Teste' }));
  return user;
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); state.sessionKey = 'session'; state.unitId = 'unit-a'; state.allowed = true;
  vi.mocked(api.get).mockReset().mockResolvedValue(options);
  vi.mocked(api.post).mockReset().mockRejectedValue(new Error('Não foi possível confirmar o envio.'));
});

describe('novo agendamento', () => {
  it('anuncia função obrigatória apenas para participante selecionado sem exigir cada opção dos grupos', async () => {
    show(); const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Equipe *' }), 'team-a');
    const participant = screen.getByRole('checkbox', { name: 'Ana Teste' });
    const serviceFunction = screen.getByRole('textbox', { name: /^Função de Ana Teste neste serviço/ });
    expect(serviceFunction).toBeDisabled();
    expect(serviceFunction).not.toHaveAttribute('aria-required', 'true');
    await user.click(participant);
    expect(serviceFunction).toBeEnabled();
    expect(serviceFunction).toHaveAttribute('aria-required', 'true');
    expect(serviceFunction).not.toHaveAttribute('required');
    expect(serviceFunction).toHaveValue('Inspeção');
    await user.click(participant);
    expect(serviceFunction).toBeDisabled();
    expect(serviceFunction).not.toHaveAttribute('aria-required', 'true');
    screen.getAllByRole('checkbox').forEach(checkbox => {
      expect(checkbox).not.toHaveAttribute('required');
      expect(checkbox).not.toHaveAttribute('aria-required', 'true');
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('envia trabalho a quente e espaço confinado juntos, preservando o serviço principal legado', async () => {
    vi.mocked(api.post).mockImplementation(async (_path, input) => receipt(input as AppointmentWriteDto) as never);
    show(); const user = await fill();
    await user.click(screen.getByRole('checkbox', { name: 'Inspeção' }));
    await user.click(screen.getByRole('checkbox', { name: 'Trabalho a quente' }));
    await user.click(screen.getByRole('checkbox', { name: 'Espaço confinado' }));
    expect(screen.getByText('Checklist v2 · Requisitos v3')).toBeVisible();
    expect(screen.getByText('Checklist v4 · Requisitos v5')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText('Atendimento salvo')).toBeVisible();
    expect(api.post).toHaveBeenCalledWith('/appointments', expect.objectContaining({ serviceTypeId: 'service-hot', serviceTypeIds: ['service-hot', 'service-confined'], participants: [options.teams[0].members[0]] }), expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });
  it('exige um serviço selecionado e não envia o atendimento vazio', async () => {
    show(); const user = await fill();
    await user.click(screen.getByRole('checkbox', { name: 'Inspeção' }));
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText('Selecione pelo menos um serviço.')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Local do serviço *' })).toHaveValue('Galpão A');
  });
  it('recusa um serviço removido das opções durante o preenchimento sem apagar os outros campos', async () => {
    const { client } = show(); const user = await fill();
    vi.mocked(api.get).mockResolvedValue({ ...options, services: options.services.filter(service => service.id !== 'service-a') });
    await act(async () => { await client.refetchQueries({ queryKey: ['permit-options'] }); });
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText('Selecione serviços disponíveis para esta unidade.')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Local do serviço *' })).toHaveValue('Galpão A');
    await user.click(screen.getByRole('button', { name: 'Remover serviços indisponíveis' }));
    await user.click(screen.getByRole('checkbox', { name: 'Trabalho a quente' }));
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText('Não foi possível confirmar o envio.')).toBeVisible();
    expect(api.post).toHaveBeenCalledWith('/appointments', expect.objectContaining({ serviceTypeIds: ['service-hot'], serviceTypeId: 'service-hot' }), expect.anything());
  });
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
    expect(screen.getByRole('checkbox', { name: 'Inspeção' })).toBeDisabled();
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
    expect(screen.getByRole('checkbox', { name: 'Inspeção' })).toBeChecked();
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

  it.each(['network', 401, 403, 404, 'invalid', 'inactive'] as const)('preserva os valores, oculta referências antigas e bloqueia envio após %s', async failure => {
    const view = show(); const user = await fill();
    await user.type(screen.getByLabelText('Observações do atendimento'), 'Orientação preservada');
    fireEvent.change(screen.getByLabelText('Função de Ana Teste neste serviço'), { target: { value: 'Função ajustada' } });
    if (failure === 'invalid') vi.mocked(api.get).mockResolvedValue({ ...options, teams: [{ ...options.teams[0], unitId: 'unit-b' }] });
    else if (failure === 'inactive') vi.mocked(api.get).mockResolvedValue({ ...options, teams: [{ ...options.teams[0], status: 'INACTIVE' }] });
    else vi.mocked(api.get).mockRejectedValue(typeof failure === 'number' ? new ApiError(failure, { code: 'FORBIDDEN', message: 'Nome restrito retornado pela API', requestId: 'test' }) : new Error('Conexão interrompida.'));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['permit-options'] }); });
    expect(screen.getByLabelText('Local do serviço *')).toHaveValue('Galpão A');
    expect(screen.getByLabelText('Observações do atendimento')).toHaveValue('Orientação preservada');
    expect(screen.getByLabelText('Equipe *')).toHaveValue('team-a');
    expect(screen.getByLabelText('Responsável pelo atendimento *')).toHaveValue('operator-a');
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Equipe A' })).not.toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Operador A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Ana Teste' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Inspeção' })).not.toBeInTheDocument();
    expect(screen.queryByText('Nome restrito retornado pela API')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar agendamento' })).toBeDisabled();
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Salvar agendamento' }).closest('form')!); });
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(api.get).mockResolvedValue(options);
    await user.click(screen.getByRole('button', { name: 'Atualizar opções' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar agendamento' })).toBeEnabled());
    expect(screen.getByRole('checkbox', { name: 'Inspeção' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ana Teste' })).toBeChecked();
    expect(screen.getByLabelText('Função de Ana Teste neste serviço')).toHaveValue('Função ajustada');
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/appointments', expect.objectContaining({ location: 'Galpão A', notes: 'Orientação preservada', participants: [{ workerId: 'worker-a', name: 'Ana Teste', serviceFunction: 'Função ajustada' }] }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('bloqueia envio enquanto as opções estão sendo conferidas sem perder o preenchimento', async () => {
    const view = show(); await fill(); const pending = deferred<unknown>();
    vi.mocked(api.get).mockReturnValue(pending.promise as never); let refresh!: Promise<void>;
    act(() => { refresh = view.client.refetchQueries({ queryKey: ['permit-options'] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar agendamento' })).toBeDisabled());
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Salvar agendamento' }).closest('form')!); });
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(options); await refresh; });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar agendamento' })).toBeEnabled());
    expect(screen.getByLabelText('Local do serviço *')).toHaveValue('Galpão A');
    expect(screen.getByRole('checkbox', { name: 'Ana Teste' })).toBeChecked();
  });

  it('envia uma única vez para dois submits no mesmo ciclo e invalida somente o contexto atual', async () => {
    const pending = deferred<unknown>(); vi.mocked(api.post).mockReturnValue(pending.promise as never);
    const view = show(); await fill(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    view.client.setQueryData(['appointments', 'other-session', 'unit-a'], ['sentinela']);
    view.client.setQueryData(['permit-dashboard', 'session', 'unit-b'], { untouched: true });
    const form = screen.getByRole('button', { name: 'Salvar agendamento' }).closest('form')!;
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Agendando…' })).toBeDisabled();
    expect(screen.getByLabelText('Local do serviço *')).toBeDisabled();
    const contextChange = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(contextChange); }); expect(contextChange.defaultPrevented).toBe(true);
    expect(vi.mocked(api.post).mock.calls[0][2]?.signal).toBeInstanceOf(AbortSignal);
    await act(async () => { pending.resolve(receipt(vi.mocked(api.post).mock.calls[0][1] as AppointmentWriteDto)); await pending.promise; });
    expect(await screen.findByText('Atendimento salvo')).toBeVisible();
    expect(invalidate.mock.calls.map(call => call[0])).toEqual([{ queryKey: ['appointments', 'session', 'unit-a'] }, { queryKey: ['permit-dashboard', 'session', 'unit-a'] }]);
    expect(view.client.getQueryState(['appointments', 'other-session', 'unit-a'])?.isInvalidated).toBe(false);
    expect(view.client.getQueryState(['permit-dashboard', 'session', 'unit-b'])?.isInvalidated).toBe(false);
  });

  it('não confirma envio após negativa das opções durante POST e permite repetir com a mesma chave depois de conferir', async () => {
    const pending = deferred<unknown>(); vi.mocked(api.post).mockReturnValue(pending.promise as never);
    const view = show(); const user = await fill(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const original = vi.mocked(api.post).mock.calls[0], saved = receipt(original[1] as AppointmentWriteDto);
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Referência restrita', requestId: 'test' }));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['permit-options'] }); });
    await screen.findByRole('button', { name: 'Atualizar opções' });
    await act(async () => { pending.resolve(saved); await pending.promise; });
    expect(await screen.findByText(/O envio retornou, mas as opções precisam ser conferidas novamente/)).toBeVisible();
    expect(screen.queryByText('Atendimento salvo')).not.toBeInTheDocument(); expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Local do serviço *')).toHaveValue('Galpão A');
    vi.mocked(api.get).mockResolvedValue(options);
    await user.click(screen.getByRole('button', { name: 'Atualizar opções' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar agendamento' })).toBeEnabled());
    vi.mocked(api.post).mockResolvedValue(saved);
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText('Atendimento salvo')).toBeVisible();
    expect(vi.mocked(api.post).mock.calls[1][2]?.idempotencyKey).toBe(original[2]?.idempotencyKey);
  });

  it.each(['unit', 'session', 'permission', 'unmount'] as const)('aborta e ignora criação tardia após mudar %s', async change => {
    const pending = deferred<unknown>(); vi.mocked(api.post).mockReturnValue(pending.promise as never);
    const view = show(); const user = await fill(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const call = vi.mocked(api.post).mock.calls[0], signal = call[2]?.signal;
    if (change === 'unit') state.unitId = 'unit-b';
    if (change === 'session') state.sessionKey = 'session-b';
    if (change === 'permission') state.allowed = false;
    if (change === 'unmount') view.unmount(); else view.update();
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(receipt(call[1] as AppointmentWriteDto)); await pending.promise; });
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText('Atendimento salvo')).not.toBeInTheDocument();
    expect(screen.queryByText(/Serviço agendado/)).not.toBeInTheDocument();
  });

  it.each([
    { id: '../outro' }, { teamId: 'team-b' }, { companyId: 'company-b' }, { responsibleId: 'operator-b' },
    { serviceTypeIds: ['service-hot'] }, { revision: 0 }, { participants: [] }, { startsAt: '2099-10-12T12:00:00Z' },
  ])('recusa recibo da mesma unidade com vínculo ou conteúdo inválido: %j', async invalid => {
    vi.mocked(api.post).mockImplementation(async (_path, input) => receipt(input as AppointmentWriteDto, invalid) as never);
    const view = show(); const user = await fill(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    await user.click(screen.getByRole('button', { name: 'Salvar agendamento' }));
    expect(await screen.findByText('A resposta não corresponde ao agendamento enviado. Seu preenchimento foi preservado.')).toBeVisible();
    expect(screen.getByLabelText('Local do serviço *')).toHaveValue('Galpão A');
    expect(screen.getByRole('checkbox', { name: 'Inspeção' })).toBeChecked();
    expect(screen.queryByText('Atendimento salvo')).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('mantém referências recusadas ocultas ao remontar até receber resposta fresca válida', async () => {
    const view = show(); await fill();
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Restrito', requestId: 'test' }));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['permit-options'] }); });
    await screen.findByRole('button', { name: 'Atualizar opções' }); view.unmount();
    const pending = deferred<unknown>(); vi.mocked(api.get).mockReturnValue(pending.promise as never);
    show(<AppointmentFormPage />, view.client);
    expect(screen.queryByRole('option', { name: 'Equipe A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Inspeção' })).not.toBeInTheDocument();
    await act(async () => { pending.resolve(options); await pending.promise; });
    expect(await screen.findByRole('option', { name: 'Equipe A' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Equipe *')).toBeEnabled());
  });

  it('não renderiza opções malformadas em cache enquanto aguarda a consulta válida', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const pending = deferred<unknown>();
    client.setQueryData(['permit-options', 'session', 'unit-a'], { ...options, teams: [{ id: 'team-a', unitId: 'unit-a', name: 'Nome antigo restrito' }] });
    vi.mocked(api.get).mockReturnValue(pending.promise as never); show(<AppointmentFormPage />, client);
    expect(await screen.findByText(/As opções retornadas não correspondem/)).toBeVisible();
    expect(screen.queryByText('Nome antigo restrito')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar agendamento' })).not.toBeInTheDocument();
    await act(async () => { pending.resolve(options); await pending.promise; });
    expect(await screen.findByRole('option', { name: 'Equipe A' })).toBeInTheDocument();
  });
});
