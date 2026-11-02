import { api } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { checkedNativeTeam, checkedTeamSummaries, nativeId } from './contracts';

/** List DTO omits company/local; verify details before exposing a page of teams. */
export async function loadNativeTeams(context: { unitId: string; companyIds: readonly string[]; page: number }, signal: AbortSignal) {
  if (!nativeId.safeParse(context.unitId).success || !context.companyIds.length || !Number.isInteger(context.page) || context.page < 1 || context.page > Math.floor(2147483647 / 10)) throw new InvalidReadResponse();
  const summaries = checkedTeamSummaries(await api.get<unknown>('/teams', { query: { locationId: context.unitId, pageNumber: context.page, pageSize: 10 }, signal }));
  const items = await Promise.all(summaries.map(async summary => {
    const item = checkedNativeTeam(await api.get<unknown>(`/teams/${encodeURIComponent(summary.id)}`, { signal }), { ...context, id: summary.id });
    if (item.organizationId !== summary.organizationId || item.name !== summary.name || item.chiefId !== summary.chiefId || item.active !== summary.active
      || summary.version !== undefined && item.version !== summary.version) throw new InvalidReadResponse();
    return item;
  }));
  return { items, count: summaries.length };
}
