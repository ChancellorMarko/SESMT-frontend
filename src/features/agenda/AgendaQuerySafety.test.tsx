import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { AgendaPage } from './AgendaPage';
import { calendarShiftDay, calendarToday } from './calendar';

vi.mock('../../shared/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({ sessionKey: 'agenda-query-safety', unitId: 'unit-demo', can: () => true }),
}));

const storageKey = 'agenda_filters_unit-demo';

function Harness() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="Endereço atual">{location.search}</output>
    <button type="button" onClick={() => navigate(-1)}>Voltar no teste</button>
    <AgendaPage />
  </>;
}

function show(query: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/app/agenda${query}`]}><Harness /></MemoryRouter>
  </QueryClientProvider>);
}

function currentParams() {
  return new URLSearchParams(screen.getByLabelText('Endereço atual').textContent || '');
}

function appointmentCalls() {
  return vi.mocked(api.get).mock.calls.filter(([path]) => path === '/appointments');
}

describe('AgendaPage — segurança e continuidade dos filtros na URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(api.get).mockImplementation(async <T,>(path: string): Promise<T> => (
      path === '/permit-options' ? { teams: [], services: [], responsibles: [] } : []
    ) as T);
  });

  it('aplica atalhos sem apagar filtros ou texto não enviado e retira somente o período', async () => {
    const user = userEvent.setup();
    show('?q=AG&status=CONFIRMED&teamId=team-a&eligibility=blocked&order=TEAM');
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));
    await user.clear(screen.getByLabelText('Buscar atendimento'));
    await user.type(screen.getByLabelText('Buscar atendimento'), 'Ainda não enviado');
    await user.click(screen.getByRole('button', { name: 'Filtrar agenda para os próximos 7 dias, incluindo hoje' }));
    const today = calendarToday();
    await waitFor(() => expect(currentParams().get('from')).toBe(today));
    expect(currentParams().get('to')).toBe(calendarShiftDay(today, 6));
    expect(currentParams().get('status')).toBe('CONFIRMED');
    expect(currentParams().get('teamId')).toBe('team-a');
    expect(currentParams().get('eligibility')).toBe('blocked');
    expect(currentParams().get('order')).toBe('TEAM');
    expect(currentParams().get('q')).toBe('AG');
    expect(screen.getByLabelText('Buscar atendimento')).toHaveValue('Ainda não enviado');
    await user.click(screen.getByRole('button', { name: 'Consultar agenda sem limite de período' }));
    await waitFor(() => expect(currentParams().has('from')).toBe(false));
    expect(currentParams().has('to')).toBe(false); expect(currentParams().get('teamId')).toBe('team-a');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('reposiciona o calendário na data do atalho sem perder a visão semanal', async () => {
    const user = userEvent.setup(); show('?view=calendar&calendarMode=week&calendarDate=2026-01-01&day=2026-01-02&status=REQUESTED');
    await screen.findByRole('grid');
    await user.click(screen.getByRole('button', { name: 'Filtrar agenda para hoje' }));
    await waitFor(() => expect(currentParams().get('calendarDate')).toBe(calendarToday()));
    expect(currentParams().get('day')).toBe(calendarToday());
    expect(currentParams().get('calendarMode')).toBe('week');
    expect(currentParams().get('status')).toBe('REQUESTED');
  });
  it.each(['order=unknown', 'order=TEAM&order=START_DESC'])('bloqueia ordenação inválida até a escolha explícita: %s', async search => {
    const user = userEvent.setup(); show(`?q=AG&${search}`);
    await screen.findByRole('heading', { name: 'Corrija os filtros da agenda' });
    expect(appointmentCalls()).toHaveLength(0);
    await user.selectOptions(screen.getByLabelText('Ordenar atendimentos'), 'START_ASC');
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));
    expect(currentParams().has('order')).toBe(false); expect(currentParams().get('q')).toBe('AG');
  });
  it('permite limpar uma ordenação inválida sem conservar o erro', async () => {
    const user = userEvent.setup(); show('?order=unknown');
    await screen.findByRole('heading', { name: 'Corrija os filtros da agenda' });
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));
    expect(currentParams().has('order')).toBe(false);
    expect(screen.getByLabelText('Ordenar atendimentos')).toHaveValue('START_ASC');
  });

  it('remove a única situação pelo select sem restaurar o filtro salvo', async () => {
    const user = userEvent.setup();
    show('?status=REQUESTED');
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));
    expect(sessionStorage.getItem(storageKey)).toContain('status=REQUESTED');

    await user.selectOptions(screen.getByLabelText('Situação do agendamento'), '');

    await waitFor(() => {
      expect(currentParams().toString()).toBe('');
      expect(screen.getByLabelText('Situação do agendamento')).toHaveValue('');
    });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    await waitFor(() => expect(appointmentCalls()).toContainEqual([
      '/appointments', expect.objectContaining({ query: expect.objectContaining({ status: '' }) }),
    ]));
  });

  it.each([
    ['invertido', '?from=2026-12-31&to=2026-01-01'],
    ['com início impossível', '?from=2026-02-30&to=2026-03-01'],
    ['com término impossível', '?to=2026-02-30'],
  ])('bloqueia a consulta com período %s recebido na URL', async (_description, query) => {
    show(query);
    expect(await screen.findByRole('heading', { name: 'Corrija os filtros da agenda' })).toBeVisible();
    expect(appointmentCalls()).toHaveLength(0);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(query);
  });

  it('remove o último chip de situação e mantém a lista sem query nem filtros salvos', async () => {
    const user = userEvent.setup();
    show('?status=CONFIRMED');
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Remover filtro: Situação' }));

    await waitFor(() => expect(currentParams().toString()).toBe(''));
    expect(screen.getByLabelText('Situação do agendamento')).toHaveValue('');
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover filtro: Situação' })).not.toBeInTheDocument();
  });

  it('remove o último chip sem perder o período e a seleção do calendário', async () => {
    const user = userEvent.setup();
    show('?status=CONFIRMED&view=calendar&calendarMode=week&calendarDate=2026-10-15&day=2026-10-16');
    await screen.findByRole('grid', { name: 'Calendário semanal de 11/10 a 17/10/2026' });

    await user.click(screen.getByRole('button', { name: 'Remover filtro: Situação' }));

    await waitFor(() => expect(currentParams().has('status')).toBe(false));
    expect(Object.fromEntries(currentParams())).toEqual({
      view: 'calendar', calendarMode: 'week', calendarDate: '2026-10-15', day: '2026-10-16',
    });
    expect(screen.getByRole('heading', { name: 'Atendimentos em 16/10/2026' })).toBeVisible();
    expect(sessionStorage.getItem(storageKey)).toContain('calendarMode=week');
    expect(sessionStorage.getItem(storageKey)).not.toContain('status=');
  });

  it('Voltar restaura os critérios aplicados e sincroniza os campos de busca e local', async () => {
    const user = userEvent.setup();
    show('?q=AG-ANTERIOR&status=REQUESTED&location=Galp%C3%A3o&from=2026-10-01');
    await waitFor(() => expect(appointmentCalls()).toHaveLength(1));

    await user.clear(screen.getByLabelText('Buscar atendimento'));
    await user.type(screen.getByLabelText('Buscar atendimento'), 'AG-NOVO');
    await user.clear(screen.getByLabelText('Local do serviço'));
    await user.type(screen.getByLabelText('Local do serviço'), 'Torre');
    await user.click(screen.getByRole('button', { name: 'Pesquisar' }));
    await waitFor(() => expect(currentParams().get('q')).toBe('AG-NOVO'));
    await user.selectOptions(screen.getByLabelText('Situação do agendamento'), 'CONFIRMED');
    await waitFor(() => expect(currentParams().get('status')).toBe('CONFIRMED'));

    await user.click(screen.getByRole('button', { name: 'Voltar no teste' }));
    await waitFor(() => expect(screen.getByLabelText('Situação do agendamento')).toHaveValue('REQUESTED'));
    expect(screen.getByLabelText('Buscar atendimento')).toHaveValue('AG-NOVO');
    expect(screen.getByLabelText('Local do serviço')).toHaveValue('Torre');

    await user.click(screen.getByRole('button', { name: 'Voltar no teste' }));
    await waitFor(() => expect(screen.getByLabelText('Buscar atendimento')).toHaveValue('AG-ANTERIOR'));
    expect(screen.getByLabelText('Local do serviço')).toHaveValue('Galpão');
    expect(screen.getByLabelText('Situação do agendamento')).toHaveValue('REQUESTED');
    expect(screen.getByLabelText('Data inicial do filtro')).toHaveValue('2026-10-01');
    expect(Object.fromEntries(currentParams())).toEqual({
      q: 'AG-ANTERIOR', status: 'REQUESTED', location: 'Galpão', from: '2026-10-01',
    });
  });
});
