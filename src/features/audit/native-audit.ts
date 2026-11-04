import { z } from 'zod';
import { isIsoInstant } from '../../shared/auth/session-response';
import { checkedPage, isSafePage } from '../../shared/lib/scoped-page';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { actionCode, validCivilDate } from './audit-support';

// AuditLogsController.ToItem: preserve nullable identities; do not invent names.
const event = z.object({
  id: z.string().uuid(), atorId: z.string().uuid().nullable(), declaranteId: z.string().uuid().nullable(),
  empresaId: z.string().uuid().nullable(), acao: z.string().min(1).max(200),
  recursoTipo: z.string().min(1).max(200), recursoId: z.string().uuid().nullable(),
  versao: z.number().int().nonnegative().nullable(), momento: z.string().refine(isIsoInstant),
  resultado: z.string().max(4000).nullable(), traceId: z.string().max(4000).nullable(),
});
const envelope = z.object({ items: z.array(event), page: z.number(), pageSize: z.number(), total: z.number() });
export type NativeAuditEvent = z.infer<typeof event>;
export const nativeAuditPageSize = 20;
export type NativeAuditCriteria = { page: number; action: string; resourceType: string; from: string; to: string };
export function nativeAuditCriteria(params: URLSearchParams): NativeAuditCriteria | undefined {
  const keys = ['page', 'action', 'resourceType', 'from', 'to'];
  const action = params.get('action') ?? '', resourceType = params.get('resourceType') ?? '';
  const from = params.get('from') ?? '', to = params.get('to') ?? '';
  if (keys.some(key => params.getAll(key).length > 1) || !isSafePage(params.get('page'), nativeAuditPageSize) || Number(params.get('page') ?? 1) > 2147483647
    || action && (!actionCode(action) || action !== action.toUpperCase())
    || resourceType && (!actionCode(resourceType) || resourceType !== resourceType.toLowerCase())
    || !validCivilDate(from) || !validCivilDate(to) || from.startsWith('0000') || to.startsWith('0000') || from && to && from > to) return undefined;
  return { page: Number(params.get('page') ?? 1), action, resourceType, from, to };
}
export function nativeAuditQuery(criteria: NativeAuditCriteria) {
  return { pageNumber: criteria.page, pageSize: nativeAuditPageSize, action: criteria.action || undefined,
    resourceType: criteria.resourceType || undefined, from: criteria.from ? `${criteria.from}T00:00:00Z` : undefined,
    to: criteria.to ? `${criteria.to}T23:59:59.9999999Z` : undefined };
}
export function checkedNativeAudit(value: unknown, criteria: NativeAuditCriteria) {
  const parsed = envelope.safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const result = checkedPage(parsed.data, { page: criteria.page, pageSize: nativeAuditPageSize }, (item): item is NativeAuditEvent => event.safeParse(item).success);
  for (const item of result.items) {
    const day = new Date(item.momento).toISOString().slice(0, 10);
    if (criteria.action && item.acao !== criteria.action || criteria.resourceType && item.recursoTipo !== criteria.resourceType
      || criteria.from && day < criteria.from || criteria.to && day > criteria.to) throw new InvalidReadResponse();
  }
  return result;
}
