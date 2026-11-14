import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { formatDate } from '../../shared/lib/format';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { nativeId } from '../native-operations/contracts';
import { nativeAgendaReturn } from '../native-operations/agenda-navigation';
import { checkedDeclarations, checkedEligibility, checkedPermit, checkedPermitHistory, checkedPermitReview, permitReturn, permitReviewLabels, permitStatusLabels, type NativePermit, type PermitDeclarations } from './contracts';
import { actionNeedsReadiness, NativePermitAction, permitActionAllowed, permitActions, type PermitAction } from './NativePermitAction';
import { NativePermitChecklists } from './NativePermitChecklists';
import { NativePermitScience } from './NativePermitScience';
import { NativePermitReview } from './NativePermitReview';
import { NativePermitIssues } from './NativePermitIssues';
import { checkedNativeServices } from '../native-operations/contracts';
import styles from '../../shared/ui/NativeRecords.module.css';
import local from './NativePermits.module.css';

const eventLabels: Record<string, string> = { ABERTA: 'Aberta', LIBERADA: 'Liberada', INICIADA: 'Serviço iniciado', SUSPENSA: 'Serviço suspenso', RETOMADA: 'Serviço retomado', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
  REVISAO_APROVADA: 'Encerramento aprovado', REVISAO_DEVOLVIDA: 'Encerramento devolvido', ENCERRAMENTO_REENVIADO: 'Encerramento reenviado' };
