import type { PermitLifecycleDto } from './permit-lifecycle';
import type { ServiceTemplateVersionDto } from './service-templates';
/** Contrato proposto para integração. Dados e ações do modo demo são sintéticos. */
export type AppointmentStatus = 'REQUESTED' | 'CONFIRMED' | 'ATTENDANCE_OPENED' | 'CANCELED';
export type OperationStatus = 'VERIFICATION' | 'RELEASED' | 'EXECUTING' | 'SUSPENDED' | 'COMPLETED' | 'CANCELED';
export type FinalReviewStatus = 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'RETURNED' | 'VALIDATED';
export type EvidenceStatus = 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export interface ParticipantDto { workerId: string; name: string; serviceFunction: string }
export interface TeamDto { id: string; name: string; unitId: string; companyId: string; chiefId: string; members: ParticipantDto[]; revision: number; status?: 'ACTIVE' | 'INACTIVE'; inactiveReason?: string }
export interface AppointmentWriteDto { unitId: string; teamId: string; serviceTypeId: string; serviceTypeIds?: string[]; location: string; startsAt: string; endsAt: string; responsibleId: string; participants: ParticipantDto[]; notes?: string; requestedStartsAt?: string; requestedEndsAt?: string }
export interface AppointmentDto extends AppointmentWriteDto { companyId?: string; id: string; code: string; teamName: string; responsibleName: string; serviceLabel: string; status: AppointmentStatus; permitId?: string; revision: number; availableActions: string[]; history: PermitEventDto[]; requestedStartsAt?: string; requestedEndsAt?: string; confirmedStartsAt?: string; confirmedEndsAt?: string }
export interface ServiceTypeDto { id: string; name: string; description: string; templateVersion: string; requirementVersion: string; activityIds?: string[] }
export interface PermitOptionsDto { teams: TeamDto[]; services: ServiceTypeDto[]; responsibles: { id: string; name: string }[] }
export interface RequirementDto { id: string; label: string; description: string; serviceTypeId: string; serviceFunction: string; locationContains?: string; version: string; restricted: boolean; validFromRequired?: boolean; validUntilRequired?: boolean }
export interface EligibilityItemDto { requirementId: string; source?: 'REQUIREMENT_MATRIX' | 'WORKER_INTEGRATION'; label: string; description: string; status: EvidenceStatus; evidenceId?: string; evidenceRevision?: number; fileName?: string; validFrom?: string; validUntil?: string; validFromRequired?: boolean; validUntilRequired?: boolean; reason?: string; restricted: boolean }
export interface ParticipantEligibilityDto extends ParticipantDto { eligible: boolean; items: EligibilityItemDto[] }
export interface EligibilityDto { unitId?: string; appointmentId: string; checkedAt: string; requirementVersion: string; eligible: boolean; participants: ParticipantEligibilityDto[] }
export interface EvidenceDto { unitId?: string; requirementVersion?: string; id: string; workerId: string; requirementId: string; fileName: string; status: EvidenceStatus; validFrom?: string; validUntil?: string; reason?: string; revision: number; submittedAt: string; reviewedBy?: string }
export interface ChecklistItemDto { id: string; label: string; required: boolean; answer: 'YES' | 'NO' | null; note?: string; serviceTypeId?: string; serviceName?: string; templateVersion?: string; blockingAnswers?: ('YES' | 'NO')[] }
/** Resposta documental do modelo recebido. Não define por si só uma condição segura. */
export interface PermitSourceCheckDto { id: string; section: string; label: string; answer: 'YES' | 'NO' | 'NA' | null; note?: string; sourceCell?: string }
export interface PermitPreparationDto {
  sourceId: string;
  sourceRevision: string;
  identification: { serviceProvider: string; subcontractor: string; group: string; workFront: string; location: string; activityDescription: string; riskAnalysisReference: string; executorName: string; issuerName: string; atmosphereNotes: string; watchers: string; supervisors: string };
  activities: string[];
  /** Categories fixed by the service templates at opening. Undefined denotes a legacy record. */
  requiredActivities?: string[];
  equipment: string[];
  controls: string[];
  additionalControls: string;
  checks: PermitSourceCheckDto[];
  closingChecks: PermitSourceCheckDto[];
  measurements: { id: string; oxygen: string; carbonMonoxide: string; explosivity: string; other: string; measuredAt: string; responsible: string; instrument: string }[];
}
export interface ScienceDto { id: string; workerId: string; declarantName: string; method: 'TYPED' | 'DRAWN'; representation: string; confirmed: true; collectedBy: string; collectedByName: string; collectedAt: string; version: number }
export interface PermitEventDto { id: string; action: string; actorName: string; occurredAt: string; reason?: string; version?: number }
export interface PermitReleaseSnapshotDto { releasedAt: string; releasedBy: string; releasedByName: string; appointment: AppointmentDto; templateVersion: string; serviceTemplates?: ServiceTemplateVersionDto[]; checklist: ChecklistItemDto[]; sciences: ScienceDto[]; eligibility: EligibilityDto; preparation?: PermitPreparationDto }
export interface PermitSnapshotDto { release?: PermitReleaseSnapshotDto; startedAt?: string; completedAt?: string; eligibility?: EligibilityDto; templateVersion?: string; serviceTemplates?: ServiceTemplateVersionDto[]; appointment?: AppointmentDto; version: number; submittedAt: string; summary: string; checklist: ChecklistItemDto[]; sciences: ScienceDto[]; preparation?: PermitPreparationDto; decision?: 'APPROVE' | 'RETURN'; comment?: string; reviewedBy?: string; reviewedAt?: string; signatureRepresentation?: string; signatureMethod?: 'TYPED' | 'DRAWN' | 'IMAGE'; signatureImage?: string; signatureProfileId?: string; signatureProfileVersion?: number }
export interface WorkPermitDto { release?: PermitReleaseSnapshotDto; id: string; code: string; appointment: AppointmentDto; operationStatus: OperationStatus; reviewStatus: FinalReviewStatus; version: number; revision: number; templateVersion: string; serviceTemplates?: ServiceTemplateVersionDto[]; checklist: ChecklistItemDto[]; preparation?: PermitPreparationDto; lifecycle?: PermitLifecycleDto; sciences: ScienceDto[]; eligibility: EligibilityDto; availableActions: string[]; releasedAt?: string; startedAt?: string; completedAt?: string; summary?: string; reviewComment?: string; snapshots: PermitSnapshotDto[]; history: PermitEventDto[] }
export interface PermitDashboardDto { generatedAt: string; appointments: number; activePermits: number; blockedAppointments: number; pendingReviews: number; nextAppointments: AppointmentDto[]; pendingPermits: WorkPermitDto[] }
export interface FinalPdfDto { url: string; expiresAt: string; fileName: string; mimeType: string; backendPersisted: boolean; disclaimer: string; version?: number; permitId?: string }
export interface PermitParticipantsWriteDto { participants: ParticipantDto[]; reason: string }
