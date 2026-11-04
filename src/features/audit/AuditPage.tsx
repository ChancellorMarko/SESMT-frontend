import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ListChecks, RefreshCw, ScrollText } from 'lucide-react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AuditLogDto, PageDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { isSafePage, ScopedPageError, scopedQueryError } from '../../shared/lib/scoped-page';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { AppliedFilters, type AppliedFilter } from '../../shared/ui/filter-controls';
import { AuditEventList } from './AuditEventList';
import { actionCode, checkedAuditPage, validCivilDate } from './audit-support';

const actionLabels: Record<string, string> = {
  INTEGRATION_EVIDENCE_SUBMITTED: 'Comprovante de integração vinculado', INTEGRATION_EVIDENCE_REVIEWED: 'Conferência do comprovante registrada', WORKER_INTEGRATION_UPDATED: 'Integração administrativa registrada',
  LOGIN: 'Login', CREATE: 'Criação', UPDATE: 'Alteração', DOWNLOAD: 'Download', VIEW: 'Consulta', APPROVE: 'Aprovação', PUBLISH: 'Publicação', ARCHIVE: 'Arquivamento', SIGNATURE: 'Evidência de assinatura',
  DOCUMENT_CREATED: 'Documento cadastrado', CREATED: 'Documento criado', UPDATED: 'Documento alterado', DOCUMENT_VIEWED: 'Documento consultado', ARCHIVED: 'Documento arquivado', VERSION_CREATED: 'Versão criada', PREVIEWED: 'Prévia do documento consultada', REVIEW_SUBMITTED: 'Documento enviado para revisão', REVIEWED: 'Revisão registrada', APPROVED: 'Documento aprovado', PUBLISHED: 'Documento publicado', SIGNATURE_EVIDENCE_ADDED: 'Evidência de assinatura adicionada', SIGNATURE_VERIFIED: 'Evidência de assinatura conferida',
  WORKER_CREATED: 'Trabalhador cadastrado', WORKER_UPDATED: 'Trabalhador alterado', WORKER_MOVED: 'Movimentação do trabalhador', ORGANIZATION_CREATED: 'Cadastro organizacional criado', ORGANIZATION_UPDATED: 'Cadastro organizacional alterado', TYPE_CREATED: 'Tipo documental criado', USER_INVITED: 'Usuário convidado', USER_ACCESS_UPDATED: 'Acesso de usuário alterado',
  AUTHORIZATION_CREATED: 'AT criada', AUTHORIZATION_UPDATED: 'Rascunho da AT alterado', AUTHORIZATION_SCIENCE_COLLECTED: 'Ciência registrada na AT', AUTHORIZATION_AUTHORIZED: 'AT autorizada', AUTHORIZATION_REVALIDATED: 'AT revalidada', AUTHORIZATION_SUSPENDED: 'AT suspensa', AUTHORIZATION_CANCELED: 'AT cancelada', AUTHORIZATION_ADMIN_CANCELED: 'AT cancelada administrativamente', AUTHORIZATION_CLOSED: 'AT encerrada',
  PET_DRAFT_CREATED: 'Rascunho de PET criado', PET_DRAFT_UPDATED: 'Rascunho de PET alterado',
  DESIGNATION_CREATED: 'Designação criada', DESIGNATION_UPDATED: 'Designação alterada', DESIGNATION_REVOKED: 'Designação revogada',
};
const pageSize = 20;
type Denial = { error: unknown; revisions: Record<string, number> };

export function AuditPage() {
  const { sessionKey, unitId, can } = useSession();
  return <AuditPageContent key={JSON.stringify([sessionKey, unitId, can('audit.read')])} />;
}

