import { useEffect, useRef, useState } from 'react';
import { WorkerIntegrationPanel } from './WorkerIntegrationPanel';
import { Link, useLocation, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, FileText, History, UsersRound, UserRound, ClipboardCheck } from 'lucide-react';
import { api } from '../../shared/api/client';
import { readIdentifier, useVerifiedRead } from '../../shared/lib/verified-read';
import { checkedDocumentPage } from '../documents/document-page';
import { checkedOrganization, checkedWorkerDetail, checkedWorkerMovements } from './worker-read';
import { useSession } from '../../shared/auth/SessionProvider';
import { integrationReturnDestination } from './worker-integration-navigation';
import { restoredWorkerDocumentPage, workerDocumentNavigation } from './worker-document-navigation';
import type {
  OrganizationDto,
  WorkerAssignmentReadDto as WorkerAssignment,
} from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { workerNavigation } from './worker-navigation';
import styles from './WorkerDetail.module.css';
import {
  dateLabel,
  movementLabels,
  QueryError,
  workerStatusLabels,
} from './support';

const documentLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovado',
  ACTIVE: 'Vigente',
  EXPIRED: 'Vencido',
  SUPERSEDED: 'Substituído',
  ARCHIVED: 'Arquivado',
};

export function WorkerDetailPage() {
  const { id } = useParams();
  const { unitId, sessionKey, can } = useSession();
  return <WorkerDetailContent key={JSON.stringify([id, unitId, sessionKey, can('workers.read'), can('documents.read')])} />;
}

