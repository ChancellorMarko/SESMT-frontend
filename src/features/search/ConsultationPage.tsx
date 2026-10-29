import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, ClipboardCheck, Search, MapPin, FileCheck, HardHat, ArrowUpRight } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type {
  DocumentReadDto as DocumentDto,
  DocumentTypeReadDto as DocumentTypeDto,
  PageDto,
  WorkerReadDto as WorkerDto,
} from '../../shared/contracts';
import type {
  PermitOptionsDto,
  WorkPermitDto,
} from '../../shared/contracts/work-permits';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { DocumentStatus } from '../documents/DocumentStatus';
import {
  documentStatuses,
  errorMessage as docErrorMessage,
  formatDate,
  isCivilDate,
  statusLabels as docStatusLabels,
} from '../documents/validation';
import { positivePage } from '../documents/expiry';
import { operationLabels, PermitStatus, reviewLabels } from '../permits/PermitStatus';
import { errorMessage as permitErrorMessage } from '../permits/validation';
import styles from './Consultation.module.css';
import { consultationResults } from './consultation-results';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { PagedSelect } from '../../shared/ui/PagedSelect';
import { PreparationSearchTab } from './PreparationSearchTab';
import { ConsultationSearchHeading, PendingSearchChanges } from './ConsultationSearchTools';
import { TerminologyHelp } from '../../shared/ui/TerminologyGuide';

const consultationTabs = {
  documents: { permission: 'documents.read', label: 'Documentos controlados', shortLabel: 'Documentos', description: 'Arquivos e vigências', icon: FolderOpen },
  permits: { permission: 'permits.read', label: 'Permissões de trabalho (PT)', shortLabel: 'Permissões', description: 'Trabalho · PT', icon: ClipboardCheck },
  ats: { permission: 'at.read', label: 'Autorizações de trabalho (AT)', shortLabel: 'Autorizações', description: 'Trabalho · AT', icon: FileCheck },
  pets: { permission: 'pet.read', label: 'Permissões de entrada e trabalho (PET)', shortLabel: 'Entrada e trabalho', description: 'Espaços confinados · PET', icon: HardHat },
};
type ActiveTab = keyof typeof consultationTabs;

function documentFilterError(status: string, from: string, to: string) {
  if (status && !documentStatuses.some(value => value === status)) return 'Selecione uma situação documental válida.';
  if (from && !isCivilDate(from)) return 'Data inicial de vencimento inválida.';
  if (to && !isCivilDate(to)) return 'Data final de vencimento inválida.';
  if (from && to && from > to) return 'A data final deve ser igual ou posterior à data inicial.';
  return '';
}

function permitFilterError(operation: string, review: string) {
  if (operation && !Object.hasOwn(operationLabels, operation)) return 'Selecione uma situação operacional válida.';
  if (review && !Object.hasOwn(reviewLabels, review)) return 'Selecione uma revisão do encerramento válida.';
  return '';
}

