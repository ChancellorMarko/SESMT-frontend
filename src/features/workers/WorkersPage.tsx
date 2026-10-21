import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Plus, Search, UsersRound } from 'lucide-react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PageDto, WorkerDto, OrganizationDto } from '../../shared/contracts';
import type { TeamDto } from '../../shared/contracts/work-permits';
import { checkedPage, isRecord, isSafePage, ScopedPageError, scopedQueryError, shortText } from '../../shared/lib/scoped-page';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { AppliedFilters, FilterDisclosure, type AppliedFilter } from '../../shared/ui/filter-controls';
import { workerStatusLabels, integrationStatusLabels, validCivil } from './support';
import { WorkerList } from './WorkerList';
import { workerCriteriaError, workerIdentifier as identifier, workerNavigation } from './worker-navigation';
import styles from './WorkersWorkspace.module.css';

const pageSize = 10;
type Denial = { error: unknown; revisions: Record<string, number> };

function workerItem(value: unknown, unitId: string): value is WorkerDto {
  return isRecord(value) && identifier(value.id) && value.unitId === unitId && identifier(value.companyId) && identifier(value.sectorId)
    && shortText(value.fullName, 500) && Boolean(value.fullName.trim()) && shortText(value.registration, 200)
    && shortText(value.employmentType, 200) && shortText(value.admissionDate, 100) && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
    && typeof value.status === 'string' && Object.hasOwn(workerStatusLabels, value.status)
    && (value.integrationStatus === undefined || typeof value.integrationStatus === 'string' && Object.hasOwn(integrationStatusLabels, value.integrationStatus))
    && (value.integrationValidUntil === undefined || shortText(value.integrationValidUntil, 100) && (!value.integrationValidUntil || validCivil(value.integrationValidUntil)));
}
function organizationResponse(value: unknown): OrganizationDto {
  if (!isRecord(value) || ['companies', 'establishments', 'units', 'sectors', 'jobs', 'jobFunctions', 'workCenters'].some(key => {
    const rows = value[key]; return !Array.isArray(rows) || rows.some(item => !isRecord(item) || !identifier(item.id) || !shortText(item.name, 500)) || new Set(rows.map(item => item.id)).size !== rows.length;
  })) throw new ScopedPageError();
  return value as unknown as OrganizationDto;
}
function teamsResponse(value: unknown, unitId: string): TeamDto[] {
  if (!Array.isArray(value) || value.some(item => !isRecord(item) || !identifier(item.id) || !shortText(item.name, 500) || item.unitId !== unitId || !identifier(item.companyId) || item.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(item.status as string))
    || new Set(value.map(item => item.id)).size !== value.length) throw new ScopedPageError();
  return value as TeamDto[];
}

/** A cached page cannot restore identifiers after the service denies this resource. */
function useScopedRead<T>({ queryKey, enabled, request, validate }: { queryKey: QueryKey; enabled: boolean; request: (signal: AbortSignal) => Promise<unknown>; validate: (value: unknown) => T }) {
  const client = useQueryClient(), scope = queryKey.slice(0, 3), contextKey = JSON.stringify(queryKey), denialKey = [...scope, 'workers-list-denial'];
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const query = useQuery({ queryKey, queryFn: async ({ signal }) => validate(await request(signal)), enabled });
  const verified = useMemo<{ data?: T; error?: unknown }>(() => {
    if (query.data === undefined) return {};
    try { return { data: validate(query.data) }; } catch (error) { return { error }; }
  }, [query.data, contextKey]);
  const deniedError = [query.error, verified.error].find(error => error instanceof ScopedPageError || error instanceof ApiError && [401, 403, 404].includes(error.status));
  useEffect(() => {
    if (!enabled || !deniedError) return;
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error: deniedError, revisions });
  }, [client, contextKey, enabled, deniedError]);
  const current = client.getQueryCache().find({ queryKey, exact: true });
  const fresh = enabled && denial.data && !deniedError && current?.state.status === 'success' && current.state.fetchStatus === 'idle'
    && current.state.dataUpdateCount > (denial.data.revisions[current.queryHash] ?? 0);
  useEffect(() => { if (fresh) client.setQueryData(denialKey, null); }, [client, contextKey, fresh]);
  const failed = enabled && (query.isError || Boolean(verified.error) || Boolean(denial.data));
  return { ...query, data: enabled && !failed ? verified.data : undefined, failed, error: query.error ?? verified.error ?? denial.data?.error,
    retry: async () => { if (!enabled) return; const result = await query.refetch(); if (result.isSuccess) client.setQueryData(denialKey, null); } };
}

