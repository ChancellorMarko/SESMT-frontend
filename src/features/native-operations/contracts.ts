import { z } from 'zod';
import { isIsoInstant } from '../../shared/auth/session-response';
import { checkedPage, isSafePage } from '../../shared/lib/scoped-page';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

// Official Appointments/Teams/OperationalDesignation DTOs, backend 41d31e9.
export const nativeId = z.string().uuid().transform(value => value.toLowerCase()).refine(value => value !== '00000000-0000-0000-0000-000000000000');
export const nativeIds = z.array(nativeId).refine(values => new Set(values).size === values.length);
const instant = z.string().refine(isIsoInstant), version = z.number().int().min(1).max(2147483647);
export const nativeAppointmentLabels = { REQUESTED: 'Solicitado', CONFIRMED: 'Confirmado', CANCELLED: 'Cancelado' } as const;
const status = z.enum(['REQUESTED', 'CONFIRMED', 'CANCELLED']);
const state = z.object({ status, startsAt: instant, endsAt: instant, responsibleId: nativeId.nullable(), teamId: nativeId.nullable(), serviceCodes: z.array(z.string().min(1).max(200)), participantIds: nativeIds });
export const nativeAppointment = z.object({
  id: nativeId, companyId: nativeId, locationId: nativeId.nullable(), teamId: nativeId.nullable(), title: z.string().trim().min(1).max(200),
  status, version, startsAt: instant, endsAt: instant, responsibleId: nativeId.nullable(), serviceCodes: z.array(z.string().min(1).max(200)),
  participantIds: nativeIds, requestedBy: nativeId.nullable(), requestedViaInviteId: nativeId.nullable(),
  history: z.array(z.object({ action: z.string().min(1).max(200), version, actorId: nativeId.nullable(), occurredAt: instant, reason: z.string().max(1000).nullable(), before: state.nullable(), after: state })),
}).refine(item => Date.parse(item.endsAt) > Date.parse(item.startsAt) && item.history.every(event => event.version <= item.version && Date.parse(event.after.endsAt) > Date.parse(event.after.startsAt)));
export type NativeAppointment = z.infer<typeof nativeAppointment>;
export function checkedNativeAppointment(value: unknown, expectedId?: string) {
  const result = nativeAppointment.safeParse(value);
  if (!result.success || expectedId && result.data.id !== expectedId.toLowerCase()) throw new InvalidReadResponse();
  return result.data;
}
export const nativeAgendaPageSize = 20;
export type NativeAgendaCriteria = { page: number; q: string; status: string; from: string; to: string; companyId: string };
const civil = (value: string) => !value || isIsoInstant(`${value}T00:00:00Z`);
export function nativeAgendaCriteria(params: URLSearchParams): NativeAgendaCriteria | undefined {
  const keys = ['page', 'q', 'status', 'from', 'to', 'companyId'];
  const q = params.get('q') ?? '', selectedStatus = params.get('status') ?? '', from = params.get('from') ?? '', to = params.get('to') ?? '', companyId = params.get('companyId') ?? '';
  if ([...params.keys()].some(key => !keys.includes(key)) || keys.some(key => params.getAll(key).length > 1) || !isSafePage(params.get('page'), nativeAgendaPageSize)
    || Number(params.get('page') ?? 1) > Math.floor(2147483647 / nativeAgendaPageSize) || q.length > 200 || /[\u0000-\u001f\u007f]/.test(q)
    || selectedStatus && !Object.hasOwn(nativeAppointmentLabels, selectedStatus) || !civil(from) || !civil(to) || from && to && from > to
    || to === '9999-12-31' || companyId && !nativeId.safeParse(companyId).success) return undefined;
  return { page: Number(params.get('page') ?? 1), q: q.trim(), status: selectedStatus, from, to, companyId: companyId.toLowerCase() };
}
export function nativeAgendaQuery(criteria: NativeAgendaCriteria) {
  return { page: criteria.page, pageSize: nativeAgendaPageSize, q: criteria.q || undefined, status: criteria.status || undefined,
    companyId: criteria.companyId || undefined, from: criteria.from ? `${criteria.from}T00:00:00Z` : undefined,
    // Native repository uses overlapping half-open intervals, including the full selected final day.
    to: criteria.to ? new Date(Date.parse(`${criteria.to}T00:00:00Z`) + 86400000).toISOString() : undefined };
}
export function checkedNativeAgenda(value: unknown, criteria: NativeAgendaCriteria) {
  const response = z.object({ items: z.array(nativeAppointment), total: z.number(), page: z.number(), pageSize: z.number() }).safeParse(value);
  if (!response.success) throw new InvalidReadResponse();
  const result = checkedPage(response.data, { page: criteria.page, pageSize: nativeAgendaPageSize }, (item): item is NativeAppointment => nativeAppointment.safeParse(item).success);
  const query = nativeAgendaQuery(criteria);
  if (result.items.some(item => criteria.status && item.status !== criteria.status || criteria.companyId && item.companyId !== criteria.companyId
    || criteria.q && !item.title.toLocaleLowerCase('pt-BR').includes(criteria.q.toLocaleLowerCase('pt-BR'))
    || query.from && Date.parse(item.endsAt) <= Date.parse(query.from) || query.to && Date.parse(item.startsAt) >= Date.parse(query.to))) throw new InvalidReadResponse();
  return result;
}

