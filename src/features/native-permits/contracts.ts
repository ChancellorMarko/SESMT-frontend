import { brasiliaDayStart, brasiliaNextDayStart } from '../../shared/lib/format';
import { z } from 'zod';
import { isIsoInstant } from '../../shared/auth/session-response';
import { checkedPage, isSafePage } from '../../shared/lib/scoped-page';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { nativeId, nativeIds } from '../native-operations/contracts';

// WorkPermitsController/DTOs and domain records in backend origin/main 41d31e9.
const instant = z.string().refine(isIsoInstant);
const version = z.number().int().min(1).max(2147483647);
const text = z.string().trim().min(1);
export const permitStatusLabels = {
  EM_VERIFICACAO: 'Em verificação', LIBERADA: 'Liberada', EM_EXECUCAO: 'Em execução',
  SUSPENSA: 'Suspensa', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
} as const;
const status = z.enum(['EM_VERIFICACAO', 'LIBERADA', 'EM_EXECUCAO', 'SUSPENSA', 'CONCLUIDA', 'CANCELADA']);
export const permitReviewLabels: Record<string, string> = { NAO_ENVIADA: 'Não enviada', AGUARDANDO_REVISAO: 'Aguardando revisão', DEVOLVIDA: 'Devolvida para correção', APROVADA: 'Aprovada' };
const answer = z.object({ perguntaId: nativeId, valor: z.string().nullable(), justificativa: z.string().nullable() });
const answers = z.array(answer).refine(items => new Set(items.map(item => item.perguntaId)).size === items.length);
const acknowledgement = z.object({ id: nativeId, participantUserId: nativeId, collectorId: nativeId, contentVersion: version,
  confirmedName: text.max(160), identificationMethod: text.max(300), declaration: text, recordedAt: instant });
const participant = z.object({ userId: nativeId, responsibility: text, acknowledgedAt: instant.nullable(),
  acknowledgedVersion: version.nullable(), acknowledgements: z.array(acknowledgement).nullable(),
}).refine(item => (item.acknowledgedAt === null) === (item.acknowledgedVersion === null)
  && (item.acknowledgements ?? []).every(record => record.participantUserId === item.userId)
  && new Set((item.acknowledgements ?? []).map(record => record.id)).size === (item.acknowledgements ?? []).length);
const observation = z.object({ id: nativeId, actorId: nativeId, recordedAt: instant, text: text.max(4000) });
export const nativePermit = z.object({
  id: nativeId, companyId: nativeId, appointmentId: nativeId.nullable(), serviceCode: text, title: text,
  status, version, contentVersion: version, createdAt: instant,
  releasedAt: instant.nullable(), startedAt: instant.nullable(), suspendedAt: instant.nullable(),
  suspensionReason: z.string().nullable(), completedAt: instant.nullable(), cancelledAt: instant.nullable(),
  cancellationReason: z.string().nullable(), participants: z.array(participant), templateVersionIds: nativeIds,
  checklistAnswers: answers, authorizedFrom: instant.nullable(), authorizedUntil: instant.nullable(),
  releaseConditions: z.string().nullable(), completionSummary: z.string().nullable(), actualEnd: instant.nullable(),
  reviewStatus: text, closingAnswers: answers.nullable(), observations: z.array(observation).nullable(),
}).refine(item => new Set(item.participants.map(person => person.userId)).size === item.participants.length
  && item.participants.every(person => person.acknowledgedVersion === null || person.acknowledgedVersion <= item.contentVersion)
  && (item.authorizedFrom === null) === (item.authorizedUntil === null)
  && (!item.authorizedFrom || Date.parse(item.authorizedUntil!) > Date.parse(item.authorizedFrom))
  && new Set((item.observations ?? []).map(event => event.id)).size === (item.observations ?? []).length);
export type NativePermit = z.infer<typeof nativePermit>;
export function checkedPermit(value: unknown, id?: string) {
  const parsed = nativePermit.safeParse(value);
  if (!parsed.success || id && parsed.data.id !== id.toLowerCase()) throw new InvalidReadResponse();
  return parsed.data;
}

