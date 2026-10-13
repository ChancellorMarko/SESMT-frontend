import { z } from 'zod';
import type { OrganizationDto } from '../../shared/contracts';
import { Feedback } from '../../shared/ui';

export const workerStatusLabels: Record<string, string> = {
  ACTIVE: 'Ativo', ON_LEAVE: 'Afastado', TERMINATED: 'Desligado',
};
export const integrationStatusLabels: Record<string, string> = {
  INTEGRATED: 'Integrado',
  PENDING: 'Pendente',
  EXPIRED: 'Vencida',
  NOT_APPLICABLE: 'Não aplicável',
};
export const integrationStatusTone: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  INTEGRATED: 'success',
  PENDING: 'warning',
  EXPIRED: 'danger',
  NOT_APPLICABLE: 'neutral',
};
export const movementLabels: Record<string, string> = {
  ADMISSION: 'Admissão', TRANSFER: 'Mudança de vínculo', LEAVE: 'Afastamento',
  RETURN: 'Retorno', TERMINATION: 'Desligamento',
};
export function dateLabel(value?: string) {
  if (!value) return 'Não informado';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}
export function todayCivil() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export function validCivil(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const workerFormSchema = z.object({
  registration: z.string().trim().min(1, 'Informe a matrícula.'),
  fullName: z.string().trim().min(2, 'Informe o nome completo.'),
  companyId: z.string().min(1, 'Selecione a empresa.'),
  unitId: z.string().min(1, 'Selecione a unidade.'),
  sectorId: z.string().min(1, 'Selecione o setor.'),
  employmentType: z.string().trim().min(1, 'Informe o tipo de vínculo.'),
  admissionDate: z.string().refine(validCivil, 'Informe uma data de admissão válida.'),
  jobId: z.string(), jobFunctionId: z.string(), workCenterId: z.string(), managerId: z.string(),
});
export type WorkerFormValues = z.infer<typeof workerFormSchema>;

export const integrationFormSchema = z.object({
  status: z.enum(['INTEGRATED', 'PENDING', 'EXPIRED', 'NOT_APPLICABLE']),
  integratedAt: z.string().refine(validCivil, 'Informe uma data de integração válida.'),
  validUntil: z.string().refine(v => !v || validCivil(v), 'Informe uma data de validade válida.').optional(),
  responsibleName: z.string().trim().optional(),
  evidenceFileName: z.string().trim().optional(),
  notes: z.string().trim().optional(),
}).refine(data => {
  if (data.validUntil && data.integratedAt && data.validUntil < data.integratedAt) {
    return false;
  }
  return true;
}, {
  message: 'A validade não pode ser anterior à data de realização.',
  path: ['validUntil'],
});
export type IntegrationFormValues = z.infer<typeof integrationFormSchema>;

export function assignmentError(values: Pick<WorkerFormValues, 'companyId' | 'unitId' | 'sectorId' | 'jobId' | 'jobFunctionId' | 'workCenterId'>, organization: OrganizationDto) {
  const unit = organization.units.find(item => item.id === values.unitId && item.status === 'ACTIVE');
  const sector = organization.sectors.find(item => item.id === values.sectorId && item.status === 'ACTIVE');
  if (!unit || unit.companyId !== values.companyId) return 'Selecione uma unidade ativa pertencente à empresa.';
  if (!sector || sector.unitId !== values.unitId) return 'Selecione um setor ativo pertencente à unidade.';
  if (values.jobId && !organization.jobs.some(item => item.id === values.jobId && item.companyId === values.companyId && item.status === 'ACTIVE')) return 'O cargo não pertence à empresa selecionada.';
  if (values.jobFunctionId && !organization.jobFunctions.some(item => item.id === values.jobFunctionId && item.companyId === values.companyId && item.status === 'ACTIVE' && (!item.jobId || item.jobId === values.jobId))) return 'A função não corresponde à empresa e ao cargo selecionados.';
  if (values.workCenterId && !organization.workCenters.some(item => item.id === values.workCenterId && item.unitId === values.unitId && (!item.sectorId || item.sectorId === values.sectorId) && item.status === 'ACTIVE')) return 'O centro de trabalho não corresponde ao setor/unidade.';
  return undefined;
}

export function errorMessage(error: unknown) {
  const candidate = error as { message?: string; status?: number; requestId?: string };
  if (candidate?.status === 403) return 'Você não tem permissão para consultar ou alterar este registro.';
  if (candidate?.status === 404) return 'Registro não encontrado ou indisponível para o seu acesso.';
  if (candidate?.status === 412 || candidate?.status === 409) return `${candidate.message || 'O registro foi alterado ou a operação está em conflito.'} Recarregue os dados e revise antes de reenviar.`;
  return candidate?.message || 'Não foi possível concluir a operação. Tente novamente.';
}
export function QueryError({ error, retry }: { error: unknown; retry?: () => void }) {
  return <Feedback tone="danger"><span>{errorMessage(error)}</span>{retry && <button type="button" onClick={retry}>Tentar novamente</button>}</Feedback>;
}
export function fieldErrorsOf(error: unknown): { field: string; message: string }[] {
  const value = error as { fieldErrors?: { field: string; message: string }[]; body?: { fieldErrors?: { field: string; message: string }[] } };
  return value?.fieldErrors || value?.body?.fieldErrors || [];
}
