import type { PermitEventDto } from './work-permits';

/**
 * Contratos propostos para designações operacionais.
 * Uma designação vincula um responsável a serviços, local/alcance e um período de vigência.
 * A demonstração não constitui autorização real de operação.
 */

export type DesignationStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface DesignationWriteDto {
  /** ID do responsável designado (deve ser técnico ou bombeiro). */
  responsibleId: string;
  /** IDs dos serviços cobertos pela designação. */
  serviceTypeIds: string[];
  /** Padrão de local/alcance — string vazia cobre qualquer local. */
  locationPattern: string;
  /** Início da vigência (ISO date: YYYY-MM-DD). */
  validFrom: string;
  /** Fim da vigência (ISO date: YYYY-MM-DD). */
  validUntil: string;
  /** Observações opcionais. */
  notes?: string;
}

export interface DesignationDto extends DesignationWriteDto {
  id: string;
  unitId: string;
  responsibleName: string;
  serviceNames: string[];
  status: DesignationStatus;
  revokedAt?: string;
  revokedBy?: string;
  revokedByName?: string;
  revocationReason?: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  revision: number;
  history: PermitEventDto[];
}

export interface DesignationCoverageItemDto {
  serviceTypeId: string;
  serviceName: string;
  covered: boolean;
  designationId?: string;
  responsibleId?: string;
  responsibleName?: string;
  validFrom?: string;
  validUntil?: string;
  /** Expirada mas existente. */
  expired?: boolean;
  /** Revogada mas existente. */
  revoked?: boolean;
}

export interface DesignationCoverageDto {
  checkedAt: string;
  unitId: string;
  /** Se true, todos os serviços possuem designação vigente. */
  fullyCovered: boolean;
  /** Cobertura vigente para a data/hora consultada. */
  operationalWindowEnd?: string;
  items: DesignationCoverageItemDto[];
}
