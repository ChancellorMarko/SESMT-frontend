import { z } from 'zod';
import { api } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

// DeadlinesController (GET /deadlines), backend PR #52. Docs: SESMT-backend/docs/deadlines.md.
export const deadlineKinds = ['TRAINING', 'ASO', 'EPI'] as const;
export type DeadlineKind = typeof deadlineKinds[number];
export const deadlineWindows = [30, 60, 90] as const;
export const DEADLINES_MAX_ITEMS = 200;
export const deadlinePermissions: Record<DeadlineKind, string> = { TRAINING: 'treinamento:ler', ASO: 'aso:acompanhar', EPI: 'epi:ler' };
export const deadlineLabels: Record<DeadlineKind, string> = { TRAINING: 'Treinamento', ASO: 'ASO', EPI: 'EPI' };
export const deadlineRoutes: Record<DeadlineKind, string> = { TRAINING: '/app/treinamentos', ASO: '/app/asos', EPI: '/app/epis' };

const id = z.guid().transform(value => value.toLowerCase());
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(200);
const item = z.strictObject({
  kind: z.enum(deadlineKinds), id, companyId: id, unitId: id, unitName: text, workerId: id, workerName: text,
  label: text, dueOn: civilDate, status: z.enum(['OVERDUE', 'DUE_SOON']),
});
const response = z.strictObject({
  referenceDate: civilDate, days: z.number().int().min(1).max(365), kinds: z.array(z.enum(deadlineKinds)),
  summary: z.strictObject({ overdue: count, dueSoon: count }), total: count, truncated: z.boolean(), items: z.array(item),
});
export type NativeDeadlines = z.infer<typeof response>;
export type NativeDeadline = z.infer<typeof item>;

/** Opens the module on the item's own unit and worker. When the header has another unit selected, the module
 * keeps it and offers "Abrir unidade do link" instead of switching silently. */
export function deadlineHref(item: { kind: DeadlineKind; unitId: string; workerId: string }) {
  return `${deadlineRoutes[item.kind]}?${new URLSearchParams({ unitId: item.unitId, workerId: item.workerId })}`;
}

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function readableDeadlineKinds(can: (permission: string) => boolean) {
  return deadlineKinds.filter(kind => can(deadlinePermissions[kind]));
}

export function requestNativeDeadlines(days: number, signal: AbortSignal) {
  return api.get<unknown>('/deadlines', { query: { days: String(days) }, signal });
}

/** Rejects anything that would mislead the reader: wrong window, statuses or counts that disagree with the
 * dates, a source the account was not told it may read, duplicated rows or a list out of order. */
export function checkedNativeDeadlines(value: unknown, days: number): NativeDeadlines {
  const parsed = response.safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const data = parsed.data, limit = addDays(data.referenceDate, days), kinds = new Set(data.kinds);
  const overdue = data.items.filter(entry => entry.status === 'OVERDUE').length;
  if (data.days !== days || kinds.size !== data.kinds.length || data.summary.overdue + data.summary.dueSoon !== data.total
    || data.truncated !== data.total > DEADLINES_MAX_ITEMS || data.items.length !== Math.min(data.total, DEADLINES_MAX_ITEMS)
    || !data.truncated && overdue !== data.summary.overdue
    || new Set(data.items.map(entry => `${entry.kind}:${entry.id}`)).size !== data.items.length) throw new InvalidReadResponse();
  let previous = '';
  for (const entry of data.items) {
    if (!kinds.has(entry.kind) || entry.dueOn > limit || entry.dueOn < previous
      || (entry.status === 'OVERDUE') !== (entry.dueOn < data.referenceDate)) throw new InvalidReadResponse();
    previous = entry.dueOn;
  }
  return data;
}
