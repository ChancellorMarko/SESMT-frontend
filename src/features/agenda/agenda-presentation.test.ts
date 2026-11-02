import { describe, expect, it } from 'vitest';
import { agendaOrderError, agendaPeriodRange, orderAppointments } from './agenda-presentation';
import { calendarToday } from './calendar';

const rows = [
  { id: 'b', code: 'AG-10', teamName: 'Equipe 10', startsAt: '2026-10-19T10:00:00-03:00' },
  { id: 'c', code: 'AG-2', teamName: 'Água', startsAt: '2026-10-19T12:00:00Z' },
  { id: 'a', code: 'AG-1', teamName: 'Equipe 2', startsAt: '2026-10-19T13:00:00Z' },
];

describe('período e apresentação da agenda', () => {
  it('inclui hoje nos sete dias e atravessa mês e ano usando datas civis', () => {
    expect(agendaPeriodRange('today', '2026-12-29')).toEqual({ from: '2026-12-29', to: '2026-12-29' });
    expect(agendaPeriodRange('seven-days', '2026-12-29')).toEqual({ from: '2026-12-29', to: '2027-01-04' });
    expect(agendaPeriodRange('seven-days', '2028-02-27')).toEqual({ from: '2028-02-27', to: '2028-03-04' });
    expect(agendaPeriodRange('all', '2026-12-29')).toEqual({ from: '', to: '' });
  });
  it('aplica os atalhos no dia de São Paulo mesmo após virar o dia em UTC', () => {
    const today = calendarToday(new Date('2026-10-20T01:30:00Z'));
    expect(agendaPeriodRange('today', today)).toEqual({ from: '2026-10-19', to: '2026-10-19' });
  });
  it('ordena pelos instantes reais, desempata por código e não altera a resposta original', () => {
    const original = structuredClone(rows);
    expect(orderAppointments(rows, 'START_ASC').map(item => item.id)).toEqual(['c', 'a', 'b']);
    expect(orderAppointments(rows, 'START_DESC').map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual(original);
  });
  it('compara equipes em português e com numeração natural', () => {
    expect(orderAppointments(rows, 'TEAM').map(item => item.id)).toEqual(['c', 'a', 'b']);
  });
  it('mantém datas indisponíveis ao final em ambas as direções sem inventar horários', () => {
    const invalid = { ...rows[0], id: 'invalid', startsAt: 'indisponível' };
    expect(orderAppointments([invalid, ...rows], 'START_ASC').at(-1)).toEqual(invalid);
    expect(orderAppointments([invalid, ...rows], 'START_DESC').at(-1)).toEqual(invalid);
  });
  it.each(['order=', 'order=unknown', 'order=__proto__', 'order=TEAM&order=START_ASC'])('recusa ordenação inválida: %s', search => {
    expect(agendaOrderError(new URLSearchParams(search))).toBeDefined();
  });
  it.each(['', 'order=START_ASC', 'order=START_DESC', 'order=TEAM'])('aceita ordenação válida: %s', search => {
    expect(agendaOrderError(new URLSearchParams(search))).toBeUndefined();
  });
});
