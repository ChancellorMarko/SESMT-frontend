import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { AppointmentDetailPage } from './AppointmentDetailPage';

vi.mock('../../shared/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  revisionEtag: (revision: number) => `"${revision}"`,
}));
vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({ sessionKey: 'detail-usability', unitId: 'unit-a', can: () => true }),
}));
vi.mock('./EligibilityPanel', () => ({ EligibilityPanel: () => <div>Conferência documental</div> }));

let appointment: AppointmentDto;

beforeEach(() => {
  vi.clearAllMocks();
  appointment = {
    id: 'appointment-a', unitId: 'unit-a', code: 'AG-001',
    teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a',
    serviceLabel: 'Inspeção do galpão', location: 'Galpão A',
    startsAt: '2026-10-09T17:00:00Z', endsAt: '2026-10-09T19:00:00Z',
    responsibleId: 'operator-a', responsibleName: 'Operador A',
    participants: [], status: 'CONFIRMED', revision: 4,
    availableActions: ['RESCHEDULE'], history: [],
  };
  vi.mocked(api.get).mockImplementation(async () => structuredClone(appointment));
  vi.mocked(api.post).mockImplementation(async () => structuredClone(appointment));
});

afterEach(() => { vi.restoreAllMocks(); });

function show(fromSearch?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[{ pathname: '/app/agenda/appointment-a', state: { fromSearch } }]}>
      <Routes>
        <Route path="/app/agenda/:id" element={<AppointmentDetailPage />} />
        <Route path="/app/agenda" element={<div>Lista da agenda</div>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

describe('AppointmentDetailPage — preenchimento pendente e retorno à agenda', () => {
  it.each(['Escape', 'X', 'Voltar'] as const)('protege o motivo alterado ao fechar por %s e descarta somente após aceitar', async method => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    await user.type(screen.getByLabelText('Motivo *'), 'Ajustar janela com a equipe');

    const requestClose = async () => {
      if (method === 'Escape') await user.keyboard('{Escape}');
      else await user.click(within(screen.getByRole('dialog')).getByRole('button', {
        name: method === 'X' ? 'Fechar janela' : 'Voltar',
      }));
    };

    await requestClose();
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Motivo *')).toHaveValue('Ajustar janela com a equipe');
    expect(screen.getByLabelText('Novo início *')).toHaveValue('2026-10-09T14:00');
    expect(api.post).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await requestClose();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('fecha a ação sem alterações sem pedir confirmação de descarte', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Reagendar' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(confirm).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('mantém mês, modo, dia e filtros do calendário no retorno após falha de carregamento', async () => {
    const fromSearch = '?view=calendar&calendarDate=2026-11-01&calendarMode=week&day=2026-11-04&status=CONFIRMED&q=galpao';
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Não foi possível carregar o atendimento.'));
    show(fromSearch);

    const back = await screen.findByRole('link', { name: 'Voltar à agenda' });
    expect(back).toHaveAttribute('href', `/app/agenda${fromSearch}`);
    expect(screen.queryByRole('heading', { name: 'Inspeção do galpão' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('oferece o retorno original ao receber outra unidade sem mostrar os dados ou ações do atendimento', async () => {
    const fromSearch = '?view=calendar&calendarDate=2026-12-01&calendarMode=month&day=2026-12-08&responsibleId=operator-a';
    appointment = { ...appointment, unitId: 'unit-b', teamName: 'Equipe de outra unidade' };
    show(fromSearch);

    const back = await screen.findByRole('link', { name: 'Voltar à agenda' });
    expect(back).toHaveAttribute('href', `/app/agenda${fromSearch}`);
    expect(screen.queryByRole('heading', { name: 'Inspeção do galpão' })).not.toBeInTheDocument();
    expect(screen.queryByText('Equipe de outra unidade')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reagendar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Conferência documental')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