export function NativePermitDetail() {
  const { id = '' } = useParams(), { sessionKey } = useSession();
  return <Detail key={`${sessionKey}:${id}`} id={id}/>;
}
function Detail({ id }: { id: string }) {
  const { sessionKey, can } = useSession(), location = useLocation(), client = useQueryClient();
  const [editing, edit] = useState<{ item: NativePermit; action: PermitAction; context?: PermitDeclarations['context'] }>();
  const [confirmation, setConfirmation] = useState('');
  const validId = nativeId.safeParse(id).success;
  const query = useVerifiedRead({ queryKey: ['native-permit', sessionKey, id], scope: ['native-permit', sessionKey, id], enabled: validId,
    request: signal => api.get<unknown>(`/work-permits/${id}`, { signal }), validate: value => checkedPermit(value, id) });
  const item = query.data, enabled = Boolean(item && !query.isFetching), revision = item?.version;
  const fromAppointment = Boolean(item?.appointmentId && location.state?.nativeSourceAppointmentId === item.appointmentId);
  const history = useVerifiedRead({ queryKey: ['native-permit-history', sessionKey, id, revision], scope: ['native-permit-history', sessionKey, id], enabled,
    request: signal => api.get<unknown>(`/work-permits/${id}/history`, { signal }), validate: value => checkedPermitHistory(value, item!) });
  const readiness = useVerifiedRead({ queryKey: ['native-permit-eligibility', sessionKey, id, revision], scope: ['native-permit-eligibility', sessionKey, id], enabled,
    request: signal => api.get<unknown>(`/work-permits/${id}/eligibility`, { signal }), validate: checkedEligibility });
  const review = useVerifiedRead({ queryKey: ['native-permit-review', sessionKey, id, revision], scope: ['native-permit-review', sessionKey, id], enabled: enabled && item?.status === 'CONCLUIDA',
    request: signal => api.get<unknown>(`/work-permits/${id}/review`, { signal }), validate: value => checkedPermitReview(value, item!) });
  const declarations = useVerifiedRead({ queryKey: ['native-permit-declarations', sessionKey, id, revision], scope: ['native-permit-declarations', sessionKey, id], enabled,
    request: signal => api.get<unknown>(`/work-permits/${id}/declarations`, { signal }), validate: value => checkedDeclarations(value, item!) });
  async function refresh() {
    setConfirmation('');
    await Promise.all(['native-permit', 'native-permit-history', 'native-permit-eligibility', 'native-permit-declarations', 'native-permit-review'].map(key => client.invalidateQueries({ queryKey: [key, sessionKey, id] })));
  }
  async function done() {
    edit(undefined);
    await Promise.all(['native-permit', 'native-permit-history', 'native-permit-eligibility', 'native-permit-declarations', 'native-permit-review', 'native-permits', 'native-dashboard', 'native-agenda'].map(key => client.invalidateQueries({ queryKey: [key, sessionKey] })));
    setConfirmation('Operação confirmada pela API.');
  }
  const busy = query.isFetching || history.isFetching || readiness.isFetching || declarations.isFetching;
  const services = useVerifiedRead({ queryKey: ['native-services', sessionKey], enabled: Boolean(item),
    request: signal => api.get<unknown>('/work-permits/services', { signal }), validate: checkedNativeServices });
  const serviceName = (code: string) => services.data?.find(service => service.code === code)?.name ?? code;
  const allowedActions = item ? (Object.keys(permitActions) as PermitAction[]).filter(action => permitActionAllowed(item, action, can)) : [];
  const blockedByReadiness = allowedActions.some(action => actionNeedsReadiness(action)) && readiness.data && !readiness.data.ready;
  return <div className="stack">
    <div className="actions"><Link className="button button--ghost" to={fromAppointment ? `/app/agenda/${item!.appointmentId}` : permitReturn(location.state?.nativePermitReturnTo)} state={fromAppointment ? { nativeReturnTo: nativeAgendaReturn(location.state?.nativeAgendaReturnTo) } : undefined}>{fromAppointment ? 'Voltar ao agendamento' : 'Voltar às PTs'}</Link><Button variant="secondary" disabled={!validId || busy} onClick={() => void refresh()}>Atualizar PT</Button></div>
    <PageHeader title={item?.title ?? 'Permissão de trabalho'} description="Situação e requisitos retornados pela API. Liberação, início e retomada revalidam as condições no servidor. Uma consulta sem pendências não substitui a decisão de liberação."/>
    {query.isPending && <Spinner/>}{(!validId || query.isError) && <Feedback tone="danger">{query.error instanceof ApiError && [403, 404].includes(query.error.status) ? 'PT não encontrada ou não autorizada para esta conta.' : 'Não foi possível conferir esta PT.'}</Feedback>}
    {item && <>
      <section className={`panel ${local.summary}`} aria-label="Resumo da PT"><dl className={styles.details}><dt>Operação</dt><dd><Badge>{permitStatusLabels[item.status]}</Badge></dd><dt>Revisão</dt><dd>{permitReviewLabels[item.reviewStatus] ?? item.reviewStatus}</dd><dt>Serviços</dt><dd>{item.serviceCode.split(',').map(code => serviceName(code.trim())).join(' · ')}</dd><dt>Revisão do registro</dt><dd>{item.version}<small className={local.hint}>Declarações na versão {item.contentVersion}</small></dd><dt>Abertura</dt><dd>{formatDate(item.createdAt)}</dd><dt>Janela autorizada</dt><dd>{item.authorizedFrom ? `${formatDate(item.authorizedFrom)} a ${formatDate(item.authorizedUntil)}` : 'Não definida'}</dd></dl>
        <div className="actions">{item.appointmentId && <Link className="button button--ghost" to={`/app/agenda/${item.appointmentId}`}>Consultar agendamento</Link>}<InfoButton title="Identificadores da PT"><dl className={styles.details}><dt>PT</dt><dd>{item.id}</dd><dt>Empresa</dt><dd>{item.companyId}</dd><dt>Agendamento</dt><dd>{item.appointmentId ?? 'Não informado'}</dd><dt>Modelos fixados</dt><dd>{item.templateVersionIds.join(' · ') || 'Não informados'}</dd></dl></InfoButton></div>
      </section>
      <div className={`actions ${local.operations}`} aria-label="Operações da PT">
        {allowedActions.filter(action => action !== 'cancel').map(action => <Button key={action} variant={actionNeedsReadiness(action) ? 'primary' : 'secondary'} aria-describedby={blockedByReadiness && actionNeedsReadiness(action) ? 'pt-readiness-reason' : undefined} disabled={query.isFetching || actionNeedsReadiness(action) && (readiness.isFetching || !readiness.data?.ready) || action === 'release' && (declarations.isFetching || !declarations.data?.context)} onClick={() => { setConfirmation(''); edit({ item, action, context: declarations.data?.context }); }}>{permitActions[action].label}</Button>)}
        {blockedByReadiness && <p id="pt-readiness-reason" className={local.blockedReason}>Resolva {readiness.data!.issues.length === 1 ? 'a pendência listada' : `as ${readiness.data!.issues.length} pendências listadas`} em “O que falta para liberar”.</p>}
        {allowedActions.includes('cancel') && <Button className={local.cancelAction} variant="danger" disabled={query.isFetching} onClick={() => { setConfirmation(''); edit({ item, action: 'cancel', context: declarations.data?.context }); }}>{permitActions.cancel.label}</Button>}
      </div>
      {confirmation && <Feedback tone="success">{confirmation}</Feedback>}
      <NativePermitIssues permit={item} readiness={readiness} serviceNames={services.data}/>
      {item.status === 'CONCLUIDA' && <NativePermitReview item={item} review={review} refreshing={busy} onDone={done}/>}
      <NativePermitChecklists item={item} refreshing={query.isFetching} onDone={done} canResubmit={Boolean(review.data?.canResubmit)}/>
      <NativePermitScience item={item} refreshing={busy} onDone={done}/>
      <details className="panel" open><summary>Participantes · {item.participants.length}</summary>{!item.participants.length ? <p>Nenhum participante informado.</p> : <div className={styles.scroll} role="region" aria-label="Participantes da PT" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Responsabilidade e usuário</th><th scope="col">Ciência registrada</th></tr></thead><tbody>{item.participants.map(person => <tr key={person.userId}><td>{person.responsibility}<small>{person.userId}</small></td><td>{formatDate(person.acknowledgedAt)}<small>{person.acknowledgedVersion === item.contentVersion ? 'Registro na versão de conteúdo atual' : 'Sem registro na versão de conteúdo atual'}</small><InfoButton title="Registros de ciência">{(person.acknowledgements ?? []).length ? person.acknowledgements!.map(record => <div className={local.inset} key={record.id}><strong>{record.confirmedName}</strong><p>{record.identificationMethod} · conteúdo {record.contentVersion} · {formatDate(record.recordedAt)}</p><p className={styles.message}>{record.declaration}</p></div>) : <p>Nenhum registro retornado.</p>}</InfoButton></td></tr>)}</tbody></table></div>}</details>
      <details className="panel"><summary>Declarações e contexto</summary>{declarations.isPending && <Spinner/>}{declarations.isError && <Feedback tone="danger">Não foi possível conferir as declarações desta versão. Atualize a PT.</Feedback>}{declarations.data && <>{declarations.data.context && <p>{formatDate(declarations.data.context.from)} a {formatDate(declarations.data.context.until)} · {declarations.data.context.serviceCodes.map(serviceName).join(' · ')}</p>}{declarations.data.declarations.map(record => <section key={record.templateVersionId}><h3>Declaração · versão {record.version}</h3><p className={styles.message}>{record.text}</p></section>)}{!declarations.data.declarations.length && <p>Nenhuma declaração retornada.</p>}</>}</details>
      <details className="panel"><summary>Registros da operação</summary><dl className={styles.details}><dt>Liberação</dt><dd>{formatDate(item.releasedAt)}</dd><dt>Condições</dt><dd className={styles.message}>{item.releaseConditions ?? 'Não informadas'}</dd><dt>Início</dt><dd>{formatDate(item.startedAt)}</dd><dt>Suspensão</dt><dd>{formatDate(item.suspendedAt)} · {item.suspensionReason ?? 'Sem motivo registrado'}</dd><dt>Cancelamento</dt><dd>{formatDate(item.cancelledAt)} · {item.cancellationReason ?? 'Sem motivo registrado'}</dd><dt>Conclusão</dt><dd>{formatDate(item.completedAt)}</dd><dt>Término efetivo</dt><dd>{formatDate(item.actualEnd)}</dd><dt>Resumo</dt><dd className={styles.message}>{item.completionSummary ?? 'Não informado'}</dd></dl>{(item.observations ?? []).map(event => <section key={event.id}><h3>{formatDate(event.recordedAt)}</h3><p className={styles.message}>{event.text}</p><InfoButton title="Autor da observação"><p>{event.actorId}</p></InfoButton></section>)}</details>
      <details className="panel"><summary>Histórico de situações</summary>{history.isPending && <Spinner/>}{history.isError && <Feedback tone="danger">Não foi possível conferir o histórico desta PT.</Feedback>}{history.data && (!history.data.length ? <EmptyState title="Sem eventos retornados"/> : <div className={styles.scroll} role="region" aria-label="Histórico da PT" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Data e versão</th><th scope="col">Evento</th><th scope="col">Motivo</th></tr></thead><tbody>{history.data.map(event => <tr key={event.id}><td>{formatDate(event.occurredAt)}<small>Versão {event.version}</small></td><td>{eventLabels[event.action] ?? event.action}<small>{permitStatusLabels[event.newStatus]}</small></td><td>{event.reason ?? 'Não informado'}</td></tr>)}</tbody></table></div>)}</details>
      {editing && <NativePermitAction key={`${editing.action}:${editing.item.version}`} {...editing} onClose={() => edit(undefined)} onDone={done}/>}
    </>}
  </div>;
}

// Prevent old print URLs from invoking the incompatible demo snapshot/PDF contract.
export function NativePermitPrintPage() {
  const { id = '' } = useParams();
  return <div className="stack"><PageHeader title="Impressão da PT"/><Feedback tone="warning">A versão de impressão deste contrato ainda não está disponível.</Feedback><Link className="button button--secondary" to={nativeId.safeParse(id).success ? `/app/pts/${id}` : '/app/pts'}>Voltar à PT</Link></div>;
}
