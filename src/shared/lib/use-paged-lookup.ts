import { useEffect, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, ApiError, type RequestOptions } from '../api/client';
import type { PageDto } from '../contracts';

export interface PagedLookup<T> {
  items: T[];
  selectedItems: T[];
  missingIds: string[];
  page: number;
  total: number;
  pageSize: number;
  term: string;
  contextKey: string;
  setTerm: (term: string) => void;
  setPage: (page: number) => void;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  verified: boolean;
  refetch: () => Promise<unknown>;
}

/** Page results and resolve current selections independently, always within the same scope. */
export function usePagedLookup<T extends { id: string }>({ queryKey, path, query = {}, selectedIds = [], enabled = true, pageSize = 20 }: {
  queryKey: QueryKey;
  path: string;
  query?: RequestOptions['query'];
  selectedIds?: string[];
  enabled?: boolean;
  pageSize?: number;
}): PagedLookup<T> {
  const client = useQueryClient();
  const contextKey = JSON.stringify([queryKey, path, query]);
  const denialKey = [...queryKey, path, query, 'lookup-denial'];
  const denial = useQuery<{ error: unknown; revisions: Record<string, number> } | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const [criteria, setCriteria] = useState({ contextKey, term: '', page: 1 });
  const term = criteria.contextKey === contextKey ? criteria.term : '';
  const page = criteria.contextKey === contextKey ? criteria.page : 1;
  useEffect(() => { setCriteria(previous => previous.contextKey === contextKey ? previous : { contextKey, term: '', page: 1 }); }, [contextKey]);

  const listKey = [...queryKey, path, query, 'lookup-page', term, page, pageSize];
  const list = useQuery({
    queryKey: listKey,
    queryFn: ({ signal }) => api.get<PageDto<T>>(path, { signal, query: { ...query, q: term || undefined, page, pageSize } }),
    enabled,
  });
  const ids = [...new Set(selectedIds.filter(Boolean))].sort();
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
  const selectionKeys = batches.map(batch => [...queryKey, path, query, 'lookup-selected', batch]);
  const selections = useQueries({ queries: batches.map((batch, index) => ({
    queryKey: selectionKeys[index],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.get<PageDto<T>>(path, { signal, query: { ...query, ids: batch.join(','), page: 1, pageSize: 100 } }),
    enabled,
  })) });

  const currentError = list.error ?? selections.find(result => result.isError)?.error;
  const deniedError = [list.error, ...selections.map(result => result.error)].find(error => error instanceof ApiError && [403, 404].includes(error.status));
  useEffect(() => {
    if (enabled && deniedError) {
      const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: [...queryKey, path, query] }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
      client.setQueryData(denialKey, { error: deniedError, revisions });
    }
  }, [client, contextKey, enabled, deniedError]);
  const currentQueries = [listKey, ...selectionKeys].map(key => client.getQueryCache().find({ queryKey: key, exact: true }));
  const newlyVerified = enabled && denial.data && !deniedError && currentQueries.every(entry => entry?.state.status === 'success' && entry.state.fetchStatus === 'idle' && entry.state.dataUpdateCount > (denial.data!.revisions[entry.queryHash] ?? 0));
  useEffect(() => { if (newlyVerified) client.setQueryData(denialKey, null); }, [client, contextKey, newlyVerified]);
  const isError = enabled && (list.isError || selections.some(result => result.isError) || Boolean(denial.data));
  const isPending = enabled && (list.isPending || selections.some(result => result.isPending));
  const isFetching = enabled && (list.isFetching || selections.some(result => result.isFetching));
  const visible = enabled && !isError;
  const items = visible ? list.data?.items ?? [] : [];
  const selectedItems = visible ? selections.flatMap(result => result.data?.items ?? []).filter(item => ids.includes(item.id)) : [];
  const resolvedIds = new Set(selectedItems.map(item => item.id));
  const missingIds = enabled ? ids.filter(id => !resolvedIds.has(id)) : [];

  return {
    items, selectedItems, missingIds, page, pageSize: list.data?.pageSize ?? pageSize,
    total: visible ? list.data?.total ?? 0 : 0, term, contextKey,
    setTerm: value => setCriteria({ contextKey, term: value.trim(), page: 1 }),
    setPage: value => setCriteria({ contextKey, term, page: Math.max(1, Math.trunc(value)) }),
    isPending, isFetching, isError,
    error: currentError ?? denial.data?.error,
    verified: enabled && !isPending && !isFetching && !isError && !missingIds.length,
    refetch: async () => {
      if (!enabled) return;
      const results = await Promise.all([list.refetch(), ...selections.map(result => result.refetch())]);
      // Only fresh successful responses restore access; a cached page cannot clear a denial.
      if (results.every(result => result.isSuccess)) client.setQueryData(denialKey, null);
      return results;
    },
  };
}
