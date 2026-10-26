import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { FileText, FolderOpen, Plus, Search } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentTypeDto, PageDto, WorkerDto } from '../../shared/contracts';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { PagedSelect } from '../../shared/ui/PagedSelect';
import { AppliedFilters, FilterDisclosure, type AppliedFilter } from '../../shared/ui/filter-controls';
import { DocumentList } from './DocumentList';
import { documentStatuses, errorMessage, formatDate, isCivilDate, statusLabels } from './validation';
import { positivePage } from './expiry';
import { documentNavigation } from './document-navigation';
import styles from './DocumentWorkspace.module.css';

const filterKeys = ['q', 'typeId', 'status', 'workerId', 'responsibleId', 'validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo'] as const;
type Filters = Record<typeof filterKeys[number], string>;
const readFilters = (params: URLSearchParams): Filters => Object.fromEntries(filterKeys.map(key => [key, params.get(key) ?? ''])) as Filters;
const selectedIds = (...ids: string[]) => [...new Set(ids.filter(Boolean))];
const advancedKeys = ['workerId', 'responsibleId', 'validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo'] as const;
const filterLabels: Record<keyof Filters, string> = {
  q: 'Busca', typeId: 'Tipo documental', status: 'Situação', workerId: 'Trabalhador', responsibleId: 'Responsável',
  validUntilFrom: 'Vencimento a partir de', validUntilTo: 'Vencimento até', issueDateFrom: 'Emissão a partir de', issueDateTo: 'Emissão até',
};

function filterError(filters: Filters) {
  if (filters.status && !documentStatuses.some(status => status === filters.status)) return 'Selecione uma situação documental válida.';
  if (['validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo'].some(key => filters[key as keyof Filters] && !isCivilDate(filters[key as keyof Filters]))) return 'Informe datas válidas para os intervalos da consulta.';
  if (filters.validUntilFrom && filters.validUntilTo && filters.validUntilFrom > filters.validUntilTo) return 'O fim do intervalo de validade deve ser igual ou posterior ao início.';
  if (filters.issueDateFrom && filters.issueDateTo && filters.issueDateFrom > filters.issueDateTo) return 'O fim do período de emissão deve ser igual ou posterior ao início.';
  return '';
}

export function DocumentsPage() {
  const { sessionKey, unitId, can } = useSession();
  return <DocumentsPageContent key={`${sessionKey}:${unitId}:${can('documents.read')}:${can('workers.read')}:${can('documents.write')}`} />;
}

