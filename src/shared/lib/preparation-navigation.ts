import { consultationNavigation, type ConsultationNavigation } from './consultation-navigation';

export type PreparationList = 'ats' | 'pets';
export interface PreparationNavigation {
  fromPreparationList: PreparationList;
  fromSearch: string;
  fromUnitId: string;
}

export type PreparationOrigin = PreparationNavigation | ConsultationNavigation;

/** Preserve a central search only for the same resource and explicitly identified unit. */
export function preparationOrigin(state: unknown, unitId: string | undefined, list: PreparationList): PreparationOrigin | undefined {
  const ownList = preparationNavigation(state, unitId, list);
  if (ownList) return ownList;
  if (!unitId || !state || typeof state !== 'object' || (state as Record<string, unknown>).fromUnitId !== unitId) return undefined;
  const central = consultationNavigation(state, unitId);
  if (central && new URLSearchParams(central.fromSearch).get('tab') === list) return central;
  return undefined;
}

export function preparationListPath(origin: PreparationOrigin | undefined, list: PreparationList): string {
  return origin && 'fromConsulta' in origin ? `/app/consulta${origin.fromSearch}` : `/app/${list}${origin?.fromSearch || ''}`;
}

/** Carry list criteria through editors and print views, scoped to the current unit. */
export function preparationNavigation(state: unknown, unitId: string | undefined, list: PreparationList): PreparationNavigation | undefined {
  if (!unitId || !state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const value = state as Record<string, unknown>;
  if (value.fromPreparationList !== list || value.fromUnitId !== unitId) return undefined;
  const search = value.fromSearch;
  if (typeof search !== 'string' || search.length > 2000 || search && !search.startsWith('?') || /[\u0000-\u0020\u007f#\\]/.test(search)) return undefined;
  const params = new URLSearchParams(search);
  if (params.getAll('unitId').length > 1 || params.has('unitId') && params.get('unitId') !== unitId) return undefined;
  // The caller supplies the fixed list route. State never supplies a destination URL.
  return { fromPreparationList: list, fromSearch: search, fromUnitId: unitId };
}

