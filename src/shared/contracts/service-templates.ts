import type { PermitEventDto, ServiceTypeDto } from './work-permits';

/** Contrato proposto; os templates iniciais são exemplos administrativos do modo demo. */
export interface ServiceTemplateQuestionDto {
  id: string;
  label: string;
  required: boolean;
  blockingAnswers: ('YES' | 'NO')[];
}
export interface ServiceTemplateVersionDto {
  serviceTypeId: string;
  serviceName: string;
  version: string;
  activityIds: string[];
  questions: ServiceTemplateQuestionDto[];
  publishedAt: string;
  publishedBy: string;
  reason: string;
}
export interface ServiceTemplateDto {
  unitId: string;
  service: ServiceTypeDto;
  revision: number;
  published: ServiceTemplateVersionDto;
  draft?: { questions: ServiceTemplateQuestionDto[]; savedAt: string; savedBy: string } | null;
  versions: ServiceTemplateVersionDto[];
  availableActions: string[];
  history: PermitEventDto[];
}
export interface ServiceCatalogDto { unitId: string; templates: ServiceTemplateDto[] }
