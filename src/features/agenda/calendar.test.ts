import { describe, expect, it } from 'vitest';
import { calendarDate, calendarDays, calendarShiftDay, calendarShiftMonth, calendarToday, calendarWeekStart } from './calendar';

describe('Datas civis da agenda', () => {
  it('rejeita datas impossíveis e parâmetros incompletos', () => {
    expect(calendarDate('2026-02-30')).toBeUndefined();
    expect(calendarDate('2026-10')).toBeUndefined();
    expect(calendarDate('2026-10-13T09:00')).toBeUndefined();
    expect(calendarDate('2028-02-29')).toBe('2028-02-29');
  });
  it('define hoje no fuso operacional, inclusive próximo à meia-noite UTC', () => {
    expect(calendarToday(new Date('2026-10-14T01:00:00Z'))).toBe('2026-10-13');
    expect(calendarToday(new Date('2026-10-14T03:00:00Z'))).toBe('2026-10-14');
  });
  it('navega entre meses e anos sem converter o dia civil para o fuso do navegador', () => {
    expect(calendarShiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(calendarShiftMonth('2026-12-31', 1)).toBe('2027-01-01');
    expect(calendarShiftMonth('2027-01-31', -1)).toBe('2026-12-01');
    expect(calendarWeekStart('2026-10-13')).toBe('2026-10-11');
  });
  it('gera semanas completas, incluindo os dias adjacentes do mês e ano', () => {
    const month = calendarDays('2026-10-13', 'month');
    expect(month).toHaveLength(35);
    expect(month[0]).toBe('2026-09-27');
    expect(month.at(-1)).toBe('2026-10-31');
    expect(calendarDays('2026-12-31', 'week')).toEqual(['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
