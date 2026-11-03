import { workerDocumentDestination, workerDocumentNavigation } from './worker-document-navigation';

export const safetyId = (value: string | null): value is string =>
  Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000');

export function safetyFilter(params: URLSearchParams, ownOnly: boolean, ownWorker?: string | null) {
  const workerId = params.get('workerId');
  return {
    subjectWorkerId: safetyId(workerId) ? workerId : undefined,
    validWorker: params.getAll('workerId').length <= 1 &&
      (workerId === null || safetyId(workerId) && (!ownOnly || ownWorker === workerId)),
  };
}

export function safetyReturn(state: unknown, sessionKey: string, unitId: string | undefined, workerId: string | undefined, canRead: boolean, canEligibility: boolean, section: 'equipment' | 'training' = 'equipment') {
  const origin = workerDocumentNavigation(state, sessionKey, unitId, canRead, canEligibility);
  if (!workerId || origin?.workerDocumentReturnTo.workerId !== workerId) return undefined;
  const destination = workerDocumentDestination(origin);
  const anchor = section === 'training' ? '?seguranca=treinamentos#seguranca' : '#seguranca';
  return { ...destination, to: destination.to.replace(/#documentos$/, anchor) };
}
