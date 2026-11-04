import { isRecord, isSafePage } from '../../shared/lib/scoped-page';
import { integrationStatusLabels, workerStatusLabels } from './support';

const filterKeys = ['q', 'status', 'companyId', 'teamId', 'integrationStatus', 'page', 'unitId'];
export const workerIdentifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value !== '.' && value !== '..' && !/[\u0000-\u0020\u007f/?#\\]/.test(value);

export function workerCriteriaError(params: URLSearchParams) {
  if (Array.from(params.keys()).some(key => params.getAll(key).length > 1)) return 'O endereço contém filtros de trabalhadores repetidos. Limpe os filtros para continuar.';
  if (Array.from(params.keys()).some(key => !filterKeys.includes(key))) return 'O endereço contém filtros incompatíveis com a consulta de trabalhadores. Limpe os filtros para continuar.';
  if (!isSafePage(params.get('page'), 10)) return 'O endereço contém uma página de trabalhadores inválida.';
  if ((params.get('q') || '').length > 200 || /[\u0000-\u001f\u007f]/.test(params.get('q') || '')) return 'A busca deve ter até 200 caracteres, sem caracteres de controle.';
  const status = params.get('status') || '', integration = params.get('integrationStatus') || '';
  if (status && !Object.hasOwn(workerStatusLabels, status)) return 'Selecione uma situação cadastral válida.';
  if (integration && !Object.hasOwn(integrationStatusLabels, integration)) return 'Selecione uma situação de integração válida.';
  if (['companyId', 'teamId'].some(key => params.get(key) && !workerIdentifier(params.get(key)))) return 'A identificação da empresa ou equipe no endereço é inválida.';
  return '';
}

export interface WorkerNavigation {
  workerListReturnTo: { unitId: string; sessionKey: string; search: string; draftSearch?: string; advancedOpen?: boolean };
}

/** Only restore validated criteria on the fixed worker list in the same session and unit. */
export function workerNavigation(state: unknown, sessionKey: string, unitId: string | undefined): WorkerNavigation | undefined {
  if (!unitId || !workerIdentifier(unitId) || !isRecord(state) || !isRecord(state.workerListReturnTo)) return undefined;
  const value = state.workerListReturnTo;
  if (value.unitId !== unitId || value.sessionKey !== sessionKey || typeof value.search !== 'string') return undefined;
  if (value.search.length > 4000 || !value.search.startsWith('?') || /[#\\\s\u0000-\u001f\u007f]/u.test(value.search)) return undefined;
  const params = new URLSearchParams(value.search);
  if (params.get('unitId') !== unitId || workerCriteriaError(params)) return undefined;
  const draftSearch = typeof value.draftSearch === 'string' && value.draftSearch.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.draftSearch) ? value.draftSearch : undefined;
  return { workerListReturnTo: { unitId, sessionKey, search: value.search, ...(draftSearch === undefined ? {} : { draftSearch }), ...(typeof value.advancedOpen === 'boolean' ? { advancedOpen: value.advancedOpen } : {}) } };
}