export const nativeTeamSummary = z.object({ id: nativeId, organizationId: nativeId, name: z.string().trim().min(1).max(150), chiefId: nativeId.nullable(), active: z.boolean(), version: version.optional() });
export const nativeTeam = nativeTeamSummary.extend({ companyId: nativeId.nullable(), localId: nativeId.nullable(), description: z.string().max(1000).nullable(), participantIds: nativeIds });
export type NativeTeam = z.infer<typeof nativeTeam>;
export function checkedNativeTeam(value: unknown, expected: { id: string; unitId: string; companyIds: readonly string[] }) {
  const parsed = nativeTeam.safeParse(value);
  if (!parsed.success || parsed.data.id !== expected.id.toLowerCase() || parsed.data.localId !== expected.unitId.toLowerCase() || !parsed.data.active
    || !parsed.data.companyId || !expected.companyIds.some(id => id.toLowerCase() === parsed.data.companyId)) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedTeamSummaries(value: unknown) {
  const parsed = z.array(nativeTeamSummary).max(10).safeParse(value);
  if (!parsed.success || parsed.data.some(item => !item.active) || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length) throw new InvalidReadResponse();
  return parsed.data;
}
export const nativeDesignationTypes = { atender: 'Atendimento', liberar: 'Liberação', revisar: 'Revisão', conferir: 'Conferência' } as const;
export const nativeDesignation = z.object({ id: nativeId, personId: nativeId, serviceIds: nativeIds.refine(values => values.length > 0), locationIds: nativeIds.refine(values => values.length > 0),
  type: z.enum(['atender', 'liberar', 'revisar', 'conferir']), startsAt: instant, endsAt: instant, origin: z.string().trim().min(1).max(120),
  active: z.boolean(), version, assignedBy: nativeId, revokedBy: nativeId.nullable(), revokedAt: instant.nullable(),
}).refine(item => Date.parse(item.endsAt) > Date.parse(item.startsAt) && (item.revokedAt === null) === (item.revokedBy === null) && !(item.active && item.revokedAt !== null));
export type NativeDesignation = z.infer<typeof nativeDesignation>;
export function checkedNativeDesignations(value: unknown) {
  const parsed = z.array(nativeDesignation).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedNativeServices(value: unknown) {
  const parsed = z.array(z.object({ id: nativeId, code: z.string().min(1).max(200), name: z.string().min(1).max(300) })).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length) throw new InvalidReadResponse();
  return parsed.data;
}
