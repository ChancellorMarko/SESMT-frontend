import { isRecord } from '../../shared/lib/scoped-page';
import { readinessCriteriaError } from './readiness';

/** Only the current unit's validated documentary query can become a return link. */
export function readinessReturnPath(state: unknown, unitId: string | undefined): string | undefined {
  if (!unitId || !isRecord(state) || !isRecord(state.readinessReturnTo)) return undefined;
  const origin = state.readinessReturnTo;
  if (origin.unitId !== unitId || typeof origin.search !== 'string') return undefined;
  if ('pathname' in origin && origin.pathname !== '/app/pendencias') return undefined;
  const search = origin.search;
  if (search.length > 4096 || search && !search.startsWith('?') || /[#\u0000-\u0020\u007f\\]/.test(search)) return undefined;
  const params = new URLSearchParams(search);
  if (params.getAll('unitId').length !== 1 || params.get('unitId') !== unitId || readinessCriteriaError(params)) return undefined;
  return `/app/pendencias${search}`;
}
