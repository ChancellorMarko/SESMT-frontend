import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { CalendarClock, ArrowUpRight, FileText, RefreshCw, Search } from 'lucide-react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, PageDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { AppliedFilters, type AppliedFilter } from '../../shared/ui/filter-controls';
import { dateOnly, formatDate } from '../../shared/lib/format';
import { checkedPage, isRecord, isSafePage, ScopedPageError, scopedQueryError, shortText } from '../../shared/lib/scoped-page';
import { isCivilDate } from './validation';
import { expiryCriteriaError, expiryQuery, expiryWindow, expiryWindows } from './expiry';
import { ExpirationList } from './ExpirationList';
import styles from './Expirations.module.css';

const pageSize = 10;
type Denial = { error: unknown; revisions: Record<string, number> };
function expirationItem(value: unknown, unitId: string, filters: ReturnType<typeof expiryQuery>): value is DocumentDto {
  return isRecord(value) && value.unitId === unitId && value.status === filters.status
    && shortText(value.title, 1000) && Boolean(value.title.trim()) && shortText(value.code, 200)
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
    && (value.validUntil === undefined || shortText(value.validUntil, 100) && isCivilDate(value.validUntil))
    && (filters.status !== 'ACTIVE' || typeof value.validUntil === 'string' && 'validUntilFrom' in filters && 'validUntilTo' in filters && value.validUntil >= filters.validUntilFrom! && value.validUntil <= filters.validUntilTo!);
}
export function ExpirationsPage() {
  const { unitId, sessionKey, can } = useSession();
  return <ExpirationsContextPage key={JSON.stringify([sessionKey, unitId, can('documents.read')])} />;
}
function ExpirationsContextPage() {
  const { unitId, sessionKey, can } = useSession(), client = useQueryClient();
  const allowed = can('documents.read');
  const location = useLocation();
  const searchInput = useRef<HTMLInputElement>(null);
  const [params, setParams] = useAppQueryParams();
  const latestParams = useRef(new URLSearchParams(params));
  useLayoutEffect(() => { latestParams.current = new URLSearchParams(params); }, [params]);
  function write(next: URLSearchParams, replace = false, flushSync = false) { latestParams.current = new URLSearchParams(next); setParams(next, { replace, flushSync }); }
  const q = params.get('q') ?? '', previousUnit = params.get('unitId');
  const [search, setSearch] = useState(q), [today, setToday] = useState(() => dateOnly());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const update = () => setToday(dateOnly());
    const timer = window.setInterval(update, 60000); window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  // Window, page and civil-day changes must not discard text that has not been searched yet.
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    if (!allowed || !unitId || latestParams.current.getAll('unitId').length > 1) return;
    const oldUnit = latestParams.current.get('unitId'); if (oldUnit === unitId) return;
    const next = new URLSearchParams(latestParams.current); next.set('unitId', unitId); if (oldUnit !== null) next.delete('page'); write(next, true);
  }, [allowed, unitId, previousUnit, params, setParams]);
  const expired = params.get('view') === 'expired', days = expiryWindow(params.get('days'));
  const page = Number(params.get('page') ?? 1), filterError = expiryCriteriaError(params);
  const filters = useMemo(() => expiryQuery(params, today), [params, today]);
  const unitMatches = Boolean(unitId && previousUnit === unitId && params.getAll('unitId').length === 1);
  const enabled = allowed && unitMatches && !filterError;
  const scope = ['documents', 'expirations', sessionKey, unitId], contextKey = JSON.stringify(scope);
  const queryKey = [...scope, page, filters], denialKey = [...scope, 'access-denial'];
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const list = useQuery({ queryKey, queryFn: async ({ signal }) => checkedPage(await api.get<unknown>('/documents', { signal, query: { unitId, page, pageSize, ...filters } }), { page, pageSize }, (item): item is DocumentDto => expirationItem(item, unitId!, filters)), enabled });
  const verified = useMemo<{ data?: PageDto<DocumentDto>; error?: unknown }>(() => {
    if (list.data === undefined) return {};
    try { return { data: checkedPage(list.data, { page, pageSize }, (item): item is DocumentDto => expirationItem(item, unitId!, filters)) }; } catch (error) { return { error }; }
  }, [list.data, page, unitId, filters]);
  const deniedError = [list.error, verified.error].find(error => error instanceof ScopedPageError || error instanceof ApiError && [401, 403, 404].includes(error.status));
  useEffect(() => {
    if (!enabled || !deniedError) return;
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error: deniedError, revisions });
  }, [client, contextKey, enabled, deniedError]);
  const cached = client.getQueryCache().find({ queryKey, exact: true });
  const fresh = enabled && denial.data && !deniedError && cached?.state.status === 'success' && cached.state.fetchStatus === 'idle'
    && cached.state.dataUpdateCount > (denial.data.revisions[cached.queryHash] ?? 0);
  useEffect(() => { if (fresh) client.setQueryData(denialKey, null); }, [client, contextKey, fresh]);
  const failed = enabled && (list.isError || Boolean(verified.error) || Boolean(denial.data));
  const data = enabled && !failed ? verified.data : undefined;
  function change(key: string, value: string) {
    if (!unitMatches || filterError) return;
    const next = new URLSearchParams(latestParams.current); next.delete('page'); if (value) next.set(key, value); else next.delete(key); write(next, false, true);
  }
  function setPage(value: number) { const next = new URLSearchParams(latestParams.current); next.set('page', String(value)); write(next, false, true); }
  function clear() { setSearch(''); write(new URLSearchParams({ unitId: unitId! }), false, true); }
  function removeFilter(key: string) {
    if (key === 'q') setSearch('');
    change(key, ''); searchInput.current?.focus();
  }
  async function retry() {
    if (!enabled) return;
    const previous = client.getQueryState(queryKey)?.dataUpdateCount ?? 0, result = await list.refetch();
    if (active.current && result.isSuccess && (client.getQueryState(queryKey)?.dataUpdateCount ?? 0) > previous) client.setQueryData(denialKey, null);
  }
  function refresh() { if (!enabled) return; const current = dateOnly(); if (current !== today) setToday(current); else void retry(); }
  const documentsLink = `/app/documentos?${new URLSearchParams({ ...filters, ...(unitId ? { unitId } : {}) })}`;
  if (!allowed) return <Feedback tone="warning">Seu perfil não possui acesso à consulta documental.</Feedback>;
  if (!unitId) return <Feedback tone="warning">Selecione uma unidade para consultar os vencimentos.</Feedback>;
  const disabled = !unitMatches || Boolean(filterError);
  const pendingSearch = search.trim() !== q.trim();
  const resultCount = data ? `${data.total.toLocaleString('pt-BR')} ${data.total === 1 ? 'documento' : 'documentos'}` : '';
  const appliedFilters: AppliedFilter[] = [
    ...(q ? [{ key: 'q', label: 'Busca', value: q }] : []),
    ...(params.has('view') ? [{ key: 'view', label: 'Consulta', value: expired ? 'Vencidos' : 'A vencer' }] : []),
    ...(!expired && params.has('days') ? [{ key: 'days', label: 'Antecedência', value: `Próximos ${days} dias` }] : []),
  ];
  return <div className={`stack ${styles.workspace}`}>
    <header className={styles.pageHeader}>
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}><span aria-hidden="true"><CalendarClock size={15} /></span>Planejamento documental</p>
        <h1>Vencimentos</h1>
        <p className={styles.description}>Antecipe renovações e acompanhe documentos vencidos da unidade selecionada.</p>
      </div>
      {enabled && !failed && <Link className="button button--secondary" to={documentsLink}>Abrir no repositório <ArrowUpRight size={16} aria-hidden="true" /></Link>}
    </header>
    <section className={styles.filterPanel} aria-label="Consulta de vencimentos">
      <div className={`${styles.filterGrid} ${expired ? styles.expiredGrid : ''}`}>
        <Field label="Consultar"><select value={expired ? 'expired' : 'upcoming'} disabled={disabled} onChange={event => change('view', event.target.value)}><option value="upcoming">A vencer</option><option value="expired">Vencidos</option></select></Field>
        {!expired && <Field label="Antecedência"><select value={days} disabled={disabled} onChange={event => change('days', event.target.value)}>{expiryWindows.map(value => <option key={value} value={value}>Próximos {value} dias</option>)}</select></Field>}
        <form className={styles.searchForm} onSubmit={event => { event.preventDefault(); change('q', search.trim()); }}><Field label="Buscar por título ou código"><div className="relative"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input ref={searchInput} type="search" className="!pl-9" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder="Ex.: PGR, relatório, DOC-001" aria-describedby={pendingSearch ? 'expiration-search-hint' : undefined} /></div></Field><Button type="submit" disabled={disabled}>Buscar</Button></form>
      </div>
      {pendingSearch && <p id="expiration-search-hint" role="status" className={styles.searchHint}><strong>Busca ainda não aplicada.</strong> Selecione Buscar para atualizar os resultados.</p>}
      {(!disabled && appliedFilters.length > 0 || q || params.has('view') || params.has('days') || params.has('page') || filterError) && <div className={styles.appliedFilters}>
        {!disabled && <AppliedFilters filters={appliedFilters} onRemove={removeFilter} />}
        <Button variant="ghost"  onClick={clear}>Limpar filtros</Button>
      </div>}
    </section>
    {filterError && <Feedback tone="warning">{filterError} {!isSafePage(params.get('page'), pageSize) && <Button variant="ghost" onClick={() => setPage(1)}>Voltar à primeira página</Button>}</Feedback>}
    {!filterError && !unitMatches && <Feedback>Conferindo a unidade da consulta antes de carregar os vencimentos.</Feedback>}
    {enabled && <section aria-label="Período da consulta" className={`${styles.period} ${expired ? styles.expiredPeriod : ''}`}><span className={styles.periodIcon} aria-hidden="true"><CalendarClock size={20} /></span><div className={styles.periodCopy}><strong>{expired ? 'Documentos com situação vencida' : `Vencimentos de ${formatDate(today)} a ${formatDate('validUntilTo' in filters ? filters.validUntilTo : undefined)}`}</strong><p>{expired ? 'A situação exibida é a informada pelo serviço documental.' : 'A consulta reúne documentos vigentes com uma data de vencimento no período.'}</p></div><Button variant="secondary" disabled={list.isFetching} onClick={refresh}><RefreshCw size={15} aria-hidden="true" className={list.isFetching ? styles.refreshing : undefined} />Atualizar</Button></section>}
    {enabled && list.isPending && !failed && <Spinner />}
    {failed && <div className="panel stack"><Feedback tone="danger">{scopedQueryError(list.error ?? verified.error ?? denial.data?.error, 'vencimentos')}</Feedback><Button variant="secondary" disabled={list.isFetching} onClick={() => void retry()}>Tentar novamente</Button></div>}
    {data && <section className={styles.results} aria-label="Resultado da consulta" aria-busy={list.isFetching}>
      <header className={styles.resultsHeading}><div className={styles.resultsTitle}><span className={styles.resultsIcon} aria-hidden="true"><FileText size={17} /></span><div><h2>{expired ? 'Documentos vencidos' : 'Documentos a vencer'}</h2><p>{data.items.length ? data.total === 1 ? 'Exibindo 1 documento' : `Exibindo ${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + data.items.length} de ${resultCount}` : 'Nenhum documento nesta página'}</p></div></div><Badge tone={expired ? 'danger' : 'warning'}>{resultCount}</Badge></header>
      {!data.items.length ? <EmptyState title={page > 1 ? 'Esta página não possui documentos' : 'Nenhum vencimento encontrado'} description={page > 1 ? 'Volte à primeira página para consultar o resultado atualizado.' : 'Altere o período ou a busca para consultar outros documentos.'} /> : <ExpirationList documents={data.items} today={today} documentState={{ expirationReturnTo: { unitId, search: location.search } }} />}
      <nav className={`pagination ${styles.pagination}`} aria-label="Paginação de vencimentos"><span>Página {page} de {Math.max(1, Math.ceil(data.total / pageSize))}</span><div className="actions">{page > 1 && !data.items.length && <Button variant="secondary" disabled={list.isFetching} onClick={() => setPage(1)}>Primeira página</Button>}<Button variant="secondary" disabled={page <= 1 || list.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page * pageSize >= data.total || list.isFetching} onClick={() => setPage(page + 1)}>Próxima</Button></div></nav>
    </section>}
  </div>;
}
