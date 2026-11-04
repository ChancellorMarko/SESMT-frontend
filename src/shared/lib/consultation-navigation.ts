export interface ConsultationNavigation { fromConsulta: true; fromSearch: string; fromUnitId?: string }

/** Keep a query on the fixed consultation route; never treat state as a destination URL. */
export function consultationNavigation(state: unknown, unitId: string | undefined): ConsultationNavigation | undefined {
  if (!unitId || !state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const value = state as Record<string, unknown>;
  if (value.fromConsulta !== true || value.fromUnitId !== undefined && value.fromUnitId !== unitId) return undefined;
  const search = value.fromSearch ?? '';
  if (typeof search !== 'string' || search.length > 2000 || search && !search.startsWith('?') || /[\u0000-\u0020\u007f#\\]/.test(search)) return undefined;
  const params = new URLSearchParams(search);
  if (params.getAll('tab').length > 1 || params.getAll('unitId').length > 1 || params.has('unitId') && params.get('unitId') !== unitId) return undefined;
  if (params.has('tab') && !['documents', 'permits', 'ats', 'pets'].includes(params.get('tab')!)) return undefined;
  return { fromConsulta: true, fromSearch: search, fromUnitId: unitId };
}
