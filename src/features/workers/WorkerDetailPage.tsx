import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type {
  WorkerDto,
  WorkerMovementDto,
  OrganizationDto,
  PageDto,
  DocumentDto,
  WorkerAssignment,
  IntegrationStatus,
} from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import {
  dateLabel,
  movementLabels,
  QueryError,
  workerStatusLabels,
  integrationStatusLabels,
  integrationStatusTone,
  errorMessage,
  todayCivil,
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
  const { can, unitId, sessionKey } = useSession();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [movementPage, setMovementPage] = useState(1);
  const [documentPage, setDocumentPage] = useState(1);

  // Integration form state
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [formStatus, setFormStatus] = useState<IntegrationStatus>('INTEGRATED');
  const [formIntegratedAt, setFormIntegratedAt] = useState(todayCivil());
  const [formValidUntil, setFormValidUntil] = useState('');
  const [formResponsibleName, setFormResponsibleName] = useState('');
  const [formEvidenceFileName, setFormEvidenceFileName] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submittingIntegration, setSubmittingIntegration] = useState(false);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);

  const worker = useQuery({
    queryKey: ['worker', sessionKey, unitId, id],
    queryFn: ({ signal }) => api.get<WorkerDto>(`/workers/${id}`, { signal }),
    enabled: can('workers.read') && Boolean(id),
  });

  const organization = useQuery({
    queryKey: ['organization', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal, query: { unitId: unitId || undefined } }),
    enabled: can('organization.read'),
  });

  const movements = useQuery({
    queryKey: ['worker-movements', sessionKey, unitId, id, movementPage],
    queryFn: ({ signal }) =>
      api.get<PageDto<WorkerMovementDto>>(`/workers/${id}/movements`, {
        signal,
        query: { page: movementPage, pageSize: 5, sort: 'effectiveDate:desc' },
      }),
    enabled: Boolean(worker.data) && can('workers.read'),
  });

  const documents = useQuery({
    queryKey: ['worker-documents', sessionKey, unitId, id, documentPage],
    queryFn: ({ signal }) =>
      api.get<PageDto<DocumentDto>>('/documents', {
        signal,
        query: { workerId: id, unitId: unitId || undefined, page: documentPage, pageSize: 5 },
      }),
    enabled: Boolean(worker.data) && can('documents.read'),
  });

  if (!can('workers.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar este cadastro." />;
  if (worker.isPending) return <Spinner />;
  if (worker.isError) return <QueryError error={worker.error} retry={() => void worker.refetch()} />;
  if (!worker.data) return null;

  const data = worker.data;

  function name(collection: keyof OrganizationDto, value?: string) {
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

  async function handleSaveIntegration(event: FormEvent) {
    event.preventDefault();
    if (formValidUntil && formIntegratedAt && formValidUntil < formIntegratedAt) {
      setIntegrationError('A validade da integração não pode ser anterior à data realizada.');
      return;
    }
    setSubmittingIntegration(true);
    setIntegrationError(null);
    try {
      const updated = await api.post<WorkerDto>(
        `/workers/${id}/integration`,
        {
          status: formStatus,
          integratedAt: formIntegratedAt,
          validUntil: formValidUntil || undefined,
          responsibleName: formResponsibleName.trim() || undefined,
          evidenceFileName: formEvidenceFileName.trim() || undefined,
          notes: formNotes.trim() || undefined,
        },
        { etag: revisionEtag(data.revision) }
      );
      queryClient.setQueryData(['worker', sessionKey, unitId, id], updated);
      setIntegrationOpen(false);
      setIntegrationNotice('Integração administrativa registrada com sucesso.');
    } catch (err) {
      setIntegrationError(errorMessage(err));
    } finally {
      setSubmittingIntegration(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`Trabalhador 360° · Matrícula ${data.registration}`}
        title={data.fullName}
        description="Vínculo, documentos permitidos, integração administrativa e histórico."
        actions={
          <div className="actions">
            <Link className="button button--secondary" to="/app/trabalhadores">
              Voltar à lista
            </Link>
            {can('workers.write') && (
              <>
                <Link className="button button--secondary" to={`/app/trabalhadores/${id}/editar`}>
                  Editar cadastro
                </Link>
                <Link className="button button--primary" to={`/app/trabalhadores/${id}/movimentacoes/nova`}>
                  Registrar movimentação
                </Link>
              </>
            )}
          </div>
        }
      />
      {success && <Feedback tone="success">{success}</Feedback>}

      {/* Vínculo atual */}
      <section className="panel stack" aria-labelledby="worker-details-heading">
        <div className="toolbar">
          <h2 id="worker-details-heading">Vínculo atual</h2>
          <Badge tone={data.status === 'ACTIVE' ? 'success' : data.status === 'ON_LEAVE' ? 'warning' : 'neutral'}>
            {workerStatusLabels[data.status]}
          </Badge>
        </div>
        <dl className="form-grid">
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
            <dd>{data.employmentType}</dd>
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

      {/* Situação administrativa de integração */}
      <section className="panel stack" aria-labelledby="worker-integration-heading">
        <div className="toolbar">
          <div>
            <h2 id="worker-integration-heading">Integração administrativa</h2>
            <p className="muted">Situação de integração para acesso operacional e emissão de permissões de trabalho.</p>
          </div>
          <div className="actions">
            <Badge tone={integrationStatusTone[data.integrationStatus || 'PENDING']}>
              {integrationStatusLabels[data.integrationStatus || 'PENDING']}
            </Badge>
            {can('workers.write') && !integrationOpen && (
              <Button
                variant="secondary"
                onClick={() => {
                  setIntegrationOpen(true);
                  setIntegrationError(null);
                  setIntegrationNotice(null);
                  setFormStatus('INTEGRATED');
                  setFormIntegratedAt(todayCivil());
                }}
              >
                Registrar nova integração
              </Button>
            )}
          </div>
        </div>

        {integrationNotice && <Feedback tone="success">{integrationNotice}</Feedback>}

        {integrationOpen && (
          <form className="panel stack" onSubmit={handleSaveIntegration}>
            <h3>Registrar nova integração</h3>
            {integrationError && <Feedback tone="danger">{integrationError}</Feedback>}
            <div className="form-grid">
              <Field label="Situação da integração *">
                <select
                  value={formStatus}
                  onChange={e => setFormStatus(e.target.value as IntegrationStatus)}
                  required
                >
                  <option value="INTEGRATED">Integrado</option>
                  <option value="PENDING">Pendente</option>
                  <option value="EXPIRED">Vencida</option>
                  <option value="NOT_APPLICABLE">Não aplicável</option>
                </select>
              </Field>
              <Field label="Data de realização *">
                <input
                  type="date"
                  value={formIntegratedAt}
                  onChange={e => setFormIntegratedAt(e.target.value)}
                  required
                />
              </Field>
              <Field label="Validade da integração">
                <input
                  type="date"
                  value={formValidUntil}
                  onChange={e => setFormValidUntil(e.target.value)}
                  placeholder="AAAA-MM-DD"
                />
              </Field>
              <Field label="Responsável pelo registro">
                <input
                  type="text"
                  value={formResponsibleName}
                  onChange={e => setFormResponsibleName(e.target.value)}
                  placeholder="Ex.: SESMT / Engenharia"
                />
              </Field>
              <Field label="Arquivo / comprovante">
                <input
                  type="text"
                  value={formEvidenceFileName}
                  onChange={e => setFormEvidenceFileName(e.target.value)}
                  placeholder="Ex.: ficha-integracao-assinada.pdf"
                />
              </Field>
              <Field label="Observações operacionais">
                <input
                  type="text"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Ex.: Realizada no auditório central da unidade"
                />
              </Field>
            </div>
            <div className="actions">
              <Button type="submit" variant="primary" disabled={submittingIntegration}>
                {submittingIntegration ? 'Salvando...' : 'Salvar integração'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={submittingIntegration}
                onClick={() => setIntegrationOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}

        <dl className="form-grid">
          <div>
            <dt className="muted">Situação atual</dt>
            <dd><strong>{integrationStatusLabels[data.integrationStatus || 'PENDING']}</strong></dd>
          </div>
          <div>
            <dt className="muted">Data realizada</dt>
            <dd>{data.integratedAt ? dateLabel(data.integratedAt) : 'Não realizada'}</dd>
          </div>
          <div>
            <dt className="muted">Validade</dt>
            <dd>{data.integrationValidUntil ? dateLabel(data.integrationValidUntil) : 'Sem expiração definida'}</dd>
          </div>
          <div>
            <dt className="muted">Responsável</dt>
            <dd>{data.integrationResponsibleName || 'Não registrado'}</dd>
          </div>
          <div>
            <dt className="muted">Evidência registrada</dt>
            <dd>{data.integrationEvidenceFileName || 'Nenhum anexo registrado'}</dd>
          </div>
        </dl>

        {data.integrationHistory && data.integrationHistory.length > 0 && (
          <div className="stack" style={{ marginTop: '0.75rem' }}>
            <h3>Histórico de integrações</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data realizada</th>
                    <th>Situação</th>
                    <th>Validade</th>
                    <th>Responsável</th>
                    <th>Evidência</th>
                    <th>Observações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.integrationHistory.map(entry => (
                    <tr key={entry.id}>
                      <td>{dateLabel(entry.integratedAt)}</td>
                      <td>
                        <Badge tone={integrationStatusTone[entry.status]}>
                          {integrationStatusLabels[entry.status]}
                        </Badge>
                      </td>
                      <td>{entry.validUntil ? dateLabel(entry.validUntil) : '—'}</td>
                      <td>{entry.responsibleName}</td>
                      <td>{entry.evidenceFileName || '—'}</td>
                      <td>{entry.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Equipes de trabalho vinculadas */}
      <section className="panel stack" aria-labelledby="worker-teams-heading">
        <div className="toolbar">
          <div>
            <h2 id="worker-teams-heading">Equipes de trabalho vinculadas</h2>
            <p className="muted">Participação em equipes operacionais desta unidade.</p>
          </div>
        </div>
        {data.teams && data.teams.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Equipe</th>
                  <th>Função no serviço</th>
                  <th>Papel na equipe</th>
                  <th>Situação</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map(team => (
                  <tr key={team.teamId}>
                    <td><strong>{team.teamName}</strong></td>
                    <td>{team.serviceFunction}</td>
                    <td>
                      {team.isChief ? (
                        <Badge tone="info">Chefe da equipe</Badge>
                      ) : (
                        <span className="muted">Membro</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={team.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {team.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </td>
                    <td>
                      <Link to={`/app/equipes?q=${encodeURIComponent(team.teamName)}`}>
                        Ver equipe →
                      </Link>
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
      </section>

      {/* Documentos vinculados */}
      <section className="panel stack" aria-labelledby="worker-documents-heading">
        <h2 id="worker-documents-heading">Documentos vinculados</h2>
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
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Documento</th>
                        <th>Situação</th>
                        <th>Validade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.data.items.map(document => (
                        <tr key={document.id}>
                          <td>
                            <Link to={`/app/documentos/${document.id}`}>{document.title}</Link>
                            <span className="muted" style={{ display: 'block' }}>
                              {document.code}
                            </span>
                          </td>
                          <td>
                            <Badge tone={document.status === 'ACTIVE' ? 'success' : document.status === 'EXPIRED' ? 'danger' : 'neutral'}>
                              {documentLabels[document.status]}
                            </Badge>
                          </td>
                          <td>{document.validUntil ? dateLabel(document.validUntil) : 'Não se aplica'}</td>
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
                    <Button variant="secondary" disabled={documentPage <= 1} onClick={() => setDocumentPage(page => page - 1)}>
                      Documentos anteriores
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={documentPage * documents.data.pageSize >= documents.data.total}
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
      <section className="panel stack" aria-labelledby="worker-movements-heading">
        <h2 id="worker-movements-heading">Histórico de movimentações</h2>
        {movements.isPending && <Spinner />}
        {movements.isError && <QueryError error={movements.error} retry={() => void movements.refetch()} />}
        {movements.data && !movements.isError && (movements.data.items.length ? (
          <>
            <ol className="stack" style={{ paddingLeft: '1.25rem' }}>
              {movements.data.items.map(movement => (
                <li key={movement.id}>
                  <div className="toolbar">
                    <strong>{movementLabels[movement.type]}</strong>
                    <time dateTime={movement.effectiveDate}>{dateLabel(movement.effectiveDate)}</time>
                  </div>
                  <p>{movement.reason}</p>
                  {movement.previousAssignment && (
                    <p className="muted">Anterior: {assignmentLabel(movement.previousAssignment)}</p>
                  )}
                  {movement.newAssignment && (
                    <p className="muted">Novo vínculo: {assignmentLabel(movement.newAssignment)}</p>
                  )}
                </li>
              ))}
            </ol>
            <div className="toolbar">
              <p className="muted">
                {movements.data.total} movimentação(ões) · Página {movementPage}
              </p>
              <div className="actions">
                <Button variant="secondary" disabled={movementPage <= 1} onClick={() => setMovementPage(page => page - 1)}>
                  Histórico anterior
                </Button>
                <Button
                  variant="secondary"
                  disabled={movementPage * movements.data.pageSize >= movements.data.total}
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

      {/* Saúde e prevenção */}
      <section className="panel">
        <h2>Saúde e prevenção</h2>
        <p className="muted">
          Exposições, ASOs, EPIs, treinamentos e ocorrências serão disponibilizados nas próximas etapas do projeto, conforme as permissões de acesso. Esta versão apresenta o cadastro e os documentos autorizados.
        </p>
      </section>
    </>
  );
}
