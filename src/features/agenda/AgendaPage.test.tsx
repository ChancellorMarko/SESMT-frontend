import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
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

function renderPage(initialEntry = '/app/agenda') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/agenda" element={<AgendaPage />} />
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
});
