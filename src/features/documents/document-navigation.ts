import { isRecord, isSafePage } from '../../shared/lib/scoped-page';
import { documentStatuses, isCivilDate } from './validation';

export interface DocumentReturnTo { unitId: string; search: string }
export interface DocumentNavigation {
  documentListReturnTo?: DocumentReturnTo;
  documentDashboardReturnTo?: DocumentReturnTo;
}

const listKeys = new Set(['unitId', 'q', 'typeId', 'status', 'workerId', 'responsibleId', 'validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo', 'page']);
const dashboardKeys = new Set(['from', 'to']);
const identifier = (value: string) => value.length > 0 && value.length <= 200 && !['.', '..'].includes(value) && !/[\s\u0000-\u001f\u007f/?#\\%]/u.test(value);

function validRange(params: URLSearchParams, fromKey: string, toKey: string) {
  const from = params.get(fromKey) ?? '', to = params.get(toKey) ?? '';
  return (!from || isCivilDate(from)) && (!to || isCivilDate(to)) && (!from || !to || from <= to);
}

function checkedOrigin(value: unknown, unitId: string, pathname: string, keys: Set<string>, check: (params: URLSearchParams) => boolean): DocumentReturnTo | undefined {
  if (!isRecord(value) || value.unitId !== unitId || typeof value.search !== 'string') return undefined;
  if ('pathname' in value && value.pathname !== pathname) return undefined;
  const search = value.search;
  if (search.length > 2000 || search && !search.startsWith('?') || /[#\\\s\u0000-\u001f\u007f]/u.test(search)) return undefined;
  const params = new URLSearchParams(search);
  if (Array.from(params.keys()).some(key => !keys.has(key) || params.getAll(key).length !== 1) || !check(params)) return undefined;
  return { unitId, search };
}

export function documentCriteriaError(params: URLSearchParams, browserProjection = false) {
  if (Array.from(params.keys()).some(key => params.getAll(key).length !== 1)) return 'O endereço contém filtros repetidos. Limpe os filtros ou aplique uma nova busca.';
  if (Array.from(params.keys()).some(key => !listKeys.has(key))) return 'O endereço contém filtros incompatíveis com documentos. Limpe os filtros ou aplique uma nova busca.';
  if (['unitId', 'typeId', 'workerId', 'responsibleId'].some(key => params.get(key) && !identifier(params.get(key)!))) return 'O endereço contém uma identificação inválida. Limpe os filtros ou selecione outra opção.';
  const query = params.get('q') ?? '', status = params.get('status') ?? '';
  if (query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) return 'A busca deve ter até 200 caracteres, sem caracteres de controle.';
  if (status && !documentStatuses.some(candidate => candidate === status)) return 'Selecione uma situação documental válida.';
  if (!isSafePage(params.get('page'), 10)) return 'O endereço contém uma página de documentos inválida. Limpe os filtros ou aplique uma nova busca.';
  if (!validRange(params, 'validUntilFrom', 'validUntilTo') || !validRange(params, 'issueDateFrom', 'issueDateTo')) return 'Informe intervalos de datas válidos para a consulta.';
  if (browserProjection && params.get('responsibleId')) return 'O filtro por responsável não está disponível nesta consulta. Remova esse filtro para continuar.';
  return '';
}

function validList(params: URLSearchParams, unitId: string) {
  return (!params.has('unitId') || params.get('unitId') === unitId) && !documentCriteriaError(params);
}

/** Keep validated queries only; every destination route is fixed by the receiving screen. */
export function documentNavigation(state: unknown, unitId: string | undefined, canReadDashboard = true): DocumentNavigation | undefined {
  if (!unitId || !identifier(unitId) || !isRecord(state)) return undefined;
  const documentListReturnTo = checkedOrigin(state.documentListReturnTo, unitId, '/app/documentos', listKeys, params => validList(params, unitId));
  const documentDashboardReturnTo = canReadDashboard ? checkedOrigin(state.documentDashboardReturnTo, unitId, '/app/painel-documental', dashboardKeys, params => validRange(params, 'from', 'to')) : undefined;
  if (!documentListReturnTo && !documentDashboardReturnTo) return undefined;
  return { ...(documentListReturnTo ? { documentListReturnTo } : {}), ...(documentDashboardReturnTo ? { documentDashboardReturnTo } : {}) };
}
