import { consultationNavigation } from '../../shared/lib/consultation-navigation';
import { isRecord } from '../../shared/lib/scoped-page';
import { permitAgendaDestination, permitAgendaNavigation } from '../agenda/permit-agenda-navigation';

/** Rebuild the return state before forwarding it through details or printing. */
export function permitNavigation(state: unknown, sessionKey: string, unitId: string | undefined, permitId: string | undefined, canReadAppointments: boolean, canReadEligibility: boolean, appointmentId?: string) {
  const consultation = consultationNavigation(state, unitId);
  if (consultation) return consultation;
  const agenda = permitAgendaNavigation(state, sessionKey, unitId, permitId, canReadAppointments, canReadEligibility, appointmentId);
  if (agenda) return agenda;
  const list = isRecord(state) && typeof state.fromSearch === 'string' && (state.fromConsulta === undefined || state.fromConsulta === false)
    ? consultationNavigation({ fromConsulta: true, fromSearch: state.fromSearch, fromUnitId: state.fromUnitId }, unitId) : undefined;
  return list ? { ...list, fromConsulta: false as const } : undefined;
}

export function permitReturnDestination(origin: ReturnType<typeof permitNavigation>) {
  if (origin && 'permitAgendaReturnTo' in origin) return permitAgendaDestination(origin);
  if (origin?.fromConsulta) {
    const params = new URLSearchParams(origin.fromSearch);
    params.set('tab', 'permits');
    return { to: `/app/consulta?${params}`, label: 'Voltar à consulta', state: undefined };
  }
  return { to: `/app/pts${origin?.fromSearch || ''}`, label: 'Voltar às PTs', state: undefined };
}
