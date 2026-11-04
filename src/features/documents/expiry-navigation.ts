import { isRecord } from '../../shared/lib/scoped-page';
import { expiryCriteriaError } from './expiry';

export interface ExpirationNavigation {
  expirationReturnTo: { unitId: string; search: string };
}

/** Retain only a validated query for the fixed expirations route in the current unit. */
export function expirationNavigation(state: unknown, unitId: string | undefined): ExpirationNavigation | undefined {
  if (!unitId || !isRecord(state) || !isRecord(state.expirationReturnTo)) return undefined;
  const origin = state.expirationReturnTo;
  if (origin.unitId !== unitId || typeof origin.search !== 'string') return undefined;
  if ('pathname' in origin && origin.pathname !== '/app/vencimentos') return undefined;
  const search = origin.search;
  if (search.length > 4096 || !search.startsWith('?') || /[#\u0000-\u0020\u007f\\]/.test(search)) return undefined;
  const params = new URLSearchParams(search);
  if (params.getAll('unitId').length !== 1 || params.get('unitId') !== unitId || expiryCriteriaError(params)) return undefined;
  return { expirationReturnTo: { unitId, search } };
}
