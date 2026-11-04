import type { ChecklistItemDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import { validatePreparation } from './templates/ri-s-36001';
import { isSignatureImageRepresentation, SIGNATURE_IMAGE_MAX_DATA_URL_LENGTH } from '../../shared/lib/signature-image';
import type { PermitValidationIssue } from './validation-issues';

export const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function validateScience(participantName: string, declarantName: string, confirmed: boolean, method: 'TYPED' | 'DRAWN', representation: string): string | undefined {
  if (declarantName.trim().length < 3) return 'Informe o nome de quem declara.';
  if (normalizeName(participantName) !== normalizeName(declarantName)) return 'Confira o nome de quem declara. Ele deve corresponder ao participante selecionado.';
  if (!confirmed) return 'A declaração precisa ser confirmada explicitamente pelo participante.';
  if (method === 'DRAWN' && !isDrawingRepresentation(representation)) return 'Desenhe a manifestação antes de confirmar ou escolha a opção de nome digitado.';
  return undefined;
}

export function isDrawingRepresentation(value: string) { return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= SIGNATURE_IMAGE_MAX_DATA_URL_LENGTH; }
export const isImageRepresentation = isSignatureImageRepresentation;

export function checklistIssues(items: ChecklistItemDto[]): PermitValidationIssue[] {
  const issues: PermitValidationIssue[] = [];
  // Keep rule groups in the same priority as the original first-message validator.
  for (const item of items) if (item.required && item.answer === null) issues.push({ path: `checklist.${item.id}.answer`, message: 'Responda todos os itens obrigatórios antes de salvar.' });
  for (const item of items) {
    if (item.answer !== 'NO') continue;
    // Earlier failures previously returned before inspecting malformed later notes.
    if (issues.length && item.note != null && typeof item.note !== 'string') continue;
    if (!item.note?.trim()) issues.push({ path: `checklist.${item.id}.note`, message: 'Explique as respostas “Não” no campo de observação do item.' });
  }
  for (const item of items) if ((item.note?.length ?? 0) > 1000) issues.push({ path: `checklist.${item.id}.note`, message: 'Cada observação deve ter até 1.000 caracteres.' });
  return issues;
}

export function validateChecklist(items: ChecklistItemDto[]): string | undefined {
  return checklistIssues(items)[0]?.message;
}

export function releaseBlockers(permit: WorkPermitDto): string[] {
  const blockers: string[] = [];
  if (permit.preparation) { const error = validatePreparation(permit.preparation, true); if (error) blockers.push(`Preparação do modelo pendente: ${error}`); }
  if (!permit.eligibility.eligible) blockers.push('Existem requisitos documentais pendentes para este serviço.');
  if (permit.checklist.some(item => item.required && item.answer === null)) blockers.push('O checklist possui itens obrigatórios ainda não respondidos.');
  if (permit.checklist.some(item => item.answer !== null && (item.blockingAnswers ?? (item.required ? ['NO'] : [])).includes(item.answer))) blockers.push('O checklist contém respostas impeditivas nas condições dos templates desta versão.');
  const missing = permit.appointment.participants.filter(participant => !permit.sciences.some(science => science.workerId === participant.workerId && science.version === permit.version));
  if (missing.length) blockers.push(`Falta a ciência de ${missing.map(participant => participant.name).join(', ')} nesta versão.`);
  return blockers;
}

export function validateText(value: string, label: string, min = 5, max = 4000): string | undefined {
  if (value.trim().length < min) return `${label}: informe pelo menos ${min} caracteres.`;
  if (value.trim().length > max) return `${label}: use até ${max.toLocaleString('pt-BR')} caracteres.`;
  return undefined;
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir a ação. Tente novamente.'; }
