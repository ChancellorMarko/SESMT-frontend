import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

const id = z.guid(), text = z.string().trim().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && !value.startsWith('0000');
});
const instant = z.string().datetime({ offset: true });
export const kindLabels = { INITIAL: 'Inicial', PERIODIC: 'Periódico', EVENTUAL: 'Eventual' } as const;
export const trainingSchema = z.object({
  id, companyId: id, unitId: id, workerId: id, workerName: text, title: text.max(160), reference: z.string().max(40).nullable(),
  kind: z.enum(['INITIAL', 'PERIODIC', 'EVENTUAL']), completedOn: day, renewalOn: day.nullable(), durationMinutes: z.number().int().min(1).max(600000),
  provider: z.string().max(160).nullable(), instructor: z.string().max(160).nullable(), venue: z.string().max(160).nullable(),
  content: z.string().max(2000).nullable(), notes: z.string().max(500).nullable(), revokedAt: instant.nullable(),
  revocationReason: z.string().min(3).max(200).nullable(), revision: z.number().int().positive(),
}).refine(item => (!item.renewalOn || item.renewalOn >= item.completedOn) && Boolean(item.revokedAt) === Boolean(item.revocationReason));
export type Training = z.infer<typeof trainingSchema>;
export type TrainingScope = { unitId: string; companyIds: readonly string[]; ownOnly: boolean; workerId?: string | null; subjectWorkerId?: string };
const contextSchema = z.object({ unitId: id, companyId: id, ownOnly: z.boolean(), canCreate: z.boolean(), canEdit: z.boolean(),
  workers: z.array(z.object({ id, name: text, enrollment: text })) });
export type TrainingContext = z.infer<typeof contextSchema>;
export function checkedContext(value: unknown, scope: TrainingScope) {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success || parsed.data.unitId !== scope.unitId || !scope.companyIds.includes(parsed.data.companyId)
    || parsed.data.ownOnly !== scope.ownOnly || new Set(parsed.data.workers.map(w => w.id)).size !== parsed.data.workers.length
    || scope.ownOnly && (parsed.data.canCreate || parsed.data.canEdit || parsed.data.workers.length)) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedTraining(value: unknown, scope: TrainingScope, expectedId?: string): Training {
  const parsed = trainingSchema.safeParse(value);
  if (!parsed.success || !scope.companyIds.includes(parsed.data.companyId) || parsed.data.unitId !== scope.unitId
    || expectedId && parsed.data.id !== expectedId || scope.ownOnly && parsed.data.workerId !== scope.workerId || scope.subjectWorkerId && parsed.data.workerId !== scope.subjectWorkerId) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedPage(value: unknown, scope: TrainingScope, page: number, q = '', status = '', pageSize = 20) {
  const parsed = z.object({ items: z.array(z.unknown()), total: z.number().int().nonnegative(), page: z.literal(page), pageSize: z.literal(pageSize) }).safeParse(value);
  if (!parsed.success || parsed.data.items.length !== Math.min(pageSize, Math.max(parsed.data.total - (page - 1) * pageSize, 0))) throw new InvalidReadResponse();
  const items = parsed.data.items.map(item => checkedTraining(item, scope));
  if (new Set(items.map(item => item.id)).size !== items.length || items.some(item =>
    q && ![item.title, item.workerName, item.reference ?? ''].some(s => s.toLocaleLowerCase().includes(q.toLocaleLowerCase()))
    || status && trainingStatus(item) !== status)) throw new InvalidReadResponse();
  return { ...parsed.data, items };
}
export const historyLabels = { TRAINING_CREATED: 'Cadastro', TRAINING_UPDATED: 'Edição', TRAINING_REVOKED: 'Invalidação', TRAINING_EVIDENCE_LINKED: 'Vínculo de comprovante', TRAINING_EVIDENCE_REMOVED: 'Remoção de vínculo' } as const;
export function checkedHistory(value: unknown, revision: number) {
  const parsed = z.array(z.object({ id, action: z.enum(['TRAINING_CREATED', 'TRAINING_UPDATED', 'TRAINING_REVOKED', 'TRAINING_EVIDENCE_LINKED', 'TRAINING_EVIDENCE_REMOVED']),
    revision: z.number().int().positive(), actorName: z.string().nullable(), occurredAt: instant, reason: z.string().max(200).nullable() })).safeParse(value);
  if (!parsed.success || parsed.data.some(e => e.revision > revision) || new Set(parsed.data.map(e => e.id)).size !== parsed.data.length) throw new InvalidReadResponse();
  return parsed.data;
}
export const trainingFields = z.object({ workerId: id, title: text.max(160), reference: z.string().trim().max(40), kind: z.enum(['INITIAL', 'PERIODIC', 'EVENTUAL']),
  completedOn: day, renewalOn: z.union([day, z.literal('')]), hours: z.string().regex(/^\d{1,5}$/), minutes: z.string().regex(/^\d{1,2}$/),
  provider: z.string().trim().max(160), instructor: z.string().trim().max(160), venue: z.string().trim().max(160),
  content: z.string().trim().max(2000), notes: z.string().trim().max(500), changeReason: z.string().trim().max(200),
}).refine(f => Number(f.minutes) < 60 && Number(f.hours) * 60 + Number(f.minutes) >= 1 && Number(f.hours) * 60 + Number(f.minutes) <= 600000
  && (!f.renewalOn || f.renewalOn >= f.completedOn));
export const statuses = { CURRENT: 'Prazo em dia', EXPIRING: 'Renovar em até 30 dias', EXPIRED: 'Renovação atrasada', NO_DATE: 'Sem data de renovação', REVOKED: 'Registro invalidado' } as const;
export function localDay() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function trainingStatus(item: Training): keyof typeof statuses {
  if (item.revokedAt) return 'REVOKED';
  if (!item.renewalOn) return 'NO_DATE';
  const today = localDay();
  const soon = new Date(`${today}T12:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  return item.renewalOn < today ? 'EXPIRED' : item.renewalOn <= soon.toISOString().slice(0, 10) ? 'EXPIRING' : 'CURRENT';
}
export const formatDay = (value: string | null) => value ? value.split('-').reverse().join('/') : '—';
export const duration = (minutes: number) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
