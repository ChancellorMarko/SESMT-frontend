import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { AgendaPage } from './AgendaPage';

vi.mock('../../shared/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  revisionEtag: (r: number) => `"${r}"`,
}));

vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({
    sessionKey: 'session-demo',
    unitId: 'unit-demo',
    can: () => true,
  }),
}));

const mockOptions: PermitOptionsDto = {
  teams: [
    {
      id: 'team-1',
      name: 'Equipe Alfa',
      unitId: 'unit-demo',
      companyId: 'comp-1',
      chiefId: 'chief-1',
      members: [{ workerId: 'worker-1', name: 'Trabalhador 1', serviceFunction: 'Executante' }],
      revision: 1,
    },
  ],
  services: [
    { id: 'service-alt', name: 'Trabalho em altura', description: 'Serviço em altura', templateVersion: '1', requirementVersion: '1' },
    { id: 'service-esp', name: 'Espaço confinado', description: 'Serviço confinado', templateVersion: '1', requirementVersion: '1' },
  ],
  responsibles: [
    { id: 'resp-1', name: 'Diego Demo' },
    { id: 'resp-2', name: 'Operador Secundário' },
  ],
};

const mockAppointments: AppointmentDto[] = [
  {
    id: 'app-1',
    code: 'AG-DEMO-220',
    unitId: 'unit-demo',
    teamId: 'team-1',
    teamName: 'Equipe Alfa',
    serviceTypeId: 'service-alt',
    serviceTypeIds: ['service-alt', 'service-esp'],
    serviceLabel: 'Trabalho em altura + Espaço confinado',
    location: 'Galpão 01 · Área Operacional',
    startsAt: '2026-10-15T12:00:00Z',
    endsAt: '2026-10-15T15:00:00Z',
    requestedStartsAt: '2026-10-15T12:00:00Z',
    requestedEndsAt: '2026-10-15T15:00:00Z',
    confirmedStartsAt: '2026-10-15T12:00:00Z',
    confirmedEndsAt: '2026-10-15T15:00:00Z',
    responsibleId: 'resp-1',
    responsibleName: 'Diego Demo',
    participants: [{ workerId: 'worker-1', name: 'Trabalhador 1', serviceFunction: 'Executante' }],
    status: 'CONFIRMED',
    revision: 2,
    availableActions: ['RESCHEDULE'],
    history: [],
  },
  {
    id: 'app-2',
    code: 'AG-DEMO-221',
    unitId: 'unit-demo',
    teamId: 'team-1',
    teamName: 'Equipe Alfa',
    serviceTypeId: 'service-alt',
    serviceTypeIds: ['service-alt'],
    serviceLabel: 'Trabalho em altura',
    location: 'Torre de Resfriamento',
    startsAt: '2026-10-20T11:00:00Z',
    endsAt: '2026-10-20T14:00:00Z',
    requestedStartsAt: '2026-10-20T11:00:00Z',
    requestedEndsAt: '2026-10-20T14:00:00Z',
    responsibleId: 'resp-2',
    responsibleName: 'Operador Secundário',
    participants: [],
    status: 'REQUESTED',
    revision: 1,
    availableActions: ['CONFIRM', 'CANCEL'],
    history: [],
  },
];

