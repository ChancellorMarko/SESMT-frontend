import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Users, ShieldCheck, Clock, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { api, ApiError } from '../../shared/api/client';
import type { PublicTeamInviteDto, PublicInviteAppointmentDto, PublicInviteAppointmentWriteDto } from '../../shared/contracts/teams';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { useSession } from '../../shared/auth/SessionProvider';
import styles from './TeamInvitePage.module.css';
import { appointmentInstant, appointmentLabels } from '../agenda/support';
import { UnsavedChanges } from '../workers/UnsavedChanges';

export function TeamInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { status: sessionStatus, sessionKey } = useSession();
  const [now, setNow] = useState(Date.now);

  const inviteQuery = useQuery({
    queryKey: ['public-team-invite', sessionKey, token],
    queryFn: ({ signal }) =>
      api.get<PublicTeamInviteDto>(`/team-invites/public/${encodeURIComponent(token || '')}`, { signal }),
    enabled: Boolean(token) && sessionStatus !== 'restoring',
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    setNow(Date.now());
    if (inviteQuery.data?.status !== 'ACTIVE') return;
    const remaining = Date.parse(inviteQuery.data.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [inviteQuery.data?.expiresAt, inviteQuery.data?.status]);

  if ((inviteQuery.isPending || !inviteQuery.isFetchedAfterMount) && token) {
    return (
      <main className={`${styles.page} ${styles.loading}`}>
        <Spinner />
        <p className="muted" style={{ marginTop: '1rem' }}>Carregando dados do convite de equipe…</p>
      </main>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    const unavailable = inviteQuery.isError && !(inviteQuery.error instanceof ApiError && inviteQuery.error.status === 404);
    return (
      <main className={`stack ${styles.page}`}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <BrandLogo />
        </div>
        <div className="panel stack">
          <EmptyState
            title={unavailable ? 'Não foi possível consultar o convite' : 'Convite inválido ou não encontrado'}
            description={unavailable ? 'Confira sua conexão e tente novamente para verificar a situação atual do convite.' : 'Verifique se o endereço foi copiado por completo ou solicite um novo convite ao gestor da sua equipe.'}
          />
          {unavailable && <Button onClick={() => void inviteQuery.refetch()} disabled={inviteQuery.isFetching}>Tentar novamente</Button>}
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to="/login" className="button button--secondary">
              Acessar plataforma Ampara
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const data = inviteQuery.data;
  const isExpired = data.status === 'EXPIRED' || data.status === 'ACTIVE' && !(Date.parse(data.expiresAt) > now);
  const isTemporarilyUnavailable = data.unavailableReason === 'TEAM_INACTIVE';
  const isRevoked = data.status === 'REVOKED' && !isTemporarilyUnavailable;
  const isActive = data.status === 'ACTIVE' && !isExpired && !isTemporarilyUnavailable;

  return (
    <main className={`stack ${styles.page}`}>
      <div className={styles.header}>
        <BrandLogo className={styles.logo} />
        <Link to="/login" className="button button--ghost">
          Entrar com conta
        </Link>
      </div>

      <PageHeader
        eyebrow="ACESSO LIMITADO · CONVITE DE EQUIPE"
        title={data.teamName}
        description={isActive ? 'Confira a equipe e solicite o atendimento para avaliação do responsável.' : 'Solicite um novo link ao gestor para consultar a equipe.'}
      />

      {isRevoked && (
        <Feedback tone="danger">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <XCircle size={18} aria-hidden="true" />
            <strong>Este convite foi revogado pela administração e não é mais válido para acesso em campo.</strong>
          </div>
        </Feedback>
      )}

      {isTemporarilyUnavailable && <Feedback tone="warning">Esta equipe está inativa. O convite fica indisponível enquanto a equipe não for reativada.</Feedback>}

      {isExpired && (
        <Feedback tone="warning">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <strong>A validade deste convite expirou em {formatDate(data.expiresAt)}.</strong> Solicite ao líder da equipe a geração de um novo link atualizado.
          </div>
        </Feedback>
      )}

      {isActive && (
        <Feedback tone="info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle size={18} aria-hidden="true" />
            <span>Convite ativo. Apresente este comprovante ou consulte a escala antes do início da jornada.</span>
          </div>
        </Feedback>
      )}

      {!isActive && <Badge tone={isExpired || isTemporarilyUnavailable ? 'warning' : 'danger'}>{isTemporarilyUnavailable ? 'Equipe inativa' : isExpired ? 'Expirado' : 'Revogado'}</Badge>}

      {isActive && <>
      <section className="panel stack" aria-labelledby="team-info-heading">
        <div className="toolbar" style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)', paddingBottom: '0.75rem' }}>
          <h2 id="team-info-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
            <Users size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} aria-hidden="true" />
            Identificação e local
          </h2>
          <Badge tone={isActive ? 'success' : isExpired ? 'warning' : 'danger'}>
            {isActive ? 'Convite válido' : isExpired ? 'Expirado' : 'Revogado'}
          </Badge>
        </div>

        <dl className="form-grid">
          <div>
            <dt className="muted">Empresa</dt>
            <dd><strong>{data.companyName}</strong></dd>
          </div>
          <div>
            <dt className="muted">Unidade de trabalho</dt>
            <dd>{data.unitName}</dd>
          </div>
          <div>
            <dt className="muted">Chefe da equipe</dt>
            <dd>{data.chiefName}</dd>
          </div>
          <div>
            <dt className="muted">Validade do convite</dt>
            <dd>
              <Clock size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} aria-hidden="true" />
              {formatDate(data.expiresAt)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Participantes */}
      <section className="panel stack" aria-labelledby="team-members-heading">
        <h2 id="team-members-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
          Participantes vinculados ({data.members.length})
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Função operacional</th>
                <th>Papel</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member, idx) => (
                <tr key={idx}>
                  <td><strong>{member.name}</strong></td>
                  <td>{member.serviceFunction}</td>
                  <td>
                    {member.isChief ? (
                      <Badge tone="info">Chefe da equipe</Badge>
                    ) : (
                      <span className="muted">Participante</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Orientações operacionais de SST */}
      <section className="panel stack" aria-labelledby="instructions-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={20} color="var(--color-primary, #0284c7)" aria-hidden="true" />
          <h2 id="instructions-heading" style={{ margin: 0, fontSize: '1.15rem' }}>
            Instruções operacionais de segurança
          </h2>
        </div>
        <p style={{ lineHeight: 1.6 }}>{data.operationalInstructions}</p>
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          A solicitação por este link fica sujeita à confirmação de um responsável. A liberação de execução e emissão de PTs exige login de responsável autorizado.
        </div>
      </section>
      {data.appointmentRequestsEnabled && <InviteAppointmentRequests key={data.token} invite={data} onUnavailable={() => void inviteQuery.refetch()} />}
      </>}
    </main>
  );
}

function InviteAppointmentRequests({ invite, onUnavailable }: { invite: PublicTeamInviteDto; onUnavailable: () => void }) {
  const path = `/team-invites/public/${encodeURIComponent(invite.token)}/appointments`;
  const [serviceTypeIds, setServices] = useState<string[]>([]);
  const [participants, setParticipants] = useState<PublicInviteAppointmentWriteDto['participants']>([]);
  const [location, setLocation] = useState('');
  const [startsAt, setStart] = useState('');
  const [endsAt, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [declarantName, setDeclarant] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<PublicInviteAppointmentDto>();
  const [review, setReview] = useState<PublicInviteAppointmentWriteDto>();
  const [busy, setBusy] = useState(false);
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  const operation = useRef<AbortController | undefined>(undefined);
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  const requests = useQuery({ queryKey: ['public-invite-appointments', invite.token], queryFn: ({ signal }) => api.get<PublicInviteAppointmentDto[]>(path, { signal }), retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 30_000 });
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => { if (requests.error instanceof ApiError && requests.error.status === 410) unavailable.current(); }, [requests.error]);
  const dirty = Boolean(location || startsAt || endsAt || notes || declarantName || participants.length || serviceTypeIds.length);
  const unavailableParticipants = participants.filter(person => !invite.members.some(member => member.memberId === person.memberId));
  const unavailableServices = serviceTypeIds.filter(id => !invite.services?.some(service => service.id === id));

  function prepare(event: FormEvent) {
    event.preventDefault(); setError(''); setSaved(undefined);
    const start = appointmentInstant(startsAt), end = appointmentInstant(endsAt);
    if (!serviceTypeIds.length || serviceTypeIds.length > 7 || serviceTypeIds.some(id => !invite.services?.some(service => service.id === id))) { setError('Selecione de um a sete serviços disponíveis.'); return; }
    if (location.trim().length < 3 || location.length > 200) { setError('Informe o local do serviço, com 3 a 200 caracteres.'); return; }
    if (!start || !end || Date.parse(start) <= Date.now() || end <= start) { setError('Informe um período futuro válido; o término deve ocorrer depois do início.'); return; }
    if (!participants.length || participants.some(person => !invite.members.some(member => member.memberId === person.memberId) || !person.serviceFunction.trim() || person.serviceFunction.length > 100)) { setError('Selecione pelo menos um participante disponível e informe sua função no atendimento.'); return; }
    if (declarantName.trim().length < 3 || declarantName.length > 100) { setError('Informe seu nome, com 3 a 100 caracteres.'); return; }
    if (notes.length > 2000) { setError('Use até 2.000 caracteres nas observações.'); return; }
    if (!acknowledged) { setError('Confirme que a solicitação não libera a execução do serviço.'); return; }
    if (!(Date.parse(invite.expiresAt) > Date.now())) { setError('A validade deste convite expirou. Solicite um novo link.'); onUnavailable(); return; }
    setReview({ serviceTypeIds, location: location.trim(), startsAt: start, endsAt: end, participants: participants.map(person => ({ ...person, serviceFunction: person.serviceFunction.trim() })), declarantName: declarantName.trim(), notes: notes.trim(), acknowledged: true });
  }
  async function submit() {
    if (!review || busy || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const serialized = JSON.stringify(review);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const result = await api.post<PublicInviteAppointmentDto>(path, review, { signal: controller.signal, idempotencyKey: lastRequest.current.key });
      if (controller.signal.aborted) return;
      setSaved(result); setReview(undefined); setServices([]); setParticipants([]); setLocation(''); setStart(''); setEnd(''); setNotes(''); setDeclarant(''); setAcknowledged(false); lastRequest.current = undefined;
      void requests.refetch();
    } catch (failure) {
      if (controller.signal.aborted) return;
      setReview(undefined);
      setError(failure instanceof Error ? failure.message : 'Não foi possível enviar. Seu preenchimento foi preservado; tente novamente.');
      if (failure instanceof ApiError && failure.status === 410) onUnavailable();
    } finally { if (!controller.signal.aborted) { operation.current = undefined; setBusy(false); } }
  }

  return <>
    <UnsavedChanges dirty={dirty} busy={busy} protectContext />
    <section className="panel stack" aria-labelledby="invite-request-heading">
      <h2 id="invite-request-heading">Solicitar atendimento</h2>
      <Feedback>O link permite solicitar um atendimento para esta equipe. O nome do solicitante é autodeclarado: o convite não comprova sua identidade. A solicitação não confirma horários, não libera trabalhadores e não cria uma PT.</Feedback>
      {saved && <Feedback tone="success">Solicitação {saved.code} recebida. Aguarde a avaliação e a confirmação do responsável.</Feedback>}
      {error && <Feedback tone="danger">{error}</Feedback>}
      {(unavailableParticipants.length > 0 || unavailableServices.length > 0) && <Feedback tone="warning">A equipe foi atualizada. Seu preenchimento contém {unavailableParticipants.length} participante(s) e {unavailableServices.length} serviço(s) indisponível(is). Remova essas seleções para continuar; os demais dados serão preservados.<div className="actions"><Button variant="secondary" disabled={busy || Boolean(review)} onClick={() => { setParticipants(current => current.filter(person => invite.members.some(member => member.memberId === person.memberId))); setServices(current => current.filter(id => invite.services?.some(service => service.id === id))); setError(''); }}>Remover itens indisponíveis</Button></div></Feedback>}
      <form className="stack" onSubmit={prepare} noValidate>
        <fieldset className={`stack ${styles.requestFields}`} disabled={busy || Boolean(review)}>
          <legend>Dados da solicitação</legend>
          <fieldset className={styles.choices}>
            <legend>Serviços solicitados *</legend>
            {(invite.services || []).map(service => <label className={styles.checkChoice} key={service.id}><input type="checkbox" checked={serviceTypeIds.includes(service.id)} disabled={!serviceTypeIds.includes(service.id) && serviceTypeIds.length >= 7} onChange={event => setServices(current => event.target.checked ? [...current, service.id] : current.filter(id => id !== service.id))} /><span>{service.name}{service.description && <small className="muted">{service.description}</small>}</span></label>)}
            {!invite.services?.length && <p className="muted">Nenhum serviço disponível para esta equipe.</p>}
          </fieldset>
          <Field label="Local do atendimento *"><input value={location} onChange={event => setLocation(event.target.value)} maxLength={200} /></Field>
          <div className="form-grid">
            <Field label="Início solicitado *"><input type="datetime-local" value={startsAt} onChange={event => setStart(event.target.value)} /></Field>
            <Field label="Término solicitado *"><input type="datetime-local" value={endsAt} onChange={event => setEnd(event.target.value)} /></Field>
          </div>
          <p className="muted">Datas e horas no fuso de Brasília (America/Sao_Paulo).</p>
          <fieldset className={styles.choices}>
            <legend>Participantes do atendimento *</legend>
            {invite.members.map((person, index) => {
              const selected = participants.find(value => value.memberId === person.memberId);
              return <div className="stack" key={person.memberId || index}><label className={styles.checkChoice}><input type="checkbox" disabled={!person.memberId} checked={Boolean(selected)} onChange={event => setParticipants(current => event.target.checked ? [...current, { memberId: person.memberId!, serviceFunction: person.serviceFunction }] : current.filter(value => value.memberId !== person.memberId))} /><span>{person.name}</span></label><Field label={`Função de ${person.name} no atendimento`}><input disabled={!selected} maxLength={100} value={selected?.serviceFunction || ''} onChange={event => setParticipants(current => current.map(value => value.memberId === person.memberId ? { ...value, serviceFunction: event.target.value } : value))} /></Field></div>;
            })}
          </fieldset>
          <Field label="Seu nome (autodeclarado) *"><input autoComplete="name" value={declarantName} onChange={event => setDeclarant(event.target.value)} maxLength={100} /></Field>
          <Field label="Observações da solicitação"><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} placeholder="Informe acesso e contexto. Evite dados médicos ou informações pessoais desnecessárias." /></Field>
          <label className={styles.checkChoice}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>Entendo que a solicitação depende de confirmação e não autoriza a execução do serviço.</span></label>
          <Button type="submit" disabled={!invite.services?.length || !invite.members.some(person => person.memberId)}>Revisar solicitação</Button>
        </fieldset>
      </form>
    </section>
    <section className="panel stack" aria-labelledby="invite-requests-heading">
      <div className="toolbar"><h2 id="invite-requests-heading">Solicitações deste convite</h2><Button variant="secondary" disabled={requests.isFetching || busy} onClick={() => void requests.refetch()}>Atualizar solicitações</Button></div>
      <p className="muted">Esta lista mostra somente pedidos realizados por este link enquanto ele estiver válido.</p>
      {requests.isPending ? <Spinner /> : requests.isError ? <Feedback tone="warning">Não foi possível atualizar as solicitações. Tente novamente.</Feedback> : !requests.data?.length ? <p className="muted">Nenhuma solicitação realizada por este convite.</p> : requests.data.map(item => <article className={`stack ${styles.requestCard}`} key={item.id} aria-label={`Solicitação ${item.code}`}>
        <div className="toolbar"><h3>{item.code}</h3><Badge tone={item.status === 'CANCELED' ? 'warning' : item.status === 'REQUESTED' ? 'info' : 'success'}>{appointmentLabels[item.status]}</Badge></div>
        <p><strong>Serviços:</strong> {item.services.map(service => service.name).join(' + ')}</p><p><strong>Local:</strong> {item.location}</p><p><strong>Horário solicitado:</strong> {formatDate(item.requestedStartsAt)} até {formatDate(item.requestedEndsAt)}</p>
        {item.confirmedStartsAt && <p><strong>Horário confirmado:</strong> {formatDate(item.confirmedStartsAt)} até {formatDate(item.confirmedEndsAt)}</p>}
        <p><strong>Participantes:</strong> {item.participants.map(person => `${person.name} (${person.serviceFunction})`).join('; ')}</p><p className="muted">Solicitante autodeclarado: {item.declarantName} · {formatDate(item.requestedAt)}</p>
      </article>)}
    </section>
    <Modal open={Boolean(review)} title="Confirmar solicitação de atendimento" onClose={() => { if (!busy) setReview(undefined); }}>
      {review && <div className="stack"><p><strong>Equipe:</strong> {invite.teamName}</p><p><strong>Serviços:</strong> {review.serviceTypeIds.map(id => invite.services?.find(service => service.id === id)?.name).join(' + ')}</p><p><strong>Local:</strong> {review.location}</p><p><strong>Período solicitado:</strong> {formatDate(review.startsAt)} até {formatDate(review.endsAt)}</p><p><strong>Participantes:</strong> {review.participants.length}</p><Feedback>O pedido ficará como solicitado. Aguarde a confirmação do responsável e a liberação operacional antes de executar.</Feedback><div className="actions"><Button disabled={busy} onClick={() => void submit()}>{busy ? 'Enviando solicitação…' : 'Enviar solicitação'}</Button><Button variant="secondary" disabled={busy} onClick={() => setReview(undefined)}>Voltar ao preenchimento</Button></div></div>}
    </Modal>
  </>;
}