export function WorkersPage() {
  const { unitId, sessionKey, can } = useSession();
  return <WorkersPageContent key={JSON.stringify([sessionKey, unitId, can('workers.read'), can('workers.write'), can('organization.read'), can('teams.read')])} />;
}
function WorkersPageContent() {
  const { unitId, sessionKey, can } = useSession();
  const allowed = can('workers.read');
  const location = useLocation();
  const restored = workerNavigation(location.state, sessionKey, unitId)?.workerListReturnTo;
  const restore = restored?.search === location.search ? restored : undefined;
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(new URLSearchParams(params));
  useLayoutEffect(() => { latestParams.current = new URLSearchParams(params); }, [params]);
  function writeParams(next: URLSearchParams, replace = false) { latestParams.current = new URLSearchParams(next); setParams(next, { replace }); }
  const q = params.get('q') || '', status = params.get('status') || '', companyId = params.get('companyId') || '', teamId = params.get('teamId') || '', integrationStatus = params.get('integrationStatus') || '';
  const [search, setSearch] = useState(restore?.draftSearch ?? q);
  const [advancedOpen, setAdvancedOpen] = useState(restore?.advancedOpen ?? Boolean(companyId || teamId));
  const previousQuery = useRef(q);
  useEffect(() => { if (previousQuery.current !== q) { previousQuery.current = q; setSearch(q); } }, [q]);
  const page = Number(params.get('page') ?? 1), filterError = workerCriteriaError(params), urlUnit = params.get('unitId');
  useEffect(() => {
    if (!allowed || !unitId || latestParams.current.getAll('unitId').length > 1) return;
    const previousUnit = latestParams.current.get('unitId'); if (previousUnit === unitId) return;
    const next = new URLSearchParams(latestParams.current); next.set('unitId', unitId); if (previousUnit !== null) next.delete('page'); writeParams(next, true);
  }, [allowed, unitId, urlUnit, params, setParams]);
  const unitMatches = Boolean(unitId && urlUnit === unitId && params.getAll('unitId').length === 1), enabled = allowed && unitMatches && !filterError;
  const workers = useScopedRead<PageDto<WorkerDto>>({
    queryKey: ['workers', sessionKey, unitId, q, status, companyId, teamId, integrationStatus, page], enabled,
    request: signal => api.get<unknown>('/workers', { signal, query: { q: q || undefined, status: status || undefined, companyId: companyId || undefined, teamId: teamId || undefined, integrationStatus: integrationStatus || undefined, unitId, page, pageSize } }),
    validate: value => checkedPage(value, { page, pageSize }, (item): item is WorkerDto => workerItem(item, unitId!)),
  });
  const organization = useScopedRead<OrganizationDto>({ queryKey: ['organization', sessionKey, unitId], enabled: enabled && can('organization.read'), request: signal => api.get<unknown>('/organization', { signal, query: { unitId } }), validate: organizationResponse });
  const teams = useScopedRead<TeamDto[]>({ queryKey: ['teams', sessionKey, unitId], enabled: enabled && can('teams.read'), request: signal => api.get<unknown>('/teams', { signal, query: { unitId } }), validate: value => teamsResponse(value, unitId!) });
  function change(key: string, value: string) {
    if (!unitMatches || filterError) return;
    const next = new URLSearchParams(latestParams.current); if (value) next.set(key, value); else next.delete(key); next.delete('page'); writeParams(next);
  }
  function setPage(value: number) { const next = new URLSearchParams(latestParams.current); if (value === 1) next.delete('page'); else next.set('page', String(value)); writeParams(next); }
  function clear() { setSearch(''); writeParams(new URLSearchParams({ unitId: unitId! })); }
  if (!allowed) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso ao cadastro de trabalhadores." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade para consultar seus trabalhadores." />;
  const organizationData = workers.failed ? undefined : organization.data, teamData = workers.failed ? undefined : teams.data;
  const companyName = (id: string) => organizationData?.companies.find(item => item.id === id)?.name || 'Empresa';
  const unitName = (id: string) => organizationData?.units.find(item => item.id === id)?.name || 'Unidade vinculada';
  const sectorName = (id: string) => organizationData?.sectors.find(item => item.id === id)?.name || 'Setor vinculado';
  const hasFilters = Boolean(q || status || companyId || teamId || integrationStatus || params.has('page') || filterError);
  const disabledFilters = !unitMatches || Boolean(filterError);
  const appliedFilters: AppliedFilter[] = [
    { key: 'q', label: 'Busca', value: q },
    { key: 'status', label: 'Situação cadastral', value: status && (workerStatusLabels[status] || 'Situação inválida') },
    { key: 'integrationStatus', label: 'Integração', value: integrationStatus && (integrationStatusLabels[integrationStatus] || 'Integração inválida') },
    { key: 'companyId', label: 'Empresa', value: companyId && (organizationData?.companies.find(item => item.id === companyId)?.name || 'Identificação indisponível') },
    { key: 'teamId', label: 'Equipe', value: teamId && (teamData?.find(item => item.id === teamId)?.name || 'Identificação indisponível') },
  ].filter(item => Boolean(item.value));
  const hasDraft = search.trim() !== q;
  const origin = enabled ? workerNavigation({ workerListReturnTo: { unitId, sessionKey, search: location.search, draftSearch: search, advancedOpen } }, sessionKey, unitId) : undefined;
  return <div className={styles.workspace}>
    <PageHeader eyebrow="Pessoas e vínculos" title="Trabalhadores" description="Encontre cadastros, situação de integração, equipes operacionais e documentos permitidos." actions={can('workers.write') && <Link className="button button--primary" to="/app/trabalhadores/novo" state={origin}><Plus size={16} aria-hidden="true" />Novo trabalhador</Link>} />
    <section className={`panel ${styles.filters}`} aria-label="Pesquisa de trabalhadores">
      <form className={styles.filters} aria-label="Filtros de trabalhadores" onSubmit={event => { event.preventDefault(); change('q', search.trim()); }}>
        <div className={styles.primaryFilters}>
        <Field label="Buscar nome ou matrícula"><div className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder="Digite um nome ou matrícula" aria-describedby={hasDraft ? 'worker-search-draft' : undefined} /></div></Field>
        <Field label="Integração administrativa"><select value={integrationStatus} disabled={disabledFilters} onChange={event => change('integrationStatus', event.target.value)}><option value="">Todas as integrações</option>{integrationStatus && !Object.hasOwn(integrationStatusLabels, integrationStatus) && <option value={integrationStatus}>Integração inválida</option>}{Object.entries(integrationStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="Situação cadastral"><select value={status} disabled={disabledFilters} onChange={event => change('status', event.target.value)}><option value="">Todas as situações</option>{status && !Object.hasOwn(workerStatusLabels, status) && <option value={status}>Situação inválida</option>}{Object.entries(workerStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        </div>
        <div className="actions"><Button type="submit" disabled={disabledFilters}><Search size={14} aria-hidden="true" />Pesquisar</Button>{(hasFilters || hasDraft) && <Button variant="ghost" onClick={clear}>Limpar filtros</Button>}{hasDraft && <span id="worker-search-draft" className={styles.draft} role="status">Busca digitada ainda não aplicada. Selecione Pesquisar.</span>}</div>
        {(Boolean(organizationData && organizationData.companies.length > 1) || Boolean(companyId) || Boolean(teamData?.length) || Boolean(teamId)) && <FilterDisclosure open={advancedOpen} onOpenChange={setAdvancedOpen} label="Empresa e equipe" count={Number(Boolean(companyId)) + Number(Boolean(teamId))}>
        <div className={styles.secondaryFilters}>
        {(Boolean(organizationData && organizationData.companies.length > 1) || companyId) && <Field label="Empresa"><select value={companyId} disabled={disabledFilters} onChange={event => change('companyId', event.target.value)}><option value="">Todas as empresas</option>{companyId && !organizationData?.companies.some(item => item.id === companyId) && <option value={companyId}>Empresa selecionada; identificação indisponível: {companyId}</option>}{organizationData?.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        {(Boolean(teamData?.length) || teamId) && <Field label="Equipe operacional"><select value={teamId} disabled={disabledFilters} onChange={event => change('teamId', event.target.value)}><option value="">Todas as equipes</option>{teamId && !teamData?.some(item => item.id === teamId) && <option value={teamId}>Equipe selecionada; identificação indisponível: {teamId}</option>}{teamData?.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === 'INACTIVE' ? ' (Inativa)' : ''}</option>)}</select></Field>}
        </div></FilterDisclosure>}
        {!filterError && <AppliedFilters filters={appliedFilters} onRemove={key => change(key, '')} />}
      </form>
      {filterError && <Feedback tone="warning">{filterError} {!isSafePage(params.get('page'), pageSize) && <Button variant="ghost" onClick={() => setPage(1)}>Voltar à primeira página</Button>}</Feedback>}
      {!filterError && !unitMatches && <Feedback>Conferindo a unidade da consulta antes de carregar os trabalhadores.</Feedback>}
      {enabled && organization.failed && <Feedback tone="danger">{scopedQueryError(organization.error, 'dados organizacionais')} <Button variant="ghost" disabled={organization.isFetching} onClick={() => void organization.retry()}>Tentar carregar organização novamente</Button></Feedback>}
      {enabled && teams.failed && <Feedback tone="danger">{scopedQueryError(teams.error, 'equipes')} <Button variant="ghost" disabled={teams.isFetching} onClick={() => void teams.retry()}>Tentar carregar equipes novamente</Button></Feedback>}
    </section>
      {enabled && workers.isPending && !workers.failed && <Spinner />}
      {enabled && workers.failed && <Feedback tone="danger">{scopedQueryError(workers.error, 'trabalhadores')} <Button variant="ghost" disabled={workers.isFetching} onClick={() => void workers.retry()}>Tentar novamente</Button></Feedback>}
      {workers.data && <section className={styles.results} aria-label="Resultados de trabalhadores" aria-busy={workers.isFetching}>
        <div className={styles.resultsHeader}><h2><UsersRound size={17} aria-hidden="true" />Pessoas da unidade</h2><p role="status">{workers.isFetching ? 'Atualizando lista…' : `${new Intl.NumberFormat('pt-BR').format(workers.data.total)} trabalhador(es) encontrado(s)`}</p></div>
        {workers.data.items.length ? <>
          <WorkerList workers={workers.data.items} companyName={companyName} unitName={unitName} sectorName={sectorName} origin={origin} />
          <nav className={styles.pagination} aria-label="Paginação de trabalhadores"><p>{workers.data.total} registro(s) · Página {page} de {Math.max(1, Math.ceil(workers.data.total / pageSize))}</p><div className="actions"><Button variant="secondary" disabled={page <= 1 || workers.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page * pageSize >= workers.data.total || workers.isFetching} onClick={() => setPage(page + 1)}>Próxima</Button></div></nav>
        </> : <><EmptyState title={page > 1 ? 'Esta página não possui resultados' : hasFilters ? 'Nenhum resultado para estes filtros' : 'Nenhum trabalhador cadastrado'} description={page > 1 ? 'Volte à primeira página para consultar os trabalhadores com os filtros atuais.' : hasFilters ? 'Revise a busca ou limpe os filtros para consultar outros registros.' : 'Cadastre o primeiro vínculo para organizar os documentos da equipe.'} />{page > 1 ? <div className={styles.emptyAction}><Button variant="secondary" onClick={() => setPage(1)}>Voltar à primeira página</Button></div> : !hasFilters && can('workers.write') && <div className={styles.emptyAction}><Link className="button button--primary" to="/app/trabalhadores/novo" state={origin}><Plus size={16} aria-hidden="true" />Cadastrar primeiro trabalhador</Link></div>}</>}
      </section>}
      <p className={styles.notice}>A integração exibida é administrativa. A liberação do trabalho depende da conferência dos requisitos e da autorização operacional.</p>
  </div>;
}