function AuditPageContent() {
  const { sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const latestSearch = useRef(new URLSearchParams(search));
  const actionSelect = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => { latestSearch.current = new URLSearchParams(search); }, [search]);
  function writeSearch(next: URLSearchParams, replace = false) { latestSearch.current = new URLSearchParams(next); setSearch(next, { replace }); }
  const permitted = can('audit.read');
  const page = Number(search.get('page') ?? 1), invalidPage = !isSafePage(search.get('page'), pageSize);
  const action = search.get('action') ?? '', from = search.get('from') ?? '', to = search.get('to') ?? '';
  const [draft, setDraft] = useState({ action, from, to });
  useEffect(() => { setDraft({ action, from, to }); }, [action, from, to]);
  const hasDraft = draft.action !== action || draft.from !== from || draft.to !== to;
  const unitValues = search.getAll('unitId'), urlUnit = search.get('unitId');
  const repeated = Array.from(search.keys()).some(key => search.getAll(key).length > 1);
  const unsupported = Array.from(search.keys()).some(key => !['action', 'from', 'to', 'page', 'unitId'].includes(key));
  const invalidAction = Boolean(action && !actionCode(action));
  const invalidDates = !validCivilDate(from) || !validCivilDate(to);
  const invalidRange = !invalidDates && Boolean(from && to && from > to);
  const invalidAddress = repeated || unsupported || invalidAction || invalidPage;
  const invalidFilters = invalidAddress || invalidDates || invalidRange;
  const unitMatches = Boolean(unitId && unitValues.length === 1 && urlUnit === unitId);
  const enabled = permitted && unitMatches && !invalidFilters;
  const scope = ['audit', sessionKey, unitId], contextKey = JSON.stringify(scope);
  const queryKey = [...scope, page, action, from, to], denialKey = [...scope, 'access-denial'];

  useEffect(() => {
    if (!permitted || !unitId || unitValues.length > 1 || urlUnit === unitId) return;
    const next = new URLSearchParams(latestSearch.current); next.set('unitId', unitId);
    if (urlUnit !== null) next.delete('page');
    writeSearch(next, true);
  }, [permitted, unitId, urlUnit, unitValues.length, search, setSearch]);

  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const events = useQuery({
    queryKey,
    queryFn: async ({ signal }) => checkedAuditPage(await api.get<unknown>('/audit-logs', { query: { unitId, page, pageSize, action: action || undefined, from: from || undefined, to: to || undefined }, signal }), { page, pageSize, action, from, to }),
    enabled,
  });
  const verified = useMemo<{ data?: PageDto<AuditLogDto>; error?: unknown }>(() => {
    if (events.data === undefined) return {};
    try { return { data: checkedAuditPage(events.data, { page, pageSize, action, from, to }) }; }
    catch (error) { return { error }; }
  }, [events.data, page, action, from, to]);
  const currentError = events.error ?? verified.error;
  const deniedError = [events.error, verified.error].find(error => error instanceof ScopedPageError || error instanceof ApiError && [401, 403, 404].includes(error.status));
  useEffect(() => {
    if (!enabled || !deniedError) return;
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error: deniedError, revisions });
  }, [client, contextKey, enabled, deniedError]);
  const cached = client.getQueryCache().find({ queryKey, exact: true });
  const freshlyVerified = enabled && denial.data && !deniedError && cached?.state.status === 'success' && cached.state.fetchStatus === 'idle'
    && cached.state.dataUpdateCount > (denial.data.revisions[cached.queryHash] ?? 0);
  useEffect(() => { if (freshlyVerified) client.setQueryData(denialKey, null); }, [client, contextKey, freshlyVerified]);
  const failed = events.isError || Boolean(verified.error) || Boolean(denial.data);
  const data = enabled && !failed ? verified.data : undefined;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : page;
  const clamping = Boolean(data && !events.isFetching && page > lastPage);
  useEffect(() => {
    if (!clamping) return;
    const next = new URLSearchParams(latestSearch.current);
    if (next.get('unitId') !== unitId || (next.get('action') || '') !== action || (next.get('from') || '') !== from || (next.get('to') || '') !== to || Number(next.get('page') ?? 1) !== page) return;
    next.set('page', String(lastPage)); writeSearch(next, true);
  }, [clamping, lastPage, search, setSearch]);

  function clear() { setDraft({ action: '', from: '', to: '' }); writeSearch(new URLSearchParams(unitId ? { unitId } : {})); actionSelect.current?.focus(); }
  function changePage(nextPage: number) { const next = new URLSearchParams(latestSearch.current); next.set('page', String(nextPage)); writeSearch(next); }
  function removeFilter(key: string) {
    if (!unitMatches || invalidFilters || events.isFetching) return;
    const next = new URLSearchParams(latestSearch.current); next.delete(key); next.delete('page');
    setDraft({ action: next.get('action') || '', from: next.get('from') || '', to: next.get('to') || '' });
    writeSearch(next); actionSelect.current?.focus();
  }
  async function retry() { if (enabled) await events.refetch(); }
  if (!permitted) return <Feedback tone="warning">Seu acesso não permite consultar auditoria.</Feedback>;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade de trabalho antes de consultar a auditoria." />;
  const hasFilters = Boolean(action || from || to || search.has('page') || invalidFilters);
  const appliedFilters: AppliedFilter[] = [
    ...(action ? [{ key: 'action', label: 'Ação', value: Object.hasOwn(actionLabels, action) ? actionLabels[action] : action }] : []),
    ...(from ? [{ key: 'from', label: 'De', value: formatDate(from) }] : []),
    ...(to ? [{ key: 'to', label: 'Até', value: formatDate(to) }] : []),
  ];

  return <div className="stack">
    <PageHeader eyebrow="RASTREABILIDADE" title="Auditoria" description="Acompanhe as ações registradas na unidade, com horário, autoria e rastreio." actions={<><Badge tone="neutral">Somente leitura</Badge><Button variant="secondary" className="!min-h-11" disabled={!enabled || events.isFetching} onClick={() => void retry()}><RefreshCw size={15} className="shrink-0" aria-hidden="true" />Atualizar</Button></>} />
    <form className="grid min-w-0 gap-4 rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 [&_.field]:min-w-0 [&_select]:w-full" aria-label="Filtros da auditoria" onSubmit={event => {
      event.preventDefault(); if (!unitMatches || invalidAddress || events.isFetching) return;
      const next = new URLSearchParams({ unitId });
      for (const key of ['action', 'from', 'to'] as const) { if (draft[key]) next.set(key, draft[key]); }
      writeSearch(next);
    }}>
      <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0 sm:col-span-2 xl:col-span-1"><Field label="Ação"><select ref={actionSelect} name="action" value={draft.action} onChange={event => setDraft(current => ({ ...current, action: event.target.value }))}><option value="">Todas</option>{draft.action && !Object.hasOwn(actionLabels, draft.action) && <option value={draft.action}>{draft.action}</option>}{Object.entries(actionLabels).map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></Field></div>
        <Field label="De" error={validCivilDate(from) ? undefined : 'A data recebida no endereço é inválida.'}><input name="from" type="date" value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></Field>
        <Field label="Até" error={validCivilDate(to) ? undefined : 'A data recebida no endereço é inválida.'}><input name="to" type="date" value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></Field>
        <Button type="submit" className="!min-h-11 sm:col-span-2 xl:col-span-1" disabled={!unitMatches || invalidAddress || events.isFetching}>Filtrar eventos</Button>
      </div>
      {hasDraft && <p role="status" className="!m-0 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] leading-5 text-[#315884]"><strong className="font-semibold">Alterações ainda não aplicadas à consulta.</strong> Selecione Filtrar eventos para atualizar os resultados.</p>}
      {hasFilters && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        {!invalidFilters && <div inert={events.isFetching} className={events.isFetching ? 'pointer-events-none opacity-60' : ''}><AppliedFilters filters={appliedFilters} onRemove={removeFilter} /></div>}
        <Button variant="ghost"  disabled={events.isFetching} onClick={clear}>Limpar filtros</Button>
      </div>}
      {appliedFilters.length > 0 && !invalidFilters && <p className="!m-0 text-[11px] leading-5 text-slate-500">Remover um filtro retoma os demais critérios aplicados e descarta o preenchimento ainda não enviado.</p>}
    </form>
    {repeated && <Feedback tone="danger">O endereço contém filtros de auditoria repetidos. Limpe os filtros antes de consultar.</Feedback>}
    {!repeated && unsupported && <Feedback tone="danger">O endereço contém filtros incompatíveis com a auditoria. Limpe os filtros para continuar.</Feedback>}
    {!repeated && !unsupported && invalidAction && <Feedback tone="danger">O código da ação deve ter até 100 caracteres seguros, sem espaços ou controles. Limpe os filtros para continuar.</Feedback>}
    {!repeated && !unsupported && !invalidAction && invalidPage && <Feedback tone="danger">O endereço contém uma página de auditoria inválida. <Button variant="ghost" onClick={() => changePage(1)}>Voltar à primeira página</Button></Feedback>}
    {invalidDates && <Feedback tone="danger">Corrija as datas do período ou limpe os filtros para consultar os eventos.</Feedback>}
    {!invalidDates && invalidRange && <Feedback tone="danger">A data final deve ser igual ou posterior à inicial.</Feedback>}
    {!unitMatches && !repeated && <Feedback>Conferindo a unidade da consulta antes de carregar a auditoria.</Feedback>}
    {enabled && !failed && (events.isPending || clamping) && <Spinner />}
    {enabled && failed && <Feedback tone="danger">{scopedQueryError(currentError ?? denial.data?.error, 'auditoria')} <Button variant="ghost" disabled={events.isFetching} onClick={() => void retry()}>Tentar novamente</Button></Feedback>}
    {data && page <= lastPage && <>
    <section role="status" aria-label="Resumo da consulta" aria-live="polite" className="grid min-w-0 grid-cols-2 gap-3">
      {[{ label: 'Na consulta', value: data.total, icon: ScrollText, caption: 'Eventos no filtro aplicado' }, { label: 'Nesta página', value: data.items.length, icon: ListChecks, caption: 'Eventos exibidos abaixo' }].map(({ label, value, icon: Icon, caption }) => <div key={label} className="min-w-0 rounded-2xl border border-slate-200/80 bg-white px-4 py-4 sm:px-5"><div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium leading-5 text-slate-500">{label}</span><Icon size={16} className="shrink-0 text-[#6582a5]" aria-hidden="true" /></div><strong className="mt-2 block text-3xl font-semibold leading-9 tabular-nums text-[#244a77]">{value.toLocaleString('pt-BR')}</strong><span className="mt-1 block text-[11px] leading-5 text-slate-500">{caption}</span></div>)}
    </section>
    <section className="min-w-0 overflow-hidden rounded-3xl border border-slate-200/80 bg-white" aria-label="Eventos de auditoria">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-5 sm:px-5"><h2 className="!m-0 !text-[15px] font-semibold leading-6 text-[#244a77]">Trilha de eventos</h2><span className="text-[11px] leading-5 text-slate-500">Horários de Brasília</span></header>
      <AuditEventList events={data.items} actionLabels={actionLabels} />
      {!data.items.length && <EmptyState title="Nenhum evento encontrado" description="Altere o período ou os filtros para consultar a trilha disponível." />}
      <nav className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-4 sm:px-5" aria-label="Paginação da auditoria"><span className="text-[11px] leading-5 text-slate-500">{data.total} eventos · página {page} de {lastPage} · America/Sao_Paulo</span><div className="flex gap-2"><Button variant="secondary" className="!min-h-11" onClick={() => changePage(page - 1)} disabled={page <= 1 || events.isFetching}>Anterior</Button><Button variant="secondary" className="!min-h-11" onClick={() => changePage(page + 1)} disabled={page >= lastPage || events.isFetching}>Próxima</Button></div></nav>
    </section></>}
    <p className="!m-0 text-[11px] leading-5 text-slate-500">Os horários são exibidos em Brasília. Os identificadores completos permitem localizar o recurso, a autoria e o rastreio de cada evento.</p>
  </div>;
}
