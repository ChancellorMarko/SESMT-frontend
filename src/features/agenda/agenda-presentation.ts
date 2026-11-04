import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { calendarShiftDay } from './calendar';

export const agendaOrderLabels = {
  START_ASC: 'Início: mais cedo',
  START_DESC: 'Início: mais tarde',
  TEAM: 'Equipe: A–Z',
} as const;
export type AgendaOrder = keyof typeof agendaOrderLabels;
export type AgendaPeriod = 'today' | 'seven-days' | 'all';

export function agendaPeriodRange(period: AgendaPeriod, today: string) {
  return period === 'all' ? { from: '', to: '' } : { from: today, to: period === 'today' ? today : calendarShiftDay(today, 6) };
}

export function agendaOrderError(params: URLSearchParams) {
  return params.getAll('order').length > 1 || params.has('order') && !Object.hasOwn(agendaOrderLabels, params.get('order')!)
    ? 'Selecione uma ordenação válida para consultar a agenda.' : undefined;
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/** Presentation only: sort the returned records without changing statuses or the cached response. */
export function orderAppointments<T extends Pick<AppointmentDto, 'id' | 'code' | 'teamName' | 'startsAt'>>(appointments: T[], order: AgendaOrder): T[] {
  return [...appointments].sort((left, right) => {
    if (order === 'TEAM') {
      const team = collator.compare(left.teamName, right.teamName);
      if (team) return team;
    }
    const leftTime = Date.parse(left.startsAt), rightTime = Date.parse(right.startsAt);
    const leftValid = Number.isFinite(leftTime), rightValid = Number.isFinite(rightTime);
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    if (leftValid && leftTime !== rightTime) return (leftTime - rightTime) * (order === 'START_DESC' ? -1 : 1);
    return collator.compare(left.code, right.code) || collator.compare(left.id, right.id);
  });
}