export function ConsultationPage() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useAppQueryParams();
  const tabsId = useId();
  const allowedTabs = (Object.keys(consultationTabs) as ActiveTab[]).filter(tab => can(consultationTabs[tab].permission));
  const rawTab = params.get('tab');
  const requestedTab = rawTab && Object.hasOwn(consultationTabs, rawTab) ? rawTab as ActiveTab : undefined;
  const invalidContext = params.getAll('tab').length > 1 || params.getAll('unitId').length > 1 || Boolean(rawTab && !requestedTab);
  const activeTab = requestedTab && allowedTabs.includes(requestedTab) ? requestedTab : allowedTabs[0];
  const contextReady = !invalidContext && rawTab === activeTab && params.get('unitId') === unitId;

  useEffect(() => {
    if (!unitId || !activeTab || invalidContext) return;
    const next = requestedTab && requestedTab !== activeTab ? new URLSearchParams() : new URLSearchParams(params);
    next.set('tab', activeTab);
    if (params.has('unitId') && params.get('unitId') !== unitId) {
      for (const key of ['page', 'workerId', 'teamId', 'responsibleId']) next.delete(key);
    }
    next.set('unitId', unitId);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [activeTab, invalidContext, params, requestedTab, setParams, unitId]);

  function switchTab(nextTab: ActiveTab, originTab = activeTab) {
    if (nextTab === activeTab && contextReady && originTab === activeTab) return;
    // Each resource has its own filter vocabulary; changing tabs starts a new search.
    setParams(new URLSearchParams({ tab: nextTab, ...(unitId ? { unitId } : {}) }), { flushSync: true });
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, originTab: ActiveTab) {
    // Focus moves before the router commits; the pressed button owns the next step.
    const position = allowedTabs.indexOf(originTab);
    if (position < 0) return;
    const next = event.key === 'ArrowRight' ? allowedTabs[(position + 1) % allowedTabs.length]
      : event.key === 'ArrowLeft' ? allowedTabs[(position + allowedTabs.length - 1) % allowedTabs.length]
      : event.key === 'Home' ? allowedTabs[0] : event.key === 'End' ? allowedTabs.at(-1) : undefined;
    if (!next) return;
    event.preventDefault();
    switchTab(next, originTab);
    document.getElementById(`${tabsId}-${next}`)?.focus();
  }

  if (!allowedTabs.length) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso às consultas." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade de trabalho para consultar os registros." />;

  return (
    <div className={`stack ${styles.page}`}>
      <PageHeader
        eyebrow="BUSCA E AUDITORIA OPERACIONAL"
        title="Central de consulta unificada"
        description="Encontre documentos, permissões e autorizações de trabalho em consultas próprias para cada registro."
        actions={<TerminologyHelp related={['PT', 'AT', 'PET']}>Entenda PT, AT e PET</TerminologyHelp>}
      />

      <div className={styles.tabBar} role="tablist" aria-label="Abas de consulta">
        {allowedTabs.map(tab => {
          const { icon: Icon, label, shortLabel, description } = consultationTabs[tab];
          return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-label={label}
            id={`${tabsId}-${tab}`}
            aria-controls={`${tabsId}-${tab}-panel`}
            tabIndex={activeTab === tab ? 0 : -1}
            aria-selected={activeTab === tab}
            className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`}
            onClick={() => switchTab(tab)}
            onKeyDown={event => navigateTabs(event, tab)}
          >
            <span className={styles.tabIcon}><Icon size={19} aria-hidden="true" /></span>
            <span className={styles.tabText}><strong>{shortLabel}</strong><small>{description}</small></span>
            <span className={styles.tabMarker} aria-hidden="true" />
          </button>
          );
        })}
      </div>

      {invalidContext && <Feedback tone="danger">O endereço da consulta contém aba ou unidade inválida ou repetida. <Button variant="secondary" onClick={() => switchTab(activeTab!)}>Reiniciar consulta</Button></Feedback>}
      {allowedTabs.map(tab => <div key={tab} role="tabpanel" data-consultation-panel data-motion-managed className={styles.tabPanel} id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}`} hidden={activeTab !== tab} tabIndex={0}>
        {activeTab === tab && contextReady && (tab === 'documents' ? <DocumentsSearchTab key={`documents-${sessionKey}-${unitId}`} /> : tab === 'permits' ? <PermitsSearchTab key={`permits-${sessionKey}-${unitId}`} /> : <PreparationSearchTab key={`${tab}-${sessionKey}-${unitId}`} kind={tab} />)}
      </div>)}
    </div>
  );
}

