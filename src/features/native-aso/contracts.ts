import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { localDay } from '../native-training/contracts';
export { localDay, formatDay } from '../native-training/contracts';
const id = z.string().uuid(), text = z.string().trim().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v && !v.startsWith('0000');
});
export const kindLabels = { ADMISSION: 'Admissional', PERIODIC: 'Periódico', RETURN_TO_WORK: 'Retorno ao trabalho', RISK_CHANGE: 'Mudança de riscos', DISMISSAL: 'Demissional' } as const;
export const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
export const correctionLabels = { REGISTRATION_ERROR: 'Erro de transcrição no cadastro', SOURCE_CORRECTION: 'Correção no documento de origem' } as const;
export const revocationLabels = { ENTRY_ERROR: 'Cadastro incorreto', DUPLICATE: 'Registro duplicado', REPLACED: 'Registro substituído' } as const;
export const dueLabels = { DUE: 'Data ultrapassada', SOON: 'Em até 30 dias', SCHEDULED: 'Após 30 dias', NO_DATE: 'Sem data informada' } as const;
const medical = z.object({ physicianName: text.max(160), physicianCrm: z.string().regex(/^\d{1,12}$/), physicianState: z.string().refine(s => states.includes(s)), reference: z.string().max(80).nullable() }).strict();
const base = z.object({ id, companyId: id, unitId: id, workerId: id, workerName: text, examKind: z.enum(['ADMISSION', 'PERIODIC', 'RETURN_TO_WORK', 'RISK_CHANGE', 'DISMISSAL']),
  examOn: day, issuedOn: day, nextEvaluationOn: day.nullable(), fitness: z.enum(['FIT', 'UNFIT']), evaluatedFunction: text.max(160), medical: medical.nullable(),
  revision: z.number().int().positive(), revokedAt: z.string().datetime({ offset: true }).nullable(), revocationCode: z.enum(['ENTRY_ERROR', 'DUPLICATE', 'REPLACED']).nullable(), isLatest: z.boolean() }).strict()
  .refine(a => a.issuedOn >= a.examOn && (!a.nextEvaluationOn || a.nextEvaluationOn >= a.examOn) && Boolean(a.revokedAt) === Boolean(a.revocationCode) && !(a.revokedAt && a.isLatest));
export type Aso = z.infer<typeof base>;
export type AsoScope = { unitId: string; companyIds: readonly string[]; ownOnly: boolean; workerId?: string | null; canDetail?: boolean };
const context = z.object({ unitId: id, companyId: id, ownOnly: z.boolean(), canEdit: z.boolean(), canDetail: z.boolean(), workers: z.array(z.object({ id, name: text, enrollment: text })) }).strict();
export type AsoContext = z.infer<typeof context>;
export function checkedContext(value: unknown, scope: AsoScope) {
  const p = context.safeParse(value);
  if (!p.success || p.data.unitId !== scope.unitId || !scope.companyIds.includes(p.data.companyId) || p.data.ownOnly !== scope.ownOnly
    || new Set(p.data.workers.map(w => w.id)).size !== p.data.workers.length || p.data.canEdit && !p.data.canDetail
    || !p.data.canEdit && p.data.workers.length > 0 || scope.ownOnly && (p.data.canEdit || !p.data.canDetail)) throw new InvalidReadResponse();
  return p.data;
}
export function checkedAso(value: unknown, scope: AsoScope, expectedId?: string) {
  const p = base.safeParse(value);
  if (!p.success || p.data.unitId !== scope.unitId || !scope.companyIds.includes(p.data.companyId) || expectedId && p.data.id !== expectedId
    || scope.ownOnly && p.data.workerId !== scope.workerId || Boolean(p.data.medical) !== Boolean(scope.canDetail)) throw new InvalidReadResponse();
  return p.data;
}
export function dueStatus(item: Aso): keyof typeof dueLabels {
  if (!item.nextEvaluationOn) return 'NO_DATE';
  const today = localDay(), soon = new Date(`${today}T12:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  return item.nextEvaluationOn < today ? 'DUE' : item.nextEvaluationOn <= soon.toISOString().slice(0, 10) ? 'SOON' : 'SCHEDULED';
}
export function checkedPage(value: unknown, scope: AsoScope, page: number, view: string, due: string) {
  const p = z.object({ items: z.array(z.unknown()), total: z.number().int().nonnegative(), page: z.literal(page), pageSize: z.literal(20) }).safeParse(value);
  if (!p.success || p.data.items.length !== Math.min(20, Math.max(p.data.total - (page - 1) * 20, 0))) throw new InvalidReadResponse();
  const items = p.data.items.map(a => checkedAso(a, scope));
  if (new Set(items.map(a => a.id)).size !== items.length || view === 'LATEST' && new Set(items.map(a => a.workerId)).size !== items.length
    || items.some(a => view === 'LATEST' && !a.isLatest || due && (a.revokedAt || dueStatus(a) !== due))) throw new InvalidReadResponse();
  return { ...p.data, items };
}
export const historyLabels = { ASO_REGISTERED: 'Cadastro', ASO_CORRECTED: 'Correção', ASO_REVOKED: 'Invalidação' } as const;
export function checkedHistory(value: unknown, revision: number) {
  const p = z.array(z.object({ id, action: z.enum(['ASO_REGISTERED', 'ASO_CORRECTED', 'ASO_REVOKED']), revision: z.number().int().positive(), actorName: z.string().nullable(), occurredAt: z.string().datetime({ offset: true }), reasonCode: z.enum(['REGISTRATION_ERROR', 'SOURCE_CORRECTION', 'ENTRY_ERROR', 'DUPLICATE', 'REPLACED']).nullable() }).strict()).safeParse(value);
  if (!p.success || p.data.some(e => e.revision > revision) || new Set(p.data.map(e => e.id)).size !== p.data.length) throw new InvalidReadResponse(); return p.data;
}
export const fieldsSchema = z.object({ workerId: id, examKind: z.enum(['ADMISSION', 'PERIODIC', 'RETURN_TO_WORK', 'RISK_CHANGE', 'DISMISSAL']), examOn: day, issuedOn: day,
  nextEvaluationOn: z.union([day, z.literal('')]), fitness: z.enum(['FIT', 'UNFIT']), evaluatedFunction: text.max(160), physicianName: text.max(160),
  physicianCrm: medical.shape.physicianCrm, physicianState: medical.shape.physicianState, reference: z.string().trim().max(80), changeCode: z.string() })
  .refine(f => f.examOn <= localDay() && f.issuedOn <= localDay() && f.issuedOn >= f.examOn && (!f.nextEvaluationOn || f.nextEvaluationOn >= f.examOn));
