import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, FolderOpen, ClipboardCheck, Search, MapPin, Calendar, Clock, Filter, ArrowUpRight } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type {
  DocumentDto,
  DocumentTypeDto,
  PageDto,
  WorkerDto,
} from '../../shared/contracts';
import type {
  FinalReviewStatus,
  OperationStatus,
  PermitOptionsDto,
  WorkPermitDto,
} from '../../shared/contracts/work-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
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

type ActiveTab = 'documents' | 'permits';

export function ConsultationPage() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const activeTab: ActiveTab = params.get('tab') === 'permits' ? 'permits' : 'documents';

  function switchTab(nextTab: ActiveTab) {
    setParams(prev => {
      const next = new URLSearchParams();
      next.set('tab', nextTab);
      return next;
    });
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="BUSCA E AUDITORIA OPERACIONAL"
        title="Central de consulta unificada"
        description="Pesquise documentos controlados e permissões de trabalho com filtros avançados, paginação e rastreabilidade."
      />

      <div className={styles.tabBar} role="tablist" aria-label="Abas de consulta">
        {can('documents.read') && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'documents'}
            className={`${styles.tabBtn} ${activeTab === 'documents' ? styles.tabBtnActive : ''}`}
            onClick={() => switchTab('documents')}
          >
            <FolderOpen size={17} aria-hidden="true" />
            <span>Documentos controlados</span>
          </button>
        )}
        {can('permits.read') && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'permits'}
            className={`${styles.tabBtn} ${activeTab === 'permits' ? styles.tabBtnActive : ''}`}
            onClick={() => switchTab('permits')}
          >
            <ClipboardCheck size={17} aria-hidden="true" />
            <span>Permissões de trabalho (PTs)</span>
          </button>
        )}
      </div>

      {activeTab === 'documents' && <DocumentsSearchTab />}
      {activeTab === 'permits' && <PermitsSearchTab />}
    </div>
  );
}

function DocumentsSearchTab() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useSearchParams();
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

  useEffect(() => {
    setSearch(q);
    setDraftType(typeId);
    setDraftStatus(status);
    setDraftWorker(workerId);
    setDraftValidFrom(validUntilFrom);
    setDraftValidTo(validUntilTo);
  }, [q, typeId, status, workerId, validUntilFrom, validUntilTo]);

  const hasFilters = Boolean(q || typeId || status || workerId || validUntilFrom || validUntilTo);

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
    enabled: can('documents.read'),
  });

  const types = useQuery({
    queryKey: ['document-types', sessionKey],
    queryFn: ({ signal }) =>
      api.get<PageDto<DocumentTypeDto>>('/document-types', { signal, query: { pageSize: 100, activeOnly: true } }),
    enabled: can('documents.read'),
  });

  const workers = useQuery({
    queryKey: ['workers', 'consulta-filter', sessionKey, unitId],
    queryFn: ({ signal }) =>
      api.get<PageDto<WorkerDto>>('/workers', { signal, query: { unitId: unitId || undefined, pageSize: 100 } }),
    enabled: can('workers.read'),
  });

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    if (draftValidFrom && !isCivilDate(draftValidFrom)) {
      setValidationError('Data inicial de vencimento inválida.');
      return;
    }
    if (draftValidTo && !isCivilDate(draftValidTo)) {
      setValidationError('Data final de vencimento inválida.');
      return;
    }
    if (draftValidFrom && draftValidTo && draftValidFrom > draftValidTo) {
      setValidationError('A data final deve ser igual ou posterior à data inicial.');
      return;
    }
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
    });
  }

  function handleClear() {
    setSearch('');
    setDraftType('');
    setDraftStatus('');
    setDraftWorker('');
    setDraftValidFrom('');
    setDraftValidTo('');
    setValidationError('');
    setParams(new URLSearchParams({ tab: 'documents' }));
  }

  return (
    <section className="panel stack" aria-label="Consulta de documentos controlados">
      <form onSubmit={handleSearch} className="stack">
        <div className="toolbar">
          <Field label="Buscar título ou código">
            <input
              type="search"
              placeholder="Ex.: Relatório, PGR, ASO, DOC-001…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            <Search size={15} /> Pesquisar
          </Button>
          {hasFilters && (
            <Button type="button" variant="ghost" onClick={handleClear}>
              Limpar filtros
            </Button>
          )}
        </div>

        {validationError && <Feedback tone="danger">{validationError}</Feedback>}

        <div className="form-grid">
          <Field label="Tipo documental">
            <select value={draftType} onChange={e => setDraftType(e.target.value)}>
              <option value="">Todos os tipos</option>
              {types.data?.items.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Situação">
            <select value={draftStatus} onChange={e => setDraftStatus(e.target.value)}>
              <option value="">Todas as situações</option>
              {documentStatuses.map(st => (
                <option key={st} value={st}>{docStatusLabels[st]}</option>
              ))}
            </select>
          </Field>

          {can('workers.read') && (
            <Field label="Trabalhador vinculado">
              <select value={draftWorker} onChange={e => setDraftWorker(e.target.value)}>
                <option value="">Todos os trabalhadores</option>
                {workers.data?.items.map(w => (
                  <option key={w.id} value={w.id}>{w.fullName} ({w.registration})</option>
                ))}
              </select>
            </Field>
          )}

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

      {documents.isPending && <Spinner />}
      {documents.isError && <Feedback tone="danger">{docErrorMessage(documents.error)}</Feedback>}

      {documents.data && !documents.isError && (
        documents.data.items.length ? (
          <>
            <div className="table-wrap">
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
                    const typeObj = types.data?.items.find(t => t.id === doc.typeId);
                    return (
                      <tr key={doc.id}>
                        <td>
                          <Link
                            to={`/app/documentos/${doc.id}`}
                            state={{ fromSearch: location.search, fromConsulta: true }}
                          >
                            <strong>{doc.title}</strong>
                          </Link>
                          <span className="muted" style={{ display: 'block' }}>{doc.code}</span>
                        </td>
                        <td>{typeObj?.name || 'Tipo padrão'}</td>
                        <td>
                          <DocumentStatus status={doc.status} />
                        </td>
                        <td>{doc.validUntil ? formatDate(doc.validUntil) : 'Não expira'}</td>
                        <td>{formatDate(doc.issueDate)}</td>
                        <td>
                          <Link
                            to={`/app/documentos/${doc.id}`}
                            state={{ fromSearch: location.search, fromConsulta: true }}
                            aria-label={`Abrir ${doc.title}`}
                          >
                            Consultar →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              <p className="muted">
                {documents.data.total} documento(s) encontrado(s) · Página {page} de{' '}
                {Math.max(1, Math.ceil(documents.data.total / documents.data.pageSize))}
              </p>
              <div className="actions">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() =>
                    setParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.set('page', String(page - 1));
                      return next;
                    })
                  }
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  disabled={page * documents.data.pageSize >= documents.data.total}
                  onClick={() =>
                    setParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.set('page', String(page + 1));
                      return next;
                    })
                  }
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'Nenhum documento encontrado' : 'Nenhum documento disponível'}
            description={hasFilters ? 'Revise os filtros aplicados para consultar outros registros.' : 'Não há documentos no seu alcance de acesso nesta unidade.'}
          />
        )
      )}
    </section>
  );
}

