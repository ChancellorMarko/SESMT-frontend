import { z } from 'zod';
import { api } from '../../shared/api/client';
import { isIsoInstant } from '../../shared/auth/session-response';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

// DashboardController + DashboardDtos + DashboardService, backend 41d31e9.
const id = z.string().uuid().transform(value => value.toLowerCase()), instant = z.string().refine(isIsoInstant);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ids = z.array(id).refine(values => new Set(values).size === values.length);
const operationalStatus = z.enum(['EM_VERIFICACAO', 'LIBERADA', 'EM_EXECUCAO', 'SUSPENSA', 'CONCLUIDA', 'CANCELADA', 'DEVOLVIDA', 'APROVADA']);
const reviewStatus = z.enum(['AGUARDANDO_REVISAO', 'DEVOLVIDA', 'APROVADA']);
export const nativeOperationalLabels: Record<z.infer<typeof operationalStatus>, string> = {
  EM_VERIFICACAO: 'Em verificação', LIBERADA: 'Liberada', EM_EXECUCAO: 'Em execução',
  SUSPENSA: 'Suspensa', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada', DEVOLVIDA: 'Devolvida', APROVADA: 'Aprovada',
};
const appointment = z.object({
  id, workPermitId: id.nullable(), title: z.string().trim().min(1).max(2000), companyId: id, localId: id.nullable(),
  startsAt: instant, endsAt: instant, operationalStatus: operationalStatus.nullable(), reviewStatus: reviewStatus.nullable(), serviceIds: ids, teamIds: ids,
}).refine(item => Date.parse(item.endsAt) >= Date.parse(item.startsAt));
const documentPendency = z.object({ workPermitId: id, companyId: id, localId: id.nullable(), operationalStatus,
  pendingRequirements: count.refine(value => value > 0), occurredAt: instant, serviceIds: ids, teamIds: ids });
const reviewPendency = z.object({ workPermitId: id, companyId: id, localId: id.nullable(),
  serviceCodes: z.array(z.string().trim().min(1).max(200)), version: count.refine(value => value > 0), completedAt: instant.nullable(), teamIds: ids });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(value => !value.startsWith('0000'));
const bundle = z.object({
  summary: z.object({ emVerificacao: count, liberadas: count, emExecucao: count, concluidasAguardandoRevisao: count,
    pendenciasDocumentais: count, periodo: z.object({ from: instant.nullable(), to: instant.nullable() }) }),
  appointments: z.array(appointment), documents: z.array(documentPendency), reviews: z.array(reviewPendency),
  evolution: z.object({ periodo: z.object({ from: month, to: month }), series: z.array(z.object({ mes: month, concluidas: count, emAndamento: count, pendentes: count })) }),
});
export type NativeDashboard = z.infer<typeof bundle>;
export type NativeAppointment = z.infer<typeof appointment>;
export type NativeDashboardCriteria = { from: string; to: string; scope: 'account' | 'unit'; localId?: string };
const civilDate = (value: string) => isIsoInstant(`${value}T00:00:00Z`);
export const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;

export function defaultNativeDashboardPeriod(now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Apply one explicit UTC period to all five endpoints, bounded by the history contract. */
export function nativeDashboardCriteria(params: URLSearchParams, defaults: { from: string; to: string }, unitId?: string): NativeDashboardCriteria | undefined {
  const keys = ['from', 'to', 'scope'];
  if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1)
    || params.has('from') !== params.has('to')) return undefined;
  const from = params.get('from') ?? defaults.from, to = params.get('to') ?? defaults.to, scope = params.get('scope') ?? 'account';
  if (!civilDate(from) || !civilDate(to) || from > to || monthIndex(to) - monthIndex(from) > 35
    || !['account', 'unit'].includes(scope) || scope === 'unit' && (!id.safeParse(unitId).success || unitId === '00000000-0000-0000-0000-000000000000')) return undefined;
  return { from, to, scope: scope as 'account' | 'unit', localId: scope === 'unit' ? unitId?.toLowerCase() : undefined };
}
export function nativeDashboardQuery(criteria: NativeDashboardCriteria) {
  return { from: `${criteria.from}T00:00:00Z`, to: `${criteria.to}T23:59:59.9999999Z`, localId: criteria.localId };
}
export async function requestNativeDashboard(criteria: NativeDashboardCriteria, signal: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const query = nativeDashboardQuery(criteria);
    const paths = ['summary', 'appointments', 'document-pendencies', 'review-pendencies', 'activity-evolution'];
    const [summary, appointments, documents, reviews, evolution] = await Promise.all(paths.map(path => api.get<unknown>(`/dashboard/${path}`, { query, signal: controller.signal })));
    return { summary, appointments, documents, reviews, evolution };
  } catch (error) { controller.abort(); throw error; }
  finally { signal.removeEventListener('abort', abort); }
}

/** Validate fresh responses AND cached bundles before presenting any metric or record. */
export function checkedNativeDashboard(value: unknown, criteria: NativeDashboardCriteria): NativeDashboard {
  const parsed = bundle.safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const data = parsed.data, query = nativeDashboardQuery(criteria), start = Date.parse(query.from), end = Date.parse(query.to);
  const within = (value: string | null) => value !== null && Date.parse(value) >= start && Date.parse(value) <= end;
  const atLocal = (value: string | null) => !criteria.localId || value === criteria.localId;
  if (Date.parse(data.summary.periodo.from ?? '') !== start || Date.parse(data.summary.periodo.to ?? '') !== end) throw new InvalidReadResponse();
  for (const items of [data.appointments.map(item => ({ key: item.id, localId: item.localId, date: item.startsAt })),
    data.documents.map(item => ({ key: item.workPermitId, localId: item.localId, date: item.occurredAt })),
    data.reviews.map(item => ({ key: item.workPermitId, localId: item.localId, date: item.completedAt }))]) {
    if (new Set(items.map(item => item.key)).size !== items.length || items.some(item => !atLocal(item.localId) || !within(item.date))) throw new InvalidReadResponse();
  }
  const fromMonth = criteria.from.slice(0, 7), toMonth = criteria.to.slice(0, 7);
  if (data.evolution.periodo.from !== fromMonth || data.evolution.periodo.to !== toMonth
    || data.evolution.series.length !== monthIndex(toMonth) - monthIndex(fromMonth) + 1
    || data.evolution.series.some((item, index) => monthIndex(item.mes) !== monthIndex(fromMonth) + index)) throw new InvalidReadResponse();
  // Each endpoint has its own DB read; do not reject a live update by equating cross-request counts.
  return data;
}
