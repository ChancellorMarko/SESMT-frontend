import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { appointmentInstant, appointmentLabels, appointmentLocal, errorMessage } from './support';
import { EligibilityPanel } from './EligibilityPanel';
import styles from './Agenda.module.css';

type Action = 'CONFIRM' | 'RESCHEDULE' | 'CANCEL' | 'OPEN_PERMIT';
const actionTitles: Record<Action, string> = { CONFIRM: 'Confirmar agendamento', RESCHEDULE: 'Reagendar serviço', CANCEL: 'Cancelar agendamento', OPEN_PERMIT: 'Abrir atendimento em campo' };
const eventLabels: Record<string, string> = { CREATED: 'Agendamento solicitado', APPOINTMENT_CREATED: 'Agendamento solicitado', APPOINTMENT_REQUESTED: 'Agendamento solicitado', CONFIRMED: 'Agendamento confirmado', CONFIRM: 'Agendamento confirmado', APPOINTMENT_CONFIRMED: 'Agendamento confirmado', RESCHEDULED: 'Serviço reagendado', RESCHEDULE: 'Serviço reagendado', APPOINTMENT_RESCHEDULED: 'Serviço reagendado', CANCELED: 'Agendamento cancelado', CANCEL: 'Agendamento cancelado', APPOINTMENT_CANCELED: 'Agendamento cancelado', ATTENDANCE_OPENED: 'Atendimento aberto em campo', OPEN_PERMIT: 'Atendimento aberto em campo', EVIDENCE_UPLOADED: 'Evidência enviada', EVIDENCE_SUBMITTED: 'Evidência enviada', EVIDENCE_REVIEWED: 'Conferência documental registrada' };

