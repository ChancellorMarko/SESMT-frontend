import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead, InvalidReadResponse } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, Feedback, Field, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { appointmentInstant, appointmentLocal } from '../agenda/support';
import { checkedNativeAppointment, checkedNativeResponsibles, nativeAppointmentLabels, nativeId, type NativeAppointment } from './contracts';
import { nativeAgendaReturn } from './agenda-navigation';
import { NativeOpenPermit } from '../native-permits/NativeOpenPermit';
import { NativeCommandDialog, NativeFormError } from './NativeCommandDialog';
import { NativeCreationDialog } from './NativeCreationDialog';
import styles from '../../shared/ui/NativeRecords.module.css';

export { nativeAgendaReturn } from './agenda-navigation';
export function NativeAppointmentDetail() {
  const { id = '' } = useParams(), { sessionKey } = useSession();
  return <Detail key={`${sessionKey}:${id}`} id={id}/>;
}
function Detail({ id }: { id: string }) {
  const { sessionKey, can } = useSession(), location = useLocation(), client = useQueryClient(), navigate = useNavigate();
  const [opening, setOpening] = useState<NativeAppointment>();
  type Action='confirm'|'reschedule'|'cancel'|'context';
  const [editing, setEditing] = useState<{kind:Action;item:NativeAppointment}>(), [confirmation, setConfirmation] = useState('');
  const validId = nativeId.safeParse(id).success;
  const appointment = useVerifiedRead({ queryKey: ['native-appointment', sessionKey, id], scope: ['native-appointment', sessionKey], enabled: validId,
    request: signal => api.get<unknown>(`/appointments/${encodeURIComponent(id)}`, { signal }), validate: value => checkedNativeAppointment(value, id) });
  const item = appointment.data;
  const action=editing?.kind;
  function setAction(kind:Action|undefined){setEditing(kind&&item?{kind,item}:undefined);}
  const back = nativeAgendaReturn(location.state?.nativeReturnTo);
  return <div className="stack"><div className="actions"><Link to={back} className="button button--ghost">Voltar à agenda</Link><Button variant="secondary" disabled={!validId || appointment.isFetching} onClick={() => void appointment.refetch()}>Atualizar agendamento</Button></div>
    <PageHeader title={item?.title ?? 'Agendamento'} description="Horários em Brasília. A API confere escopo, designação, capacidade e versão antes de confirmar qualquer alteração."/>
    {(!validId || appointment.isError) && <Feedback tone="danger">{appointment.error instanceof ApiError && [403, 404].includes(appointment.error.status) ? 'Agendamento não encontrado ou não autorizado para esta conta.' : 'Não foi possível conferir este agendamento.'}</Feedback>}
    {appointment.isPending && <Spinner/>}
    {item && <>
      <section className="panel" aria-label="Dados do agendamento"><dl className={styles.details}><dt>Situação</dt><dd><Badge>{nativeAppointmentLabels[item.status]}</Badge></dd><dt>Início</dt><dd>{formatDate(item.startsAt)}</dd><dt>Término</dt><dd>{formatDate(item.endsAt)}</dd><dt>Serviços</dt><dd>{item.serviceCodes.join(' · ') || 'Não informados'}</dd><dt>Participantes</dt><dd>{item.participantIds.length}</dd><dt>Versão</dt><dd>{item.version}</dd></dl>
      <InfoButton title="Identificadores do agendamento"><dl className={styles.details}><dt>Agendamento</dt><dd>{item.id}</dd><dt>Empresa</dt><dd>{item.companyId}</dd><dt>Local</dt><dd>{item.locationId ?? 'Não informado'}</dd><dt>Equipe</dt><dd>{item.teamId ?? 'Não informada'}</dd><dt>Responsável pela atividade</dt><dd>{item.responsibleId ?? 'Não definido'}</dd><dt>Trabalhadores</dt><dd>{item.participantIds.join(' · ') || 'Não informados'}</dd></dl></InfoButton></section>
      {can('agenda:editar') && item.status !== 'CANCELLED' && <div className="actions">{item.status === 'REQUESTED' && <><Button disabled={appointment.isFetching} onClick={() => setAction('confirm')}>Confirmar agendamento</Button><Button variant="secondary" disabled={appointment.isFetching} onClick={()=>setAction('context')}>Alterar equipe e participantes</Button></>}<Button variant="secondary" disabled={appointment.isFetching} onClick={() => setAction('reschedule')}>Reagendar</Button><Button variant="danger" disabled={appointment.isFetching} onClick={() => setAction('cancel')}>Cancelar agendamento</Button></div>}
      {confirmation && <Feedback tone="success">{confirmation}</Feedback>}
      {can('pt:criar') && item.status === 'CONFIRMED' && <div className="actions"><Button disabled={appointment.isFetching} onClick={() => setOpening(item)}>Abrir PT</Button></div>}
      <section className={styles.results} aria-label="Histórico do agendamento"><div className={styles.footer}><h2>Histórico</h2></div><div className={styles.scroll} role="region" aria-label="Tabela do histórico" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Data e hora</th><th scope="col">Evento</th><th scope="col">Motivo</th></tr></thead><tbody>{item.history.map((event, index) => <tr key={`${event.version}:${event.action}:${index}`}><td>{formatDate(event.occurredAt)}</td><td>{({ REQUESTED: 'Solicitado', CONFIRMED: 'Confirmado', RESCHEDULED: 'Reagendado', CANCELLED: 'Cancelado', CONTEXT_CHANGED: 'Contexto alterado' } as Record<string,string>)[event.action] ?? event.action}<small>Versão {event.version}</small></td><td>{event.reason ?? 'Não informado'}</td></tr>)}</tbody></table></div></section>
      {action && editing && can('agenda:editar') && (action==='context'?<NativeCreationDialog kind="context" initial={editing.item} onClose={()=>setAction(undefined)} onDone={async()=>{setAction(undefined);setConfirmation('Contexto confirmado pela API.');await Promise.all([client.invalidateQueries({queryKey:['native-appointment',sessionKey]}),client.invalidateQueries({queryKey:['native-agenda',sessionKey]}),client.invalidateQueries({queryKey:['native-dashboard',sessionKey]})]);}}/>:<AppointmentAction key={`${action}:${editing.item.version}`} item={editing.item} action={action} onClose={() => setAction(undefined)} onDone={async () => { setAction(undefined); setConfirmation('Alteração confirmada pela API.'); await Promise.all([client.invalidateQueries({ queryKey: ['native-appointment', sessionKey] }), client.invalidateQueries({ queryKey: ['native-agenda', sessionKey] }), client.invalidateQueries({ queryKey: ['native-dashboard', sessionKey] })]); }}/ >)}
      {opening && can('pt:criar') && <NativeOpenPermit appointment={opening} onClose={() => setOpening(undefined)} onOpened={permitId => { setOpening(undefined); void navigate(`/app/pts/${permitId}`, { state: { nativeSourceAppointmentId: opening.id, nativeAgendaReturnTo: back } }); }}/ >}
    </>}
  </div>;
}
function AppointmentAction({ item, action, onClose, onDone }: { item: NativeAppointment; action: 'confirm'|'reschedule'|'cancel'; onClose: () => void; onDone: () => Promise<void> }) {
  const { sessionKey, can } = useSession();
  const [startsAt, setStart] = useState(appointmentLocal(item.startsAt)), [endsAt, setEnd] = useState(appointmentLocal(item.endsAt)), [reason, setReason] = useState(''), [responsibleId, setResponsible] = useState('');
  const users = useVerifiedRead({ queryKey: ['native-appointment-responsibles', sessionKey,item.id,item.version], enabled: action === 'confirm' && can('agenda:editar'), request: signal => api.get<unknown>(`/appointments/${item.id}/responsibles`, { signal }), validate: checkedNativeResponsibles });
  const ready = action !== 'confirm' || Boolean(users.data && !users.isFetching && users.data.some(user => user.id.toLowerCase() === responsibleId && user.active));
  async function perform(signal: AbortSignal) {
    if (!can('agenda:editar') || !ready) throw new NativeFormError('Confira seus acessos e o responsável selecionado.');
    const start = appointmentInstant(startsAt), end = appointmentInstant(endsAt);
    if (action === 'reschedule' && (!start || !end || Date.parse(start) < Date.now() || Date.parse(end) <= Date.parse(start))) throw new NativeFormError('Informe início futuro e término posterior, no horário de Brasília.');
    if (action !== 'confirm' && (!reason.trim() || reason.trim().length > 1000)) throw new NativeFormError('Informe um motivo de até 1.000 caracteres.');
    const payload = action === 'confirm' ? { expectedVersion: item.version, responsibleId } : action === 'cancel' ? { expectedVersion: item.version, reason: reason.trim() } : { expectedVersion: item.version, startsAt: start, endsAt: end, reason: reason.trim() };
    const updated = checkedNativeAppointment(await api.post<unknown>(`/appointments/${item.id}/${action}`, payload, { signal }), item.id);
    if (updated.version !== item.version + 1 || updated.companyId !== item.companyId || updated.locationId !== item.locationId || updated.teamId !== item.teamId || updated.title!==item.title
      || !same(updated.participantIds,item.participantIds)||!same(updated.serviceCodes,item.serviceCodes)
      || action === 'confirm' && (updated.status !== 'CONFIRMED' || updated.responsibleId !== responsibleId)
      || action === 'cancel' && updated.status !== 'CANCELLED'
      || action !== 'reschedule' && (Date.parse(updated.startsAt)!==Date.parse(item.startsAt)||Date.parse(updated.endsAt)!==Date.parse(item.endsAt))
      || action !== 'confirm' && updated.responsibleId!==item.responsibleId
      || action === 'reschedule' && (updated.status!==item.status||Date.parse(updated.startsAt) !== Date.parse(start!) || Date.parse(updated.endsAt) !== Date.parse(end!))) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={action === 'confirm' ? 'Confirmar agendamento' : action === 'cancel' ? 'Cancelar agendamento' : 'Reagendar'} dirty={Boolean(reason || responsibleId || startsAt !== appointmentLocal(item.startsAt) || endsAt !== appointmentLocal(item.endsAt))} disabled={!ready} onClose={onClose} perform={perform} onDone={onDone} submitLabel={action === 'cancel' ? 'Confirmar cancelamento' : 'Salvar alteração'}>{busy => <>
    {action === 'confirm' ? <><Field label="Responsável pela atividade"><select value={responsibleId} disabled={busy || !users.data || users.isFetching} onChange={event => setResponsible(event.target.value)}><option value="">Selecione</option>{users.data?.filter(user => user.active).map(user => <option key={user.id} value={user.id.toLowerCase()}>{user.name}</option>)}</select></Field>{users.isPending && <Spinner/>}{users.isError && <Feedback tone="danger">Não foi possível consultar os responsáveis.</Feedback>}</> : <>{action === 'reschedule' && <><Field label="Novo início (Brasília)"><input type="datetime-local" value={startsAt} disabled={busy} onChange={event => setStart(event.target.value)}/></Field><Field label="Novo término (Brasília)"><input type="datetime-local" value={endsAt} disabled={busy} onChange={event => setEnd(event.target.value)}/></Field></>}<Field label="Motivo" required><textarea value={reason} maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)}/></Field></>}
  </>}</NativeCommandDialog>;
}
function same(a:readonly string[],b:readonly string[]){return a.length===b.length&&a.every(value=>b.includes(value));}
