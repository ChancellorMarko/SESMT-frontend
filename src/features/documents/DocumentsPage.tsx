import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentTypeDto, PageDto, WorkerDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { DocumentStatus } from './DocumentStatus';
import { documentStatuses, errorMessage, formatDate, isCivilDate, statusLabels } from './validation';
import { positivePage } from './expiry';

const filterKeys = ['q', 'typeId', 'status', 'workerId', 'responsibleId', 'validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo'] as const;
type Filters = Record<typeof filterKeys[number], string>;
const readFilters = (params: URLSearchParams): Filters => Object.fromEntries(filterKeys.map((key) => [key, params.get(key) ?? ''])) as Filters;

export function DocumentsPage() {
  const { unitId, sessionKey, can } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const [search, setSearch] = useState(filters.q);
  const [draftFilters, setDraftFilters] = useState(filters);
  const page = positivePage(searchParams.get('page'));
  const [filterError, setFilterError] = useState('');
  const appliedIntervalInvalid = Boolean(['validUntilFrom','validUntilTo','issueDateFrom','issueDateTo'].some(key => filters[key as keyof Filters] && !isCivilDate(filters[key as keyof Filters])) || (filters.validUntilFrom && filters.validUntilTo && filters.validUntilFrom > filters.validUntilTo) || (filters.issueDateFrom && filters.issueDateTo && filters.issueDateFrom > filters.issueDateTo));
  useEffect(() => { setSearch(filters.q); setDraftFilters(filters); setFilterError(''); }, [filters]);
  useEffect(() => {
    const previousUnitId = searchParams.get('unitId');
    if (!unitId || !previousUnitId || previousUnitId === unitId) return;
    const next = new URLSearchParams(searchParams);
    next.set('unitId', unitId); next.delete('workerId'); next.delete('responsibleId'); next.delete('page');
    setSearchParams(next, { replace: true });
  }, [unitId, searchParams, setSearchParams]);
  const list = useQuery({ queryKey: ['documents', sessionKey, unitId, page, filters], queryFn: ({ signal }) => api.get<PageDto<DocumentDto>>('/documents', { signal, query: { unitId, page, pageSize: 10, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) } }), enabled: !appliedIntervalInvalid });
  const types = useQuery({ queryKey: ['document-types', sessionKey], queryFn: ({ signal }) => api.get<PageDto<DocumentTypeDto>>('/document-types', { signal, query: { pageSize: 100, activeOnly: true } }) });
  const workers = useQuery({ queryKey: ['workers', 'document-filter', sessionKey, unitId], queryFn: ({ signal }) => api.get<PageDto<WorkerDto>>('/workers', { signal, query: { unitId, pageSize: 100 } }), enabled: can('workers.read') });
  const assignees = useQuery({ queryKey: ['assignees', 'document-filter', sessionKey, unitId], queryFn: ({ signal }) => api.get<PageDto<{ id: string; displayName: string }>>('/assignees', { signal, query: { unitId, purpose: 'DOCUMENT_RESPONSIBLE', pageSize: 100 } }), enabled: Boolean(unitId) && can('documents.write') });
  function searchDocuments(event: FormEvent) {
    event.preventDefault();
    if (['validUntilFrom','validUntilTo','issueDateFrom','issueDateTo'].some(key => draftFilters[key as keyof Filters] && !isCivilDate(draftFilters[key as keyof Filters]))) { setFilterError('Informe datas válidas para os intervalos da consulta.'); return; }
    if (draftFilters.validUntilFrom && draftFilters.validUntilTo && draftFilters.validUntilFrom > draftFilters.validUntilTo) { setFilterError('O fim do intervalo de validade deve ser igual ou posterior ao início.'); return; }
    if (draftFilters.issueDateFrom && draftFilters.issueDateTo && draftFilters.issueDateFrom > draftFilters.issueDateTo) { setFilterError('O fim do período de emissão deve ser igual ou posterior ao início.'); return; }
    const next = new URLSearchParams(searchParams);
    filterKeys.forEach((key) => next.delete(key)); next.delete('page');
    Object.entries({ ...draftFilters, q: search.trim() }).forEach(([key, value]) => { if (value) next.set(key, value); });
    if (unitId) next.set('unitId', unitId);
    setFilterError(''); setSearchParams(next);
  }
  function setPage(nextPage: number) { const next = new URLSearchParams(searchParams); next.set('page', String(nextPage)); setSearchParams(next); }
  return <div className="stack">
    <PageHeader eyebrow="REPOSITÓRIO CONTROLADO" title="Documentos" description="Consulte vigências, acompanhe versões e encontre as evidências da sua unidade." actions={can('documents.write') ? <Link className="button button--primary" to="/app/documentos/novo">Novo documento</Link> : undefined} />
    <form className="panel stack" onSubmit={searchDocuments}>
      <div className="toolbar"><Field label="Buscar por título ou código"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ex.: PGR, relatório, DOC-001" maxLength={200} /></Field><Button type="submit">Buscar</Button></div>
      <div className="form-grid">
        <Field label="Tipo documental"><select value={draftFilters.typeId} onChange={(event) => setDraftFilters({ ...draftFilters, typeId: event.target.value })}><option value="">Todos os tipos</option>{types.data?.items.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
        <Field label="Situação"><select value={draftFilters.status} onChange={(event) => setDraftFilters({ ...draftFilters, status: event.target.value })}><option value="">Todas as situações</option>{documentStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></Field>
        {can('workers.read') && <Field label="Trabalhador"><select value={draftFilters.workerId} onChange={(event) => setDraftFilters({ ...draftFilters, workerId: event.target.value })}><option value="">Todos os trabalhadores</option>{workers.data?.items.map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName} · {worker.registration}</option>)}</select></Field>}
        {can('documents.write') && unitId && <Field label="Responsável"><select value={draftFilters.responsibleId} onChange={(event) => setDraftFilters({ ...draftFilters, responsibleId: event.target.value })}><option value="">Todos os responsáveis</option>{assignees.data?.items.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></Field>}
        <Field label="Vencimento a partir de"><input type="date" value={draftFilters.validUntilFrom} onChange={(event) => setDraftFilters({ ...draftFilters, validUntilFrom: event.target.value })} /></Field>
        <Field label="Vencimento até"><input type="date" value={draftFilters.validUntilTo} onChange={(event) => setDraftFilters({ ...draftFilters, validUntilTo: event.target.value })} /></Field>
        <Field label="Emissão a partir de"><input type="date" value={draftFilters.issueDateFrom} onChange={(event) => setDraftFilters({ ...draftFilters, issueDateFrom: event.target.value })} /></Field>
        <Field label="Emissão até"><input type="date" value={draftFilters.issueDateTo} onChange={(event) => setDraftFilters({ ...draftFilters, issueDateTo: event.target.value })} /></Field>
      </div>
      {filterError && <Feedback tone="danger">{filterError}</Feedback>}
      {appliedIntervalInvalid && !filterError && <Feedback tone="danger">O intervalo informado no endereço é inválido. Corrija as datas e aplique a busca.</Feedback>}
      {(types.isError || workers.isError || assignees.isError) && <Feedback tone="warning">Algumas opções de filtro não foram carregadas. Recarregue a página para tentar novamente.</Feedback>}
    </form>
    {appliedIntervalInvalid ? <EmptyState title="Corrija o intervalo da consulta" description="A busca será realizada depois de aplicar datas válidas." /> : list.isPending ? <Spinner /> : list.isError ? <div className="panel stack"><Feedback tone="danger">{errorMessage(list.error)}</Feedback><Button variant="secondary" onClick={() => list.refetch()}>Tentar novamente</Button></div> : !list.data?.items.length ? <div><EmptyState title="Nenhum documento encontrado" description={page > 1 ? 'Esta página não possui resultados. Volte à primeira página para consultar os documentos.' : 'Ajuste os filtros ou cadastre o primeiro documento autorizado para esta unidade.'} />{page > 1 && <Button variant="secondary" onClick={() => setPage(1)}>Voltar à primeira página</Button>}</div> : <div className="panel stack">
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Documento</th><th>Tipo</th><th>Situação</th><th>Validade</th><th>Versões vigentes</th></tr></thead><tbody>{list.data.items.map((document) => <tr key={document.id}><td><Link to={`/app/documentos/${document.id}`}><strong>{document.title}</strong></Link><div className="muted">{document.code}</div></td><td>{types.data?.items.find((type) => type.id === document.typeId)?.name ?? 'Tipo documental'}</td><td><DocumentStatus status={document.status} /></td><td>{formatDate(document.validUntil)}</td><td>{document.activeVersionIds?.length ?? (document.activeVersionId ? 1 : 0)}</td></tr>)}</tbody></table></div>
      <div className="toolbar"><span className="muted">{list.data.total} documento(s) · Página {page} de {Math.max(1, Math.ceil(list.data.total / 10))}</span><div className="actions"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page * 10 >= list.data.total} onClick={() => setPage(page + 1)}>Próxima</Button></div></div>
    </div>}
  </div>;
}