export const permitPageSize = 20;
export type PermitCriteria = { page: number; q: string; status: string; serviceCode: string; from: string; to: string; companyId: string; locationId: string; participantUserId: string };
export function permitCriteria(params: URLSearchParams): PermitCriteria | undefined {
  const keys = ['page', 'q', 'status', 'serviceCode', 'from', 'to', 'companyId', 'locationId', 'participantUserId'];
  const values = Object.fromEntries(keys.map(key => [key, params.get(key) ?? '']));
  if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1)
    || !isSafePage(params.get('page'), permitPageSize) || Number(values.page || 1) > Math.floor(2147483647 / permitPageSize)
    || values.q.length > 200 || /[\u0000-\u001f\u007f]/.test(values.q)
    || values.status && !Object.hasOwn(permitStatusLabels, values.status)
    || values.serviceCode.length > 80 || /[,\u0000-\u001f\u007f]/.test(values.serviceCode)
    || [values.from, values.to].some(day => day && !isIsoInstant(`${day}T00:00:00Z`))
    || values.from && values.to && values.from > values.to || values.to === '9999-12-31'
    || [values.companyId, values.locationId, values.participantUserId].some(id => id && !nativeId.safeParse(id).success)) return undefined;
  return { page: Number(values.page || 1), q: values.q.trim(), status: values.status, serviceCode: values.serviceCode.trim().toUpperCase(),
    from: values.from, to: values.to, companyId: values.companyId.toLowerCase(), locationId: values.locationId.toLowerCase(), participantUserId: values.participantUserId.toLowerCase() };
}
export function permitQuery(criteria: PermitCriteria) {
  const { from, to, ...rest } = criteria;
  return { ...rest, pageSize: permitPageSize, from: from ? brasiliaDayStart(from) : undefined,
    to: to ? brasiliaNextDayStart(to) : undefined };
}
export function checkedPermits(value: unknown, criteria: PermitCriteria) {
  const page = checkedPage(value, { page: criteria.page, pageSize: permitPageSize }, (item): item is NativePermit => nativePermit.safeParse(item).success);
  const items = page.items.map(item => checkedPermit(item));
  const q = criteria.q.toLocaleLowerCase('pt-BR');
  if (new Set(items.map(item => item.id)).size !== items.length || items.some(item =>
    criteria.companyId && item.companyId !== criteria.companyId || criteria.status && item.status !== criteria.status
    || criteria.serviceCode && !item.serviceCode.split(',').includes(criteria.serviceCode)
    || criteria.participantUserId && !item.participants.some(person => person.userId === criteria.participantUserId)
    || q && !item.title.toLocaleLowerCase('pt-BR').includes(q) && !item.serviceCode.toLocaleLowerCase('pt-BR').includes(q))) throw new InvalidReadResponse();
  // Location and overlap cannot be reconstructed from WorkPermitResponse; the API filters before paging.
  return { ...page, items };
}
export function permitReturn(value: unknown) {
  if (typeof value !== 'string' || value.length > 3000) return '/app/pts';
  try {
    const url = new URL(value, 'https://workspace.invalid');
    return url.origin === 'https://workspace.invalid' && url.pathname === '/app/pts' && !url.hash && permitCriteria(url.searchParams) ? `${url.pathname}${url.search}` : '/app/pts';
  } catch { return '/app/pts'; }
}

const previousClosing = z.object({ summary: z.string(), actualEnd: instant.nullable(), answers, submittedBy: nativeId.nullable(), submittedAt: instant.nullable(),
  reviewedBy: nativeId.nullable(), reviewedAt: instant.nullable(), reviewNote: z.string().nullable() });
