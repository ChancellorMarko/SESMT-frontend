import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type RequestOptions } from '../../shared/api/client';
import { ScopedPageError } from '../../shared/lib/scoped-page';

type Denial = { error: unknown; revisions: Record<string, number> };
type Options<T> = {
  resource: 'dashboard' | 'permit-dashboard' | 'permit-options';
  sessionKey: string;
  unitId?: string;
  criteria?: string[];
  query: RequestOptions['query'];
  enabled: boolean;
  blockedBy?: unknown;
  check: (value: unknown) => T;
};

/** Dashboard data and filter references are checked again when read from the cache. */
export function useDashboardQuery<T>({ resource, sessionKey, unitId, criteria = [], query, enabled, blockedBy, check }: Options<T>) {
  const client = useQueryClient();
  const scope = [resource, sessionKey, unitId], contextKey = JSON.stringify(scope);
  const queryKey = [...scope, ...criteria], denialKey = [...scope, 'access-denial'];
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const result = useQuery({ queryKey, enabled, queryFn: async ({ signal }) => check(await api.get<unknown>(`/${resource}`, { query, signal })) });
  const verified = useMemo<{ data?: T; error?: unknown }>(() => {
    if (!enabled || result.data === undefined) return {};
    try { return { data: check(result.data) }; }
    catch (error) { return { error }; }
  }, [enabled, result.data, check]);
  const deniedError = [blockedBy, result.error, verified.error].find(error => error instanceof ScopedPageError || error instanceof ApiError && [401, 403, 404].includes(error.status));
  useEffect(() => {
    if ((!enabled && !blockedBy) || !deniedError) return;
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error: deniedError, revisions });
    // A changed authorization on references also invalidates aggregates already in flight or cached.
    if (blockedBy) void client.cancelQueries({ queryKey: scope }).then(() => client.invalidateQueries({ queryKey: scope, refetchType: 'none' }));
  }, [client, contextKey, enabled, blockedBy, deniedError]);
  const cached = client.getQueryCache().find({ queryKey, exact: true });
  const freshlyVerified = enabled && denial.data && !deniedError && cached?.state.status === 'success' && cached.state.fetchStatus === 'idle'
    && cached.state.dataUpdateCount > (denial.data.revisions[cached.queryHash] ?? 0);
  useEffect(() => { if (freshlyVerified) client.setQueryData(denialKey, null); }, [client, contextKey, freshlyVerified]);
  const failed = result.isError || Boolean(verified.error) || Boolean(denial.data);
  return {
    data: enabled && !failed ? verified.data : undefined,
    error: result.error ?? verified.error ?? denial.data?.error,
    isError: enabled && failed,
    isPending: enabled && !failed && result.isPending,
    isFetching: result.isFetching,
    retry: async () => { if (enabled) await result.refetch(); },
  };
}
