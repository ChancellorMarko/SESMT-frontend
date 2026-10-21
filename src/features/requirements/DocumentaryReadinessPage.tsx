import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, Download, RefreshCw, Search, UsersRound } from 'lucide-react';
import { api, API_MODE, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { formatDate } from '../../shared/lib/format';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { AppliedFilters, type AppliedFilter } from '../../shared/ui/filter-controls';
import { checkedReadiness, filterReadiness, readinessCounts, readinessCriteriaError, readinessCsv, ReadinessResponseError, readinessServiceIds } from './readiness';
import { scopedQueryError } from '../../shared/lib/scoped-page';
import { WorkerIntegrationLink } from '../workers/WorkerIntegrationLink';
import { ReadinessAppointment } from './ReadinessAppointment';

export function DocumentaryReadinessPage() {
  const { unitId, sessionKey, can } = useSession();
  return <ReadinessContent key={JSON.stringify([sessionKey, unitId, can('eligibility.read')])} />;
}

function ReadinessContent() {
  const { unitId, sessionKey, can } = useSession();
  const client = useQueryClient();
  const location = useLocation();
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useSearchParams();
  const latestSearch = useRef(new URLSearchParams(search));
  useLayoutEffect(() => { latestSearch.current = new URLSearchParams(search); }, [search]);
  function writeSearch(next: URLSearchParams) { latestSearch.current = new URLSearchParams(next); setSearch(next, { replace: true }); }
  const criteriaError = readinessCriteriaError(search);
  const urlUnit = search.get('unitId');
  useEffect(() => {
    if (!can('eligibility.read') || !unitId || search.getAll('unitId').length > 1 || urlUnit === unitId) return;
    const next = new URLSearchParams(latestSearch.current);
    // Team and service filters belong to the previous unit and must not be silently reused.
    if (urlUnit && urlUnit !== unitId) { next.delete('teamId'); next.delete('serviceTypeId'); }
    next.set('unitId', unitId); writeSearch(next);
  }, [unitId, urlUnit, search, can, setSearch]);
  const enabled = can('eligibility.read') && Boolean(unitId && urlUnit === unitId) && !criteriaError;
  const queryKey = ['documentary-readiness', sessionKey, unitId];
  const denialKey = [...queryKey, 'access-denial'];
  const denial = useQuery<{ error: unknown; revision: number } | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const readiness = useQuery({ queryKey, queryFn: async ({ signal }) => checkedReadiness(await api.get<unknown>('/documentary-readiness', { query: { unitId }, signal }), unitId!), enabled });
  const responseError = useMemo(() => {
    try { if (readiness.data && unitId) checkedReadiness(readiness.data, unitId); } catch (error) { return error; }
    return undefined;
  }, [readiness.data, unitId]);
  const accessDenied = readiness.error instanceof ApiError && [401, 403, 404].includes(readiness.error.status);
  const deniedError = responseError ?? (readiness.error instanceof ReadinessResponseError || accessDenied ? readiness.error : undefined);
  useEffect(() => {
    if (enabled && deniedError) client.setQueryData(denialKey, { error: deniedError, revision: client.getQueryState(queryKey)?.dataUpdateCount ?? 0 });
  }, [client, sessionKey, unitId, enabled, deniedError]);
  const currentRevision = client.getQueryState(queryKey)?.dataUpdateCount ?? 0;
  const fresh = enabled && denial.data && !deniedError && readiness.isSuccess && !readiness.isFetching && currentRevision > denial.data.revision;
  useEffect(() => { if (fresh) client.setQueryData(denialKey, null); }, [client, sessionKey, unitId, fresh]);
  const failed = readiness.isError || Boolean(responseError || denial.data);
  const filters = { query: search.get('q') || '', teamId: search.get('teamId') || '', serviceTypeId: search.get('serviceTypeId') || '', status: search.get('status') ?? 'pending' };
  const rows = enabled && !failed ? readiness.data?.rows || [] : [];
  const groups = filterReadiness(rows, filters);
  const counts = readinessCounts(groups);
  const teams = [...new Map(rows.map(row => [row.teamId, row.teamName])).entries()];
  const services = [...new Map(rows.flatMap(row => (row.services?.length ? row.services : [{ id: row.serviceTypeId, name: row.serviceLabel }]).map(service => [service.id, service.name] as const))).entries()];
  const teamLabel = teams.find(([id]) => id === filters.teamId)?.[1] ?? 'Equipe indisponível nesta consulta';
  const serviceLabel = services.find(([id]) => id === filters.serviceTypeId)?.[1]
    ?? (rows.some(row => readinessServiceIds(row).includes(filters.serviceTypeId)) ? 'Serviço sem descrição nesta consulta' : 'Serviço indisponível nesta consulta');
  const appliedFilters: AppliedFilter[] = [
    ...(filters.query ? [{ key: 'q', label: 'Busca', value: filters.query }] : []),
    ...(filters.teamId ? [{ key: 'teamId', label: 'Equipe', value: teamLabel }] : []),
    ...(filters.serviceTypeId ? [{ key: 'serviceTypeId', label: 'Serviço', value: serviceLabel }] : []),
    ...(filters.status !== 'all' ? [{ key: 'status', label: 'Situação documental', value: filters.status === 'pending' ? 'Com pendências' : filters.status === 'ready' ? 'Conferida' : 'Situação inválida' }] : []),
  ];
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(latestSearch.current);
    if (value) next.set(key, value); else next.delete(key);
    writeSearch(next);
  }
  function clearFilters() { writeSearch(new URLSearchParams(unitId ? { unitId } : {})); }
  function removeFilter(key: string) { setFilter(key, key === 'status' ? 'all' : ''); searchInput.current?.focus(); }
  function exportCsv() {
    if (!enabled || failed || readiness.isFetching || !groups.length || search.toString() !== latestSearch.current.toString()) return;
    const blob = new Blob([readinessCsv(groups)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `pendencias-documentais${API_MODE === 'demo' ? '-DEMONSTRACAO' : ''}.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!can('eligibility.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à conferência documental." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar as pendências documentais." />;
  return <div className="stack">
    <PageHeader eyebrow="DOCUMENTOS POR PESSOA E SERVIÇO" title="Pendências documentais" description="Organize a conferência dos próximos serviços e dos atendimentos em aberto." actions={<>
      {can('requirements.read') && <Link className="button button--secondary" to="/app/configuracoes/requisitos">Consultar matriz</Link>}
      <Button variant="secondary" onClick={() => void readiness.refetch()} disabled={!enabled || readiness.isFetching}><RefreshCw size={16} aria-hidden="true" /> {readiness.isFetching ? 'Atualizando…' : 'Atualizar pendências'}</Button>
    </>} />
    <Feedback>A situação é documental e considera a função, o local e o período de cada serviço. A execução exige a liberação explícita na PT, com checklist e ciências conferidos.</Feedback>
    <section className="grid min-w-0 gap-4 rounded-3xl border border-slate-200/80 bg-white p-4 sm:p-5 [&_.field]:min-w-0 [&_select]:w-full" aria-label="Filtros de pendências">
      <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <Field label="Buscar pessoa ou atendimento"><div className="relative"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input ref={searchInput} type="search" className="!pl-9" maxLength={2000} placeholder="Nome, código, local ou requisito" value={filters.query} onChange={event => setFilter('q', event.target.value)} /></div></Field>
        <Field label="Equipe"><select value={filters.teamId} onChange={event => setFilter('teamId', event.target.value)}><option value="">Todas as equipes</option>{filters.teamId && !teams.some(([id]) => id === filters.teamId) && <option value={filters.teamId}>{teamLabel}</option>}{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        <Field label="Serviço"><select value={filters.serviceTypeId} onChange={event => setFilter('serviceTypeId', event.target.value)}><option value="">Todos os serviços</option>{filters.serviceTypeId && !services.some(([id]) => id === filters.serviceTypeId) && <option value={filters.serviceTypeId}>{serviceLabel}</option>}{services.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
        <Field label="Situação documental"><select value={filters.status} onChange={event => setFilter('status', event.target.value)}>{!['pending', 'ready', 'all'].includes(filters.status) && <option value={filters.status}>Situação documental inválida</option>}<option value="pending">Com pendências</option><option value="ready">Conferida</option><option value="all">Todas as situações</option></select></Field>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <AppliedFilters filters={appliedFilters} onRemove={removeFilter} />
        <Button variant="ghost"  title="Restaurar a consulta inicial, com pendências" onClick={clearFilters}>Limpar filtros</Button>
      </div>
      <p className="!m-0 text-[11px] leading-5 text-slate-500">A consulta inicial mostra pessoas com pendências. Remova o filtro de situação para consultar todas.</p>
    </section>
    {criteriaError ? <Feedback tone="warning">{criteriaError}</Feedback> : !enabled ? <Feedback>Conferindo a unidade da consulta. Aguarde a atualização dos filtros.</Feedback> : failed ? <Feedback tone="danger">{scopedQueryError(responseError ?? readiness.error ?? denial.data?.error, 'pendências documentais')} <Button variant="ghost" disabled={readiness.isFetching} onClick={() => void readiness.refetch()}>Tentar novamente</Button></Feedback> : readiness.isPending ? <Spinner /> : <>
      <section aria-label="Resumo desta consulta" className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="status" aria-live="polite">
        {[{ label: 'Atendimentos', value: counts.appointments, icon: CalendarDays }, { label: 'Pessoas', value: counts.people, icon: UsersRound }, { label: 'Requisitos pendentes', value: counts.pending, icon: ClipboardList }].map(({ label, value, icon: Icon }, index) => <div key={label} className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${index === 2 ? 'col-span-2 border-amber-100 bg-amber-50/55 sm:col-span-1' : 'border-slate-200/80 bg-white'}`}>
          <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-medium leading-5 text-slate-500">{label}</span><Icon size={16} className={index === 2 ? 'shrink-0 text-amber-600' : 'shrink-0 text-[#6582a5]'} aria-hidden="true" /></div>
          <strong className={`mt-3 block text-3xl font-semibold leading-9 tabular-nums ${index === 2 ? 'text-amber-800' : 'text-[#244a77]'}`}>{value.toLocaleString('pt-BR')}</strong>
          <span className="mt-1 block text-[11px] leading-5 text-slate-500">{index === 1 ? 'Pessoas únicas nesta consulta' : 'Nesta consulta'}</span>
        </div>)}
      </section>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><p className="!m-0 min-w-0 flex-1 basis-64 text-[11px] leading-5 text-slate-500">Cada requisito é contado por pessoa e atendimento. Consulta em {readiness.data && formatDate(readiness.data.generatedAt)}.</p><Button variant="secondary" className="!min-h-11 !max-w-full !whitespace-normal" disabled={!groups.length || readiness.isFetching} onClick={exportCsv}><Download size={16} className="shrink-0" aria-hidden="true" /> Exportar consulta CSV</Button></div>
      {!groups.length ? <EmptyState title="Nenhum atendimento nesta consulta" description="Consulte outras situações ou ajuste os filtros. Somente os atendimentos do seu alcance são exibidos." /> : groups.map(group => <ReadinessAppointment
        key={group.row.appointmentId} group={group}
        canReadAppointments={can('appointments.read')}
        canManageEligibility={can('eligibility.write') || can('eligibility.review')}
        canReadPermits={can('permits.read')}
        appointmentState={{ readinessReturnTo: { unitId, search: location.search } }}
        renderIntegrationLink={person => <WorkerIntegrationLink workerId={person.workerId} workerName={person.name} />}
      />)}
    </>}
  </div>;
}
