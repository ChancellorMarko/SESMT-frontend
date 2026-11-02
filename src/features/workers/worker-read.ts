import type { OrganizationDto, WorkerMovementReadDto, WorkerReadDto } from '../../shared/contracts';
import { checkedPage, isRecord, shortText } from '../../shared/lib/scoped-page';
import { InvalidReadResponse, readIdentifier as id } from '../../shared/lib/verified-read';
import { isCivilDate } from '../documents/validation';
import { integrationStatusLabels, movementLabels, workerStatusLabels } from './support';

export function checkedWorkerDetail(value: unknown, workerId: string, unitId: string): WorkerReadDto {
  if (!isRecord(value) || value.sourceReadOnly !== undefined && typeof value.sourceReadOnly !== 'boolean' || value.id !== workerId || value.unitId !== unitId || !id(value.companyId)
    || !shortText(value.fullName, 500) || !value.fullName.trim() || !shortText(value.registration, 200)
    || typeof value.admissionDate !== 'string' || !isCivilDate(value.admissionDate)
    || typeof value.status !== 'string' || !Object.hasOwn(workerStatusLabels, value.status)
    || (value.sourceReadOnly === true ? value.revision !== null || value.employmentType !== null || value.sectorId !== null && !id(value.sectorId)
      : !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !shortText(value.employmentType, 200) || !id(value.sectorId))
    || value.integrationStatus !== undefined && (typeof value.integrationStatus !== 'string' || !Object.hasOwn(integrationStatusLabels, value.integrationStatus))
    || value.teams !== undefined && (!Array.isArray(value.teams) || value.teams.some(item => !isRecord(item) || !id(item.teamId) || !shortText(item.teamName, 500) || !shortText(item.serviceFunction, 500) || !['ACTIVE', 'INACTIVE'].includes(String(item.status)) || typeof item.isChief !== 'boolean'))
    || value.integrationHistory !== undefined && (!Array.isArray(value.integrationHistory) || value.integrationHistory.some(item => !isRecord(item) || !id(item.id) || item.workerId !== workerId || !shortText(item.integratedAt, 100) || !shortText(item.responsibleName, 500)))) throw new InvalidReadResponse();
  return value as unknown as WorkerReadDto;
}
export function checkedOrganization(value: unknown): OrganizationDto {
  if (!isRecord(value) || ['companies', 'establishments', 'units', 'sectors', 'jobs', 'jobFunctions', 'workCenters'].some(key => {
    const rows = value[key];
    return !Array.isArray(rows) || rows.some(item => !isRecord(item) || !id(item.id) || !shortText(item.name, 500)) || new Set(rows.map(item => item.id)).size !== rows.length;
  })) throw new InvalidReadResponse();
  return value as unknown as OrganizationDto;
}
export function checkedWorkerMovements(value: unknown, workerId: string, page: number) {
  function assignment(value: unknown) {
    return value == null || isRecord(value) && (value.unitId === null || id(value.unitId)) && (value.sectorId === null || id(value.sectorId));
  }
  return checkedPage(value, { page, pageSize: 5 }, (item): item is WorkerMovementReadDto => isRecord(item) && item.workerId === workerId
    && typeof item.type === 'string' && Object.hasOwn(movementLabels, item.type)
    && typeof item.effectiveDate === 'string' && isCivilDate(item.effectiveDate)
    && (item.reason === null || shortText(item.reason, 10000)) && assignment(item.previousAssignment) && assignment(item.newAssignment));
}
