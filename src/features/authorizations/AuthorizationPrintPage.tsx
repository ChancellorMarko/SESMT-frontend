import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import type { WorkAuthorizationDto, AuthorizationRepresentationsDto } from '../../shared/contracts/work-authorizations';
import type { EligibilityDto, PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { preparationOrigin } from '../../shared/lib/preparation-navigation';
import { Button, EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { isDrawingRepresentation } from '../permits/validation';
import { AT_CONTROLS, AT_REVALIDATION_CAPACITY, authorizationAnswerLabel } from './model';
import { authorizationError, authorizationEventLabels, authorizationKey, authorizationLabels, identificationLabels, useAuthorizationClock } from './support';
import { authorizationWindowNotice } from './print-record';
import styles from '../permits/print.module.css';

const evidenceLabels: Record<string, string> = { APPROVED: 'Conferido', MISSING: 'Ausente', PENDING: 'Aguardando conferência', REJECTED: 'Reprovado', EXPIRED: 'Vencido' };
function Checks({ items }: { items: PermitSourceCheckDto[] }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Conferência e origem</th><th>Resposta</th><th>Observação / justificativa</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{item.label}<small>{item.sourceCell}</small></td><td>{authorizationAnswerLabel(item.answer)}</td><td>{item.note || '—'}</td></tr>)}</tbody></table></div>;
}
function DocumentaryRecord({ value }: { value: EligibilityDto }) {
  return <><p className={styles.small}>Matriz {value.requirementVersion} · conferida em {formatDate(value.checkedAt)} · {value.eligible ? 'Sem pendência documental na consulta' : 'Com pendência documental na consulta'}. Situação administrativa; não substitui a avaliação em campo.</p><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Participante / função</th><th>Requisito</th><th>Situação administrativa</th></tr></thead><tbody>{value.participants.flatMap(person => person.items.map(item => <tr key={`${person.workerId}-${item.requirementId}`}><td>{person.name}<small>{person.serviceFunction}</small></td><td>{item.label}</td><td>{evidenceLabels[item.status] || item.status}{item.restricted && <small>Conferência restrita</small>}</td></tr>))}</tbody></table></div></>;
}
function Representations({ value }: { value: AuthorizationRepresentationsDto }) {
  return <dl className={styles.facts}><div><dt>Responsável pela atividade</dt><dd>{value.responsibleName}</dd></div><div><dt>Encarregado / líder</dt><dd>{value.foremanName}</dd></div><div><dt>Emitente / responsável pela área informado</dt><dd>{value.issuerName}</dd></div><div><dt>Confirmação das representações</dt><dd>{value.confirmed ? 'Registrada pelo coletor da ação' : 'Não registrada'}</dd></div></dl>;
}
export function AuthorizationPrintPage() {
  const { id } = useParams();
  const { sessionKey, unitId, can } = useSession();
  const now = useAuthorizationClock();
  const location = useLocation();
  const listNavigation = preparationOrigin(location.state, unitId, 'ats');
  const query = useQuery({ queryKey: authorizationKey(sessionKey, unitId, id), queryFn: ({ signal }) => api.get<WorkAuthorizationDto>(`/work-authorizations/${id}`, { signal, query: { unitId } }), enabled: can('at.read') && Boolean(unitId && id) });
  const record = query.data;
  const titleAllowed = can('at.read') && !query.isError && record?.id === id && record?.unitId === unitId && record?.appointment.unitId === unitId;
  useEffect(() => {
    if (!record || !titleAllowed) return;
    const previous = document.title; document.title = `${record.code} — revisão ${record.revision} — Ampara SESMT`;
    return () => { document.title = previous; };
  }, [record?.code, record?.revision, titleAllowed]);
  if (!can('at.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar esta AT." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" />;
  if (query.isPending) return <Spinner />;
  if (query.isError || !record) return <div className="panel stack"><Feedback tone="danger">{authorizationError(query.error)}</Feedback><Button onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  if (record.id !== id || record.unitId !== unitId || record.appointment.unitId !== unitId) return <EmptyState title="AT de outra unidade" description="Selecione a unidade do atendimento para visualizar este registro." />;
  const foreman = record.appointment.participants.find(person => person.workerId === record.preparation.foremanId);
  const windowNotice = authorizationWindowNotice(record, now);
  const label = `${record.code} · revisão ${record.revision} · ${authorizationLabels[record.status]}${API_MODE === 'demo' ? ' · DEMONSTRAÇÃO · SEM VALIDADE OPERACIONAL' : ''}`;
  return <div className={`stack ${styles.page}`}>
    <style media="print">{`@page { @bottom-center { content: ${JSON.stringify(label)} " · Página " counter(page) " de " counter(pages); font: 7pt Arial, sans-serif; color: #596c63; } }`}</style>
    <div className={styles.toolbar}><PageHeader eyebrow="Registro da autorização" title="Visualização e impressão da AT" description="Confira as janelas e o estado do registro antes de imprimir ou salvar em PDF." actions={<><Link className="button button--secondary" to={`/app/ats/${id}`} state={listNavigation}>Voltar à AT</Link><Button onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Imprimir / salvar PDF</Button></>} /></div>
    <article className={styles.paper} aria-label="Registro imprimível da AT" data-print-record>
      <header className={styles.documentHeader}><div><BrandLogo className={styles.documentBrand} /><p className={styles.kicker}>AMPARA SESMT · AUTORIZAÇÃO DE TRABALHO</p><h1>{record.code}</h1><p>Revisão do registro {record.revision} · {record.sourceId} · revisão de origem {record.sourceRevision}</p></div><strong className={styles.status}>{authorizationLabels[record.status]}</strong></header>
      {API_MODE === 'demo' && <p className={styles.demo}>DEMONSTRAÇÃO · DADOS FICTÍCIOS · SEM VALIDADE OPERACIONAL</p>}
      {windowNotice && <p className={styles.notice}>{windowNotice}</p>}
      <section><h2>Identificação do atendimento</h2><dl className={styles.facts}><div><dt>Atendimento</dt><dd>{record.appointment.code}</dd></div><div><dt>PT vinculada</dt><dd>{record.permitCode || 'Sem vínculo com uma PT'}</dd></div><div><dt>Serviço</dt><dd>{record.appointment.serviceLabel}</dd></div><div><dt>Equipe</dt><dd>{record.appointment.teamName}</dd></div><div><dt>Local</dt><dd>{record.appointment.location}</dd></div><div><dt>Responsável designado</dt><dd>{record.appointment.responsibleName}</dd></div><div><dt>Início planejado</dt><dd>{formatDate(record.appointment.startsAt)}</dd></div><div><dt>Término planejado</dt><dd>{formatDate(record.appointment.endsAt)}</dd></div></dl><p className={styles.small}>O vínculo documental não autoriza nem altera a PT. Mudança de equipe, atividade ou condições exige a revisão dos registros correspondentes.</p></section>
      <section><h2>Preparação e análise do serviço</h2><dl className={styles.facts}>{Object.entries(record.preparation.identification).map(([key, value]) => <div key={key}><dt>{identificationLabels[key as keyof typeof identificationLabels]}</dt><dd>{value || 'Não informado'}</dd></div>)}<div><dt>Encarregado / líder da equipe</dt><dd>{foreman?.name || 'Não informado'}</dd></div></dl></section>
      <section><h2>Medidas de controle</h2><ul>{record.preparation.controls.map(control => <li key={control}>{AT_CONTROLS.find(item => item.id === control)?.label || control}</li>)}</ul>{!record.preparation.controls.length && <p>Nenhuma medida registrada.</p>}<p className={styles.preserve}><strong>Medidas complementares:</strong> {record.preparation.additionalControls || 'Não registradas'}</p></section>
      <section><h2>Conferências da autorização</h2><Checks items={record.preparation.checks} /></section>
      <section><h2>Participantes e manifestações</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Participante / função</th><th>Manifestação</th><th>Coleta</th></tr></thead><tbody>{record.appointment.participants.map(person => {
        const science = record.sciences.find(item => item.workerId === person.workerId);
        return <tr key={person.workerId}><td>{person.name}<small>{person.serviceFunction}</small></td><td>{science ? <>{science.method === 'DRAWN' && isDrawingRepresentation(science.representation) ? <img className={styles.signature} src={science.representation} alt={`Representação visual de ${person.name}`} /> : science.declarantName}<small>{science.method === 'DRAWN' ? 'Desenho' : 'Nome digitado'} · confirmação registrada</small></> : 'Não registrada'}</td><td>{science ? <>{science.collectedByName}<br />{formatDate(science.collectedAt)}</> : '—'}</td></tr>;
      })}</tbody></table></div><p className={styles.small}>Nomes e desenhos são representações visuais. O registro identifica quem coletou a ação; não autentica a identidade do emitente informado.</p></section>
      <section><h2>Conferência documental {record.status === 'CLOSED' || record.status === 'CANCELED' ? 'preservada no término' : 'da consulta atual'}</h2><DocumentaryRecord value={record.eligibility} /></section>
      <section><h2>Autorização inicial e revalidações</h2><p className={styles.small}>O formulário de origem dispõe de {AT_REVALIDATION_CAPACITY} espaços de revalidação. Esta capacidade do modelo não define um limite normativo geral. Cada rodada abaixo preserva sua própria conferência documental.</p>{!record.releases.length && <p>Nenhuma autorização registrada.</p>}{record.releases.map(release => <section key={release.id} aria-label={`Rodada ${release.sequence}`}><h3>{release.kind === 'INITIAL' ? 'Autorização inicial' : `Revalidação ${release.sequence - 1}`}</h3><dl className={styles.facts}><div><dt>Janela registrada · Brasília</dt><dd>{formatDate(release.validFrom)} a {formatDate(release.validUntil)}</dd></div><div><dt>Coletor / data do registro</dt><dd>{release.actorName} · {formatDate(release.occurredAt)}</dd></div></dl>{release.reason && <p className={styles.preserve}><strong>Motivo:</strong> {release.reason}</p>}<Representations value={release.representations} /><DocumentaryRecord value={release.eligibility} /></section>)}</section>
      <section><h2>Encerramento e resultado</h2>{record.closure ? <><p className={styles.preserve}>{record.closure.summary}</p><p>Registrado por {record.closure.actorName} em {formatDate(record.closure.occurredAt)}.</p><Representations value={record.closure.representations} /><Checks items={record.closure.checks} /></> : <p>Encerramento ainda não registrado.</p>}{record.suspensionReason && <p className={styles.preserve}><strong>Última suspensão:</strong> {record.suspensionReason}</p>}{record.cancellationReason && <p className={styles.preserve}><strong>Cancelamento:</strong> {record.cancellationReason}</p>}</section>
      <section><h2>Histórico do registro</h2><ol className={styles.events}>{record.history.map(event => <li key={event.id}><strong>{authorizationEventLabels[event.action] || event.action.replaceAll('_', ' ')}</strong> · {event.actorName} · {formatDate(event.occurredAt)}{event.reason && <p>{event.reason}</p>}</li>)}</ol></section>
      <footer className={styles.documentFooter}>{label}<br />Origem: {record.sourceId} · revisão {record.sourceRevision} · SHA-256: {record.sourceSha256}</footer>
    </article>
  </div>;
}
