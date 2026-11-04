import type { AppointmentDto, PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import type { AuthorizationPreparationDto } from '../../shared/contracts/work-authorizations';
import source from './ri-s-36002.source.json';

export const AT_SOURCE = source;
export const AT_CHECKS = source.checks;
export const AT_CONTROLS = source.controls;
export const AT_CLOSING_CHECKS = source.closingChecks;
/** Limite de espaços do formulário recebido, sem atribuir esse número a uma norma. */
export const AT_REVALIDATION_CAPACITY = source.revalidationSourceRanges.length;
export const authorizationAnswerLabel = (answer: PermitSourceCheckDto['answer']) => answer === 'YES' ? 'Sim' : answer === 'NO' ? 'Não' : answer === 'NA' ? 'Não aplicável' : 'Não respondido';
const blankChecks = (items: { id: string; label: string; section: string; sourceCell: string }[]): PermitSourceCheckDto[] => items.map(({ id, label, section, sourceCell }) => ({ id, label, section, sourceCell, answer: null }));
export const createAuthorizationClosingChecks = () => blankChecks(AT_CLOSING_CHECKS);

export function createAuthorizationPreparation(appointment: AppointmentDto): AuthorizationPreparationDto {
  return {
    identification: { serviceManagement: '', serviceProvider: '', activityDescription: '', workFront: '', areaManagement: '', riskAnalysisReference: '', notes: '' },
    foremanId: appointment.participants[0]?.workerId || '', controls: [], additionalControls: '', checks: blankChecks(AT_CHECKS),
  };
}

/** Respostas registram a avaliação, sem tratar todo Sim como condição universal de segurança. */
export function validateAuthorizationChecks(checks: PermitSourceCheckDto[], complete = false): string | undefined {
  if (!Array.isArray(checks) || checks.some(item => !item)) return 'Envie todos os itens do modelo.';
  if (checks.some(item => ![null, 'YES', 'NO', 'NA'].includes(item.answer))) return 'Selecione Sim, Não ou Não aplicável.';
  if (checks.some(item => item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 1000))) return 'Cada observação deve ter até 1.000 caracteres.';
  if (checks.some(item => (item.answer === 'NO' || item.answer === 'NA') && !item.note?.trim())) return 'Justifique as respostas Não e Não aplicável em cada item.';
  if (complete && checks.some(item => item.answer === null)) return 'Responda todos os itens do modelo.';
  if (complete && checks.some(item => item.id === 'at-check-b24' && !item.note?.trim())) return 'Descreva os meios de comunicação de emergência no item correspondente.';
  return undefined;
}

export function validateAuthorizationPreparation(value: AuthorizationPreparationDto, complete = false): string | undefined {
  if (!value?.identification || Object.values(value.identification).some(item => typeof item !== 'string' || item.length > 2000)
    || typeof value.additionalControls !== 'string' || value.additionalControls.length > 4000) return 'Confira os textos: identificação até 2.000 e controles complementares até 4.000 caracteres.';
  if (!Array.isArray(value.controls) || new Set(value.controls).size !== value.controls.length || value.controls.some(id => !AT_CONTROLS.some(item => item.id === id))) return 'Selecione medidas do catálogo sem duplicação.';
  if (!Array.isArray(value.checks) || value.checks.length !== AT_CHECKS.length || new Set(value.checks.map(item => item?.id)).size !== AT_CHECKS.length || value.checks.some(item => !item || !AT_CHECKS.some(original => original.id === item.id))) return 'Envie todos os itens de verificação do modelo.';
  if (typeof value.foremanId !== 'string') return 'Selecione o encarregado da equipe.';
  if (complete) {
    if (value.identification.activityDescription.trim().length < 10) return 'Descreva a atividade com pelo menos 10 caracteres.';
    if (['serviceManagement', 'serviceProvider', 'workFront', 'areaManagement', 'riskAnalysisReference'].some(key => value.identification[key as keyof typeof value.identification].trim().length < 3)) return 'Informe gerências, fornecedor, frente e referência da análise de risco com pelo menos 3 caracteres.';
    if (!value.foremanId) return 'Selecione um participante como encarregado da equipe.';
    if (!value.controls.length) return 'Selecione ao menos uma medida aplicável para completar esta demonstração.';
  }
  return validateAuthorizationChecks(value.checks, complete);
}

/** O cliente fornece apenas respostas e notas; rótulos, seções e células vêm do catálogo. */
export function canonicalAuthorizationChecks(input: PermitSourceCheckDto[], originals: PermitSourceCheckDto[]): PermitSourceCheckDto[] {
  if (!Array.isArray(input) || input.length !== originals.length || new Set(input.map(item => item?.id)).size !== originals.length || input.some(item => !item || !originals.some(original => original.id === item.id))) throw new Error('Envie todos os itens do modelo sem substituir perguntas.');
  return originals.map(original => {
    const item = input.find(value => value.id === original.id)!;
    if (![null, 'YES', 'NO', 'NA'].includes(item.answer) || item.note !== undefined && (typeof item.note !== 'string' || item.note.length > 1000)) throw new Error('Confira a resposta e a observação de cada item.');
    return { id: original.id, label: original.label, section: original.section, sourceCell: original.sourceCell, answer: item.answer, note: item.note?.trim() };
  });
}

export function canonicalAuthorizationPreparation(input: AuthorizationPreparationDto, current: AuthorizationPreparationDto): AuthorizationPreparationDto {
  if (!input || typeof input !== 'object' || !input.identification || typeof input.additionalControls !== 'string' || input.additionalControls.length > 4000 || typeof input.foremanId !== 'string') throw new Error('Envie a preparação completa desta AT.');
  const identification = Object.fromEntries(Object.keys(current.identification).map(key => {
    const item = input.identification[key as keyof typeof input.identification];
    if (typeof item !== 'string' || item.length > 2000) throw new Error('Cada campo de identificação deve ter até 2.000 caracteres.');
    return [key, item.trim()];
  })) as AuthorizationPreparationDto['identification'];
  if (!Array.isArray(input.controls) || new Set(input.controls).size !== input.controls.length || input.controls.some(id => !AT_CONTROLS.some(item => item.id === id))) throw new Error('Selecione medidas do catálogo sem duplicação.');
  return { identification, foremanId: input.foremanId, controls: [...input.controls], additionalControls: input.additionalControls.trim(), checks: canonicalAuthorizationChecks(input.checks, current.checks) };
}
