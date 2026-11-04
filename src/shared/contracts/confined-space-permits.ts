import type { AppointmentDto, PermitEventDto, PermitSourceCheckDto } from './work-permits';

/** Proposed frontend contract. This increment prepares drafts; it does not issue a PET or authorize entry. */
export type PetPlannedRole = 'ENTRANT' | 'WATCHER' | 'ENTRY_SUPERVISOR' | 'RESCUE';
export interface PetPersonDto {
  id: string; workerId?: string; name: string; registration: string; serviceFunction: string; role: PetPlannedRole;
}
export interface PetAtmosphericReadingDto {
  id: string; phase: 'INITIAL' | 'FOLLOW_UP'; measuredAt: string; instrument: string; responsibleName: string;
  oxygenPercent: string; carbonMonoxidePpm: string; flammabilityPercentLel: string;
  otherAgent: string; otherValue: string; otherUnit: string; notes: string;
}
export interface PetPreparationDto {
  identification: {
    serviceProvider: string; subcontractor: string; workFront: string; spaceCode: string; spaceDescription: string;
    task: string; riskAssessmentReference: string; hazards: string; entryHazards: string; energyIsolation: string;
    emergencyPlanReference: string; communication: string; plannedStartAt: string; plannedEndAt: string; notes: string;
  };
  people: PetPersonDto[];
  equipment: string[]; controls: string[]; additionalControls: string;
  checks: PermitSourceCheckDto[];
  atmosphere: PetAtmosphericReadingDto[];
}
export interface PetCreateDto extends PetPreparationDto { appointmentId: string }
export interface PetDraftSnapshotDto {
  revision: number; preparation: PetPreparationDto; savedAt: string; actorName: string;
}
export interface ConfinedSpacePermitDto {
  id: string; code: string; unitId: string; companyId: string; revision: number;
  sourceId: string; sourceRevision: string; sourceSha256: string;
  status: 'DRAFT'; appointment: AppointmentDto; preparation: PetPreparationDto;
  availableActions: string[]; history: PermitEventDto[]; snapshots: PetDraftSnapshotDto[];
  createdAt: string; createdByName: string; updatedAt: string;
}
export interface PetOptionsDto { appointments: AppointmentDto[] }