export function AppointmentDetailPage() {
  const { id } = useParams();
  const { can, sessionKey, unitId } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [action, setAction] = useState<Action>();
  const [actionRevision, setActionRevision] = useState<number>();
  const [reason, setReason] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState((location.state as { success?: string } | null)?.success || '');
  const queryKey = ['appointment', sessionKey, unitId, id];
  const appointment = useQuery({ queryKey, queryFn: ({ signal }) => api.get<AppointmentDto>(`/appointments/${id}`, { signal }), enabled: can('appointments.read') && Boolean(id && unitId) });
  const busy = sending || refreshing;
  const conflict = writeConflict || Boolean(action && actionRevision !== appointment.data?.revision);
  const hasAction = (value: Action) => Boolean(appointment.data && appointment.data.unitId === unitId && appointment.data.availableActions.includes(value) && can(value === 'OPEN_PERMIT' ? 'permits.operate' : 'appointments.write'));
  useEffect(() => {
    setAction(undefined); setActionRevision(undefined); setReason(''); setFailure(''); setActionNotice(''); setWriteConflict(false);
  }, [id, sessionKey, unitId]);
  useEffect(() => { setSuccess((location.state as { success?: string } | null)?.success || ''); }, [location.key]);
  useEffect(() => {
    if (!action && !busy) return;
    const allowLeave = () => {
      if (busy) { setFailure('Aguarde a confirmação da ação antes de sair ou mudar a unidade.'); return false; }
      return window.confirm('Há uma ação do agendamento ainda não enviada. Deseja sair e descartar o preenchimento?');
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const contextChange = (event: Event) => { if (!event.defaultPrevented && !allowLeave()) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!allowLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('sesmt:before-context-change', contextChange); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('sesmt:before-context-change', contextChange); document.removeEventListener('click', navigate, true); };
  }, [action, busy]);
  function select(value: Action) {
    if (busy || !hasAction(value) || !appointment.data) return;
    setAction(value); setActionRevision(appointment.data.revision); setReason(''); setFailure(''); setActionNotice(''); setWriteConflict(false);
    setStart(appointmentLocal(appointment.data.startsAt)); setEnd(appointmentLocal(appointment.data.endsAt));
  }
  function close() { if (!busy) { setAction(undefined); setActionRevision(undefined); } }
  async function refreshCurrent() {
    if (busy) return;
    setRefreshing(true); setFailure('');
    try {
      const current = await client.fetchQuery({ queryKey, queryFn: ({ signal }) => api.get<AppointmentDto>(`/appointments/${id}`, { signal }), staleTime: 0 });
      if (current.id !== id || current.unitId !== unitId) throw new Error('O atendimento retornado pertence a outro contexto. Seu preenchimento foi preservado.');
      setActionRevision(current.revision); setWriteConflict(false);
      setActionNotice('Atendimento atual carregado. O motivo e o período preenchidos foram preservados. Confira os dados atuais antes de confirmar a ação novamente.');
    } catch (error) { setFailure(errorMessage(error)); }
    finally { setRefreshing(false); }
  }
  async function submit() {
    const current = appointment.data;
    if (!current || !action || actionRevision === undefined || busy || conflict || !hasAction(action)) return;
    setFailure(''); setSuccess('');
    if ((action === 'CANCEL' || action === 'RESCHEDULE') && !reason.trim()) { setFailure('Informe o motivo para preservar o histórico do atendimento.'); return; }
    const startsAt = appointmentInstant(start), endsAt = appointmentInstant(end);
    if (action === 'RESCHEDULE' && (!startsAt || !endsAt || startsAt >= endsAt)) { setFailure('Informe um período válido, com término após o início.'); return; }
    setSending(true);
    try {
      const path: Record<Action, string> = { CONFIRM: 'confirm', RESCHEDULE: 'reschedule', CANCEL: 'cancel', OPEN_PERMIT: 'open-permit' };
      const body = action === 'CANCEL' ? { reason: reason.trim() } : action === 'RESCHEDULE' ? { startsAt, endsAt, reason: reason.trim() } : {};
      const result = await api.post<AppointmentDto | WorkPermitDto>(`/appointments/${current.id}/${path[action]}`, body, { etag: revisionEtag(actionRevision) });
      await Promise.all(['appointment', 'appointments', 'eligibility', 'work-permits', 'permit-dashboard', 'documentary-readiness', 'work-authorizations', 'work-authorization', 'authorization-options'].map(key => client.invalidateQueries({ queryKey: [key] })));
      setAction(undefined);
      setActionRevision(undefined);
      if (action === 'OPEN_PERMIT') navigate(`/app/pts/${result.id}`);
      else setSuccess(action === 'CONFIRM' ? 'Agendamento confirmado.' : action === 'RESCHEDULE' ? 'Novo período registrado no histórico.' : 'Agendamento cancelado.');
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 412 || status === 428) setWriteConflict(true);
      setFailure(status === 412 || status === 428 ? 'O atendimento mudou enquanto você preenchia. Seu motivo e período foram preservados; confira o registro atual antes de confirmar novamente.' : errorMessage(error));
    }
    finally { setSending(false); }
  }
  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso a este atendimento." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar este atendimento." />;
  if (appointment.isPending) return <Spinner />;
  if (appointment.isError) return <div className="panel stack"><Feedback tone="danger">{errorMessage(appointment.error)}</Feedback><Button variant="secondary" onClick={() => void appointment.refetch()}>Tentar novamente</Button><Link to="/app/agenda">Voltar à agenda</Link></div>;
  if (!appointment.data || appointment.data.unitId !== unitId) return <EmptyState title="Atendimento indisponível nesta unidade" description="Consulte a agenda da unidade selecionada." />;
  const data = appointment.data;
  const fromSearch = (location.state as { fromSearch?: string } | null)?.fromSearch;
  const backTarget = fromSearch !== undefined
    ? `/app/agenda${fromSearch}`
    : typeof window !== 'undefined' && unitId && window.sessionStorage?.getItem(`agenda_filters_${unitId}`)
      ? `/app/agenda?${window.sessionStorage.getItem(`agenda_filters_${unitId}`)}`
      : '/app/agenda';

  const requestedPeriod = data.requestedStartsAt && data.requestedEndsAt
    ? `${formatDate(data.requestedStartsAt)} até ${formatDate(data.requestedEndsAt)}`
    : `${formatDate(data.startsAt)} até ${formatDate(data.endsAt)}`;
  const confirmedPeriod = data.confirmedStartsAt && data.confirmedEndsAt
    ? `${formatDate(data.confirmedStartsAt)} até ${formatDate(data.confirmedEndsAt)}`
    : data.status !== 'REQUESTED' && data.status !== 'CANCELED'
      ? `${formatDate(data.startsAt)} até ${formatDate(data.endsAt)}`
      : undefined;
  const hasTimeAdjustment = Boolean(
    confirmedPeriod &&
    data.requestedStartsAt &&
    data.confirmedStartsAt &&
    (data.requestedStartsAt !== data.confirmedStartsAt || data.requestedEndsAt !== data.confirmedEndsAt)
  );

  return <div className="stack">
    <PageHeader eyebrow={data.code} title={data.serviceLabel} description={`${data.teamName} · ${data.location}`} actions={<Link className="button button--secondary" to={backTarget}>Voltar à agenda</Link>} />
      {success && <Feedback tone="success">{success}</Feedback>}
      <div className={styles.detailColumns}>
        <section className="panel stack"><div className={styles.sectionHead}><h2>Dados do atendimento</h2><Badge tone={data.status === 'CANCELED' ? 'neutral' : data.status === 'REQUESTED' ? 'warning' : 'success'}>{appointmentLabels[data.status]}</Badge></div>
          <div className={styles.timeSection}>
            <div className={styles.timeBox}>
              <span className={styles.timeLabel}>Horário solicitado pela equipe</span>
              <strong className={styles.timeValue}>{requestedPeriod}</strong>
            </div>
            <div className={styles.timeBox}>
              <span className={styles.timeLabel}>Horário operacional confirmado</span>
              {confirmedPeriod ? (
                <div className={styles.confirmedValueRow}>
                  <strong className={styles.timeValue}>{confirmedPeriod}</strong>
                  {hasTimeAdjustment && <Badge tone="neutral">Ajustado na confirmação</Badge>}
                </div>
              ) : (
                <span className="muted">{data.status === 'CANCELED' ? 'Agendamento cancelado' : 'Aguardando confirmação operacional'}</span>
              )}
            </div>
          </div>
          <dl className={styles.metadata}>
            <div><dt>Equipe</dt><dd>{data.teamName}</dd></div>
            <div><dt>Responsável pelo atendimento</dt><dd>{data.responsibleName}</dd></div>
            <div><dt>Local do serviço</dt><dd>{data.location}</dd></div>
            <div><dt>Participantes</dt><dd>{data.participants.length} pessoa(s)</dd></div>
          </dl>
          <dl className={styles.metadata}><div className={styles.wide}><dt>Serviços agendados</dt><dd>{data.serviceLabel}</dd></div></dl>
          {data.notes && <div><h3>Observações</h3><p className="muted">{data.notes}</p></div>}
          <div className="actions">
            {hasAction('CONFIRM') && <Button disabled={busy} onClick={() => select('CONFIRM')}>Confirmar agendamento</Button>}
            {hasAction('RESCHEDULE') && <Button disabled={busy} variant="secondary" onClick={() => select('RESCHEDULE')}>Reagendar</Button>}
            {hasAction('CANCEL') && <Button disabled={busy} variant="danger" onClick={() => select('CANCEL')}>Cancelar agendamento</Button>}
            {hasAction('OPEN_PERMIT') && <Button disabled={busy} onClick={() => select('OPEN_PERMIT')}>Abrir atendimento em campo</Button>}
            {data.permitId && can('permits.read') && <Link className="button button--primary" to={`/app/pts/${data.permitId}`}>Acompanhar PT →</Link>}
            {can('at.write') && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(data.status) && <Link className="button button--secondary" to={`/app/ats/nova?appointmentId=${data.id}`}>Preparar AT</Link>}
            {can('pet.write') && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(data.status) && <Link className="button button--secondary" to={`/app/pets/nova?appointmentId=${data.id}`}>Preparar PET</Link>}
          </div>
          {data.status !== 'CANCELED' && <Feedback tone="info">Abrir o atendimento inicia a verificação em campo. A execução exige liberação explícita na PT pelo responsável designado.</Feedback>}
        </section>
        <section className="panel stack"><h2>Histórico do agendamento</h2>{data.history.length ? <ol className={styles.history}>{data.history.map(event => <li key={event.id}><strong>{eventLabels[event.action] || event.action.replaceAll('_', ' ')}</strong><p className="muted">{event.actorName}</p><small>{formatDate(event.occurredAt)}</small>{event.reason && <p>{event.reason}</p>}</li>)}</ol> : <p className="muted">Nenhum evento registrado.</p>}</section>
      </div>
      <EligibilityPanel appointmentId={data.id} readOnly={data.status === 'CANCELED'} />
      <Modal open={Boolean(action)} title={action ? actionTitles[action] : ''} onClose={close}>
        {action && <form className="stack" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {action === 'OPEN_PERMIT' ? <Feedback tone="warning">O atendimento será aberto para verificação em campo. A atividade continuará bloqueada até que documentos, checklist e ciências estejam completos e o responsável faça a liberação.</Feedback> : action === 'CONFIRM' ? <>
            <p>Confirme o atendimento para a equipe <strong>{data.teamName}</strong>. Você pode confirmar o horário solicitado ou definir o horário operacional confirmado.</p>
            <div className="form-grid">
              <Field label="Início confirmado *"><input type="datetime-local" value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></Field>
              <Field label="Término confirmado *"><input type="datetime-local" value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></Field>
            </div>
            <Field label="Observação da confirmação (opcional)"><input maxLength={300} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Ex.: Janela confirmada conforme disponibilidade de acesso" /></Field>
          </> : action === 'CANCEL' ? <p>O agendamento será cancelado. O motivo ficará registrado no histórico.</p> : <><p>Informe o novo período no horário de Brasília. O período anterior e o motivo serão preservados no histórico.</p><div className="form-grid"><Field label="Novo início *"><input type="datetime-local" value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></Field><Field label="Novo término *"><input type="datetime-local" value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></Field></div></>}
          {(action === 'CANCEL' || action === 'RESCHEDULE') && <Field label="Motivo *"><textarea maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></Field>}
          {failure && <Feedback tone="danger">{failure}</Feedback>}
          {conflict && <Feedback tone="warning">O registro mudou enquanto esta confirmação estava aberta. O preenchimento foi mantido.<div className="actions"><Button variant="secondary" disabled={busy} onClick={() => void refreshCurrent()}>Atualizar atendimento e preservar preenchimento</Button></div></Feedback>}
          {actionNotice && <Feedback>{actionNotice}</Feedback>}
          {!hasAction(action) && <Feedback tone="warning">Esta ação já não está disponível no estado atual do atendimento. Feche a janela e confira o registro.</Feedback>}
          <div className="actions"><Button type="submit" variant={action === 'CANCEL' ? 'danger' : 'primary'} disabled={busy || conflict || !hasAction(action)}>{busy ? 'Registrando…' : actionTitles[action]}</Button><Button variant="secondary" disabled={busy} onClick={close}>Voltar</Button></div>
        </form>}
      </Modal>
    </div>;
}
