import { isRecord } from '../../shared/lib/scoped-page';
import { readinessReturnPath } from '../requirements/readiness-navigation';
import { agendaOrderError } from './agenda-presentation';
import { calendarDate } from './calendar';
import { appointmentLabels } from './support';

export interface PermitAgendaNavigation {
  permitAgendaReturnTo: {
    permitId: string;
    appointmentId: string;
    unitId: string;
    sessionKey: string;
    source: 'agenda' | 'appointment';
    search: string;
    readinessReturnTo?: { unitId: string; search: string };
  };
}

const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
const agendaKeys = new Set(['unitId', 'q', 'status', 'teamId', 'responsibleId', 'serviceTypeId', 'location', 'from', 'to', 'eligibility', 'order', 'view', 'calendarMode', 'calendarDate', 'day']);

/** A query describes the fixed agenda route, never a destination supplied by state or storage. */
export function agendaReturnSearch(value: unknown, unitId: string | undefined): string | undefined {
  if (!unitId || typeof value !== 'string' || value.length > 4096 || value && !value.startsWith('?') || /[\u0000-\u0020\u007f#\\]/.test(value)) return undefined;
  try {
    // URLSearchParams accepts malformed escapes; reject them before parsing the criteria.
    if (/[\u0000-\u001f\u007f]/.test(decodeURIComponent(value.replaceAll('+', ' ')))) return undefined;
  } catch { return undefined; }
  const params = new URLSearchParams(value);
  for (const key of params.keys()) {
    if (!agendaKeys.has(key) || params.getAll(key).length !== 1) return undefined;
  }
  if (params.has('unitId') && params.get('unitId') !== unitId) return undefined;
  if (['teamId', 'responsibleId', 'serviceTypeId'].some(key => params.has(key) && !safeId(params.get(key)))) return undefined;
  if (['q', 'location'].some(key => (params.get(key)?.length ?? 0) > 2000)) return undefined;
  if (params.has('status') && !Object.hasOwn(appointmentLabels, params.get('status')!)) return undefined;
  if (params.has('eligibility') && params.get('eligibility') !== 'blocked') return undefined;
  if (agendaOrderError(params)) return undefined;
  if (params.has('view') && !['list', 'calendar'].includes(params.get('view')!)) return undefined;
  if (params.has('calendarMode') && !['month', 'week'].includes(params.get('calendarMode')!)) return undefined;
  if (['from', 'to', 'calendarDate'].some(key => params.has(key) && !calendarDate(params.get(key)))) return undefined;
  if (params.has('day') && params.get('day') !== 'none' && !calendarDate(params.get('day'))) return undefined;
  if (params.has('from') && params.has('to') && params.get('from')! > params.get('to')!) return undefined;
  return value;
}

/** Bind an operational return to the current record and access context on every screen. */
export function permitAgendaNavigation(
  state: unknown,
  sessionKey: string,
  unitId: string | undefined,
  permitId: string | undefined,
  canReadAppointments = true,
  canReadEligibility = true,
  appointmentId?: string,
): PermitAgendaNavigation | undefined {
  if (!canReadAppointments || !sessionKey || !unitId || !safeId(permitId) || !isRecord(state) || !isRecord(state.permitAgendaReturnTo)) return undefined;
  const value = state.permitAgendaReturnTo;
  if (value.unitId !== unitId || value.sessionKey !== sessionKey || value.permitId !== permitId || !safeId(value.appointmentId)
    || appointmentId !== undefined && value.appointmentId !== appointmentId || value.source !== 'agenda' && value.source !== 'appointment') return undefined;
  const search = agendaReturnSearch(value.search, unitId);
  if (search === undefined) return undefined;
  const readinessPath = value.source === 'appointment' && canReadEligibility ? readinessReturnPath(value, unitId) : undefined;
  return { permitAgendaReturnTo: {
    permitId, appointmentId: value.appointmentId, unitId, sessionKey, source: value.source, search,
    ...(readinessPath ? { readinessReturnTo: { unitId, search: readinessPath.slice('/app/pendencias'.length) } } : {}),
  } };
}

export function permitAgendaDestination(origin: PermitAgendaNavigation) {
  const { source, appointmentId, search, readinessReturnTo } = origin.permitAgendaReturnTo;
  return source === 'agenda'
    ? { to: `/app/agenda${search}`, label: 'Voltar à agenda', state: undefined }
    : { to: `/app/agenda/${encodeURIComponent(appointmentId)}`, label: 'Voltar ao atendimento', state: { fromSearch: search, ...(readinessReturnTo ? { readinessReturnTo } : {}) } };
}
