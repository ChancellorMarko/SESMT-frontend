import type { DashboardDto } from '../../shared/contracts';
import { isRecord, ScopedPageError, shortText } from '../../shared/lib/scoped-page';
import { documentStatuses, isCivilDate } from '../documents/validation';

export interface DocumentDashboardCriteria { unitId: string; from: string; to: string }
type Indicator = DashboardDto['indicators'][number];

export class DocumentDashboardResponseError extends ScopedPageError {
  constructor() {
    super();
    this.name = 'DocumentDashboardResponseError';
    this.message = 'A consulta retornou dados documentais inválidos. Tente novamente.';
  }
}

const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value) && !['.', '..'].includes(value) && !/[\u0000-\u0020\u007f/?#\\%]/.test(value);
const label = (value: unknown, max = 4000): value is string => shortText(value, max) && Boolean(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
const code = (value: unknown): value is string => shortText(value, 100) && /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && isCivilDate(value);
const normalizedDate = (value: unknown) => value === undefined || value === '' ? '' : date(value) ? value : undefined;
const expectedStatuses = new Map<string, string>([['DOCUMENTS_ACTIVE', 'ACTIVE'], ['DOCUMENTS_EXPIRED', 'EXPIRED'], ['DOCUMENTS_IN_REVIEW', 'IN_REVIEW'], ['DOCUMENTS_EXPIRING', 'ACTIVE']]);
const idFilters = new Set(['companyId', 'unitId', 'sectorId', 'typeId', 'workerId', 'responsibleId']);
const dateFilters = new Set(['validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo']);
const acceptedFilters = new Set([...idFilters, ...dateFilters, 'q', 'status']);

function instant(value: unknown): value is string {
  if (!shortText(value, 100) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !date(value.slice(0, 10))) return false;
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19));
  return hour < 24 && minute < 60 && second < 60 && Number.isFinite(Date.parse(value));
}

function validCriteria(expected: DocumentDashboardCriteria) {
  return identifier(expected.unitId) && normalizedDate(expected.from) !== undefined && normalizedDate(expected.to) !== undefined
    && (!expected.from || !expected.to || expected.from <= expected.to);
}

/** Unknown future keys are not interpreted; every recognized criterion must be safe and coherent. */
function checkedTarget(value: unknown, indicatorCode: string, expected: DocumentDashboardCriteria): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new DocumentDashboardResponseError();
  const filters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!acceptedFilters.has(key)) continue;
    if (raw === undefined || raw === '') continue;
    if (idFilters.has(key) ? !identifier(raw) : dateFilters.has(key) ? !date(raw) : key === 'status' ? !documentStatuses.some(status => status === raw) : !label(raw, 200)) throw new DocumentDashboardResponseError();
    filters[key] = raw as string;
  }
  if (filters.unitId && filters.unitId !== expected.unitId
    || filters.issueDateFrom && filters.issueDateFrom !== expected.from || filters.issueDateTo && filters.issueDateTo !== expected.to
    || filters.validUntilFrom && filters.validUntilTo && filters.validUntilFrom > filters.validUntilTo
    || filters.issueDateFrom && filters.issueDateTo && filters.issueDateFrom > filters.issueDateTo
    || filters.status && expectedStatuses.has(indicatorCode) && filters.status !== expectedStatuses.get(indicatorCode)) throw new DocumentDashboardResponseError();
  return filters;
}

/** Validate the envelope and only data consumed by the documentary dashboard, also on cache reads. */
export function checkedDocumentDashboard(value: unknown, expected: DocumentDashboardCriteria): DashboardDto {
  if (!validCriteria(expected) || !isRecord(value) || !instant(value.generatedAt) || !isRecord(value.filters)
    || value.filters.unitId !== expected.unitId || normalizedDate(value.filters.from) !== expected.from || normalizedDate(value.filters.to) !== expected.to
    || !Array.isArray(value.indicators) || !Array.isArray(value.pendingItems)) throw new DocumentDashboardResponseError();
  const codes = new Set<string>();
  for (const indicator of value.indicators) {
    if (!isRecord(indicator) || !code(indicator.code) || codes.has(indicator.code) || !label(indicator.label, 240)
      || typeof indicator.value !== 'number' || !Number.isSafeInteger(indicator.value) || indicator.value < 0
      || !label(indicator.formula, 2000) || !label(indicator.period, 500) || !label(indicator.source, 500) || !instant(indicator.updatedAt)) throw new DocumentDashboardResponseError();
    codes.add(indicator.code);
    checkedTarget(indicator.targetFilter, indicator.code, expected);
  }
  const ids = new Set<string>(), resources = new Set<string>();
  for (const item of value.pendingItems) {
    if (!isRecord(item) || !identifier(item.id) || ids.has(item.id) || !identifier(item.resourceId) || !label(item.title, 240)
      || !code(item.resourceType) || item.status !== undefined && !code(item.status)
      || item.dueDate !== undefined && item.dueDate !== '' && !date(item.dueDate)) throw new DocumentDashboardResponseError();
    const resource = JSON.stringify([item.resourceType.toUpperCase(), item.resourceId]);
    if (resources.has(resource)) throw new DocumentDashboardResponseError();
    ids.add(item.id); resources.add(resource);
  }
  return value as unknown as DashboardDto;
}

/** Missing criteria or filters the document screen cannot apply never broaden a metric's search. */
export function documentDashboardLink(indicator: Indicator, expected: DocumentDashboardCriteria): string | undefined {
  if (!validCriteria(expected)) return undefined;
  const filters = checkedTarget(indicator.targetFilter, indicator.code, expected);
  // Company and sector identities are valid contract fields, but DocumentsPage currently filters only by unit.
  if (filters?.companyId || filters?.sectorId) return undefined;
  const status = expectedStatuses.get(indicator.code);
  if (indicator.code === 'DOCUMENTS_EXPIRING' && (!filters?.validUntilFrom || !filters.validUntilTo)) return undefined;
  if (!status && (!filters || !Object.keys(filters).length)) return undefined;
  const params = new URLSearchParams(filters);
  if (status) params.set('status', status);
  params.set('unitId', expected.unitId);
  if (expected.from) params.set('issueDateFrom', expected.from);
  if (expected.to) params.set('issueDateTo', expected.to);
  return `/app/documentos?${params}`;
}
