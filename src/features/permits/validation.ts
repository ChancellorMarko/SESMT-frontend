import type { ChecklistItemDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import { validatePreparation } from './templates/ri-s-36001';

export const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function validateScience(participantName: string, declarantName: string, confirmed: boolean, method: 'TYPED' | 'DRAWN', representation: string): string | undefined {
  if (declarantName.trim().length < 3) return 'Informe o nome de quem declara.';
  if (normalizeName(participantName) !== normalizeName(declarantName)) return 'Confira o nome de quem declara. Ele deve corresponder ao participante selecionado.';
  if (!confirmed) return 'A declaração precisa ser confirmada explicitamente pelo participante.';
  if (method === 'DRAWN' && !isDrawingRepresentation(representation)) return 'Desenhe a manifestação antes de confirmar ou escolha a opção de nome digitado.';
  return undefined;
}

export function isDrawingRepresentation(value: string) { return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 1_000_000; }
export function isImageRepresentation(value: string) { return /^data:image\/(?:png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 2_000_000; }

export function validateChecklist(items: ChecklistItemDto[]): string | undefined {
  if (items.some(item => item.required && item.answer === null)) return 'Responda todos os itens obrigatórios antes de salvar.';
  if (items.some(item => item.answer === 'NO' && !item.note?.trim())) return 'Explique as respostas “Não” no campo de observação do item.';
  if (items.some(item => (item.note?.length ?? 0) > 1000)) return 'Cada observação deve ter até 1.000 caracteres.';
  return undefined;
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
