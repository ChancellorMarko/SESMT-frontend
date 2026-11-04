import { isRecord } from '../../shared/lib/scoped-page';
import { notificationCriteriaError } from './notifications-support';

export interface NotificationNavigation {
  notificationReturnTo: { unitId: string; search: string };
}

/** Preserve only an authorized unit's validated query for the fixed notifications route. */
export function notificationNavigation(state: unknown, unitId: string | undefined): NotificationNavigation | undefined {
  if (!unitId || !isRecord(state) || !isRecord(state.notificationReturnTo)) return undefined;
  const origin = state.notificationReturnTo;
  if (origin.unitId !== unitId || typeof origin.search !== 'string') return undefined;
  if ('pathname' in origin && origin.pathname !== '/app/notificacoes') return undefined;
  const search = origin.search;
  if (search.length > 4096 || !search.startsWith('?') || /[#\u0000-\u0020\u007f\\]/.test(search)) return undefined;
  const params = new URLSearchParams(search);
  if (params.getAll('unitId').length !== 1 || params.get('unitId') !== unitId || notificationCriteriaError(params)) return undefined;
  return { notificationReturnTo: { unitId, search } };
}
