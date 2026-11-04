import { isRecord, isSafePage } from '../../shared/lib/scoped-page';
import { workerNavigation, type WorkerNavigation } from './worker-navigation';
import { integrationReturnDestination } from './worker-integration-navigation';

interface WorkerDocumentReturnTo {
  workerId: string;
  unitId: string;
  sessionKey: string;
  documentPage: number;
  workerListReturnTo?: WorkerNavigation['workerListReturnTo'];
  integrationReturnTo?: { pathname: string; search: string; hash: string; unitId: string; readinessReturnTo?: { search: string; unitId: string } };
}
export interface WorkerDocumentNavigation { workerDocumentReturnTo: WorkerDocumentReturnTo }

const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
const safePage = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && isSafePage(String(value), 5);

/** The receiving screen determines the route; state only describes its authorized return context. */
export function workerDocumentNavigation(state: unknown, sessionKey: string, unitId: string | undefined, canReadWorkers = true, canReadEligibility = true): WorkerDocumentNavigation | undefined {
  if (!canReadWorkers || !unitId || !isRecord(state) || !isRecord(state.workerDocumentReturnTo)) return undefined;
  const value = state.workerDocumentReturnTo;
  if (value.unitId !== unitId || value.sessionKey !== sessionKey || !safeId(value.workerId) || !safePage(value.documentPage)) return undefined;
  const list = workerNavigation(value, sessionKey, unitId);
  const integration = integrationReturnDestination(value, unitId, unitId, canReadEligibility);
  return { workerDocumentReturnTo: { workerId: value.workerId, unitId, sessionKey, documentPage: value.documentPage,
    ...list,
    ...(integration ? { integrationReturnTo: { ...integration.to, unitId, ...integration.state } } : {}),
  } };
}

export function workerDocumentDestination(origin: WorkerDocumentNavigation) {
  const { workerId, unitId, sessionKey, documentPage, workerListReturnTo, integrationReturnTo } = origin.workerDocumentReturnTo;
  return { to: `/app/trabalhadores/${encodeURIComponent(workerId)}#documentos`, state: {
    workerDocumentPageReturnTo: { workerId, unitId, sessionKey, page: documentPage },
    ...(workerListReturnTo ? { workerListReturnTo } : {}), ...(integrationReturnTo ? { integrationReturnTo } : {}),
  } };
}

export function restoredWorkerDocumentPage(state: unknown, sessionKey: string, unitId: string | undefined, workerId: string | undefined) {
  if (!unitId || !workerId || !isRecord(state) || !isRecord(state.workerDocumentPageReturnTo)) return 1;
  const value = state.workerDocumentPageReturnTo;
  return value.unitId === unitId && value.sessionKey === sessionKey && value.workerId === workerId && safePage(value.page) ? value.page : 1;
}
