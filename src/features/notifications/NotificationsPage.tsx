import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { Bell, BellRing, ListChecks, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { NotificationDto } from '../../shared/contracts';
import { isSafePage, scopedQueryError, ScopedPageError } from '../../shared/lib/scoped-page';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { AppliedFilters } from '../../shared/ui/filter-controls';
import { NotificationCard } from './NotificationCard';
import { checkedNotificationsPage, isNotification, notificationCriteriaError, validReadAt } from './notifications-support';

const pageSize = 20;
type Denial = { error: unknown; revisions: Record<string, number> };
function accessFailure(error: unknown) { return error instanceof ApiError && [401, 403, 404].includes(error.status); }
function targetPath(item: NotificationDto) {
  const routes: Record<string, string> = { DOCUMENT: '/app/documentos', WORKER: '/app/trabalhadores', WORK_PERMIT: '/app/pts', PERMIT: '/app/pts', APPOINTMENT: '/app/agenda' };
  const base = routes[item.resourceType.toUpperCase()];
  return base && item.resourceId ? `${base}/${encodeURIComponent(item.resourceId)}` : undefined;
}

export function NotificationsPage() {
  const { sessionKey, unitId, can } = useSession();
  return <NotificationsContent key={JSON.stringify([sessionKey, unitId, can('notifications.read')])} />;
}

function NotificationsContent() {
  const { sessionKey, unitId, can } = useSession(); const client = useQueryClient();
  const allowed = can('notifications.read');
  const location = useLocation();
  const readSelect = useRef<HTMLSelectElement>(null);
  const restoreReadFocus = useRef(false);
  const [params, setParams] = useAppQueryParams();
  const latestParams = useRef(new URLSearchParams(params));
  useLayoutEffect(() => { latestParams.current = new URLSearchParams(params); }, [params]);
  function writeParams(next: URLSearchParams, replace = false, flushSync = false) { latestParams.current = new URLSearchParams(next); setParams(next, { replace, flushSync }); }
  const requestedRead = params.get('read') ?? '', read = ['true', 'false'].includes(requestedRead) ? requestedRead : '';
  const page = Number(params.get('page') ?? 1), urlUnit = params.get('unitId');
  const filterError = notificationCriteriaError(params);
  const [confirmation, setConfirmation] = useState(''), [mutationError, setMutationError] = useState<unknown>(), [savingId, setSavingId] = useState('');
  const active = useRef(true); const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => {
    if (!allowed || !unitId || params.getAll('unitId').length > 1) return;
    const next = new URLSearchParams(latestParams.current), previousUnit = next.get('unitId');
    if (previousUnit === unitId) return;
    next.set('unitId', unitId); if (previousUnit && previousUnit !== unitId) next.delete('page');
    writeParams(next, true);
  }, [allowed, unitId, urlUnit, params, setParams]);
  const unitMatches = Boolean(unitId && urlUnit === unitId);
  const enabled = allowed && unitMatches && !filterError;
  const scope = ['notifications', sessionKey, unitId];
  const contextKey = JSON.stringify(scope), queryKey = [...scope, read, page], denialKey = [...scope, 'access-denial'];
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const notices = useQuery({ queryKey, queryFn: async ({ signal }) => checkedNotificationsPage(await api.get<unknown>('/notifications', { query: { unitId, page, pageSize, read: read === '' ? undefined : read === 'true' }, signal }), { page, pageSize, read }), enabled });
  const verified = useMemo(() => {
    if (notices.data === undefined) return {};
    try { return { data: checkedNotificationsPage(notices.data, { page, pageSize, read }) }; }
    catch (error) { return { error }; }
  }, [notices.data, page, read]);
  function rememberDenial(error: unknown) {
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error, revisions });
  }
  const deniedError = verified.error ?? (accessFailure(notices.error) || notices.error instanceof ScopedPageError ? notices.error : undefined);
  useEffect(() => { if (enabled && deniedError) rememberDenial(deniedError); }, [client, contextKey, enabled, deniedError]);
  const cachedQuery = client.getQueryCache().find({ queryKey, exact: true });
  const fresh = enabled && denial.data && !deniedError && cachedQuery?.state.status === 'success' && cachedQuery.state.fetchStatus === 'idle'
    && cachedQuery.state.dataUpdateCount > (denial.data.revisions[cachedQuery.queryHash] ?? 0);
  useEffect(() => { if (fresh) { client.setQueryData(denialKey, null); setMutationError(undefined); } }, [client, contextKey, fresh]);
  const failed = notices.isError || Boolean(verified.error || denial.data) || accessFailure(mutationError) || mutationError instanceof ScopedPageError;
  const data = enabled && !failed ? verified.data : undefined;
  const items = data?.items ?? [];
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : page;
  useEffect(() => {
    if (!restoreReadFocus.current || savingId || notices.isFetching || !enabled || failed) return;
    restoreReadFocus.current = false; readSelect.current?.focus();
  }, [savingId, notices.isFetching, enabled, failed]);
  useEffect(() => {
    if (!enabled || !data || notices.isFetching || failed || page <= lastPage) return;
    const next = new URLSearchParams(latestParams.current);
    if (next.get('unitId') !== unitId || (next.get('read') || '') !== read || Number(next.get('page') ?? 1) !== page) return;
    next.set('page', String(lastPage)); writeParams(next, true);
  }, [enabled, unitId, read, data, notices.isFetching, failed, lastPage, page, params, setParams]);

  function setPage(nextPage: number) {
    if (pending.current) return;
    const next = new URLSearchParams(latestParams.current); next.set('page', String(nextPage)); writeParams(next, false, true);
  }
  function changeRead(value: string) {
    if (pending.current) return;
    const next = new URLSearchParams(latestParams.current); next.delete('page');
    if (value) next.set('read', value); else next.delete('read');
    setConfirmation(''); setMutationError(undefined); writeParams(next, false, true);
  }
  function removeReadFilter() { changeRead(''); readSelect.current?.focus(); }
  function clearFilters() {
    if (pending.current || !unitId) return;
    setConfirmation(''); setMutationError(undefined); writeParams(new URLSearchParams({ unitId }), false, true);
  }
  async function retry() {
    if (!enabled || pending.current) return;
    await notices.refetch();
  }
  async function markRead(item: NotificationDto) {
    if (!enabled || notices.isFetching || failed || pending.current || item.readAt || !items.some(current => current.id === item.id && current.resourceId === item.resourceId && current.resourceType === item.resourceType)) return;
    const controller = new AbortController(); pending.current = controller;
    setSavingId(item.id); setConfirmation(''); setMutationError(undefined);
    try {
      const updated = await api.patch<unknown>(`/notifications/${encodeURIComponent(item.id)}/read`, {}, { signal: controller.signal, query: { unitId } });
      if (!active.current || controller.signal.aborted || pending.current !== controller) return;
      if (!isNotification(updated) || updated.id !== item.id || updated.resourceId !== item.resourceId || updated.resourceType !== item.resourceType || !validReadAt(updated.readAt)) throw new ScopedPageError();
      restoreReadFocus.current = read === 'false';
      setConfirmation(`Leitura registrada: ${updated.title}. A pendência do registro continua sendo acompanhada.`);
      await client.invalidateQueries({ queryKey: scope });
    } catch (error) {
      if (!active.current || controller.signal.aborted || pending.current !== controller) return;
      restoreReadFocus.current = false; setMutationError(error); if (accessFailure(error) || error instanceof ScopedPageError) rememberDenial(error);
    } finally { if (pending.current === controller) { pending.current = undefined; if (active.current) setSavingId(''); } }
  }

  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar notificações.</Feedback>;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar suas notificações." />;
  const currentError = verified.error ?? notices.error ?? denial.data?.error ?? mutationError;
  return <div className="stack">
    <PageHeader eyebrow="ACOMPANHAMENTO" title="Notificações" description="Avisos do seu escopo. Marcar como lido registra a leitura e mantém a pendência do documento." />
    <section aria-label="Filtros de notificações" className="grid min-w-0 gap-4 rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-end gap-3 [&_.field]:min-w-0 [&_.field]:flex-1 [&_.field]:basis-48 [&_select]:w-full"><Field label="Leitura"><select ref={readSelect} value={requestedRead} disabled={Boolean(savingId)} onChange={event => changeRead(event.target.value)}><option value="">Todas</option>{requestedRead && !['true', 'false'].includes(requestedRead) && <option value={requestedRead}>Filtro de leitura inválido</option>}<option value="false">Não lidas</option><option value="true">Lidas</option></select></Field><Button variant="secondary" className="!min-h-11 max-sm:!w-full" disabled={!enabled || notices.isFetching || Boolean(savingId)} onClick={() => void retry()}><RefreshCw size={15} className="shrink-0" aria-hidden="true" />{notices.isFetching && !notices.isPending ? 'Atualizando…' : 'Atualizar'}</Button></div>
      {read && <div className={`flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 ${savingId ? 'pointer-events-none opacity-60' : ''}`} inert={Boolean(savingId)}><AppliedFilters filters={[{ key: 'read', label: 'Leitura', value: read === 'true' ? 'Lidas' : 'Não lidas' }]} onRemove={removeReadFilter} /><Button variant="ghost"  disabled={Boolean(savingId)} onClick={removeReadFilter}>Limpar filtro</Button></div>}
    </section>
    {filterError && <Feedback tone="warning">{filterError} {!isSafePage(params.get('page'), pageSize) && <Button variant="ghost" disabled={Boolean(savingId)} onClick={() => setPage(1)}>Voltar à primeira página</Button>} <Button variant="ghost" disabled={Boolean(savingId)} onClick={clearFilters}>Limpar filtros</Button></Feedback>}
    {!filterError && !unitMatches && <Feedback>Conferindo a unidade da consulta. Aguarde a atualização dos filtros.</Feedback>}
    {enabled && notices.isPending && !failed && <Spinner />}
    {enabled && failed && <Feedback tone="danger">{scopedQueryError(currentError, 'notificações')} <Button variant="ghost" disabled={notices.isFetching || Boolean(savingId)} onClick={() => void retry()}>Tentar novamente</Button></Feedback>}
    {mutationError !== undefined && !accessFailure(mutationError) && !(mutationError instanceof ScopedPageError) && <Feedback tone="danger">Não foi possível registrar a leitura. {scopedQueryError(mutationError, 'notificações')}</Feedback>}
    {confirmation && enabled && !failed && <Feedback tone="success">{confirmation}</Feedback>}
    {data && page <= lastPage && <>
    <section aria-label="Resumo da consulta" role="status" aria-live="polite" className="grid min-w-0 grid-cols-2 gap-3">
      {[{ label: 'Na consulta', value: data.total, icon: read === 'false' ? BellRing : Bell, caption: 'No filtro selecionado' }, { label: 'Nesta página', value: items.length, icon: ListChecks, caption: 'Avisos exibidos abaixo' }].map(({ label, value, icon: Icon, caption }) => <div key={label} className="min-w-0 rounded-2xl border border-slate-200/80 bg-white px-4 py-4 sm:px-5"><div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium leading-5 text-slate-500">{label}</span><Icon size={16} className="shrink-0 text-[#6582a5]" aria-hidden="true" /></div><strong className="mt-2 block text-3xl font-semibold leading-9 tabular-nums text-[#244a77]">{value.toLocaleString('pt-BR')}</strong><span className="mt-1 block text-[11px] leading-5 text-slate-500">{caption}</span></div>)}
    </section>
    <section className="grid min-w-0 gap-4" aria-label="Lista de notificações">
      {items.length ? items.map(item => {
        const href = targetPath(item), type = item.resourceType.toUpperCase();
        const permission = type === 'DOCUMENT' ? 'documents.read' : type === 'WORKER' ? 'workers.read' : ['WORK_PERMIT', 'PERMIT'].includes(type) ? 'permits.read' : type === 'APPOINTMENT' ? 'appointments.read' : undefined;
        return <NotificationCard key={item.id} item={item} href={href && permission && can(permission) ? href : undefined} linkState={type === 'DOCUMENT' ? { notificationReturnTo: { unitId, search: location.search } } : undefined} busy={Boolean(savingId)} refreshing={notices.isFetching} saving={savingId === item.id} onMarkRead={() => void markRead(item)} />;
      }) : <EmptyState title="Nenhuma notificação" description="Não há avisos para este filtro e unidade." />}
      <nav aria-label="Paginação de notificações" className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 sm:px-5"><span className="text-[11px] leading-5 text-slate-500">{data.total} {data.total === 1 ? 'notificação' : 'notificações'} · página {page} de {lastPage}</span><div className="flex gap-2"><Button variant="secondary" className="!min-h-11" onClick={() => setPage(page - 1)} disabled={page <= 1 || notices.isFetching || Boolean(savingId)}>Anterior</Button><Button variant="secondary" className="!min-h-11" onClick={() => setPage(page + 1)} disabled={page >= lastPage || notices.isFetching || Boolean(savingId)}>Próxima</Button></div></nav>
    </section></>}
  </div>;
}
