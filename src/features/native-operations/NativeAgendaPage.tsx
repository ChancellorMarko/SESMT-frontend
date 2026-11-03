import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeAgenda, nativeAgendaCriteria, nativeAgendaPageSize, nativeAgendaQuery, nativeAppointmentLabels } from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeAgendaPage() {
  const { sessionKey } = useSession();
  return <Agenda key={sessionKey}/>;
}
function Agenda() {
  const { me, sessionKey, can } = useSession(), [params, setParams] = useAppQueryParams(), location = useLocation();
  const criteria = nativeAgendaCriteria(params), search = params.toString();
  const [q, setQ] = useState(params.get('q') ?? ''), [status, setStatus] = useState(params.get('status') ?? '');
  const [from, setFrom] = useState(params.get('from') ?? ''), [to, setTo] = useState(params.get('to') ?? ''), [error, setError] = useState('');
  useEffect(() => { setQ(params.get('q') ?? ''); setStatus(params.get('status') ?? ''); setFrom(params.get('from') ?? ''); setTo(params.get('to') ?? ''); setError(''); }, [search]);
  const appointments = useVerifiedRead({ queryKey: ['native-agenda', sessionKey, criteria], scope: ['native-agenda', sessionKey], enabled: Boolean(me && criteria),
    request: signal => api.get<unknown>('/appointments', { query: nativeAgendaQuery(criteria!), signal }), validate: value => checkedNativeAgenda(value, criteria!) });
  const data = criteria ? appointments.data : undefined, pages = data ? Math.max(1, Math.ceil(data.total / nativeAgendaPageSize)) : 1;
  function submit(event: FormEvent) {
    event.preventDefault(); const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: q.trim(), status, from, to, companyId: params.get('companyId') ?? '' })) if (value) next.set(key, value);
    if (!nativeAgendaCriteria(next)) { setError('Confira a busca, a situação e as datas do período.'); return; }
    setError(''); setParams(next);
  }
  function page(number: number) { const next = new URLSearchParams(params); next.set('page', String(number)); setParams(next); }
  return <div className="stack">
    <PageHeader title="Agenda" description="Atividades, horários e responsáveis. Os horários são exibidos em Brasília." actions={<><Button variant="secondary" disabled={!criteria || appointments.isFetching} onClick={() => void appointments.refetch()}>Atualizar agenda</Button>{can('agenda:criar') && <Link className="button button--primary" to="/app/agenda/novo" state={{ nativeReturnTo: `${location.pathname}${location.search}` }}>Solicitar agendamento</Link>}</>}/>
    {location.state?.nativeCreated===true&&<Feedback tone="success">Solicitação de agendamento registrada.</Feedback>}
    <form className={`panel ${styles.toolbar}`} aria-label="Filtros da agenda" onSubmit={submit}>
      <Field label="Buscar por título"><input type="search" value={q} maxLength={200} onChange={event => setQ(event.target.value)}/></Field>
      <Field label="Situação"><select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todas</option>{Object.entries(nativeAppointmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="De (UTC)"><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></Field><Field label="Até (UTC)"><input type="date" value={to} onChange={event => setTo(event.target.value)}/></Field>
      <Button type="submit">Buscar</Button><Button variant="ghost" onClick={() => { setParams(new URLSearchParams()); setQ(''); setStatus(''); setFrom(''); setTo(''); setError(''); }}>Limpar</Button>
    </form>
    {criteria?.companyId&&<div className="actions"><Badge>Filtro de empresa aplicado</Badge><InfoButton title="Empresa da consulta"><p>{criteria.companyId}</p></InfoButton><Button variant="ghost" onClick={()=>{const next=new URLSearchParams(params);next.delete('companyId');next.delete('page');setParams(next);}}>Remover filtro de empresa</Button></div>}
    {(error || !criteria) && <Feedback tone="warning">{error || 'Os filtros do endereço são inválidos. Corrija a consulta ou limpe os filtros.'}</Feedback>}
    {appointments.isPending && <Spinner/>}
    {appointments.isError && <Feedback tone="danger">{appointments.error instanceof ApiError && appointments.error.status === 403 ? 'A API não autorizou a consulta da agenda para esta conta.' : 'Não foi possível conferir os agendamentos. Atualize a consulta.'}</Feedback>}
    {data && <section className={styles.results} aria-label="Agendamentos da conta" aria-busy={appointments.isFetching}>
      {!data.items.length ? <EmptyState title="Nenhum agendamento encontrado" description="Nenhum registro retornado para os filtros e acessos atuais."/> : <div className={styles.scroll} role="region" aria-label="Tabela de agendamentos" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Atividade</th><th scope="col">Início e término</th><th scope="col">Situação</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}>
        <td><Link to={`/app/agenda/${item.id}`} state={{ nativeReturnTo: `${location.pathname}${location.search}` }}>{item.title}</Link><small>{item.serviceCodes.join(' · ') || 'Serviços não informados'}</small></td><td>{formatDate(item.startsAt)}<small>{formatDate(item.endsAt)}</small></td><td><Badge tone={item.status === 'CONFIRMED' ? 'success' : item.status === 'CANCELLED' ? 'neutral' : 'info'}>{nativeAppointmentLabels[item.status]}</Badge></td>
      </tr>)}</tbody></table></div>}
      {criteria!.page > pages && <Feedback tone="warning">Página fora do resultado. <Button variant="ghost" onClick={() => page(1)}>Ir para a primeira página</Button></Feedback>}
      <nav className={styles.footer} aria-label="Paginação da agenda"><span>{data.total} agendamento(s) · página {criteria!.page} de {pages}</span><div className="actions"><Button variant="secondary" disabled={criteria!.page <= 1 || appointments.isFetching} onClick={() => page(criteria!.page - 1)}>Anterior</Button><Button variant="secondary" disabled={criteria!.page >= pages || appointments.isFetching} onClick={() => page(criteria!.page + 1)}>Próxima</Button></div></nav>
    </section>}
  </div>;
}
