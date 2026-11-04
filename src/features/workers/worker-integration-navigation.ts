import { readinessReturnPath } from '../requirements/readiness-navigation';

export function integrationReturnDestination(state: unknown, unitId: string | undefined, workerUnitId: string, canReadEligibility: boolean) {
  if (!state || typeof state !== 'object' || !('integrationReturnTo' in state)) return null;
  const destination = state.integrationReturnTo;
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) return null;
  if (!('unitId' in destination) || !unitId || destination.unitId !== unitId || workerUnitId !== unitId) return null;
  if (!('pathname' in destination) || typeof destination.pathname !== 'string') return null;
  const isAppointment = /^\/app\/agenda\/[A-Za-z0-9_-]+$/.test(destination.pathname);
  if (!isAppointment && destination.pathname !== '/app/pendencias') return null;
  const search = 'search' in destination ? destination.search : '';
  const hash = 'hash' in destination ? destination.hash : '';
  if (typeof search !== 'string' || typeof hash !== 'string') return null;
  if ((search && (!search.startsWith('?') || search.includes('#'))) || (hash && !hash.startsWith('#'))) return null;
  if (/[\u0000-\u0020\u007f\\]/.test(search + hash)) return null;
  const readinessTarget = isAppointment && canReadEligibility ? readinessReturnPath(destination, unitId) : undefined;
  return {
    to: { pathname: destination.pathname, search, hash },
    label: isAppointment ? 'Voltar ao atendimento' : 'Voltar às pendências',
    state: readinessTarget ? { readinessReturnTo: { search: readinessTarget.slice('/app/pendencias'.length), unitId } } : undefined,
  };
}
