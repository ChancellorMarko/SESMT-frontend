import { useNavigationGuard } from '../../app/navigation/NavigationProtection';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, PermitOptionsDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import { Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { appointmentInstant, appointmentLocal, errorMessage } from './support';
import { EligibilityPanel } from './EligibilityPanel';
import { AppointmentHistory, AppointmentSummary } from './AppointmentOverview';
import { readinessReturnPath } from '../requirements/readiness-navigation';
import { agendaReturnSearch, permitAgendaNavigation } from './permit-agenda-navigation';

type Action = 'CONFIRM' | 'RESCHEDULE' | 'CANCEL' | 'OPEN_PERMIT';
const actionTitles: Record<Action, string> = { CONFIRM: 'Confirmar agendamento', RESCHEDULE: 'Reagendar serviço', CANCEL: 'Cancelar agendamento', OPEN_PERMIT: 'Abrir atendimento em campo' };

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
  const [responsibleId, setResponsibleId] = useState('');
  const initialDraft = useRef<{ start: string; end: string; responsibleId: string } | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState((location.state as { success?: string } | null)?.success || '');
  const queryKey = ['appointment', sessionKey, unitId, id];
  const appointment = useQuery({ queryKey, queryFn: ({ signal }) => api.get<AppointmentDto>(`/appointments/${id}`, { signal }), enabled: can('appointments.read') && Boolean(id && unitId) });
  const needsResponsible = action === 'CONFIRM' && Boolean(appointment.data && !appointment.data.responsibleId);
  const options = useQuery({ queryKey: ['permit-options', sessionKey, unitId], queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { query: { unitId }, signal }), enabled: needsResponsible && can('appointments.write') && Boolean(unitId) });
  const busy = sending || refreshing;
  useNavigationGuard({ dirty: Boolean(action), busy });
  const conflict = writeConflict || Boolean(action && actionRevision !== appointment.data?.revision);
  const hasAction = (value: Action) => Boolean(appointment.data && appointment.data.unitId === unitId && appointment.data.availableActions.includes(value) && can(value === 'OPEN_PERMIT' ? 'permits.operate' : 'appointments.write'));
  useEffect(() => {
    initialDraft.current = undefined;
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
    const start = appointmentLocal(appointment.data.startsAt), end = appointmentLocal(appointment.data.endsAt);
    initialDraft.current = { start, end, responsibleId: appointment.data.responsibleId };
    setStart(start); setEnd(end);
    setResponsibleId(appointment.data.responsibleId);
  }
  function close() {
    if (busy) return;
    const initial = initialDraft.current;
    const changed = initial && (reason !== '' || start !== initial.start || end !== initial.end || responsibleId !== initial.responsibleId);
    if (changed && !window.confirm('Há alterações nesta ação ainda não enviadas. Deseja descartar o preenchimento e fechar?')) return;
    initialDraft.current = undefined; setAction(undefined); setActionRevision(undefined);
  }
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
    if ((action === 'RESCHEDULE' || action === 'CONFIRM') && (!startsAt || !endsAt || startsAt >= endsAt)) { setFailure('Informe um período válido, com término após o início.'); return; }
    if (needsResponsible && (options.isFetching || options.isError || !options.data?.responsibles.some(person => person.id === responsibleId))) { setFailure('Selecione um responsável disponível para confirmar o atendimento.'); return; }
    setSending(true);
    try {
      const path: Record<Action, string> = { CONFIRM: 'confirm', RESCHEDULE: 'reschedule', CANCEL: 'cancel', OPEN_PERMIT: 'open-permit' };
      const body = action === 'CANCEL' ? { reason: reason.trim() } : action === 'RESCHEDULE' ? { startsAt, endsAt, reason: reason.trim() } : action === 'CONFIRM' ? { confirmedStartsAt: startsAt, confirmedEndsAt: endsAt, note: reason.trim(), ...(needsResponsible ? { responsibleId } : {}) } : {};
      const result = await api.post<AppointmentDto | WorkPermitDto>(`/appointments/${current.id}/${path[action]}`, body, { etag: revisionEtag(actionRevision) });
      await Promise.all(['appointment', 'appointments', 'eligibility', 'work-permits', 'permit-dashboard', 'documentary-readiness', 'work-authorizations', 'work-authorization', 'authorization-options'].map(key => client.invalidateQueries({ queryKey: [key] })));
      setAction(undefined);
      setActionRevision(undefined);
      if (action === 'OPEN_PERMIT') navigate(`/app/pts/${encodeURIComponent(result.id)}`, { state: permitOrigin(result.id, current.id) });
      else setSuccess(action === 'CONFIRM' ? 'Agendamento confirmado.' : action === 'RESCHEDULE' ? 'Novo período registrado no histórico.' : 'Agendamento cancelado.');
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 412 || status === 428) setWriteConflict(true);
      setFailure(status === 412 || status === 428 ? 'O atendimento mudou enquanto você preenchia. Seu motivo e período foram preservados; confira o registro atual antes de confirmar novamente.' : errorMessage(error));
    }
    finally { setSending(false); }
  }
  const fromSearch = (location.state as { fromSearch?: string } | null)?.fromSearch;
  let storedSearch = '';
  try { if (unitId) storedSearch = window.sessionStorage.getItem(`agenda_filters_${unitId}`) || ''; } catch { /* The direct return link still works with storage disabled. */ }
  const readinessTarget = can('eligibility.read') ? readinessReturnPath(location.state, unitId) : undefined;
  const returnSearch = agendaReturnSearch(fromSearch, unitId) ?? agendaReturnSearch(storedSearch ? `?${storedSearch}` : '', unitId) ?? '';
  const backTarget = readinessTarget ?? `/app/agenda${returnSearch}`;
  const backLabel = readinessTarget ? 'Voltar às pendências' : 'Voltar à agenda';
  function permitOrigin(permitId: string, appointmentId: string) {
    return permitAgendaNavigation({ permitAgendaReturnTo: {
      permitId, appointmentId, unitId, sessionKey, source: 'appointment', search: returnSearch,
      ...(readinessTarget ? { readinessReturnTo: { unitId, search: readinessTarget.slice('/app/pendencias'.length) } } : {}),
    } }, sessionKey, unitId, permitId, can('appointments.read'), can('eligibility.read'), appointmentId);
  }

  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso a este atendimento." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar este atendimento." />;
  if (appointment.isPending) return <Spinner />;
  if (appointment.isError) return <div className="panel stack"><Feedback tone="danger">{errorMessage(appointment.error)}</Feedback><Button variant="secondary" onClick={() => void appointment.refetch()}>Tentar novamente</Button><Link to={backTarget}>{backLabel}</Link></div>;
  if (!appointment.data || appointment.data.unitId !== unitId) return <div className="panel stack"><EmptyState title="Atendimento indisponível nesta unidade" description="Consulte a agenda da unidade selecionada." /><Link to={backTarget}>{backLabel}</Link></div>;
  const data = appointment.data;
  return <div className="stack [&_.page-header_h1]:[overflow-wrap:anywhere] [&_.page-description]:[overflow-wrap:anywhere]">
    <PageHeader eyebrow={data.code} title={data.serviceLabel} description={`${data.teamName} · ${data.location}`} actions={<Link className="button button--secondary" to={backTarget}>{backLabel}</Link>} />
      {success && <Feedback tone="success">{success}</Feedback>}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <AppointmentSummary appointment={data} actions={[
            hasAction('CONFIRM') && <Button key="confirm" disabled={busy} onClick={() => select('CONFIRM')}>Confirmar agendamento</Button>,
            hasAction('RESCHEDULE') && <Button key="reschedule" disabled={busy} variant="secondary" onClick={() => select('RESCHEDULE')}>Reagendar</Button>,
            hasAction('CANCEL') && <Button key="cancel" disabled={busy} variant="danger" onClick={() => select('CANCEL')}>Cancelar agendamento</Button>,
            hasAction('OPEN_PERMIT') && <Button key="open" disabled={busy} onClick={() => select('OPEN_PERMIT')}>Abrir atendimento em campo</Button>,
            data.permitId && can('permits.read') && <Link key="permit" className="button button--primary" to={`/app/pts/${encodeURIComponent(data.permitId)}`} state={permitOrigin(data.permitId, data.id)}>Acompanhar PT →</Link>,
            can('at.write') && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(data.status) && <Link key="at" className="button button--secondary" to={`/app/ats/nova?appointmentId=${encodeURIComponent(data.id)}`}>Preparar AT</Link>,
            can('pet.write') && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(data.status) && <Link key="pet" className="button button--secondary" to={`/app/pets/nova?appointmentId=${encodeURIComponent(data.id)}`}>Preparar PET</Link>,
          ]} />
          <EligibilityPanel appointmentId={data.id} readOnly={data.status === 'CANCELED'} />
        </div>
        <AppointmentHistory history={data.history} />
      </div>
      <Modal open={Boolean(action)} title={action ? actionTitles[action] : ''} onClose={close}>
        {action && <form className="stack" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {action === 'OPEN_PERMIT' ? <Feedback tone="warning">O atendimento será aberto para verificação em campo. A atividade continuará bloqueada até que documentos, checklist e ciências estejam completos e o responsável faça a liberação.</Feedback> : action === 'CONFIRM' ? <>
            <p>Confirme o atendimento para a equipe <strong>{data.teamName}</strong>. Você pode confirmar o horário solicitado ou definir o horário operacional confirmado.</p>
            {needsResponsible && <>
              <Field label="Responsável pelo atendimento *"><select value={responsibleId} disabled={busy || options.isFetching || options.isError} onChange={event => setResponsibleId(event.target.value)}><option value="">Selecione o responsável</option>{options.data?.responsibles.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
              {options.isError && <Feedback tone="danger">Não foi possível carregar os responsáveis. <Button variant="secondary" disabled={busy || options.isFetching} onClick={() => void options.refetch()}>Tentar carregar responsáveis</Button></Feedback>}
              <p className="muted">A solicitação pelo convite aguarda a atribuição de um responsável interno. Confirmar o agendamento mantém a execução sujeita à liberação na PT.</p>
            </>}
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
