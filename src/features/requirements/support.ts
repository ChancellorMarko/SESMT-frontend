import { z } from 'zod';
import type { MatrixRuleDto, MatrixRuleWriteDto } from '../../shared/contracts/requirements';

export const matrixRuleSchema = z.object({
  id: z.string().trim().max(100).optional(),
  serviceTypeId: z.string().trim().min(1, 'Selecione o serviço.').max(100),
  serviceFunction: z.string().trim().min(1, 'Informe a função ou use * para todas.').max(80, 'Use até 80 caracteres.'),
  locationContains: z.string().trim().max(200, 'Use até 200 caracteres.'),
  label: z.string().trim().min(3, 'Informe um título com pelo menos 3 caracteres.').max(160, 'Use até 160 caracteres.'),
  description: z.string().trim().min(5, 'Descreva o requisito com pelo menos 5 caracteres.').max(2000, 'Use até 2.000 caracteres.'),
  restricted: z.boolean(),
  validFromRequired: z.boolean(),
  validUntilRequired: z.boolean(),
}).superRefine((value, context) => {
  if (value.restricted && (value.validFromRequired || value.validUntilRequired)) context.addIssue({ code: 'custom', path: ['restricted'], message: 'Requisitos restritos não expõem datas de vigência nesta matriz.' });
});
export const matrixFormSchema = z.object({ rules: z.array(matrixRuleSchema).min(1, 'Adicione pelo menos uma regra antes de salvar.').max(100, 'Use até 100 regras por unidade.') });
export type MatrixFormValues = z.infer<typeof matrixFormSchema>;
export const publishMatrixSchema = z.object({
  reason: z.string().trim().min(10, 'Descreva o motivo com pelo menos 10 caracteres.').max(2000, 'Use até 2.000 caracteres.'),
  confirmed: z.boolean().refine(value => value, 'Confirme a publicação deste rascunho.'),
});
export type PublishMatrixValues = z.infer<typeof publishMatrixSchema>;

export function ruleFormValue(rule: MatrixRuleDto): MatrixRuleWriteDto {
  return { id: rule.id, serviceTypeId: rule.serviceTypeId, serviceFunction: rule.serviceFunction, locationContains: rule.locationContains, label: rule.label, description: rule.description, restricted: rule.restricted, validFromRequired: rule.validFromRequired, validUntilRequired: rule.validUntilRequired };
}
export const emptyRule = (serviceTypeId = ''): MatrixRuleWriteDto => ({ serviceTypeId, serviceFunction: '*', locationContains: '', label: '', description: '', restricted: false, validFromRequired: false, validUntilRequired: false });
export const matrixErrorMessage = (error: unknown) => {
  const value = error as { status?: number; message?: string };
  if (value?.status === 403) return 'Seu acesso não permite esta ação na matriz desta unidade.';
  if (value?.status === 404) return 'A matriz está indisponível no seu escopo.';
  if (value?.status === 412 || value?.status === 428) return 'A matriz foi alterada. Seu preenchimento foi preservado; consulte a versão atual antes de continuar.';
  return value?.message || 'Não foi possível concluir a ação. Tente novamente.';
};
