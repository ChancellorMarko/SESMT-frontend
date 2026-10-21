import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ArrowUpRight, ClipboardCheck, RefreshCw, Search } from 'lucide-react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { PageDto } from '../../shared/contracts';
import type { FinalReviewStatus, OperationStatus, WorkPermitDto } from '../../shared/contracts/work-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner, type Tone } from '../../shared/ui';
import { AppliedFilters, type AppliedFilter } from '../../shared/ui/filter-controls';
import { formatDate } from '../../shared/lib/format';
import { checkedPage, isRecord, isSafePage, ScopedPageError, scopedQueryError, shortText } from '../../shared/lib/scoped-page';
import { operationLabels, reviewLabels } from './PermitStatus';
import styles from './permits.module.css';

const pageSize = 10;
const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value) && !/[\u0000-\u0020\u007f/?#\\]/.test(value);
const positiveInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const validDate = (value: unknown) => shortText(value, 100) && Number.isFinite(Date.parse(value));
const normalizedSearch = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const operationTones: Record<OperationStatus, Tone> = { VERIFICATION: 'neutral', RELEASED: 'success', EXECUTING: 'info', SUSPENDED: 'warning', COMPLETED: 'neutral', CANCELED: 'danger' };
const reviewTones: Record<FinalReviewStatus, Tone> = { NOT_SUBMITTED: 'neutral', PENDING_REVIEW: 'warning', RETURNED: 'danger', VALIDATED: 'success' };
type Denial = { error: unknown; revisions: Record<string, number> };

/** Only the list fields are inspected here; this does not validate execution or authorization. */
function permitCard(value: unknown, unitId: string | undefined, operationStatus: string, reviewStatus: string, teamId: string, query: string): value is WorkPermitDto {
  if (!isRecord(value) || !identifier(value.id) || !shortText(value.code, 200) || !value.code.trim()
    || !positiveInteger(value.version) || !positiveInteger(value.revision)
    || typeof value.operationStatus !== 'string' || !Object.hasOwn(operationLabels, value.operationStatus)
    || typeof value.reviewStatus !== 'string' || !Object.hasOwn(reviewLabels, value.reviewStatus)
    || operationStatus && value.operationStatus !== operationStatus || reviewStatus && value.reviewStatus !== reviewStatus
    || !isRecord(value.appointment)) return false;
  const appointment = value.appointment;
  if (!identifier(appointment.id) || appointment.unitId !== unitId || !identifier(appointment.teamId)
    || teamId && appointment.teamId !== teamId || !shortText(appointment.serviceLabel) || !shortText(appointment.teamName)
    || !shortText(appointment.location) || !shortText(appointment.responsibleName) || !validDate(appointment.startsAt)
    || !Array.isArray(appointment.participants) || !Array.isArray(value.sciences)) return false;
  if (normalizedSearch(query) && !normalizedSearch(`${value.code} ${appointment.teamName} ${appointment.location} ${appointment.serviceLabel}`).includes(normalizedSearch(query))) return false;
  const participants = new Set<string>();
  for (const participant of appointment.participants) {
    if (!isRecord(participant) || !identifier(participant.workerId) || participants.has(participant.workerId)) return false;
    participants.add(participant.workerId);
  }
  const currentSciences = new Set<string>();
  for (const science of value.sciences) {
    if (!isRecord(science) || !identifier(science.workerId) || !positiveInteger(science.version)) return false;
    if (science.version === value.version) {
      if (!participants.has(science.workerId) || currentSciences.has(science.workerId)) return false;
      currentSciences.add(science.workerId);
    }
  }
  return true;
}

export function PermitsPage() {
  const { sessionKey, unitId, can } = useSession();
  return <PermitsPageContent key={JSON.stringify([sessionKey, unitId, can('permits.read')])} />;
}

function PermitsPageContent() {
  const { sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(new URLSearchParams(params));
  useLayoutEffect(() => { latestParams.current = new URLSearchParams(params); }, [params]);
  function writeParams(next: URLSearchParams, replace = false) { latestParams.current = new URLSearchParams(next); setParams(next, { replace }); }
  const permitted = can('permits.read');
  const q = params.get('q') ?? '', operationStatus = params.get('operationStatus') ?? '', reviewStatus = params.get('reviewStatus') ?? '', teamId = params.get('teamId') ?? '';
  const page = Number(params.get('page') ?? 1), invalidPage = !isSafePage(params.get('page'), pageSize);
  const repeated = Array.from(params.keys()).some(key => params.getAll(key).length > 1);
  const unsupported = Array.from(params.keys()).some(key => !['q', 'operationStatus', 'reviewStatus', 'teamId', 'page', 'unitId'].includes(key));
  const invalidCriteria = q.length > 200 || /[\u0000-\u001f\u007f]/.test(q)
    || Boolean(operationStatus && !Object.hasOwn(operationLabels, operationStatus))
    || Boolean(reviewStatus && !Object.hasOwn(reviewLabels, reviewStatus)) || Boolean(teamId && !identifier(teamId));
  const invalidFilters = repeated || unsupported || invalidCriteria || invalidPage;
  const unitValues = params.getAll('unitId'), urlUnit = params.get('unitId');
  const unitMatches = Boolean(unitId && unitValues.length === 1 && urlUnit === unitId);
  const enabled = permitted && unitMatches && !invalidFilters;
  const [search, setSearch] = useState(q);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    if (!permitted || !unitId || unitValues.length > 1 || urlUnit === unitId) return;
    const next = new URLSearchParams(latestParams.current); next.set('unitId', unitId);
    if (urlUnit !== null) { next.delete('page'); next.delete('teamId'); }
    writeParams(next, true);
  }, [permitted, unitId, unitValues.length, urlUnit, params, setParams]);

  const scope = ['work-permits', sessionKey, unitId], contextKey = JSON.stringify(scope);
  const queryKey = [...scope, page, q, operationStatus, reviewStatus, teamId], denialKey = [...scope, 'access-denial'];
  const denial = useQuery<Denial | null>({ queryKey: denialKey, queryFn: async () => null, enabled: false, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const permits = useQuery({
    queryKey,
    queryFn: async ({ signal }) => checkedPage<WorkPermitDto>(await api.get<unknown>('/work-permits', { signal, query: {
      unitId, page, pageSize, q: q || undefined, operationStatus: operationStatus || undefined, reviewStatus: reviewStatus || undefined, teamId: teamId || undefined,
    } }), { page, pageSize }, value => permitCard(value, unitId, operationStatus, reviewStatus, teamId, q)),
    enabled,
  });
  const verified = useMemo<{ data?: PageDto<WorkPermitDto>; error?: unknown }>(() => {
    if (permits.data === undefined) return {};
    try { return { data: checkedPage<WorkPermitDto>(permits.data, { page, pageSize }, value => permitCard(value, unitId, operationStatus, reviewStatus, teamId, q)) }; }
    catch (error) { return { error }; }
  }, [permits.data, page, unitId, operationStatus, reviewStatus, teamId, q]);
  const deniedError = [permits.error, verified.error].find(error => error instanceof ScopedPageError || error instanceof ApiError && [401, 403, 404].includes(error.status));
  useEffect(() => {
    if (!enabled || !deniedError) return;
    const revisions = Object.fromEntries(client.getQueryCache().findAll({ queryKey: scope }).map(entry => [entry.queryHash, entry.state.dataUpdateCount]));
    client.setQueryData(denialKey, { error: deniedError, revisions });
  }, [client, contextKey, enabled, deniedError]);
  const cached = client.getQueryCache().find({ queryKey, exact: true });
  const freshlyVerified = enabled && denial.data && !deniedError && cached?.state.status === 'success' && cached.state.fetchStatus === 'idle'
    && cached.state.dataUpdateCount > (denial.data.revisions[cached.queryHash] ?? 0);
  useEffect(() => { if (freshlyVerified) client.setQueryData(denialKey, null); }, [client, contextKey, freshlyVerified]);
  const failed = permits.isError || Boolean(verified.error) || Boolean(denial.data);
  const data = enabled && !failed ? verified.data : undefined;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : page;
  const clamping = Boolean(data && !permits.isFetching && page > lastPage);
  useEffect(() => {
    if (!clamping) return;
    const next = new URLSearchParams(latestParams.current);
    if (next.get('unitId') !== unitId || Number(next.get('page') ?? 1) !== page || (next.get('q') ?? '') !== q || (next.get('operationStatus') ?? '') !== operationStatus || (next.get('reviewStatus') ?? '') !== reviewStatus || (next.get('teamId') ?? '') !== teamId) return;
    if (lastPage === 1) next.delete('page'); else next.set('page', String(lastPage));
    writeParams(next, true);
  }, [clamping, lastPage, params, setParams, unitId, page, q, operationStatus, reviewStatus, teamId]);

  function filter(key: string, value: string) {
    const next = new URLSearchParams(latestParams.current); next.delete('page');
    if (value) next.set(key, value); else next.delete(key);
    writeParams(next, true);
  }
  function changePage(nextPage: number) {
    const next = new URLSearchParams(latestParams.current); if (nextPage === 1) next.delete('page'); else next.set('page', String(nextPage)); writeParams(next);
  }
  function removeFilter(key: string) {
    if (!['q', 'operationStatus', 'reviewStatus', 'teamId'].includes(key)) return;
    filter(key, '');
    if (key === 'q') setSearch('');
    searchRef.current?.focus();
  }
  async function retry() { if (enabled) await permits.refetch(); }
  if (!permitted) return <Feedback tone="warning">Seu acesso não permite consultar permissões de trabalho.</Feedback>;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade de trabalho antes de consultar as PTs." />;
  const filtered = Boolean(q || operationStatus || reviewStatus || teamId || params.has('page') || invalidFilters);
  const returnState = { fromConsulta: false, fromSearch: location.search, fromUnitId: unitId };
  const appliedFilters: AppliedFilter[] = [
    ...(q ? [{ key: 'q', label: 'Busca', value: q }] : []),
    ...(operationStatus ? [{ key: 'operationStatus', label: 'Situação operacional', value: Object.hasOwn(operationLabels, operationStatus) ? operationLabels[operationStatus as OperationStatus] : 'Situação inválida' }] : []),
    ...(reviewStatus ? [{ key: 'reviewStatus', label: 'Revisão do encerramento', value: Object.hasOwn(reviewLabels, reviewStatus) ? reviewLabels[reviewStatus as FinalReviewStatus] : 'Situação inválida' }] : []),
  ];
  return <div className="stack">
    <PageHeader eyebrow="ATENDIMENTOS EM CAMPO" title="Permissões de trabalho" description="Acompanhe a verificação, a execução e a revisão de cada atendimento." actions={can('appointments.read') && <Link to="/app/agenda" className="button button--primary">Abrir agenda</Link>} />
    <section className="stack" aria-label="Busca de permissões de trabalho">
      <form className="panel stack" aria-label="Filtros de permissões de trabalho" onSubmit={event => { event.preventDefault(); if (!unitMatches || invalidFilters) return; filter('q', search.trim()); }}>
        <div className={styles.filters}>
          <Field label="Buscar PT"><div className={styles.search}><Search size={17} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Buscar PT" placeholder="Número, serviço, local ou equipe" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></div></Field>
          <Field label="Situação operacional"><select aria-label="Situação operacional" value={operationStatus} disabled={!unitMatches || invalidFilters} onChange={event => filter('operationStatus', event.target.value)}><option value="">Todas</option>{Object.entries(operationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Revisão do encerramento"><select aria-label="Revisão do encerramento" value={reviewStatus} disabled={!unitMatches || invalidFilters} onChange={event => filter('reviewStatus', event.target.value)}><option value="">Todas</option>{Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        </div>
        <div className="actions"><Button type="submit" disabled={!unitMatches || invalidFilters}><Search size={14} aria-hidden="true" />Pesquisar</Button><Button variant="ghost" disabled={!enabled || permits.isFetching || failed} onClick={() => void permits.refetch()}><RefreshCw size={14} aria-hidden="true" />Atualizar PTs</Button>{filtered && <Button variant="ghost" onClick={() => { setSearch(''); writeParams(new URLSearchParams({ unitId })); }}>Limpar filtros</Button>}{search.trim() !== q && <span className={styles.searchDraft}>Busca digitada ainda não aplicada à lista.</span>}</div>
        <AppliedFilters filters={appliedFilters} onRemove={removeFilter} />
        {teamId && !invalidFilters && <div className={styles.teamCriterion}><Badge tone="info">Filtro de equipe aplicado</Badge><Button variant="ghost" onClick={() => removeFilter('teamId')}>Remover filtro de equipe</Button></div>}
      </form>
      {repeated && <Feedback tone="danger">O endereço contém filtros de PT repetidos. Limpe os filtros antes de consultar.</Feedback>}
      {!repeated && unsupported && <Feedback tone="danger">O endereço contém filtros incompatíveis com a consulta de PTs. Limpe os filtros para continuar.</Feedback>}
      {!repeated && !unsupported && invalidCriteria && <Feedback tone="danger">Os filtros de PT recebidos no endereço são inválidos. Limpe os filtros para continuar.</Feedback>}
      {!repeated && !unsupported && !invalidCriteria && invalidPage && <Feedback tone="danger">O endereço contém uma página de PTs inválida. <Button variant="ghost" onClick={() => changePage(1)}>Voltar à primeira página</Button></Feedback>}
      {!unitMatches && !repeated && <Feedback>Conferindo a unidade antes de consultar as PTs.</Feedback>}
      {enabled && !failed && (permits.isPending || clamping) && <Spinner />}
      {enabled && failed && <div className="stack"><Feedback tone="danger">{scopedQueryError(permits.error ?? verified.error ?? denial.data?.error, 'permissões de trabalho')}</Feedback><Button variant="secondary" disabled={permits.isFetching} onClick={() => void retry()}>Tentar novamente</Button></div>}
      {data && page <= lastPage && <section className={styles.permitResults} aria-label="Permissões de trabalho encontradas" aria-busy={permits.isFetching}>
        <div className={styles.permitResultsHeader}><div><ClipboardCheck size={17} aria-hidden="true" /><h2>Atendimentos da unidade</h2></div><p>{data.total} atendimento{data.total === 1 ? '' : 's'} no seu alcance de acesso.</p></div>
        {!data.items.length && <EmptyState title="Nenhuma PT encontrada" description="Ajuste os filtros ou consulte os agendamentos da unidade selecionada." />}
        {data.items.length > 0 && <div className={styles.permitTableWrap} role="region" aria-label="Tabela de permissões de trabalho" tabIndex={0}>
          <table role="table" className={`data-table ${styles.permitTable}`}>
            <caption className="sr-only">Permissões de trabalho</caption>
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Atendimento</th><th role="columnheader" scope="col">Equipe e responsável</th><th role="columnheader" scope="col">Agendamento</th><th role="columnheader" scope="col">Situação</th><th role="columnheader" scope="col">Ciências</th><th role="columnheader" scope="col">Ações</th></tr></thead>
            <tbody role="rowgroup">{data.items.map(permit => {
          const count = permit.sciences.filter(science => science.version === permit.version).length;
          return <tr role="row" key={permit.id}>
            <th role="rowheader" scope="row" className={styles.permitTableIdentity}>
              <div><Link to={`/app/pts/${permit.id}`} state={returnState}>{permit.code}</Link><span>v{permit.version}</span></div>
              <strong>{permit.appointment.serviceLabel}</strong>
              <small>{permit.appointment.location}</small>
            </th>
            <td role="cell" className={styles.permitTableTeam}><span className={styles.mobileCellLabel} aria-hidden="true">Equipe e responsável</span><strong>{permit.appointment.teamName}</strong><small>{permit.appointment.responsibleName}</small></td>
            <td role="cell" className={styles.permitTableDate}><span className={styles.mobileCellLabel} aria-hidden="true">Agendamento</span><time dateTime={permit.appointment.startsAt}>{formatDate(permit.appointment.startsAt)}</time></td>
            <td role="cell" className={styles.permitTableStatus}><dl><div><dt>Operação</dt><dd><Badge tone={operationTones[permit.operationStatus]}>{operationLabels[permit.operationStatus]}</Badge></dd></div><div><dt>Revisão</dt><dd><Badge tone={reviewTones[permit.reviewStatus]}>{reviewLabels[permit.reviewStatus]}</Badge></dd></div></dl></td>
            <td role="cell" className={styles.permitTableSciences}><Badge tone={count === permit.appointment.participants.length ? 'success' : 'warning'}>Ciências {count}/{permit.appointment.participants.length}</Badge><small>Versão {permit.version} da PT</small></td>
            <td role="cell" className={styles.permitTableActions}><Link to={`/app/pts/${permit.id}`} state={returnState} className={`button button--secondary ${styles.permitTableAction}`}>Consultar PT<ArrowUpRight size={13} aria-hidden="true" /></Link></td>
          </tr>;
        })}</tbody></table></div>}
        <nav className={styles.permitPagination} aria-label="Paginação de PTs"><span className="muted">Página {page} de {lastPage}</span><div className="actions"><Button variant="secondary" disabled={page <= 1 || permits.isFetching} onClick={() => changePage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page >= lastPage || permits.isFetching} onClick={() => changePage(page + 1)}>Próxima</Button></div></nav>
      </section>}
    </section>
  </div>;
}