function DocumentsSearchTab() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useAppQueryParams();
  const location = useLocation();

  const q = params.get('q') || '';
  const typeId = params.get('typeId') || '';
  const status = params.get('status') || '';
  const workerId = params.get('workerId') || '';
  const validUntilFrom = params.get('validUntilFrom') || '';
  const validUntilTo = params.get('validUntilTo') || '';
  const page = positivePage(params.get('page'));

  const [search, setSearch] = useState(q);
  const [draftType, setDraftType] = useState(typeId);
  const [draftStatus, setDraftStatus] = useState(status);
  const [draftWorker, setDraftWorker] = useState(workerId);
  const [draftValidFrom, setDraftValidFrom] = useState(validUntilFrom);
  const [draftValidTo, setDraftValidTo] = useState(validUntilTo);
  const [validationError, setValidationError] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearch(q);
    setDraftType(typeId);
    setDraftStatus(status);
    setDraftWorker(workerId);
    setDraftValidFrom(validUntilFrom);
    setDraftValidTo(validUntilTo);
    setValidationError('');
  }, [q, typeId, status, workerId, validUntilFrom, validUntilTo, location.search]);

  const hasFilters = Boolean(q || typeId || status || workerId || validUntilFrom || validUntilTo);
  const hasDraftFilters = Boolean(search || draftType || draftStatus || draftWorker || draftValidFrom || draftValidTo);
  const draftChanged = search !== q || draftType !== typeId || draftStatus !== status || draftWorker !== workerId || draftValidFrom !== validUntilFrom || draftValidTo !== validUntilTo;
  const appliedError = documentFilterError(status, validUntilFrom, validUntilTo);

  const documents = useQuery({
    queryKey: ['consulta-documents', sessionKey, unitId, page, q, typeId, status, workerId, validUntilFrom, validUntilTo],
    queryFn: ({ signal }) =>
      api.get<PageDto<DocumentDto>>('/documents', {
        signal,
        query: {
          unitId: unitId || undefined,
          page,
          pageSize: 10,
          q: q || undefined,
          typeId: typeId || undefined,
          status: status || undefined,
          workerId: workerId || undefined,
          validUntilFrom: validUntilFrom || undefined,
          validUntilTo: validUntilTo || undefined,
        },
      }),
    enabled: can('documents.read') && !appliedError,
  });

  const types = usePagedLookup<DocumentTypeDto>({
    queryKey: ['document-types', sessionKey, unitId, 'consulta-filter'],
    path: '/document-types',
    query: { activeOnly: true },
    selectedIds: draftType ? [draftType] : [],
    enabled: can('documents.read'),
  });

  const workers = usePagedLookup<WorkerDto>({
    queryKey: ['workers', 'consulta-filter', sessionKey, unitId],
    path: '/workers',
    query: { unitId: unitId || undefined },
    selectedIds: draftWorker ? [draftWorker] : [],
    enabled: can('workers.read'),
  });

  const availableTypes = types.isError ? [] : [...types.items, ...types.selectedItems];

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const error = documentFilterError(draftStatus, draftValidFrom, draftValidTo);
    if (error) { setValidationError(error); return; }
    setValidationError('');

    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'documents');
      if (search.trim()) next.set('q', search.trim());
      else next.delete('q');
      if (draftType) next.set('typeId', draftType);
      else next.delete('typeId');
      if (draftStatus) next.set('status', draftStatus);
      else next.delete('status');
      if (draftWorker) next.set('workerId', draftWorker);
      else next.delete('workerId');
      if (draftValidFrom) next.set('validUntilFrom', draftValidFrom);
      else next.delete('validUntilFrom');
      if (draftValidTo) next.set('validUntilTo', draftValidTo);
      else next.delete('validUntilTo');
      next.delete('page');
      return next;
    }, { flushSync: true });
  }

  function handleClear() {
    setSearch('');
    setDraftType('');
    setDraftStatus('');
    setDraftWorker('');
    setDraftValidFrom('');
    setDraftValidTo('');
    setValidationError('');
    setParams(new URLSearchParams({ tab: 'documents', ...(unitId ? { unitId } : {}) }), { flushSync: true });
    searchInput.current?.focus({ preventScroll: true });
  }

  function discardDraft() {
    setSearch(q); setDraftType(typeId); setDraftStatus(status); setDraftWorker(workerId);
    setDraftValidFrom(validUntilFrom); setDraftValidTo(validUntilTo); setValidationError('');
    searchInput.current?.focus({ preventScroll: true });
  }

  return (
    <section className={`panel stack ${styles.searchPanel}`} aria-label="Consulta de documentos controlados">
      <form onSubmit={handleSearch} className={`stack ${styles.searchForm}`}>
        <ConsultationSearchHeading title="Pesquisar documentos" description="Título, código e critérios de vigência." />
        <div className={`toolbar ${styles.searchToolbar}`}>
          <Field label="Buscar título ou código">
            <input
              ref={searchInput}
              type="search"
              placeholder="Ex.: Relatório, PGR, ASO, DOC-001…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </Field>
          <Button type="submit">
            <Search size={15} /> Pesquisar
          </Button>
          {(hasFilters || hasDraftFilters) && (
            <Button type="button" variant="ghost" onClick={handleClear}>
              Limpar filtros
            </Button>
          )}
        </div>

        {validationError && <Feedback tone="danger">{validationError}</Feedback>}

        <div className={`form-grid ${styles.filterGrid}`}>
          <PagedSelect lookup={types} label="Tipo documental" noun="tipos" value={draftType}
            onChange={value => { if (typeof value === 'string') setDraftType(value); }}
            getLabel={type => type.name} emptyLabel="Todos os tipos" />

          <Field label="Situação">
            <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)}>
              <option value="">Todas as situações</option>
              {draftStatus && !documentStatuses.some(value => value === draftStatus) && <option value={draftStatus}>Situação inválida: {draftStatus}</option>}
              {documentStatuses.map(st => (
                <option key={st} value={st}>{docStatusLabels[st]}</option>
              ))}
            </select>
          </Field>

          {can('workers.read') ? <PagedSelect lookup={workers} label="Trabalhador vinculado" noun="trabalhadores" value={draftWorker}
            onChange={value => { if (typeof value === 'string') setDraftWorker(value); }}
            getLabel={worker => `${worker.fullName} (${worker.registration})`} emptyLabel="Todos os trabalhadores" />
            : draftWorker && <Field label="Trabalhador vinculado"><select value={draftWorker} onChange={event => setDraftWorker(event.target.value)}><option value="">Todos os trabalhadores</option><option value={draftWorker}>Trabalhador selecionado: {draftWorker}</option></select></Field>}

          <Field label="Vencimento a partir de">
            <input
              type="date"
              value={draftValidFrom}
              onChange={e => setDraftValidFrom(e.target.value)}
            />
          </Field>

          <Field label="Vencimento até">
            <input
              type="date"
              value={draftValidTo}
              onChange={e => setDraftValidTo(e.target.value)}
            />
          </Field>
        </div>
      </form>

      {draftChanged && <PendingSearchChanges onDiscard={discardDraft} />}

      {appliedError && <Feedback tone="danger">Filtros da consulta inválidos. {appliedError} Corrija os campos e pesquise novamente ou limpe os filtros.</Feedback>}
      {!appliedError && documents.isPending && <Spinner />}
      {!appliedError && documents.isError && <Feedback tone="danger">
        <p>{docErrorMessage(documents.error)}</p>
        <Button variant="secondary" disabled={documents.isFetching} onClick={() => void documents.refetch()}>Tentar consultar documentos novamente</Button>
      </Feedback>}

      {documents.data && !documents.isError && !appliedError && (
        documents.data.items.length ? (
          <>
            <div className="table-wrap" role="region" aria-label="Tabela de documentos controlados" tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">Resultados da consulta documental</caption>
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Tipo</th>
                    <th>Situação</th>
                    <th>Validade</th>
                    <th>Emissão</th>
                    <th><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.data.items.map(doc => {
                    const typeObj = availableTypes.find(t => t.id === doc.typeId);
                    return (
                      <tr key={doc.id}>
                        <td>
                          <Link
                            to={`/app/documentos/${doc.id}`}
                            state={{ fromSearch: location.search, fromConsulta: true, fromUnitId: unitId }}
                          >
                            <strong>{doc.title}</strong>
                          </Link>
                          <span className="muted" style={{ display: 'block' }}>{doc.code}</span>
                        </td>
                        <td>{typeObj?.name || 'Tipo não disponível'}</td>
                        <td>
                          <DocumentStatus status={doc.status} />
                        </td>
                        <td>{doc.validUntil ? formatDate(doc.validUntil) : 'Não informada'}</td>
                        <td>{formatDate(doc.issueDate)}</td>
                        <td>
                          <Link
                            to={`/app/documentos/${doc.id}`}
                            state={{ fromSearch: location.search, fromConsulta: true, fromUnitId: unitId }}
                            aria-label={`Abrir ${doc.title}`}
                            className={styles.resultAction}
                          >
                            Consultar <ArrowUpRight size={14} aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'Nenhum documento encontrado' : 'Nenhum documento disponível'}
            description={page > 1 && documents.data.total > 0 ? 'Esta página não contém resultados. Use Anterior para retornar às páginas disponíveis.' : hasFilters ? 'Revise os filtros aplicados para consultar outros registros.' : 'Não há documentos no seu alcance de acesso nesta unidade.'}
          />
        )
      )}
      {documents.data && !documents.isError && !appliedError && (documents.data.total > 0 || page > 1) && (
        <QueryPagination total={documents.data.total} page={page} pageSize={documents.data.pageSize} kind="documento(s)" />
      )}
    </section>
  );
}