const review = z.object({ permitId: nativeId, version, reviewStatus: z.enum(['NAO_ENVIADA', 'AGUARDANDO_REVISAO', 'DEVOLVIDA', 'APROVADA']),
  submittedBy: nativeId.nullable(), submittedAt: instant.nullable(), reviewedBy: nativeId.nullable(), reviewedAt: instant.nullable(),
  reviewNote: z.string().nullable(), canReview: z.boolean(), canResubmit: z.boolean(), previousClosings: z.array(previousClosing) });
export type PermitReview = z.infer<typeof review>;
/** Final review state of the permit as read now; capabilities come from the API, never from designations guessed here. */
export function checkedPermitReview(value: unknown, permit: NativePermit): PermitReview {
  const parsed = review.safeParse(value);
  if (!parsed.success || parsed.data.permitId !== permit.id || parsed.data.version !== permit.version || parsed.data.reviewStatus !== permit.reviewStatus
    || parsed.data.canReview && parsed.data.reviewStatus !== 'AGUARDANDO_REVISAO' || parsed.data.canResubmit && parsed.data.reviewStatus !== 'DEVOLVIDA'
    || parsed.data.reviewStatus === 'DEVOLVIDA' && !parsed.data.reviewNote) throw new InvalidReadResponse();
  return parsed.data;
}

const transition = z.object({ id: nativeId, previousStatus: status.nullable(), newStatus: status, action: text,
  actorId: nativeId, occurredAt: instant, reason: z.string().nullable(), version });
export function checkedPermitHistory(value: unknown, permit: NativePermit) {
  const parsed = z.array(transition).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length
    || parsed.data.some(item => item.version > permit.version)) throw new InvalidReadResponse();
  return parsed.data;
}
const issue = z.object({ code: text, participantUserId: nativeId.nullable(), documentTypeId: nativeId.nullable(), serviceCode: z.string().nullable() });
export function checkedEligibility(value: unknown) {
  const parsed = z.object({ ready: z.boolean(), issues: z.array(issue) }).safeParse(value);
  if (!parsed.success || parsed.data.ready !== (parsed.data.issues.length === 0)) throw new InvalidReadResponse();
  return parsed.data;
}
const declarations = z.object({ permitId: nativeId, expectedVersion: version, contentVersion: version,
  declarations: z.array(z.object({ templateVersionId: nativeId, version, text, templateId: nativeId.optional() })),
  context: z.object({ appointmentId: nativeId, version, locationId: nativeId.nullable(), responsibleId: nativeId.nullable(),
    from: instant, until: instant, serviceCodes: z.array(text), participantIds: nativeIds, teamId: nativeId.nullable().optional() }).nullable(),
  canonicalContent: z.string().min(1).max(1000000).optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type PermitDeclarations = z.infer<typeof declarations>;
export function checkedDeclarations(value: unknown, permit: NativePermit) {
  const parsed = declarations.safeParse(value);
  if (!parsed.success || parsed.data.permitId !== permit.id || parsed.data.expectedVersion !== permit.version || parsed.data.contentVersion !== permit.contentVersion
    || !same(parsed.data.declarations.map(item => item.templateVersionId), permit.templateVersionIds)
    || parsed.data.context && (parsed.data.context.appointmentId !== permit.appointmentId || Date.parse(parsed.data.context.until) <= Date.parse(parsed.data.context.from))) throw new InvalidReadResponse();
  return parsed.data;
}
export function same(a: readonly string[], b: readonly string[]) { return a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id)); }

export function checkedScienceParticipant(value: unknown, permit: NativePermit, userId: string, name: string, declaration: string) {
  const parsed = participant.safeParse(value);
  if (!parsed.success || parsed.data.userId !== userId || parsed.data.acknowledgedVersion !== permit.contentVersion
    || !parsed.data.acknowledgedAt || !parsed.data.acknowledgements?.some(record => record.participantUserId === userId
      && record.collectorId === userId && record.contentVersion === permit.contentVersion && record.confirmedName === name
      && record.identificationMethod === 'Sessão autenticada' && record.declaration === declaration)) throw new InvalidReadResponse();
  return parsed.data;
}
