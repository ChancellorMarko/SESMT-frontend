import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { AppointmentDetailPage } from './AppointmentDetailPage';

vi.mock('../../shared/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() }, revisionEtag: (revision: number) => `"${revision}"` }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session-a', unitId: 'unit-a', can: () => true }) }));
vi.mock('./EligibilityPanel', () => ({ EligibilityPanel: () => <div>Conferência documental</div> }));

let appointment: AppointmentDto;
beforeEach(() => {
  vi.clearAllMocks();
  appointment = { id: 'appointment-a', unitId: 'unit-a', code: 'AG-001', teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a', serviceLabel: 'Serviço ilustrativo', location: 'Galpão A', startsAt: '2026-10-09T17:00:00Z', endsAt: '2026-10-09T19:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador A', participants: [], status: 'CONFIRMED', revision: 4, availableActions: ['RESCHEDULE'], history: [] };
  vi.mocked(api.get).mockImplementation(async () => structuredClone(appointment));
  vi.mocked(api.post).mockImplementation(async () => structuredClone(appointment));
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/agenda/appointment-a']}><Routes><Route path="/app/agenda/:id" element={<AppointmentDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}

describe('Concorrência ao reagendar', () => {
  it('bloqueia a revisão antiga e preserva período e motivo até a conferência explícita', async () => {
    const user = userEvent.setup();
    const client = show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    await user.type(screen.getByLabelText('Motivo *'), 'Mudança de disponibilidade');
    appointment = { ...appointment, revision: 5, startsAt: '2026-10-10T17:00:00Z', endsAt: '2026-10-10T19:00:00Z' };
    await act(async () => { await client.refetchQueries({ queryKey: ['appointment'] }); });
    expect(client.getQueryData<AppointmentDto>(['appointment', 'session-a', 'unit-a', 'appointment-a'])?.revision).toBe(5);
    expect(screen.getByLabelText('Novo início *')).toHaveValue('2026-10-09T14:00');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reagendar serviço' })).toBeDisabled());
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Atualizar atendimento e preservar preenchimento' }));
    expect(await screen.findByText(/Atendimento atual carregado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Novo início *')).toHaveValue('2026-10-09T14:00');
    expect(screen.getByLabelText('Motivo *')).toHaveValue('Mudança de disponibilidade');
    await user.click(screen.getByRole('button', { name: 'Reagendar serviço' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [path, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe('/appointments/appointment-a/reschedule');
    expect(body).toMatchObject({ startsAt: '2026-10-09T17:00:00.000Z', endsAt: '2026-10-09T19:00:00.000Z' });
    expect(config?.etag).toBe('"5"');
    expect(await screen.findByText('Novo período registrado no histórico.')).toBeInTheDocument();
  });
  it('preserva preenchimento após conflito do servidor e permite nova confirmação com a revisão atual', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    await user.type(screen.getByLabelText('Motivo *'), 'Período ajustado com a equipe');
    vi.mocked(api.post).mockRejectedValueOnce({ status: 412, message: 'Dados alterados.' });
    await user.click(screen.getByRole('button', { name: 'Reagendar serviço' }));
    expect(await screen.findByText(/Seu motivo e período foram preservados/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reagendar serviço' })).toBeDisabled();
    expect(vi.mocked(api.post).mock.calls[0][2]?.etag).toBe('"4"');
    appointment = { ...appointment, revision: 8 };
    await user.click(screen.getByRole('button', { name: 'Atualizar atendimento e preservar preenchimento' }));
    expect(await screen.findByText(/Atendimento atual carregado/)).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo *')).toHaveValue('Período ajustado com a equipe');
    await user.click(screen.getByRole('button', { name: 'Reagendar serviço' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1][2]?.etag).toBe('"8"');
  });
  it('impede uma ação removida pela atualização concorrente, mesmo após conferir a nova revisão', async () => {
    const user = userEvent.setup(); const client = show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    appointment = { ...appointment, revision: 5, status: 'CANCELED', availableActions: [] };
    await act(async () => { await client.refetchQueries({ queryKey: ['appointment'] }); });
    await user.click(await screen.findByRole('button', { name: 'Atualizar atendimento e preservar preenchimento' }));
    expect(await screen.findByText(/Esta ação já não está disponível/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reagendar serviço' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('protege o motivo preenchido ao tentar trocar de unidade', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    await user.type(screen.getByLabelText('Motivo *'), 'Motivo ainda não enviado');
    const context = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(context); });
    expect(context.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Motivo *')).toHaveValue('Motivo ainda não enviado');
    confirm.mockReturnValue(true);
    const accepted = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(accepted); });
    expect(accepted.defaultPrevented).toBe(false);
  });
  it('bloqueia mudanças de unidade enquanto a confirmação está em andamento', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    let complete!: (value: AppointmentDto) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise<AppointmentDto>(resolve => { complete = resolve; }));
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    await user.type(screen.getByLabelText('Motivo *'), 'Motivo para reagendar');
    await user.click(screen.getByRole('button', { name: 'Reagendar serviço' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const context = new Event('sesmt:before-context-change', { cancelable: true });
    act(() => { window.dispatchEvent(context); });
    expect(context.defaultPrevented).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Motivo *')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();
    await act(async () => { complete(appointment); });
    expect(await screen.findByText('Novo período registrado no histórico.')).toBeInTheDocument();
  });
  it('apresenta os eventos reais do agendamento com rótulos compreensíveis', async () => {
    appointment.history = ['APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELED', 'EVIDENCE_SUBMITTED'].map((action, index) => ({ id: `event-${index}`, action, actorName: 'Gestora A', occurredAt: '2026-10-09T12:00:00Z' }));
    show();
    const history = await screen.findByRole('heading', { name: 'Histórico do agendamento' });
    const section = history.closest('section')!;
    expect(within(section).getByText('Agendamento confirmado')).toBeInTheDocument();
    expect(within(section).getByText('Serviço reagendado')).toBeInTheDocument();
    expect(within(section).getByText('Agendamento cancelado')).toBeInTheDocument();
    expect(within(section).getByText('Agendamento solicitado')).toBeInTheDocument();
    expect(within(section).getByText('Evidência enviada')).toBeInTheDocument();
  });
});