function DocumentsPageContent() {
  const { unitId, sessionKey, can } = useSession();
  const location = useLocation();
  const [searchParams, navigateSearch] = useAppQueryParams();
  const dashboardReturnTo = documentNavigation(location.state, unitId, can('dashboard.read'))?.documentDashboardReturnTo;
  const returnUnit = dashboardReturnTo?.unitId, returnSearch = dashboardReturnTo?.search;
  const setSearchParams = useCallback((next: URLSearchParams, options?: { replace?: boolean; flushSync?: boolean }) => {
    navigateSearch(next, { ...options, flushSync: options?.flushSync ?? true, state: returnUnit ? { documentDashboardReturnTo: { unitId: returnUnit, search: returnSearch ?? '' } } : undefined });
  }, [navigateSearch, returnUnit, returnSearch]);
  const documentOrigin = documentNavigation({ documentListReturnTo: { unitId, search: location.search }, documentDashboardReturnTo: dashboardReturnTo }, unitId, can('dashboard.read'));
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const [search, setSearch] = useState(filters.q);
  const [draftFilters, setDraftFilters] = useState(filters);
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedKeys.some(key => filters[key]));
  const [failure, setFailure] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const page = positivePage(searchParams.get('page'));
  const urlUnit = searchParams.get('unitId');
  const contextReady = Boolean(unitId) && (!urlUnit || urlUnit === unitId);
  const canRead = can('documents.read');
  const appliedError = filterError(filters);
  useEffect(() => { setSearch(filters.q); setDraftFilters(filters); setFailure(''); }, [filters]);
  useEffect(() => { if (advancedKeys.some(key => filters[key])) setAdvancedOpen(true); }, [filters]);
  useEffect(() => {
    if (!unitId || urlUnit === unitId) return;
    const next = new URLSearchParams(searchParams); next.set('unitId', unitId);
    if (urlUnit) { next.delete('workerId'); next.delete('responsibleId'); next.delete('page'); }
    setSearchParams(next, { replace: true, flushSync: false });
  }, [unitId, urlUnit, searchParams, setSearchParams]);
  const list = useQuery({
    queryKey: ['documents', sessionKey, unitId, page, filters],
    queryFn: ({ signal }) => api.get<PageDto<DocumentDto>>('/documents', { signal, query: { unitId, page, pageSize: 10, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) } }),
    enabled: canRead && contextReady && !appliedError,
  });
  const rowTypeIds = !list.isError && contextReady ? list.data?.items.map(document => document.typeId) ?? [] : [];
  const types = usePagedLookup<DocumentTypeDto>({
    queryKey: ['document-types', sessionKey, unitId, 'document-filter'], path: '/document-types', query: { activeOnly: true },
    selectedIds: selectedIds(filters.typeId, draftFilters.typeId, ...rowTypeIds), enabled: canRead && contextReady,
  });
  const workers = usePagedLookup<WorkerDto>({
    queryKey: ['workers', 'document-filter', sessionKey, unitId], path: '/workers', query: { unitId },
    selectedIds: selectedIds(filters.workerId, draftFilters.workerId), enabled: canRead && can('workers.read') && contextReady,
  });
  const assignees = usePagedLookup<{ id: string; displayName: string }>({
    queryKey: ['assignees', 'document-filter', sessionKey, unitId], path: '/assignees', query: { unitId, purpose: 'DOCUMENT_RESPONSIBLE' },
    selectedIds: selectedIds(filters.responsibleId, draftFilters.responsibleId), enabled: canRead && can('documents.write') && contextReady,
  });
  function searchDocuments(event: FormEvent) {
    event.preventDefault();
    if (!canRead || !contextReady) return;
    const invalid = filterError(draftFilters);
    if (invalid) { setFailure(invalid); return; }
    const next = new URLSearchParams(searchParams);
    filterKeys.forEach(key => next.delete(key)); next.delete('page');
    Object.entries({ ...draftFilters, q: search.trim() }).forEach(([key, value]) => { if (value) next.set(key, value); });
    if (unitId) next.set('unitId', unitId);
    setFailure(''); setSearchParams(next);
  }
  function clearFilters() {
    const next = new URLSearchParams(searchParams); filterKeys.forEach(key => next.delete(key)); next.delete('page');
    setSearch(''); setDraftFilters(readFilters(next)); setAdvancedOpen(false); setFailure(''); setSearchParams(next);
  }
  function removeFilter(key: string) {
    if (!filterKeys.some(filter => filter === key)) return;
    const next = new URLSearchParams(searchParams); next.delete(key); next.delete('page'); setSearchParams(next); searchRef.current?.focus();
  }
  function setPage(nextPage: number) { const next = new URLSearchParams(searchParams); next.set('page', String(nextPage)); setSearchParams(next); }
  if (!canRead) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar documentos." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  const typeNames = new Map([...types.items, ...types.selectedItems].map(type => [type.id, type.name]));
  const workerNames = new Map([...workers.items, ...workers.selectedItems].map(worker => [worker.id, worker.fullName]));
  const assigneeNames = new Map([...assignees.items, ...assignees.selectedItems].map(person => [person.id, person.displayName]));
  const appliedFilters: AppliedFilter[] = filterKeys.filter(key => filters[key]).map(key => ({ key, label: filterLabels[key], value:
    key === 'status' ? statusLabels[filters[key]] ?? 'Situação inválida'
      : key === 'typeId' ? typeNames.get(filters[key]) ?? 'Identificação indisponível'
        : key === 'workerId' ? workerNames.get(filters[key]) ?? 'Identificação indisponível'
          : key === 'responsibleId' ? assigneeNames.get(filters[key]) ?? 'Identificação indisponível'
            : key === 'q' ? filters[key] : isCivilDate(filters[key]) ? formatDate(filters[key]) : 'Data inválida',
  }));
  const advancedCount = advancedKeys.filter(key => filters[key]).length;
  const hasDraftChanges = search.trim() !== filters.q || filterKeys.some(key => key !== 'q' && draftFilters[key] !== filters[key]);
  return <div className={`stack ${styles.workspace}`}>
    <header className={styles.pageHeader}>
      <div className={styles.headerCopy}>
        <p className={styles.eyebrow}><span><FolderOpen size={15} aria-hidden="true" /></span>REPOSITÓRIO CONTROLADO</p>
        <h1>Documentos</h1>
        <p className={styles.description}>Consulte vigências, acompanhe versões e encontre as evidências da sua unidade.</p>
      </div>
      <div className={styles.headerActions}>
      {dashboardReturnTo && <Link className="button button--secondary" to={`/app/painel-documental${dashboardReturnTo.search}`}>Voltar ao painel documental</Link>}
      {can('documents.write') && <Link className="button button--primary" to="/app/documentos/novo" state={documentOrigin}><Plus size={16} aria-hidden="true" />Novo documento</Link>}
      </div>
    </header>
    <form className={`panel flex flex-col gap-4 ${styles.filterPanel}`} onSubmit={searchDocuments} aria-label="Filtros de documentos">
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Buscar por título ou código"><div className="relative"><Search size={16} className="pointer-events-none absolute left-3.5 top-3.5 text-slate-400" aria-hidden="true" /><input ref={searchRef} className="!pl-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="Ex.: PGR, relatório, DOC-001" maxLength={200} /></div></Field>
        <PagedSelect lookup={types} label="Tipo documental" noun="tipos documentais" value={draftFilters.typeId} onChange={value => setDraftFilters(current => ({ ...current, typeId: String(value) }))} getLabel={type => type.name} emptyLabel="Todos os tipos" />
        <Field label="Situação"><select value={draftFilters.status} onChange={event => setDraftFilters(current => ({ ...current, status: event.target.value }))}><option value="">Todas as situações</option>{draftFilters.status && !documentStatuses.some(status => status === draftFilters.status) && <option value={draftFilters.status}>Situação inválida</option>}{documentStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></Field>
      </div>
      <div className={styles.filterActions}><Button type="submit"><Search size={14} aria-hidden="true" />Buscar</Button><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button>{hasDraftChanges && <span className={styles.draftNotice}>Alterações ainda não aplicadas à lista.</span>}</div>
      <FilterDisclosure open={advancedOpen} onOpenChange={setAdvancedOpen} count={advancedCount}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {can('workers.read') && <PagedSelect lookup={workers} label="Trabalhador" noun="trabalhadores" value={draftFilters.workerId} onChange={value => setDraftFilters(current => ({ ...current, workerId: String(value) }))} getLabel={worker => `${worker.fullName} · ${worker.registration}`} emptyLabel="Todos os trabalhadores" />}
        {can('documents.write') && <PagedSelect lookup={assignees} label="Responsável" noun="responsáveis" value={draftFilters.responsibleId} onChange={value => setDraftFilters(current => ({ ...current, responsibleId: String(value) }))} getLabel={person => person.displayName} emptyLabel="Todos os responsáveis" />}
        <Field label="Vencimento a partir de"><input type="date" value={draftFilters.validUntilFrom} onChange={event => setDraftFilters(current => ({ ...current, validUntilFrom: event.target.value }))} /></Field>
        <Field label="Vencimento até"><input type="date" value={draftFilters.validUntilTo} onChange={event => setDraftFilters(current => ({ ...current, validUntilTo: event.target.value }))} /></Field>
        <Field label="Emissão a partir de"><input type="date" value={draftFilters.issueDateFrom} onChange={event => setDraftFilters(current => ({ ...current, issueDateFrom: event.target.value }))} /></Field>
        <Field label="Emissão até"><input type="date" value={draftFilters.issueDateTo} onChange={event => setDraftFilters(current => ({ ...current, issueDateTo: event.target.value }))} /></Field>
      </div>
      </FilterDisclosure>
      <AppliedFilters filters={appliedFilters} onRemove={removeFilter} />
      {(failure || appliedError) && <Feedback tone="danger">{failure || `O endereço contém filtros inválidos. ${appliedError} Corrija os critérios e aplique a busca.`}</Feedback>}
    </form>
    {appliedError ? <EmptyState title="Corrija os filtros da consulta" description="A busca será realizada depois de aplicar critérios válidos." /> : list.isPending || !contextReady ? <Spinner /> : list.isError ? <div className="panel stack"><Feedback tone="danger">{errorMessage(list.error)}</Feedback><Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></div> : <section aria-label="Resultados de documentos" aria-busy={list.isFetching} className={styles.resultsPanel}>
      <div className={styles.resultsHeading}>
        <div><span className={styles.resultsIcon}><FileText size={17} aria-hidden="true" /></span><h2>Acervo da unidade</h2></div>
        <p role="status">{list.isFetching ? 'Atualizando lista…' : `${new Intl.NumberFormat('pt-BR').format(list.data?.total ?? 0)} documento(s) encontrado(s)`}</p>
      </div>
      {!list.data?.items.length ? <div><EmptyState title="Nenhum documento encontrado" description={page > 1 ? 'Esta página não possui resultados. Volte à primeira página para consultar os documentos.' : 'Ajuste os filtros ou cadastre o primeiro documento autorizado para esta unidade.'} />{page > 1 && <div className="px-5 pb-5"><Button variant="secondary" onClick={() => setPage(1)}>Voltar à primeira página</Button></div>}</div> : <>
        <DocumentList documents={list.data.items} typeNames={typeNames} origin={documentOrigin} />
        <nav aria-label="Paginação de documentos" className={styles.pagination}><span>Página {page} de {Math.max(1, Math.ceil(list.data.total / 10))}</span><div className="actions"><Button variant="secondary" disabled={page <= 1 || list.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page * 10 >= list.data.total || list.isFetching} onClick={() => setPage(page + 1)}>Próxima</Button></div></nav>
      </>}
    </section>}
  </div>;
}
