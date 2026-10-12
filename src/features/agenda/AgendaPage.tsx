import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { CalendarDays, MapPin, Users } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { appointmentLabels, errorMessage } from './support';
import styles from './Agenda.module.css';

export function AgendaPage() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const blockedOnly = params.get('eligibility') === 'blocked';
  const [search, setSearch] = useState(q);
  useEffect(() => { setSearch(q); }, [q]);
  const appointments = useQuery({
    queryKey: ['appointments', sessionKey, unitId, q, status, blockedOnly],
    queryFn: ({ signal }) => api.get<AppointmentDto[]>('/appointments', { signal, query: { unitId, q, status, eligibility: blockedOnly ? 'blocked' : undefined } }),
    enabled: can('appointments.read') && Boolean(unitId),
  });
  const filtered = Boolean(q || status || blockedOnly);
  function change(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); value ? next.set(key, value) : next.delete(key); return next; });
  }
  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à agenda." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar os serviços agendados." />;
  return <div className="stack">
    <PageHeader eyebrow="Planejamento e atendimento" title="Agenda de serviços" description="Organize a equipe, o horário e os participantes de cada serviço. A liberação para executar acontece na PT em campo." actions={can('appointments.write') && <Link className="button button--primary" to="/app/agenda/novo">Agendar serviço</Link>} />
    <form className="panel toolbar" onSubmit={event => { event.preventDefault(); change('q', search.trim()); }}>
      <Field label="Buscar atendimento"><input maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="Código, serviço, equipe ou local" /></Field>
      <Field label="Situação do agendamento"><select value={status} onChange={event => change('status', event.target.value)}><option value="">Todas as situações</option>{Object.entries(appointmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      {can('eligibility.read') && <Field label="Documentação dos participantes"><select value={blockedOnly ? 'blocked' : ''} onChange={event => change('eligibility', event.target.value)}><option value="">Todos os atendimentos</option><option value="blocked">Com pendências documentais</option></select></Field>}
      <Button variant="secondary" type="submit">Pesquisar</Button>
      {filtered && <Button variant="ghost" onClick={() => setParams({})}>Limpar filtros</Button>}
    </form>
    {appointments.isPending ? <Spinner /> : appointments.isError ? <div className="panel stack"><Feedback tone="danger">{errorMessage(appointments.error)}</Feedback><Button variant="secondary" onClick={() => void appointments.refetch()}>Tentar novamente</Button></div> : !appointments.data?.length ? <EmptyState title={filtered ? 'Nenhum atendimento encontrado' : 'Nenhum serviço agendado'} description={filtered ? 'Ajuste a pesquisa ou limpe os filtros.' : 'Agende um serviço para organizar o próximo atendimento da equipe.'} /> : <>
      <p className="muted">{appointments.data.length} atendimento(s) no seu escopo · Horários de Brasília</p>
      <div className={styles.cards}>{appointments.data.map(appointment => <article className={`panel ${styles.card}`} key={appointment.id}>
        <div className={styles.cardHeader}><div><p className={styles.cardCode}>{appointment.code}</p><h2><Link to={`/app/agenda/${appointment.id}`}>{appointment.serviceLabel}</Link></h2><p className="muted">{appointment.teamName}</p></div><Badge tone={appointment.status === 'CANCELED' ? 'neutral' : appointment.status === 'REQUESTED' ? 'warning' : 'success'}>{appointmentLabels[appointment.status]}</Badge></div>
        <dl className={styles.metadata}><div><dt><CalendarDays size={13} aria-hidden="true" /> Início</dt><dd>{formatDate(appointment.startsAt)}</dd></div><div><dt>Término previsto</dt><dd>{formatDate(appointment.endsAt)}</dd></div><div><dt><MapPin size={13} aria-hidden="true" /> Local</dt><dd>{appointment.location}</dd></div><div><dt><Users size={13} aria-hidden="true" /> Participantes</dt><dd>{appointment.participants.length} pessoa(s)</dd></div></dl>
        <div className="actions"><Link className="button button--secondary" to={`/app/agenda/${appointment.id}`}>Consultar atendimento</Link>{appointment.permitId && can('permits.read') && <Link className="button button--ghost" to={`/app/pts/${appointment.permitId}`}>Ver PT →</Link>}</div>
      </article>)}</div>
    </>}
  </div>;
}