function PermitsSearchTab() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useSearchParams();
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

  useEffect(() => {
    setSearch(q);
    setDraftOp(operationStatus);
    setDraftReview(reviewStatus);
    setDraftTeam(teamId);
  }, [q, operationStatus, reviewStatus, teamId]);

  const hasFilters = Boolean(q || operationStatus || reviewStatus || teamId);

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
    enabled: can('permits.read'),
  });

  const permitItems: WorkPermitDto[] = useMemo(() => {
    if (!permits.data) return [];
    if (Array.isArray(permits.data)) return permits.data;
    return permits.data.items || [];
  }, [permits.data]);

  const totalCount = useMemo(() => {
    if (!permits.data) return 0;
    if (Array.isArray(permits.data)) return permits.data.length;
    return permits.data.total;
  }, [permits.data]);

  const pageSize = 10;

  function handleSearch(event: FormEvent) {
    event.preventDefault();
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
    });
  }

  function handleClear() {
    setSearch('');
    setDraftOp('');
    setDraftReview('');
    setDraftTeam('');
    setParams(new URLSearchParams({ tab: 'permits' }));
  }

  return (
    <section className="panel stack" aria-label="Consulta de permissões de trabalho">
      <form onSubmit={handleSearch} className="stack">
        <div className="toolbar">
          <Field label="Buscar PT">
            <input
              type="search"
              placeholder="Número, serviço, local ou equipe…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            <Search size={15} /> Pesquisar
          </Button>
          {hasFilters && (
            <Button type="button" variant="ghost" onClick={handleClear}>
              Limpar filtros
            </Button>
          )}
        </div>

        <div className="form-grid">
          <Field label="Situação operacional">
            <select value={draftOp} onChange={e => setDraftOp(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(operationLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </Field>

          <Field label="Revisão do encerramento">
            <select value={draftReview} onChange={e => setDraftReview(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(reviewLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </Field>

          {options.data && options.data.teams.length > 0 && (
            <Field label="Equipe operacional">
              <select value={draftTeam} onChange={e => setDraftTeam(e.target.value)}>
                <option value="">Todas as equipes</option>
                {options.data.teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </form>

      {permits.isPending && <Spinner />}
      {permits.isError && <Feedback tone="danger">{permitErrorMessage(permits.error)}</Feedback>}

      {permits.data && !permits.isError && (
        permitItems.length ? (
          <>
            <div className="table-wrap">
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
                          state={{ fromSearch: location.search, fromConsulta: true }}
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
                          state={{ fromSearch: location.search, fromConsulta: true }}
                          aria-label={`Abrir ${permit.code}`}
                        >
                          Consultar →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="toolbar">
              <p className="muted">
                {totalCount} atendimento(s) encontrado(s) · Página {page} de{' '}
                {Math.max(1, Math.ceil(totalCount / pageSize))}
              </p>
              <div className="actions">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() =>
                    setParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.set('page', String(page - 1));
                      return next;
                    })
                  }
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  disabled={page * pageSize >= totalCount}
                  onClick={() =>
                    setParams(prev => {
                      const next = new URLSearchParams(prev);
                      next.set('page', String(page + 1));
                      return next;
                    })
                  }
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'Nenhuma PT encontrada' : 'Nenhuma PT disponível'}
            description={hasFilters ? 'Ajuste os filtros para pesquisar outros atendimentos.' : 'Não há atendimentos de PT cadastrados para o seu escopo nesta unidade.'}
          />
        )
      )}
    </section>
  );
}
