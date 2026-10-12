import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { WorkerDto, WorkerMovementDto, OrganizationDto, PageDto, DocumentDto, WorkerAssignment } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { dateLabel, movementLabels, QueryError, workerStatusLabels } from './support';

const documentLabels: Record<string, string> = { DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão', APPROVED: 'Aprovado', ACTIVE: 'Vigente', EXPIRED: 'Vencido', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado' };

export function WorkerDetailPage() {
  const { id } = useParams();
  const { can, unitId, sessionKey } = useSession();
  const location = useLocation();
  const [movementPage, setMovementPage] = useState(1);
  const [documentPage, setDocumentPage] = useState(1);
  const worker = useQuery({ queryKey: ['worker', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<WorkerDto>(`/workers/${id}`, { signal }), enabled: can('workers.read') && Boolean(id) });
  const organization = useQuery({ queryKey: ['organization', sessionKey, unitId], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }), enabled: can('organization.read') });
  const movements = useQuery({ queryKey: ['worker-movements', sessionKey, unitId, id, movementPage], queryFn: ({ signal }) => api.get<PageDto<WorkerMovementDto>>(`/workers/${id}/movements`, { signal, query: { page: movementPage, pageSize: 5, sort: 'effectiveDate:desc' } }), enabled: Boolean(worker.data) && can('workers.read') });
  const documents = useQuery({ queryKey: ['worker-documents', sessionKey, unitId, id, documentPage], queryFn: ({ signal }) => api.get<PageDto<DocumentDto>>('/documents', { signal, query: { workerId: id, unitId: unitId || undefined, page: documentPage, pageSize: 5 } }), enabled: Boolean(worker.data) && can('documents.read') });
  if (!can('workers.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar este cadastro." />;
  if (worker.isPending) return <Spinner />;
  if (worker.isError) return <QueryError error={worker.error} retry={() => void worker.refetch()} />;
  if (!worker.data) return null;
  const data = worker.data;
  function name(collection: keyof OrganizationDto, value?: string) { return organization.data?.[collection].find(item => item.id === value)?.name || (value ? 'Vínculo registrado' : 'Não informado'); }
  function assignmentLabel(assignment: WorkerAssignment | null | undefined) { return assignment ? `${name('units', assignment.unitId)} · ${name('sectors', assignment.sectorId)}${assignment.jobFunctionId ? ` · ${name('jobFunctions', assignment.jobFunctionId)}` : ''}` : 'Sem vínculo anterior'; }
  const success = (location.state as { success?: string } | null)?.success;
  return <>
    <PageHeader eyebrow={`Trabalhador 360° · Matrícula ${data.registration}`} title={data.fullName} description="Vínculo, documentos permitidos e histórico administrativo." actions={<div className="actions"><Link className="button button--secondary" to="/app/trabalhadores">Voltar à lista</Link>{can('workers.write') && <><Link className="button button--secondary" to={`/app/trabalhadores/${id}/editar`}>Editar cadastro</Link><Link className="button button--primary" to={`/app/trabalhadores/${id}/movimentacoes/nova`}>Registrar movimentação</Link></>}</div>} />
    {success && <Feedback tone="success">{success}</Feedback>}
    <section className="panel stack" aria-labelledby="worker-details-heading"><div className="toolbar"><h2 id="worker-details-heading">Vínculo atual</h2><Badge tone={data.status === 'ACTIVE' ? 'success' : data.status === 'ON_LEAVE' ? 'warning' : 'neutral'}>{workerStatusLabels[data.status]}</Badge></div><dl className="form-grid"><div><dt className="muted">Empresa</dt><dd>{name('companies', data.companyId)}</dd></div><div><dt className="muted">Unidade / setor</dt><dd>{name('units', data.unitId)} / {name('sectors', data.sectorId)}</dd></div><div><dt className="muted">Cargo / função</dt><dd>{name('jobs', data.jobId)} / {name('jobFunctions', data.jobFunctionId)}</dd></div><div><dt className="muted">Tipo de vínculo</dt><dd>{data.employmentType}</dd></div><div><dt className="muted">Admissão</dt><dd>{dateLabel(data.admissionDate)}</dd></div><div><dt className="muted">Centro de trabalho</dt><dd>{name('workCenters', data.workCenterId)}</dd></div></dl>{organization.isError && <QueryError error={organization.error} retry={() => void organization.refetch()} />}</section>
    <section className="panel stack" aria-labelledby="worker-documents-heading"><h2 id="worker-documents-heading">Documentos vinculados</h2>
      {!can('documents.read') ? <EmptyState title="Consulta documental não habilitada" description="Seu perfil não possui permissão para consultar documentos." /> : <>
        {documents.isPending && <Spinner />}{documents.isError && <QueryError error={documents.error} retry={() => void documents.refetch()} />}
        {documents.data && !documents.isError && (documents.data.items.length ? <><div className="table-wrap"><table className="data-table"><thead><tr><th>Documento</th><th>Situação</th><th>Validade</th></tr></thead><tbody>{documents.data.items.map(document => <tr key={document.id}><td><Link to={`/app/documentos/${document.id}`}>{document.title}</Link><span className="muted" style={{ display: 'block' }}>{document.code}</span></td><td><Badge tone={document.status === 'ACTIVE' ? 'success' : document.status === 'EXPIRED' ? 'danger' : 'neutral'}>{documentLabels[document.status]}</Badge></td><td>{document.validUntil ? dateLabel(document.validUntil) : 'Não se aplica'}</td></tr>)}</tbody></table></div><div className="toolbar"><p className="muted">{documents.data.total} documento(s) · Página {documentPage}</p><div className="actions"><Button variant="secondary" disabled={documentPage <= 1} onClick={() => setDocumentPage(page => page - 1)}>Documentos anteriores</Button><Button variant="secondary" disabled={documentPage * documents.data.pageSize >= documents.data.total} onClick={() => setDocumentPage(page => page + 1)}>Próximos documentos</Button></div></div></> : <EmptyState title="Nenhum documento disponível" description="Não há documentos vinculados que possam ser consultados pelo seu perfil." />)}
      </>}
    </section>
    <section className="panel stack" aria-labelledby="worker-movements-heading"><h2 id="worker-movements-heading">Histórico de movimentações</h2>{movements.isPending && <Spinner />}{movements.isError && <QueryError error={movements.error} retry={() => void movements.refetch()} />}{movements.data && !movements.isError && (movements.data.items.length ? <><ol className="stack" style={{ paddingLeft: '1.25rem' }}>{movements.data.items.map(movement => <li key={movement.id}><div className="toolbar"><strong>{movementLabels[movement.type]}</strong><time dateTime={movement.effectiveDate}>{dateLabel(movement.effectiveDate)}</time></div><p>{movement.reason}</p>{movement.previousAssignment && <p className="muted">Anterior: {assignmentLabel(movement.previousAssignment)}</p>}{movement.newAssignment && <p className="muted">Novo vínculo: {assignmentLabel(movement.newAssignment)}</p>}</li>)}</ol><div className="toolbar"><p className="muted">{movements.data.total} movimentação(ões) · Página {movementPage}</p><div className="actions"><Button variant="secondary" disabled={movementPage <= 1} onClick={() => setMovementPage(page => page - 1)}>Histórico anterior</Button><Button variant="secondary" disabled={movementPage * movements.data.pageSize >= movements.data.total} onClick={() => setMovementPage(page => page + 1)}>Próxima página do histórico</Button></div></div></> : <EmptyState title="Nenhuma movimentação registrada" description="O histórico será apresentado aqui após o primeiro registro." />)}</section>
    <section className="panel"><h2>Saúde e prevenção</h2><p className="muted">Exposições, ASOs, EPIs, treinamentos e ocorrências serão disponibilizados nas próximas etapas do projeto, conforme as permissões de acesso. Esta versão apresenta o cadastro e os documentos autorizados.</p></section>
  </>;
}