function WorkerDetailContent() {
  const client = useQueryClient();
  const { id } = useParams();
  const { can, unitId, sessionKey } = useSession();
  const location = useLocation();
  const [movementPage, setMovementPage] = useState(1);
  const [documentPage, setDocumentPage] = useState(() => restoredWorkerDocumentPage(location.state, sessionKey, unitId, id));
  const integrationPanel = useRef<HTMLDivElement>(null);
  const canReadWorker = can('workers.read');
  const listOrigin = workerNavigation(location.state, sessionKey, unitId);

  const worker = useVerifiedRead({
    queryKey: ['worker', sessionKey, unitId, id],
    request: signal => api.get<unknown>(`/workers/${encodeURIComponent(id!)}`, { signal }),
    validate: value => checkedWorkerDetail(value, id!, unitId!),
    enabled: canReadWorker && readIdentifier(id) && readIdentifier(unitId),
  });

  const organization = useVerifiedRead({
    queryKey: ['organization', sessionKey, unitId],
    request: signal => api.get<unknown>('/organization', { signal, query: { unitId: unitId || undefined } }),
    validate: checkedOrganization,
    enabled: Boolean(worker.data) && can('organization.read'),
  });

  const movements = useVerifiedRead({
    queryKey: ['worker-movements', sessionKey, unitId, id, movementPage],
    scope: ['worker-movements', sessionKey, unitId, id],
    request: signal =>
      api.get<unknown>(`/workers/${id}/movements`, {
        signal,
        query: { page: movementPage, pageSize: 5, sort: 'effectiveDate:desc' },
      }),
    validate: value => checkedWorkerMovements(value, id!, movementPage),
    enabled: Boolean(worker.data) && can('workers.read'),
  });

  const documents = useVerifiedRead({
    queryKey: ['worker-documents', sessionKey, unitId, id, documentPage],
    scope: ['worker-documents', sessionKey, unitId, id],
    request: signal =>
      api.get<unknown>('/documents', {
        signal,
        query: { workerId: id, unitId: unitId || undefined, page: documentPage, pageSize: 5 },
      }),
    validate: value => checkedDocumentPage(value, documentPage, unitId!, 5, id, worker.data?.companyId),
    enabled: Boolean(worker.data) && can('documents.read'),
  });

  useEffect(() => {
    if (!worker.isError) return;
    for (const resource of ['worker-documents', 'worker-movements']) {
      const queryKey = [resource, sessionKey, unitId, id];
      void client.cancelQueries({ queryKey }); client.removeQueries({ queryKey });
    }
  }, [client, worker.isError, sessionKey, unitId, id]);

  useEffect(() => {
    if (location.hash !== '#integracao' || !canReadWorker || worker.isError || worker.data?.id !== id) return;
    integrationPanel.current?.focus({ preventScroll: true });
    integrationPanel.current?.scrollIntoView?.({ block: 'start' });
  }, [id, location.hash, location.key, unitId, sessionKey, canReadWorker, worker.data?.id, worker.isError]);

  useEffect(() => {
    if (!canReadWorker || worker.isError || worker.data?.id !== id || !['#vinculo', '#equipes', '#documentos', '#historico'].includes(location.hash)) return;
    const section = document.getElementById(location.hash.slice(1));
    section?.focus({ preventScroll: true });
    section?.scrollIntoView?.({ block: 'start' });
  }, [id, location.hash, location.key, canReadWorker, worker.data?.id, worker.isError]);

  if (!canReadWorker) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar este cadastro." />;
  if (!readIdentifier(id)) return <EmptyState title="Trabalhador inválido" description="Abra o cadastro pela consulta da unidade." />;
  if (!readIdentifier(unitId)) return <EmptyState title="Selecione uma unidade" />;
  if (worker.isPending) return <Spinner />;
  if (worker.isError) return <div className="stack"><QueryError error={worker.error} retry={() => void worker.refetch()} /><Link className="button button--secondary" to={listOrigin ? `/app/trabalhadores${listOrigin.workerListReturnTo.search}` : '/app/trabalhadores'} state={listOrigin}>Voltar à lista</Link></div>;
  if (!worker.data) return null;

  const data = worker.data;

  function name(collection: keyof OrganizationDto, value?: string | null) {
    return organization.data?.[collection].find(item => item.id === value)?.name || (value ? 'Vínculo registrado' : 'Não informado');
  }

  function assignmentLabel(assignment: WorkerAssignment | null | undefined) {
    return assignment
      ? `${name('units', assignment.unitId)} · ${name('sectors', assignment.sectorId)}${
          assignment.jobFunctionId ? ` · ${name('jobFunctions', assignment.jobFunctionId)}` : ''
        }`
      : 'Sem vínculo anterior';
  }

  const success = (location.state as { success?: string } | null)?.success;
  const integrationReturn = data.unitId ? integrationReturnDestination(location.state, unitId, data.unitId, can('eligibility.read')) : null;
  const origin = data.unitId === unitId ? listOrigin : undefined;
  const backHref = origin ? `/app/trabalhadores${origin.workerListReturnTo.search}` : '/app/trabalhadores';
  const documentOrigin = data.unitId === unitId ? workerDocumentNavigation({ workerDocumentReturnTo: { workerId: data.id, unitId, sessionKey, documentPage, ...origin, integrationReturnTo: (location.state as { integrationReturnTo?: unknown } | null)?.integrationReturnTo } }, sessionKey, unitId, canReadWorker, can('eligibility.read')) : undefined;
  const sections = [
    { hash: '#vinculo', label: 'Vínculo', icon: Building2 },
    ...(!data.sourceReadOnly ? [{ hash: '#integracao', label: 'Integração', icon: ClipboardCheck }] : []),
    ...(!data.sourceReadOnly || data.teams ? [{ hash: '#equipes', label: 'Equipes', icon: UsersRound }] : []),
    { hash: '#documentos', label: 'Documentos', icon: FileText },
    { hash: '#historico', label: 'Histórico', icon: History },
  ];

  return (
    <div className={styles.workspace}>
      <PageHeader
        eyebrow={`Trabalhador 360° · Matrícula ${data.registration}`}
        title={data.fullName}
        description="Vínculo, documentos permitidos, integração administrativa e histórico."
        actions={
          <div className="actions">
            {integrationReturn && (
              <Link className="button button--secondary" to={integrationReturn.to} state={integrationReturn.state}>
                {integrationReturn.label}
              </Link>
            )}
            <Link className="button button--secondary" to={backHref} state={origin}>
              <ArrowLeft size={15} aria-hidden="true" />Voltar à lista
            </Link>
            {can('workers.write') && !data.sourceReadOnly && (
              <>
                <Link className="button button--secondary" to={`/app/trabalhadores/${id}/editar`} state={origin}>
                  Editar cadastro
                </Link>
                <Link className="button button--primary" to={`/app/trabalhadores/${id}/movimentacoes/nova`} state={origin}>
                  Registrar movimentação
                </Link>
              </>
            )}
          </div>
        }
      />
      {success && <Feedback tone="success">{success}</Feedback>}

      <nav className={styles.sections} aria-label="Seções da ficha do trabalhador">
        {sections.map(section => <Link key={section.hash} to={{ pathname: location.pathname, search: location.search, hash: section.hash }} state={location.state} replace aria-current={location.hash === section.hash ? 'location' : undefined}><section.icon size={15} aria-hidden="true" />{section.label}</Link>)}
      </nav>

      {/* Vínculo atual */}
      <section id="vinculo" tabIndex={-1} className={`panel stack ${styles.section}`} aria-labelledby="worker-details-heading">
        <div className={styles.sectionHeader}>
          <h2 id="worker-details-heading"><UserRound size={18} aria-hidden="true" />Vínculo atual</h2>
          <Badge tone={data.status === 'ACTIVE' ? 'success' : data.status === 'ON_LEAVE' ? 'warning' : 'neutral'}>
            {workerStatusLabels[data.status]}
          </Badge>
        </div>
        <dl className={styles.assignment}>
          <div>
            <dt className="muted">Empresa</dt>
            <dd>{name('companies', data.companyId)}</dd>
          </div>
          <div>
            <dt className="muted">Unidade / setor</dt>
            <dd>
              {name('units', data.unitId)} / {name('sectors', data.sectorId)}
            </dd>
          </div>
          <div>
            <dt className="muted">Cargo / função</dt>
            <dd>
              {name('jobs', data.jobId)} / {name('jobFunctions', data.jobFunctionId)}
            </dd>
          </div>
          <div>
            <dt className="muted">Tipo de vínculo</dt>
            <dd>{data.employmentType || 'Não informado'}</dd>
          </div>
          <div>
            <dt className="muted">Admissão</dt>
            <dd>{dateLabel(data.admissionDate)}</dd>
          </div>
          <div>
            <dt className="muted">Centro de trabalho</dt>
            <dd>{name('workCenters', data.workCenterId)}</dd>
          </div>
        </dl>
        {organization.isError && <QueryError error={organization.error} retry={() => void organization.refetch()} />}
      </section>

      {!data.sourceReadOnly && <div id="integracao" className={styles.section} ref={integrationPanel} tabIndex={-1} role="region" aria-label="Integração administrativa do trabalhador">
        <WorkerIntegrationPanel worker={data} />
      </div>}

      {/* Equipes de trabalho vinculadas */}
      {(!data.sourceReadOnly || data.teams) && <section id="equipes" tabIndex={-1} className={`panel stack ${styles.section}`} aria-labelledby="worker-teams-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="worker-teams-heading"><UsersRound size={18} aria-hidden="true" />Equipes de trabalho vinculadas</h2>
            <p className="muted">Participação em equipes operacionais desta unidade.</p>
          </div>
        </div>
        {data.teams && data.teams.length > 0 ? (
          <div className={styles.tableWrap}>
            <table role="table" aria-label="Equipes vinculadas" className={`data-table ${styles.relatedTable}`}>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col">Equipe</th>
                  <th scope="col">Função no serviço</th>
                  <th scope="col">Papel na equipe</th>
                  <th scope="col">Situação</th>
                  <th scope="col"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.teams.map(team => (
                  <tr role="row" key={team.teamId}>
                    <td role="cell" className={styles.fullCell}><strong>{team.teamName}</strong></td>
                    <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Função no serviço</span>{team.serviceFunction}</td>
                    <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Papel na equipe</span>
                      {team.isChief ? (
                        <Badge tone="info">Chefe da equipe</Badge>
                      ) : (
                        <span className="muted">Membro</span>
                      )}
                    </td>
                    <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Situação</span>
                      <Badge tone={team.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {team.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </td>
                    <td role="cell" className={styles.fullCell}>
                      {can('teams.read') ? <Link className={styles.relatedAction} to={`/app/equipes?q=${encodeURIComponent(team.teamName)}`}>
                        Ver equipe →
                      </Link> : <span className="muted">Consulta da equipe não habilitada</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Nenhuma equipe vinculada"
            description="Este trabalhador ainda não participa de nenhuma equipe operacional nesta unidade."
          />
        )}
      </section>}

      {/* Documentos vinculados */}
      <section id="documentos" tabIndex={-1} className={`panel stack ${styles.section}`} aria-labelledby="worker-documents-heading">
        <div className={styles.sectionHeader}><h2 id="worker-documents-heading"><FileText size={18} aria-hidden="true" />Documentos vinculados</h2></div>
        {!can('documents.read') ? (
          <EmptyState
            title="Consulta documental não habilitada"
            description="Seu perfil não possui permissão para consultar documentos."
          />
        ) : (
          <>
            {documents.isPending && <Spinner />}
            {documents.isError && <QueryError error={documents.error} retry={() => void documents.refetch()} />}
            {documents.data && !documents.isError && (documents.data.items.length ? (
              <>
                <div className={styles.tableWrap}>
                  <table role="table" aria-label="Documentos vinculados" className={`data-table ${styles.relatedTable}`}>
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col">Documento</th>
                        <th scope="col">Situação</th>
                        <th scope="col">Validade</th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {documents.data.items.map(document => (
                        <tr role="row" key={document.id}>
                          <td role="cell" className={styles.fullCell}>
                            <Link to={`/app/documentos/${encodeURIComponent(document.id)}`} state={documentOrigin}>{document.title}</Link>
                            <span className="muted" style={{ display: 'block' }}>
                              {document.code}
                            </span>
                          </td>
                          <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Situação</span>
                            <Badge tone={document.status === 'ACTIVE' ? 'success' : document.status === 'EXPIRED' ? 'danger' : 'neutral'}>
                              {documentLabels[document.status]}
                            </Badge>
                          </td>
                          <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Validade</span>{document.validUntil ? dateLabel(document.validUntil) : 'Não informada'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="toolbar">
                  <p className="muted">
                    {documents.data.total} documento(s) · Página {documentPage}
                  </p>
                  <div className="actions">
                    <Button variant="secondary" disabled={documentPage <= 1 || documents.isFetching} onClick={() => setDocumentPage(page => page - 1)}>
                      Documentos anteriores
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={documentPage * documents.data.pageSize >= documents.data.total || documents.isFetching}
                      onClick={() => setDocumentPage(page => page + 1)}
                    >
                      Próximos documentos
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="Nenhum documento disponível"
                description="Não há documentos vinculados que possam ser consultados pelo seu perfil."
              />
            ))}
          </>
        )}
      </section>

      {/* Histórico de movimentações */}
      <section id="historico" tabIndex={-1} className={`panel stack ${styles.section}`} aria-labelledby="worker-movements-heading">
        <div className={styles.sectionHeader}><h2 id="worker-movements-heading"><History size={18} aria-hidden="true" />Histórico de movimentações</h2></div>
        {movements.isPending && <Spinner />}
        {movements.isError && <QueryError error={movements.error} retry={() => void movements.refetch()} />}
        {movements.data && !movements.isError && (movements.data.items.length ? (
          <>
            <ol className={styles.timeline}>
              {movements.data.items.map(movement => (
                <li key={movement.id}>
                  <div>
                    <strong>{movementLabels[movement.type]}</strong>
                    <time dateTime={movement.effectiveDate}>{dateLabel(movement.effectiveDate)}</time>
                  </div>
                  {movement.reason && <p>{movement.reason}</p>}
                  {movement.previousAssignment && (
                    <p className="muted">Anterior: {assignmentLabel(movement.previousAssignment)}</p>
                  )}
                  {movement.newAssignment && (
                    <p className="muted">{movement.type === 'ASSIGNMENT' ? 'Vínculo' : 'Novo vínculo'}: {assignmentLabel(movement.newAssignment)}</p>
                  )}
                </li>
              ))}
            </ol>
            <div className="toolbar">
              <p className="muted">
                {movements.data.total} movimentação(ões) · Página {movementPage}
              </p>
              <div className="actions">
                <Button variant="secondary" disabled={movementPage <= 1 || movements.isFetching} onClick={() => setMovementPage(page => page - 1)}>
                  Histórico anterior
                </Button>
                <Button
                  variant="secondary"
                  disabled={movementPage * movements.data.pageSize >= movements.data.total || movements.isFetching}
                  onClick={() => setMovementPage(page => page + 1)}
                >
                  Próxima página do histórico
                </Button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="Nenhuma movimentação registrada"
            description="O histórico será apresentado aqui após o primeiro registro."
          />
        ))}
      </section>

    </div>
  );
}
