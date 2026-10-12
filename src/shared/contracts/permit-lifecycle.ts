import type { WorkPermitDto } from './work-permits';

/** Contratos propostos para interrupção e retomada na demonstração da PT. */
export interface PermitLifecycleDto {
  suspendedFrom?: 'RELEASED' | 'EXECUTING';
  suspendedAt?: string;
  suspensionReason?: string;
  suspendedBy?: string;
  suspendedByName?: string;
  resumedAt?: string;
  resumeReason?: string;
  resumedBy?: string;
  canceledAt?: string;
  cancellationReason?: string;
  canceledBy?: string;
  canceledByName?: string;
}
/** A operação e seus registros de interrupção fazem parte da mesma PT/versionamento. */
export type PermitLifecycleRecordDto = WorkPermitDto;
export type PermitLifecycleCommand = 'suspend' | 'resume' | 'cancel';
export interface PermitSuspendWriteDto { reason: string; confirmed: true }
export interface PermitResumeWriteDto { reason: string; confirmed: true; sameTeam: true; sameConditions: true }
export interface PermitCancelWriteDto { reason: string; confirmed: true }
export const PERMIT_LIFECYCLE_REASON_MAX = 1000;
