import type { AppointmentDto, EligibilityDto, PermitEventDto, PermitSourceCheckDto, ScienceDto } from './work-permits';

/** Contratos propostos para a AT. A demonstração não concede autorização operacional real. */
export type WorkAuthorizationStatus = 'DRAFT' | 'AUTHORIZED' | 'SUSPENDED' | 'CLOSED' | 'CANCELED';
export interface AuthorizationPreparationDto {
  identification: {
    serviceManagement: string;
    serviceProvider: string;
    activityDescription: string;
    workFront: string;
    areaManagement: string;
    riskAnalysisReference: string;
    notes: string;
  };
  foremanId: string;
  controls: string[];
  additionalControls: string;
  checks: PermitSourceCheckDto[];
}
export interface AuthorizationWriteDto extends AuthorizationPreparationDto { permitId?: string | null }
export interface AuthorizationCreateDto extends AuthorizationWriteDto { appointmentId: string }
export interface AuthorizationRepresentationsDto {
  responsibleName: string;
  foremanName: string;
  issuerName: string;
  confirmed: true;
}
export interface AuthorizationReleaseWriteDto {
  validUntil: string;
  representations: AuthorizationRepresentationsDto;
}
export interface AuthorizationRevalidationWriteDto extends AuthorizationReleaseWriteDto {
  reason: string;
  sameTeam: true;
  sameConditions: true;
}
export interface AuthorizationReleaseDto {
  id: string;
  sequence: number;
  kind: 'INITIAL' | 'REVALIDATION';
  occurredAt: string;
  validFrom: string;
  validUntil: string;
  actorId: string;
  actorName: string;
  reason?: string;
  representations: AuthorizationRepresentationsDto;
  eligibility: EligibilityDto;
}
export interface AuthorizationClosureWriteDto {
  summary: string;
  checks: PermitSourceCheckDto[];
  representations: AuthorizationRepresentationsDto;
}
export interface AuthorizationClosureDto extends AuthorizationClosureWriteDto {
  occurredAt: string;
  actorId: string;
  actorName: string;
}
export interface WorkAuthorizationDto {
  id: string;
  code: string;
  companyId: string;
  unitId: string;
  revision: number;
  sourceId: string;
  sourceRevision: string;
  sourceSha256: string;
  appointment: AppointmentDto;
  permitId?: string;
  permitCode?: string;
  preparation: AuthorizationPreparationDto;
  status: WorkAuthorizationStatus;
  sciences: ScienceDto[];
  eligibility: EligibilityDto;
  releases: AuthorizationReleaseDto[];
  closingChecks: PermitSourceCheckDto[];
  closure?: AuthorizationClosureDto;
  history: PermitEventDto[];
  availableActions: string[];
  createdAt: string;
  createdByName: string;
  suspensionReason?: string;
  cancellationReason?: string;
}
export interface AuthorizationOptionDto {
  appointment: AppointmentDto;
  permits: { id: string; code: string }[];
}
export interface AuthorizationOptionsDto { appointments: AuthorizationOptionDto[] }

/** Proposed GET /work-authorizations contract. Explicit page/pageSize requests return PageDto<WorkAuthorizationDto>.
 * q searches code, appointment, team, service, location and preparation; status is exact.
 * Authorization is applied before filtering, stable code/ID ordering, total and pagination.
 * The demo alone preserves legacy array responses when both pagination parameters are absent.
 * Parameters and response shape still require agreement with the separate API repository.
 */
export interface AuthorizationListQuery {
  unitId: string; page: number; pageSize: number; q?: string; status?: WorkAuthorizationStatus;
}
