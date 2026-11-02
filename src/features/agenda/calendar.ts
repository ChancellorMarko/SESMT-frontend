import { appointmentDateOnly } from './support';

/** Civil dates use UTC arithmetic; operational instants are converted in São Paulo first. */
export function calendarDate(value?: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

export function calendarToday(now = new Date()): string {
  return appointmentDateOnly(now.toISOString());
}

export function calendarShiftDay(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarMonthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function calendarShiftMonth(value: string, months: number): string {
  const date = new Date(`${calendarMonthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function calendarWeekStart(value: string): string {
  return calendarShiftDay(value, -new Date(`${value}T12:00:00Z`).getUTCDay());
}

export function calendarDays(value: string, mode: 'month' | 'week'): string[] {
  const start = calendarWeekStart(mode === 'week' ? value : calendarMonthStart(value));
  const nextMonth = calendarShiftMonth(value, 1);
  const monthEnd = calendarShiftDay(nextMonth, -1);
  const count = mode === 'week' ? 7 : Math.round((new Date(`${monthEnd}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  const fullWeeks = Math.ceil(count / 7) * 7;
  return Array.from({ length: fullWeeks }, (_item, index) => calendarShiftDay(start, index));
}

export function calendarLabel(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}