function PermitsSearchTab() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useAppQueryParams();
  const location = useLocation();

  const q = params.get('q') || '';
  const operationStatus = params.get('operationStatus') || '';
  const reviewStatus = params.get('reviewStatus') || '';
  const teamId = params.get('teamId') || '';
  const page = positivePage(params.get('page'));

  const [search, setSearch] = useState(q);
  const [draftOp, setDraftOp] = useState(operationStatus);
  const [draftReview, setDraftReview] = useState(reviewStatus);
  const [draftTeam, setDraftTeam] = useState(teamId);
  const [validationError, setValidationError] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearch(q);
    setDraftOp(operationStatus);
    setDraftReview(reviewStatus);
    setDraftTeam(teamId);
    setValidationError('');
  }, [q, operationStatus, reviewStatus, teamId, location.search]);

  const hasFilters = Boolean(q || operationStatus || reviewStatus || teamId);
  const hasDraftFilters = Boolean(search || draftOp || draftReview || draftTeam);
  const draftChanged = search !== q || draftOp !== operationStatus || draftReview !== reviewStatus || draftTeam !== teamId;
  const appliedError = permitFilterError(operationStatus, reviewStatus);

  const options = useQuery({
    queryKey: ['permit-options', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { query: { unitId: unitId || undefined }, signal }),
    enabled: can('permits.read') && Boolean(unitId),
  });

  const permits = useQuery({
    queryKey: ['consulta-permits', sessionKey, unitId, page, q, operationStatus, reviewStatus, teamId],
    queryFn: ({ signal }) =>
      api.get<PageDto<WorkPermitDto> | WorkPermitDto[]>('/work-permits', {
        signal,
        query: {
          unitId: unitId || undefined,
          page,
          pageSize: 10,
          q: q || undefined,
          operationStatus: operationStatus || undefined,
          reviewStatus: reviewStatus || undefined,
          teamId: teamId || undefined,
        },
      }),
    enabled: can('permits.read') && !appliedError,
  });

  const { items: permitItems, total: totalCount, pageSize } = consultationResults(permits.data, page);
  const availableTeams = options.isError ? [] : options.data?.teams ?? [];

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const error = permitFilterError(draftOp, draftReview);
    if (error) { setValidationError(error); return; }
    setValidationError('');
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'permits');
      if (search.trim()) next.set('q', search.trim());
      else next.delete('q');
      if (draftOp) next.set('operationStatus', draftOp);
      else next.delete('operationStatus');
      if (draftReview) next.set('reviewStatus', draftReview);
      else next.delete('reviewStatus');
      if (draftTeam) next.set('teamId', draftTeam);
      else next.delete('teamId');
      next.delete('page');
      return next;
    }, { flushSync: true });
  }

  function handleClear() {
    setSearch('');
    setDraftOp('');
    setDraftReview('');
    setDraftTeam('');
    setValidationError('');
    setParams(new URLSearchParams({ tab: 'permits', ...(unitId ? { unitId } : {}) }), { flushSync: true });
    searchInput.current?.focus({ preventScroll: true });
  }

  function discardDraft() {
    setSearch(q); setDraftOp(operationStatus); setDraftReview(reviewStatus); setDraftTeam(teamId); setValidationError('');
    searchInput.current?.focus({ preventScroll: true });
  }

  return (
    <section className={`panel stack ${styles.searchPanel}`} aria-label="Consulta de permissões de trabalho">
      <form onSubmit={handleSearch} className={`stack ${styles.searchForm}`}>
        <ConsultationSearchHeading title="Pesquisar permissões de trabalho" description="Código, serviço, local e situação operacional." />
        <div className={`toolbar ${styles.searchToolbar}`}>
          <Field label="Buscar PT">
            <input
              ref={searchInput}
              type="search"
              placeholder="Número, serviço, local ou equipe…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </Field>
          <Button type="submit">
            <Search size={15} /> Pesquisar
          </Button>
          {(hasFilters || hasDraftFilters) && (
            <Button type="button" variant="ghost" onClick={handleClear}>
              Limpar filtros
            </Button>
          )}
        </div>

        {validationError && <Feedback tone="danger">{validationError}</Feedback>}

        <div className={`form-grid ${styles.filterGrid}`}>
          <Field label="Situação operacional">
            <select value={draftOp} onChange={e => setDraftOp(e.target.value)}>
              <option value="">Todas</option>
              {draftOp && !Object.hasOwn(operationLabels, draftOp) && <option value={draftOp}>Situação inválida: {draftOp}</option>}
              {Object.entries(operationLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Revisão do encerramento">
            <select value={draftReview} onChange={e => setDraftReview(e.target.value)}>
              <option value="">Todas</option>
              {draftReview && !Object.hasOwn(reviewLabels, draftReview) && <option value={draftReview}>Revisão inválida: {draftReview}</option>}
              {Object.entries(reviewLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Equipe operacional">
              <select value={draftTeam} onChange={e => setDraftTeam(e.target.value)}>
                <option value="">Todas as equipes</option>
                {draftTeam && !availableTeams.some(t => t.id === draftTeam) && <option value={draftTeam}>Equipe selecionada: {draftTeam}</option>}
                {availableTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
          </Field>
        </div>
      </form>

      {draftChanged && <PendingSearchChanges onDiscard={discardDraft} />}

      {options.isError && <Feedback tone="danger">
        <p>Não foi possível carregar as equipes do filtro. {permitErrorMessage(options.error)}</p>
        <Button variant="secondary" disabled={options.isFetching} onClick={() => void options.refetch()}>Tentar carregar equipes novamente</Button>
      </Feedback>}
      {appliedError && <Feedback tone="danger">Filtros da consulta inválidos. {appliedError} Corrija os campos e pesquise novamente ou limpe os filtros.</Feedback>}
      {!appliedError && permits.isPending && <Spinner />}
      {!appliedError && permits.isError && <Feedback tone="danger">
        <p>{permitErrorMessage(permits.error)}</p>
        <Button variant="secondary" disabled={permits.isFetching} onClick={() => void permits.refetch()}>Tentar consultar PTs novamente</Button>
      </Feedback>}

      {permits.data && !permits.isError && !appliedError && (
        permitItems.length ? (
          <>
            <div className="table-wrap" role="region" aria-label="Tabela de permissões de trabalho" tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">Resultados da consulta de PTs</caption>
                <thead>
                  <tr>
                    <th>Código / Versão</th>
                    <th>Serviço e local</th>
                    <th>Equipe</th>
                    <th>Responsável</th>
                    <th>Situação</th>
                    <th>Data / Início</th>
                    <th><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {permitItems.map(permit => (
                    <tr key={permit.id}>
                      <td>
                        <Link
                          to={`/app/pts/${permit.id}`}
                          state={{ fromSearch: location.search, fromConsulta: true, fromUnitId: unitId }}
                        >
                          <strong>{permit.code}</strong>
                        </Link>
                        <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                          v{permit.version}
                        </span>
                      </td>
                      <td>
                        <strong>{permit.appointment.serviceLabel}</strong>
                        <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>
                          <MapPin size={13} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} aria-hidden="true" />
                          {permit.appointment.location}
                        </span>
                      </td>
                      <td>{permit.appointment.teamName}</td>
                      <td>{permit.appointment.responsibleName}</td>
                      <td>
                        <PermitStatus
                          operationStatus={permit.operationStatus}
                          reviewStatus={permit.reviewStatus}
                        />
                      </td>
                      <td>{formatDate(permit.appointment.startsAt)}</td>
                      <td>
                        <Link
                          to={`/app/pts/${permit.id}`}
                          state={{ fromSearch: location.search, fromConsulta: true, fromUnitId: unitId }}
                          aria-label={`Abrir ${permit.code}`}
                          className={styles.resultAction}
                        >
                          Consultar <ArrowUpRight size={14} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'Nenhuma PT encontrada' : 'Nenhuma PT disponível'}
            description={page > 1 && totalCount > 0 ? 'Esta página não contém resultados. Use Anterior para retornar às páginas disponíveis.' : hasFilters ? 'Ajuste os filtros para pesquisar outros atendimentos.' : 'Não há atendimentos de PT cadastrados para o seu escopo nesta unidade.'}
          />
        )
      )}
      {permits.data && !permits.isError && !appliedError && (totalCount > 0 || page > 1) && (
        <QueryPagination total={totalCount} page={page} pageSize={pageSize} kind="PT(s)" />
      )}
    </section>
  );
}


function QueryPagination({ total, page, pageSize, kind }: { total: number; page: number; pageSize: number; kind: string }) {
  const [, setParams] = useAppQueryParams();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  function go(nextPage: number) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (nextPage === 1) next.delete('page');
      else next.set('page', String(nextPage));
      return next;
    }, { flushSync: true });
  }
  return <nav className="toolbar" aria-label="Paginação da consulta">
    <p className="muted" role="status">{total} {kind} encontrado(s) · Página {page} de {lastPage}</p>
    <div className="actions">
      <Button variant="secondary" disabled={page <= 1} onClick={() => go(Math.min(page - 1, lastPage))}>Anterior</Button>
      <Button variant="secondary" disabled={page >= lastPage} onClick={() => go(page + 1)}>Próxima</Button>
    </div>
  </nav>;
}
