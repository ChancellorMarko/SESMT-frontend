import { z } from 'zod';
import { nativeId } from '../native-operations/contracts';
import { checkedPage } from '../../shared/lib/scoped-page';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

const context = z.object({ workerId: nativeId, companyId: nativeId, unitId: nativeId.nullable(), name: z.string().trim().min(1).max(200), enrollment: z.string().trim().min(1).max(30),
  revision: z.number().int().positive(), active: z.boolean(), userId: nativeId.nullable() });
export type WorkerAccountContext = z.infer<typeof context>;
export function checkedWorkerAccountContext(value: unknown, expected: { workerId: string; unitId: string; companyIds: readonly string[] }) {
  const parsed = context.safeParse(value);
  if (!parsed.success || parsed.data.workerId !== expected.workerId || parsed.data.unitId !== expected.unitId || !expected.companyIds.includes(parsed.data.companyId)) throw new InvalidReadResponse();
  return parsed.data;
}
export const accountCandidate = z.object({ id: nativeId, name: z.string().trim().min(1).max(200), email: z.string().email().max(254) });
export type AccountCandidate = z.infer<typeof accountCandidate>;
export function checkedAccountCandidate(value: unknown, id: string) {
  const result = accountCandidate.safeParse(value); if (!result.success || result.data.id !== id) throw new InvalidReadResponse(); return result.data;
}
export function checkedAccountCandidates(value: unknown, expected: WorkerAccountContext, page: number) {
  const result = z.object({ workerId: nativeId, companyId: nativeId, unitId: nativeId.nullable(), revision: z.number().int().positive(), items: z.array(accountCandidate), total: z.number(), page: z.number(), pageSize: z.number() }).safeParse(value);
  if (!result.success || result.data.workerId !== expected.workerId || result.data.companyId !== expected.companyId || result.data.unitId !== expected.unitId || result.data.revision !== expected.revision) throw new InvalidReadResponse();
  return checkedPage(result.data, { page, pageSize: 20 }, (item): item is AccountCandidate => accountCandidate.safeParse(item).success);
}
