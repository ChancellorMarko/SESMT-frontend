import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { formatDate } from '../../shared/lib/format';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { checkedPermits, permitCriteria, permitPageSize, permitQuery, permitReviewLabels, permitStatusLabels } from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativePermitsPage() {
  const { sessionKey } = useSession();
  return <Permits key={sessionKey}/>;
}
function Permits() {
  const { sessionKey, unitId } = useSession(), [params, setParams] = useAppQueryParams(), location = useLocation();
  const criteria = permitCriteria(params), search = params.toString();
  const [q, setQ] = useState(params.get('q') ?? ''), [status, setStatus] = useState(params.get('status') ?? '');
  const [from, setFrom] = useState(params.get('from') ?? ''), [to, setTo] = useState(params.get('to') ?? ''), [error, setError] = useState('');
  const [localOnly, setLocalOnly] = useState(Boolean(criteria?.locationId && criteria.locationId === unitId?.toLowerCase()));
  useEffect(() => { setQ(params.get('q') ?? ''); setStatus(params.get('status') ?? ''); setFrom(params.get('from') ?? ''); setTo(params.get('to') ?? ''); setError(''); }, [search]);
  useEffect(() => { setLocalOnly(Boolean(criteria?.locationId && criteria.locationId === unitId?.toLowerCase())); }, [search, unitId]);
  const result = useVerifiedRead({ queryKey: ['native-permits', sessionKey, criteria], scope: ['native-permits', sessionKey], enabled: Boolean(criteria),
    request: signal => api.get<unknown>('/work-permits/search', { query: permitQuery(criteria!), signal }), validate: value => checkedPermits(value, criteria!) });
  const data = criteria ? result.data : undefined, pages = data ? Math.max(1, Math.ceil(data.total / permitPageSize)) : 1;
  function submit(event: FormEvent) {
    event.preventDefault(); const next = new URLSearchParams(params); next.delete('page');
    for (const [key, value] of Object.entries({ q: q.trim(), status, from, to })) value ? next.set(key, value) : next.delete(key);
    if (!permitCriteria(next)) { setError('Confira a busca, a situação e o período da atividade.'); return; }
    setError(''); setParams(next);
  }
  function page(number: number) { const next = new URLSearchParams(params); next.set('page', String(number)); setParams(next); }
  function remove(key: string) { const next = new URLSearchParams(params); next.delete(key); next.delete('page'); setParams(next); }
  return <div className="stack"><PageHeader title="Permissões de trabalho" description="Consulta nos escopos autorizados da conta. O período filtra sobreposição do agendamento em dias UTC; horários são mostrados em Brasília. A situação operacional e a revisão são informações diferentes." actions={<Button variant="secondary" disabled={!criteria || result.isFetching} onClick={() => void result.refetch()}>Atualizar PTs</Button>}/>
    <form className={`panel ${styles.toolbar}`} aria-label="Filtros das PTs" onSubmit={submit}>
      <Field label="Buscar atividade ou serviço"><input type="search" maxLength={200} value={q} onChange={event => setQ(event.target.value)}/></Field>
      <Field label="Situação operacional"><select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todas</option>{Object.entries(permitStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="Atividade de (UTC)"><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></Field>
      <Field label="Atividade até (UTC)"><input type="date" value={to} onChange={event => setTo(event.target.value)}/></Field>
      <Button type="submit">Buscar</Button><Button variant="ghost" onClick={() => setParams(new URLSearchParams())}>Limpar</Button>
    </form>
    <div className="actions"><label><input type="checkbox" disabled={!unitId || !criteria} checked={localOnly} onChange={event => { setLocalOnly(event.target.checked); const next = new URLSearchParams(params); next.delete('page'); if (event.target.checked && unitId) next.set('locationId', unitId); else next.delete('locationId'); setParams(next); }}/> Somente unidade selecionada</label>
      {(['companyId', 'locationId', 'participantUserId', 'serviceCode'] as const).map(key => criteria?.[key] && <span className="actions" key={key}><InfoButton title={`Filtro: ${{ companyId: 'empresa', locationId: 'local', participantUserId: 'participante', serviceCode: 'serviço' }[key]}`}><p>{criteria[key]}</p></InfoButton><Button variant="ghost" onClick={() => remove(key)}>Remover filtro de {{ companyId: 'empresa', locationId: 'local', participantUserId: 'participante', serviceCode: 'serviço' }[key]}</Button></span>)}
    </div>
    {(error || !criteria) && <Feedback tone="warning">{error || 'Os filtros do endereço são inválidos. Limpe ou corrija a consulta.'}</Feedback>}
    {result.isPending && <Spinner/>}{result.isError && <Feedback tone="danger">{result.error instanceof ApiError && [403, 404].includes(result.error.status) ? 'Consulta não autorizada ou indisponível nos acessos da conta.' : 'Não foi possível conferir as PTs. Atualize a consulta.'}</Feedback>}
    {data && <section className={styles.results} aria-label="Permissões de trabalho da conta" aria-busy={result.isFetching}>
      {!data.items.length ? <EmptyState title="Nenhuma PT encontrada" description="Não há registros para os filtros e acessos atuais."/> : <div className={styles.scroll} role="region" aria-label="Tabela de PTs" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Atividade e serviço</th><th scope="col">Abertura e versão</th><th scope="col">Operação e revisão</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><Link to={`/app/pts/${item.id}`} state={{ nativePermitReturnTo: `${location.pathname}${location.search}` }}>{item.title}</Link><small>{item.serviceCode.split(',').join(' · ')}</small></td><td>{formatDate(item.createdAt)}<small>Versão {item.version} · {item.participants.length} participante(s)</small></td><td><Badge tone={item.status === 'LIBERADA' ? 'success' : item.status === 'SUSPENSA' ? 'warning' : 'neutral'}>{permitStatusLabels[item.status]}</Badge><small>{permitReviewLabels[item.reviewStatus] ?? item.reviewStatus}</small></td></tr>)}</tbody></table></div>}
      {criteria!.page > pages && <Feedback tone="warning">Página fora do resultado. <Button variant="ghost" onClick={() => page(1)}>Ir para a primeira página</Button></Feedback>}
      <nav className={styles.footer} aria-label="Paginação de PTs"><span>{data.total} PT(s) · página {criteria!.page} de {pages}</span>{(pages > 1 || criteria!.page > 1) && <div className="actions"><Button variant="secondary" disabled={criteria!.page <= 1 || result.isFetching} onClick={() => page(criteria!.page - 1)}>Anterior</Button><Button variant="secondary" disabled={criteria!.page >= pages || result.isFetching} onClick={() => page(criteria!.page + 1)}>Próxima</Button></div>}</nav>
    </section>}
  </div>;
}
