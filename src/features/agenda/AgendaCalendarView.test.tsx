import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { AgendaCalendarView } from './AgendaCalendarView';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ can: (permission: string) => permission !== 'permits.read' }) }));
const appointment: AppointmentDto = { id: 'appointment-a', code: 'AG-001', unitId: 'unit-a', teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a', serviceTypeIds: ['service-a', 'service-b'], serviceLabel: 'Quente + Espaço confinado', location: 'Área A', startsAt: '2026-10-15T01:00:00Z', endsAt: '2026-10-15T02:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador A', participants: [], status: 'CONFIRMED', revision: 1, availableActions: [], history: [], permitId: 'permit-a' };
function Calendar({ appointments = [appointment] }: { appointments?: AppointmentDto[] }) {
  const location = useLocation();
  return <><output aria-label="URL atual">{location.search}</output><AgendaCalendarView appointments={appointments} initialDate="2026-10-14" searchString={location.search} /></>;
}
function show(entry = '/app/agenda?view=calendar', appointments?: AppointmentDto[]) {
  render(<MemoryRouter initialEntries={[entry]}><Calendar appointments={appointments} /></MemoryRouter>);
}

describe('Calendário operacional', () => {
  it('agrupa pelo dia de Brasília e só exibe links autorizados para a PT', () => {
    show();
    expect(screen.getByRole('button', { name: '14 de outubro de 2026: 1 atendimento(s)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Atendimentos em 14/10/2026' })).toHaveTextContent('Quente + Espaço confinado');
    expect(screen.queryByRole('link', { name: 'Ver PT →' })).not.toBeInTheDocument();
  });
  it('navega mensalmente com o dia coerente e mantém todos os filtros na URL', async () => {
    const user = userEvent.setup();
    show('/app/agenda?view=calendar&status=CONFIRMED&serviceTypeId=service-b');
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(screen.getByRole('grid', { name: 'Calendário de Novembro de 2026' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Atendimentos em 01/11/2026' })).toBeVisible();
    expect(screen.getByLabelText('URL atual')).toHaveTextContent('calendarDate=2026-11-01');
    expect(screen.getByLabelText('URL atual')).toHaveTextContent('serviceTypeId=service-b');
    await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(screen.getByRole('grid', { name: 'Calendário de Outubro de 2026' })).toBeVisible();
  });
  it('alterna para a semana selecionada e navega sete dias por vez', async () => {
    const user = userEvent.setup(); show();
    await user.click(screen.getByRole('button', { name: 'Semanal' }));
    expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    expect(screen.getByRole('grid', { name: 'Calendário semanal de 11/10 a 17/10/2026' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Próxima semana' }));
    expect(screen.getByRole('grid', { name: 'Calendário semanal de 18/10 a 24/10/2026' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(screen.getByRole('heading', { name: 'Atendimentos em 14/10/2026' })).toBeVisible();
  });
  it('restaura período e seleção do retorno de detalhe e permite fechar o painel', async () => {
    const user = userEvent.setup();
    show('/app/agenda?view=calendar&calendarMode=week&calendarDate=2026-12-31&day=2027-01-01');
    expect(screen.getByRole('grid', { name: 'Calendário semanal de 27/12 a 02/01/2027' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Atendimentos em 01/01/2027' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Fechar detalhe do dia' }));
    expect(screen.queryByRole('region', { name: /Atendimentos em/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('URL atual')).toHaveTextContent('day=none');
  });
  it('move seleção e foco com as setas, inclusive na virada do mês', async () => {
    const user = userEvent.setup(); show('/app/agenda?view=calendar&calendarDate=2026-10-31&day=2026-10-31');
    screen.getByRole('button', { name: '31 de outubro de 2026: 0 atendimento(s)' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '1 de novembro de 2026: 0 atendimento(s)' })).toHaveFocus();
    expect(screen.getByRole('grid', { name: 'Calendário de Novembro de 2026' })).toBeVisible();
    await user.keyboard('{ArrowDown}{End}');
    expect(screen.getByRole('button', { name: '14 de novembro de 2026: 0 atendimento(s)' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: '8 de novembro de 2026: 0 atendimento(s)' })).toHaveFocus();
    await user.keyboard('{PageDown}');
    expect(screen.getByRole('button', { name: '1 de dezembro de 2026: 0 atendimento(s)' })).toHaveFocus();
  });
  it('permite navegar e selecionar um dia mesmo sem nenhum atendimento', async () => {
    const user = userEvent.setup(); show('/app/agenda?view=calendar', []);
    await user.click(screen.getByRole('button', { name: '20 de outubro de 2026: 0 atendimento(s)' }));
    const panel = screen.getByRole('region', { name: 'Atendimentos em 20/10/2026' });
    expect(within(panel).getByRole('status')).toHaveTextContent('Nenhum atendimento agendado para esta data.');
    expect(screen.getByLabelText('URL atual')).toHaveTextContent('day=2026-10-20');
  });
});
