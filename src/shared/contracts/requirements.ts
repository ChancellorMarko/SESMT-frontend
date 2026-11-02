import type { EligibilityDto, PermitEventDto, ServiceTypeDto } from './work-permits';

/** Contratos propostos. A configuração demonstra critérios administrativos, sem definir prazos legais. */
export interface MatrixRuleDto {
  id: string;
  label: string;
  description: string;
  serviceTypeId: string;
  serviceFunction: string;
  locationContains: string;
  restricted: boolean;
  validFromRequired: boolean;
  validUntilRequired: boolean;
}
export type MatrixRuleWriteDto = Omit<MatrixRuleDto, 'id'> & { id?: string };
export interface MatrixWriteDto { rules: MatrixRuleWriteDto[] }
export interface MatrixVersionDto {
  version: string;
  rules: MatrixRuleDto[];
  publishedAt: string;
  publishedBy: string;
  reason: string;
}
export interface RequirementMatrixDto {
  unitId: string;
  revision: number;
  published: MatrixVersionDto;
  draft: { rules: MatrixRuleDto[]; savedAt: string; savedBy: string } | null;
  versions: MatrixVersionDto[];
  services: ServiceTypeDto[];
  availableActions: string[];
  history: PermitEventDto[];
}
export interface DocumentaryReadinessRowDto {
  appointmentId: string;
  appointmentCode: string;
  teamId: string;
  teamName: string;
  serviceTypeId: string;
  serviceLabel: string;
  serviceTypeIds?: string[];
  services?: { id: string; name: string }[];
  location: string;
  startsAt: string;
  endsAt: string;
  permitId?: string;
  eligibility: EligibilityDto;
}
export interface DocumentaryReadinessDto {
  generatedAt: string;
  rows: DocumentaryReadinessRowDto[];
}
