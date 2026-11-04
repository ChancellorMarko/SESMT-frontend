import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { ScopedPageError } from './scoped-page';

export class InvalidReadResponse extends Error {
  constructor() { super('A resposta da consulta não corresponde a este registro. Tente novamente.'); this.name = 'InvalidReadResponse'; }
}
export const readIdentifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_-]+$/.test(value);
type Denial = { error: unknown; proofs: Record<string, number> };

/** A denied command invalidates the same read scope, including header counters. */
export function denyVerifiedRead(client: QueryClient, scope: QueryKey, error: unknown) {
  const proofs = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, client.getQueryData(['verified-read-proof', ...entry.queryKey]) ?? 0]));
  client.setQueryData(['verified-read-denial', ...scope], { error, proofs });
}

/** Validate both fresh responses and cache entries; paging cannot bypass a denied read. */
export function useVerifiedRead<T>({ queryKey, scope = queryKey, enabled, request, validate, poll }: {
  queryKey: QueryKey; scope?: QueryKey; enabled: boolean;
  request: (signal: AbortSignal) => Promise<unknown>; validate: (value: unknown) => T;
  poll?: (data: T | undefined) => number | false;
}) {
  const client = useQueryClient(), key = JSON.stringify(queryKey), scopeKey = JSON.stringify(scope);
  const denialKey = ['verified-read-denial', ...scope];
  const proofKey = ['verified-read-proof', ...queryKey];
  const proof = useQuery<number>({ queryKey: proofKey, queryFn: async () => 0, enabled: false, initialData: 0, staleTime: Infinity });
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity });
  const query = useQuery({ queryKey, queryFn: async ({ signal }) => {
    const response = await request(signal);
    if (signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError');
    const result = validate(response);
    client.setQueryData<number>(proofKey, previous => (previous ?? 0) + 1);
    return result;
  }, enabled,
    refetchInterval: q => enabled && !denial.data ? poll?.(q.state.data) ?? false : false });
  const verified = useMemo<{ data?: T; error?: unknown }>(() => {
    if (query.data === undefined) return {};
    try { return { data: validate(query.data) }; } catch (error) { return { error }; }
  }, [query.data, key]);
  const error = query.error ?? verified.error;
  const denied = error instanceof InvalidReadResponse || error instanceof ScopedPageError || error instanceof ApiError && [401, 403, 404].includes(error.status);
  useEffect(() => {
    if (!enabled || !denied) return;
    denyVerifiedRead(client, scope, error);
  }, [client, key, scopeKey, enabled, denied, error]);
  const current = client.getQueryCache().find({ queryKey, exact: true });
  const fresh = enabled && denial.data && !error && current?.state.status === 'success' && current.state.fetchStatus === 'idle'
    && (proof.data ?? 0) > (denial.data.proofs[current.queryHash] ?? 0);
  useEffect(() => { if (fresh) client.setQueryData(denialKey, null); }, [client, scopeKey, fresh]);
  const failed = enabled && (query.isError || Boolean(verified.error) || Boolean(denial.data));
  return { ...query, data: enabled && !failed ? verified.data : undefined, error: error ?? denial.data?.error,
    isError: failed, isPending: enabled && !failed && query.isPending,
    refetch: async () => {
      if (!enabled) return;
      const result = await query.refetch();
      if (result.isSuccess) client.setQueryData(denialKey, null);
      return result;
    } };
}
