import { z } from 'zod';
import { api } from '../../shared/api/client';
import { nativeId, nativeIds } from '../native-operations/contracts';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { NativeFormError } from '../native-operations/NativeCommandDialog';
import { same, type NativePermit } from './contracts';

// WorkPermitTemplateResponse and WorkPermitChecklistQuestion, backend 41d31e9.
export const nativeQuestion = z.object({ id: nativeId, texto: z.string().trim().min(1),
  tipo: z.string().transform(value => value.toUpperCase()).pipe(z.enum(['BOOLEAN', 'TEXT', 'NUMBER'])),
  obrigatoria: z.boolean(), impeditiva: z.boolean(),
}).refine(question => !question.impeditiva || question.obrigatoria);
const questions = z.array(nativeQuestion).refine(items => new Set(items.map(item => item.id)).size === items.length);
const template = z.object({ id: nativeId, templateId: nativeId, companyId: nativeId, nome: z.string().trim().min(1),
  versao: z.number().int().min(1).max(2147483647), servicoIds: nativeIds.refine(ids => ids.length > 0),
  serviceCodes: z.array(z.string().trim().min(1)).min(1).refine(codes => new Set(codes).size === codes.length),
  perguntas: questions.refine(items => items.length > 0), declaracao: z.string().trim().min(1), ilustrativo: z.boolean(), closingQuestions: questions,
}).refine(item => item.servicoIds.length === item.serviceCodes.length);
export type NativeQuestion = z.infer<typeof nativeQuestion>;
export type NativeTemplate = z.infer<typeof template>;
export type NativeAnswer = NativePermit['checklistAnswers'][number];
export type ChecklistDraft = Record<string, { value: string; justification: string }>;
export function checkedTemplates(value: unknown, companyId: string) {
  const parsed = z.array(template).safeParse(value);
  if (!parsed.success || parsed.data.some(item => item.companyId !== companyId.toLowerCase())
    || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length
    || new Set(parsed.data.map(item => `${item.templateId}:${item.versao}`)).size !== parsed.data.length) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedPinnedTemplates(value: unknown, permit: Pick<NativePermit, 'companyId' | 'templateVersionIds' | 'serviceCode'>) {
  const templates = checkedTemplates(value, permit.companyId);
  if (!permit.templateVersionIds.length) throw new InvalidReadResponse();
  const pinned = permit.templateVersionIds.map(id => templates.find(item => item.id === id));
  if (pinned.some(item => !item)) throw new InvalidReadResponse();
  const result = pinned as NativeTemplate[], opening = result.flatMap(item => item.perguntas);
  if (new Set(result.map(item => item.templateId)).size !== result.length || new Set(opening.map(item => item.id)).size !== opening.length
    || !same([...new Set(result.flatMap(item => item.serviceCodes))], permit.serviceCode.split(','))) throw new InvalidReadResponse();
  return result;
}

/** The PT-scoped definitions do not require the privilege to administer the model catalog. */
export async function loadPinnedTemplates(permit: NativePermit, signal: AbortSignal) {
  const value = await api.get<unknown>(`/work-permits/pts/${permit.id}`, { signal });
  const receipt = z.object({ id: nativeId, versao: z.number().int().positive(),
    statusOperacional: z.string(), statusRevisao: z.string(), participanteIds: nativeIds, templateVersionIds: nativeIds,
    pinnedTemplates: z.unknown().optional(),
  }).safeParse(value);
  if (!receipt.success || receipt.data.id !== permit.id || receipt.data.versao !== permit.version
    || receipt.data.statusOperacional.toUpperCase() !== permit.status || receipt.data.statusRevisao.toUpperCase() !== permit.reviewStatus
    || !same(receipt.data.participanteIds, permit.participants.map(person => person.userId))
    || !same(receipt.data.templateVersionIds, permit.templateVersionIds)) throw new InvalidReadResponse();
  if (Object.hasOwn(value as object, 'pinnedTemplates')) {
    const models = checkedPinnedTemplates(receipt.data.pinnedTemplates, permit);
    if (models.length !== (receipt.data.pinnedTemplates as unknown[]).length) throw new InvalidReadResponse();
    return models;
  }
  // Compatibility only with an older, valid receipt. Denials and malformed data never fall back.
  return checkedPinnedTemplates(await api.get<unknown>('/work-permits/pt-templates', { query: { companyId: permit.companyId }, signal }), permit);
}

// Keep decimal strings exact: converting through Number can round the 96-bit .NET decimal.
export function decimalValue(raw: string, source: 'input' | 'api' = 'input'): string | undefined {
  let value = raw.trim(); if (!value || value.length > 256) return undefined;
  if (source === 'input') {
    if (value.includes(',') && value.includes('.') || (value.match(/,/g) ?? []).length > 1) return undefined;
    value = value.replace(',', '.');
  } else {
    // Stored NUMBER values use NumberStyles.Number with invariant culture (comma = grouping).
    if (!/^[+-]?(?:\d+(?:,\d+)*(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
    value = value.replace(/,/g, '');
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
  const negative = value.startsWith('-'); value = value.replace(/^[+-]/, '');
  const [whole, fraction = ''] = value.split('.'), integer = whole.replace(/^0+/, '') || '0', scale = fraction.replace(/0+$/, '');
  if (scale.length > 28 || BigInt(integer + scale) > 79228162514264337593543950335n) return undefined;
  return `${negative && BigInt(integer + scale) !== 0n ? '-' : ''}${integer}${scale ? `.${scale}` : ''}`;
}
function storedValue(question: NativeQuestion, value: string | null) {
  if (value === null || !value.trim()) return '';
  if (question.tipo === 'TEXT') return value;
  if (question.tipo === 'BOOLEAN' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase();
  if (question.tipo === 'NUMBER') { const result = decimalValue(value, 'api'); if (result !== undefined) return result; }
  throw new InvalidReadResponse();
}
export function checklistDraft(questions: NativeQuestion[], answers: NativeAnswer[]): ChecklistDraft {
  if (new Set(questions.map(item => item.id)).size !== questions.length || new Set(answers.map(item => item.perguntaId)).size !== answers.length
    || answers.some(answer => !questions.some(question => question.id === answer.perguntaId))) throw new InvalidReadResponse();
  return Object.fromEntries(questions.map(question => {
    const answer = answers.find(item => item.perguntaId === question.id);
    return [question.id, { value: storedValue(question, answer?.valor ?? null), justification: answer?.justificativa ?? '' }];
  }));
}
export function checklistAnswers(questions: NativeQuestion[], draft: ChecklistDraft, closing: boolean): NativeAnswer[] {
  if (new Set(questions.map(item => item.id)).size !== questions.length || Object.keys(draft).some(id => !questions.some(item => item.id === id))) throw new NativeFormError('Atualize as perguntas desta versão antes de salvar.');
  const result: NativeAnswer[] = [];
  for (const question of questions) {
    const entry = draft[question.id], value = entry?.value ?? '';
    if (!value.trim()) {
      if (closing && (question.obrigatoria || question.impeditiva)) throw new NativeFormError(`Responda a verificação obrigatória: ${question.texto}`);
      if (entry?.justification.trim() && (question.obrigatoria || question.impeditiva)) throw new NativeFormError(`Informe uma resposta para salvar a justificativa de ${question.texto}.`);
      if (entry?.justification.trim()) result.push({ perguntaId: question.id, valor: null, justificativa: entry.justification });
      continue;
    }
    const normalized = question.tipo === 'NUMBER' ? decimalValue(value) : value;
    if (normalized === undefined || question.tipo === 'BOOLEAN' && !['true', 'false'].includes(value)) throw new NativeFormError(`Confira a resposta de ${question.texto}. Use um número decimal sem separador de milhar quando solicitado.`);
    if (closing && question.impeditiva && (question.tipo === 'BOOLEAN' && normalized === 'false' || question.tipo === 'NUMBER' && normalized === '0')) throw new NativeFormError(`A resposta impede o encerramento: ${question.texto}`);
    result.push({ perguntaId: question.id, valor: normalized, justificativa: entry.justification.trim() ? entry.justification : null });
  }
  // The API permits partial opening checklists; a missing response is never converted to "false".
  return result;
}
export function sameAnswers(a: NativeAnswer[], b: NativeAnswer[]) {
  return a.length === b.length && new Set(a.map(item => item.perguntaId)).size === a.length && new Set(b.map(item => item.perguntaId)).size === b.length
    && a.every(item => b.some(other => other.perguntaId === item.perguntaId && other.valor === item.valor && other.justificativa === item.justificativa));
}