function renderPage(initialEntry = '/app/agenda', afterAgenda?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/agenda" element={<><AgendaPage />{afterAgenda}</>} />
          <Route path="/app/agenda/:id" element={<div>Detalhe do agendamento</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

describe('AgendaPage — Visão de lista e calendário, múltiplos serviços e filtros (#102)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(api.get).mockImplementation(async (path: string, options?: any) => {
      if (path === '/permit-options') return structuredClone(mockOptions);
      if (path === '/appointments') {
        const query = options?.query;
        let list = structuredClone(mockAppointments);
        if (query?.status) list = list.filter(a => a.status === query.status);
        if (query?.teamId) list = list.filter(a => a.teamId === query.teamId);
        if (query?.responsibleId) list = list.filter(a => a.responsibleId === query.responsibleId);
        if (query?.q) list = list.filter(a => a.code.includes(query.q) || a.serviceLabel.includes(query.q));
        return list;
      }
      return [];
    });
  });

  it('exibe atendimentos na visão de lista com múltiplos serviços e rótulos de horário', async () => {
    renderPage();
    expect(await screen.findByText('Trabalho em altura + Espaço confinado')).toBeInTheDocument();
    expect(screen.getByText('AG-DEMO-220')).toBeInTheDocument();
    expect(screen.getByText('AG-DEMO-221')).toBeInTheDocument();

    // Rótulos de solicitado e confirmado
    expect(screen.getByText('(Confirmado)')).toBeInTheDocument();
    expect(screen.getByText('(Solicitado)')).toBeInTheDocument();
  });

  it('reordena os resultados localmente sem repetir a consulta ou alterar situações', async () => {
    const user = userEvent.setup(); renderPage();
    const table = await screen.findByRole('table', { name: 'Atendimentos da agenda' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('AG-DEMO-220');
    const calls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/appointments').length;
    await user.selectOptions(screen.getByLabelText('Ordenar atendimentos'), 'START_DESC');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('AG-DEMO-221');
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/appointments')).toHaveLength(calls);
    expect(screen.getByText('(Confirmado)')).toBeInTheDocument();
    expect(screen.getByText('(Solicitado)')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('mantém os filtros avançados recolhidos ao usar um período rápido', async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Filtrar agenda para hoje' }));
    expect(screen.getByRole('button', { name: /Filtros avançados/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Filtrar agenda para hoje' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    'Filtrar agenda para os próximos 7 dias, incluindo hoje',
    'Consultar agenda sem limite de período',
  ])('mantém os filtros recolhidos ao escolher "%s" antes de concluir o primeiro período', async nextPeriod => {
    function ChooseNextPeriod() {
      const location = useLocation();
      const switched = useRef(false);
      useLayoutEffect(() => {
        const params = new URLSearchParams(location.search);
        if (switched.current || !params.get('from') || params.get('from') !== params.get('to')) return;
        switched.current = true;
        screen.getByRole('button', { name: nextPeriod }).click();
      }, [location.search]);
      return null;
    }
    const user = userEvent.setup();
    renderPage('/app/agenda', <ChooseNextPeriod />);
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Filtrar agenda para hoje' }));
    await waitFor(() => expect(screen.getByRole('button', { name: nextPeriod })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: /Filtros avançados/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('alterna para a visão de calendário e exibe a grade do mês e navegação', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Trabalho em altura + Espaço confinado');

    const calendarToggle = screen.getByRole('button', { name: /Calendário/i });
    await user.click(calendarToggle);

    // No calendário, o grid é renderizado
    expect(await screen.findByRole('grid', { name: /Calendário de/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument();
  });

  it('filtra por situação e atualiza a consulta à API', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('AG-DEMO-220');

    const statusSelect = screen.getByLabelText('Situação do agendamento');
    await user.selectOptions(statusSelect, 'REQUESTED');

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/appointments',
        expect.objectContaining({
          query: expect.objectContaining({ status: 'REQUESTED' }),
        })
      );
    });
  });

  it('abre filtros avançados e filtra por equipe, responsável e período', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('AG-DEMO-220');

    const advancedBtn = screen.getByRole('button', { name: /Filtros avançados/i });
    await user.click(advancedBtn);

    expect(screen.getByLabelText('Data inicial do filtro')).toBeInTheDocument();
    expect(screen.getByLabelText('Data final do filtro')).toBeInTheDocument();
    expect(screen.getByLabelText('Equipe')).toBeInTheDocument();
    expect(screen.getByLabelText('Responsável operacional')).toBeInTheDocument();

    // Selecionar responsável
    await user.selectOptions(screen.getByLabelText('Responsável operacional'), 'resp-1');

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/appointments',
        expect.objectContaining({
          query: expect.objectContaining({ responsibleId: 'resp-1' }),
        })
      );
    });
  });

  it('persiste os filtros no sessionStorage e permite limpar filtros', async () => {
    const user = userEvent.setup();
    renderPage('/app/agenda?status=CONFIRMED&q=AG-DEMO');

    await screen.findByText('AG-DEMO-220');

    expect(sessionStorage.getItem('agenda_filters_unit-demo')).toContain('status=CONFIRMED');

    const clearBtn = screen.getByRole('button', { name: 'Limpar filtros' });
    await user.click(clearBtn);

    expect(sessionStorage.getItem('agenda_filters_unit-demo')).toBeNull();
  });
  it('restaura os filtros avançados salvos ao abrir a agenda sem query', async () => {
    sessionStorage.setItem('agenda_filters_unit-demo', 'responsibleId=resp-1&location=Galp%C3%A3o&view=calendar&calendarDate=2026-12-01&day=2026-12-04');
    renderPage();
    expect(await screen.findByRole('grid', { name: 'Calendário de Dezembro de 2026' })).toBeVisible();
    expect(screen.getByLabelText('Responsável operacional')).toHaveValue('resp-1');
    expect(screen.getByLabelText('Local do serviço')).toHaveValue('Galpão');
    expect(screen.getByRole('heading', { name: 'Atendimentos em 04/12/2026' })).toBeVisible();
  });
  it('limpa critérios de busca sem perder semana e dia do calendário', async () => {
    const user = userEvent.setup();
    renderPage('/app/agenda?view=calendar&calendarMode=week&calendarDate=2026-10-15&day=2026-10-15&status=CONFIRMED');
    expect(await screen.findByRole('grid', { name: 'Calendário semanal de 11/10 a 17/10/2026' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByRole('grid', { name: 'Calendário semanal de 11/10 a 17/10/2026' })).toBeVisible();
    expect(screen.getByLabelText('Situação do agendamento')).toHaveValue('');
    expect(sessionStorage.getItem('agenda_filters_unit-demo')).toContain('day=2026-10-15');
    expect(sessionStorage.getItem('agenda_filters_unit-demo')).not.toContain('status=');
  });
  it('preserva calendário navegável quando os filtros não encontram atendimentos', async () => {
    renderPage('/app/agenda?view=calendar&q=NAO_EXISTE&calendarDate=2026-10-01');
    expect(await screen.findByRole('grid', { name: 'Calendário de Outubro de 2026' })).toBeVisible();
    expect(screen.getByText('Nenhum atendimento agendado para esta data.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeEnabled();
  });
  it('permite consulta com armazenamento do navegador indisponível', async () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
    try {
      renderPage();
      expect(await screen.findByText('AG-DEMO-220')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeEnabled();
    } finally { storage.mockRestore(); }
  });
});
