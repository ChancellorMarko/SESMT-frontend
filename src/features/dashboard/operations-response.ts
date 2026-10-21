import type { PermitDashboardDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { dateOnly } from '../../shared/lib/format';
import { isRecord, ScopedPageError, shortText } from '../../shared/lib/scoped-page';

export interface OperationsCriteria {
  unitId: string;
  from: string;
  to: string;
  teamId: string;
  serviceId: string;
  location: string;
}

export class OperationsResponseError extends ScopedPageError {
  constructor() {
    super();
    this.name = 'OperationsResponseError';
    this.message = 'A consulta retornou dados operacionais inválidos. Tente novamente.';
  }
}

const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value) && !/[\u0000-\u0020\u007f/?#\\]/.test(value);
const label = (value: unknown): value is string => shortText(value) && Boolean(value.trim());
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const nonnegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value: unknown): value is number => nonnegativeInteger(value) && value > 0;

function civilDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function instant(value: unknown): value is string {
  // Require an explicit offset so the same response cannot change scope with the browser timezone.
  return shortText(value, 100) && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && civilDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function validCriteria(value: OperationsCriteria) {
  return identifier(value.unitId) && (!value.teamId || identifier(value.teamId)) && (!value.serviceId || identifier(value.serviceId))
    && (!value.from || civilDate(value.from)) && (!value.to || civilDate(value.to)) && (!value.from || !value.to || value.from <= value.to)
    && shortText(value.location, 200);
}

function uniqueRecords(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !identifier(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function appointment(value: unknown, expected: OperationsCriteria, upcoming: boolean): value is Record<string, unknown> {
  if (!isRecord(value) || !identifier(value.id) || value.unitId !== expected.unitId || !identifier(value.teamId)
    || !identifier(value.serviceTypeId) || !label(value.serviceLabel) || !label(value.location)
    || !instant(value.startsAt) || !instant(value.endsAt) || Date.parse(value.endsAt) <= Date.parse(value.startsAt)) return false;
  const services = value.serviceTypeIds === undefined ? [value.serviceTypeId] : value.serviceTypeIds;
  if (!Array.isArray(services) || !services.length || !services.every(identifier) || new Set(services).size !== services.length
    || services[0] !== value.serviceTypeId || expected.teamId && value.teamId !== expected.teamId
    || expected.serviceId && !services.includes(expected.serviceId)
    || normalized(expected.location) && !normalized(value.location).includes(normalized(expected.location))) return false;
  // Match /permit-dashboard: an appointment can overlap the lower bound even when it starts earlier.
  const startDay = dateOnly(new Date(value.startsAt));
  const endDay = dateOnly(new Date(value.endsAt));
  if (expected.from && startDay < expected.from && endDay < expected.from || expected.to && startDay > expected.to) return false;
  if (upcoming) return ['REQUESTED', 'CONFIRMED'].includes(String(value.status)) && label(value.code) && label(value.teamName) && label(value.responsibleName);
  return value.status === 'ATTENDANCE_OPENED';
}

/** Validate only the fields exposed by the operational panel, both for requests and cache reads. */
export function checkedOperationsDashboard(value: unknown, expected: OperationsCriteria): PermitDashboardDto {
  if (!validCriteria(expected) || !isRecord(value) || !instant(value.generatedAt)
    || !['appointments', 'activePermits', 'blockedAppointments', 'pendingReviews'].every(key => nonnegativeInteger(value[key]))
    || !uniqueRecords(value.nextAppointments) || value.nextAppointments.length > 5 || !uniqueRecords(value.pendingPermits)) throw new OperationsResponseError();
  const appointments = new Set<string>();
  for (const item of value.nextAppointments) {
    if (!appointment(item, expected, true)) throw new OperationsResponseError();
    appointments.add(item.id as string);
  }
  for (const item of value.pendingPermits) {
    if (!label(item.code) || item.operationStatus !== 'COMPLETED' || !['PENDING_REVIEW', 'RETURNED'].includes(String(item.reviewStatus))
      || !positiveInteger(item.version) || !positiveInteger(item.revision) || !appointment(item.appointment, expected, false)
      || appointments.has(item.appointment.id as string)
      || item.appointment.permitId !== undefined && item.appointment.permitId !== item.id) throw new OperationsResponseError();
    appointments.add(item.appointment.id as string);
  }
  return value as unknown as PermitDashboardDto;
}

/** Selects consume identities and names; unrelated fields of the full options DTO are intentionally not required. */
export function checkedOperationsOptions(value: unknown, unitId: string): PermitOptionsDto {
  if (!identifier(unitId) || !isRecord(value) || !uniqueRecords(value.teams) || !uniqueRecords(value.services) || !uniqueRecords(value.responsibles)
    || !value.teams.every(team => team.unitId === unitId && label(team.name) && (team.status === undefined || team.status === 'ACTIVE'))
    || !value.services.every(service => label(service.name)) || !value.responsibles.every(responsible => label(responsible.name))) throw new OperationsResponseError();
  return value as unknown as PermitOptionsDto;
}
