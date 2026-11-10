import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../shared/api/client';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { formatDate } from '../../shared/lib/format';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { appointmentInstant } from '../agenda/support';
import { nativeAppointmentLabels, type NativeAppointment } from '../native-operations/contracts';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { checkedInviteContext, checkedInviteRequest, inviteTokenPattern, type NativeInviteContext } from './contracts';
import styles from '../teams/TeamInvitePage.module.css';

const invalidInvite = (failure: unknown) => failure instanceof ApiError && [401, 404].includes(failure.status);

/** Public page of an official appointment invite: no account, the link token is the only credential. */
export function NativeInvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const validToken = inviteTokenPattern.test(token);
  const context = useQuery({
    queryKey: ['native-invite-context', token], enabled: validToken, retry: false, staleTime: 0, refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => checkedInviteContext(await api.get<unknown>('/invites/context', { inviteToken: token, signal })),
  });
  const shell = (content: React.ReactNode) => <main className={`stack ${styles.page}`}><div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}><BrandLogo/></div>{content}</main>;

  if (validToken && context.isPending) return <main className={`${styles.page} ${styles.loading}`}><Spinner/><p className="muted" style={{ marginTop: '1rem' }}>Carregando dados do convite…</p></main>;
  if (!validToken || context.isError || !context.data) {
    const unavailable = validToken && !invalidInvite(context.error);
    return shell(<div className="panel stack">
      <EmptyState title={unavailable ? 'Não foi possível consultar o convite' : 'Convite inválido, expirado ou revogado'}
        description={unavailable ? 'Confira sua conexão e tente novamente.' : 'Confira se o endereço foi copiado por completo ou peça um novo convite a quem enviou o link.'}/>
      {unavailable && <Button onClick={() => void context.refetch()} disabled={context.isFetching}>Tentar novamente</Button>}
      <div style={{ textAlign: 'center' }}><Link to="/login" className="button button--secondary">Acessar a plataforma</Link></div>
    </div>);
  }
  return shell(<InviteRequest key={token} token={token} invite={context.data} onInvalid={() => void context.refetch()}/>);
}

function InviteRequest({ token, invite, onInvalid }: { token: string; invite: NativeInviteContext; onInvalid: () => void }) {
  const [title, setTitle] = useState(''), [startsAt, setStart] = useState(''), [endsAt, setEnd] = useState('');
  const [serviceIds, setServices] = useState<string[]>([]), [participantIds, setParticipants] = useState<string[]>([]), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [requests, setRequests] = useState<NativeAppointment[]>([]), [refreshing, setRefreshing] = useState(false);
  // One Idempotency-Key per filled-in request: sending the same content again returns the request already made.
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  const dirty = Boolean(title || startsAt || endsAt || serviceIds.length || participantIds.length);
  const toggle = (values: string[], id: string, checked: boolean) => checked ? [...values, id] : values.filter(value => value !== id);
  const serviceName = (code: string) => invite.services.find(service => service.code === code)?.name ?? code;
  const memberName = (id: string) => invite.members.find(member => member.id === id)?.name ?? 'Participante';

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    const start = appointmentInstant(startsAt), end = appointmentInstant(endsAt);
    if (!title.trim() || title.trim().length > 200) { setError('Informe um título de até 200 caracteres.'); return; }
    if (!start || !end || Date.parse(start) <= Date.now() || Date.parse(end) <= Date.parse(start)) { setError('Informe início futuro e término posterior, no horário de Brasília.'); return; }
    if (!serviceIds.length || serviceIds.some(id => !invite.services.some(service => service.id === id))) { setError('Selecione ao menos um serviço.'); return; }
    if (!participantIds.length || participantIds.some(id => !invite.members.some(member => member.id === id))) { setError('Selecione ao menos um participante da equipe.'); return; }
    if (!acknowledged) { setError('Confirme que a solicitação depende de confirmação e não autoriza a execução.'); return; }
    const payload = { title: title.trim(), startsAt: start, endsAt: end, serviceIds, participantIds };
    const serialized = JSON.stringify(payload);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const saved = checkedInviteRequest(await api.post<unknown>('/invites/appointments', payload, { inviteToken: token, idempotencyKey: lastRequest.current.key }), invite);
      if (saved.title !== payload.title || Date.parse(saved.startsAt) !== Date.parse(start) || Date.parse(saved.endsAt) !== Date.parse(end)) throw new InvalidReadResponse();
      setRequests(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setTitle(''); setStart(''); setEnd(''); setServices([]); setParticipants([]); setAcknowledged(false); lastRequest.current = undefined;
    } catch (failure) {
      if (invalidInvite(failure)) { onInvalid(); return; }
      setError(failure instanceof ApiError && [400, 409, 422].includes(failure.status) ? `${failure.message} Seu preenchimento foi mantido.`
        : failure instanceof InvalidReadResponse ? 'A resposta não confirmou a solicitação. Não altere o formulário e envie de novo para conferir.'
        : 'Não foi possível confirmar o envio. Você pode enviar de novo sem alterar o formulário: a mesma solicitação não é registrada duas vezes.');
    } finally { setBusy(false); }
  }
  async function refresh() {
    if (refreshing) return; setRefreshing(true); setError('');
    try {
      const updated = await Promise.all(requests.map(async item => checkedInviteRequest(await api.get<unknown>(`/invites/appointments/${item.id}`, { inviteToken: token }), invite, item.id)));
      setRequests(updated);
    } catch (failure) {
      if (invalidInvite(failure)) { onInvalid(); return; }
      setError('Não foi possível atualizar a situação das solicitações. Tente novamente.');
    } finally { setRefreshing(false); }
  }

  return <>
    <UnsavedChanges dirty={dirty} busy={busy}/>
    <section className="panel stack" aria-labelledby="native-invite-heading">
      <h1 id="native-invite-heading">Solicitar agendamento</h1>
      <p><strong>Equipe:</strong> {invite.teamName} · <strong>Local:</strong> {invite.locationName}</p>
      <p className="muted">Convite válido até {formatDate(invite.expiresAt)}.</p>
      <Feedback>A solicitação depende da confirmação do responsável. Ela não reserva horário, não libera trabalhadores e não cria uma PT.</Feedback>
      {error && <Feedback tone="danger">{error}</Feedback>}
      <form className="stack" onSubmit={event => void submit(event)} noValidate>
        <fieldset className={`stack ${styles.requestFields}`} disabled={busy}>
          <legend>Dados da solicitação</legend>
          <Field label="Título *"><input value={title} maxLength={200} onChange={event => setTitle(event.target.value)}/></Field>
          <div className="form-grid">
            <Field label="Início (Brasília) *"><input type="datetime-local" value={startsAt} onChange={event => setStart(event.target.value)}/></Field>
            <Field label="Término (Brasília) *"><input type="datetime-local" value={endsAt} onChange={event => setEnd(event.target.value)}/></Field>
          </div>
          <fieldset className={styles.choices}><legend>Serviços *</legend>
            {invite.services.map(service => <label className={styles.checkChoice} key={service.id}><input type="checkbox" checked={serviceIds.includes(service.id)} onChange={event => setServices(toggle(serviceIds, service.id, event.target.checked))}/><span>{service.name}</span></label>)}
          </fieldset>
          <fieldset className={styles.choices}><legend>Participantes da equipe *</legend>
            {!invite.members.length ? <p className="muted">A equipe não tem participantes disponíveis agora. Fale com quem enviou o convite.</p>
              : invite.members.map(member => <label className={styles.checkChoice} key={member.id}><input type="checkbox" checked={participantIds.includes(member.id)} onChange={event => setParticipants(toggle(participantIds, member.id, event.target.checked))}/><span>{member.name}</span></label>)}
          </fieldset>
          <label className={styles.checkChoice}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>Entendo que a solicitação depende de confirmação e não autoriza a execução do serviço.</span></label>
          <div className="actions"><Button type="submit" disabled={busy || !invite.members.length}>{busy ? 'Enviando…' : 'Enviar solicitação'}</Button></div>
        </fieldset>
      </form>
    </section>
    {requests.length > 0 && <section className="panel stack" aria-labelledby="native-invite-requests">
      <div className="toolbar"><h2 id="native-invite-requests">Solicitações enviadas nesta página</h2><Button variant="secondary" disabled={refreshing || busy} onClick={() => void refresh()}>Atualizar situação</Button></div>
      {requests.map(item => <article className="stack" key={item.id}>
        <div className="toolbar"><h3>{item.title}</h3><Badge tone={item.status === 'CANCELLED' ? 'warning' : item.status === 'REQUESTED' ? 'info' : 'success'}>{nativeAppointmentLabels[item.status]}</Badge></div>
        <p><strong>Horário:</strong> {formatDate(item.startsAt)} até {formatDate(item.endsAt)}</p>
        <p><strong>Serviços:</strong> {item.serviceCodes.map(serviceName).join(' + ')}</p>
        <p><strong>Participantes:</strong> {item.participantIds.map(memberName).join('; ')}</p>
      </article>)}
    </section>}
  </>;
}
