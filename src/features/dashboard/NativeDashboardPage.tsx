import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeDashboard, defaultNativeDashboardPeriod, nativeDashboardCriteria, requestNativeDashboard } from './native-dashboard';
import { NativeDashboardMetrics, NativeDashboardQueues } from './NativeDashboardPanels';
import { NativeDashboardEvolution } from './NativeDashboardEvolution';
import styles from './NativeDashboardPage.module.css';

/** The native controller requires authentication; its repository applies actor visibility. */
export function NativeDashboardPage() {
  const { me, sessionKey, unitId } = useSession();
  return me ? <Dashboard key={JSON.stringify([sessionKey, unitId])}/> : null;
}
function Dashboard() {
  const { me, sessionKey, unitId } = useSession(), [params, setParams] = useAppQueryParams();
  const [defaults] = useState(defaultNativeDashboardPeriod);
  const criteria = nativeDashboardCriteria(params, defaults, unitId);
  const [from, setFrom] = useState(params.get('from') ?? defaults.from), [to, setTo] = useState(params.get('to') ?? defaults.to);
  const [scope, setScope] = useState(params.get('scope') ?? 'account'), [formError, setFormError] = useState('');
  const search = params.toString();
  useEffect(() => { setFrom(params.get('from') ?? defaults.from); setTo(params.get('to') ?? defaults.to); setScope(params.get('scope') ?? 'account'); setFormError(''); }, [search]);
  const dashboard = useVerifiedRead({ queryKey: ['native-dashboard', sessionKey, criteria], scope: ['native-dashboard', sessionKey], enabled: Boolean(me && criteria),
    request: signal => requestNativeDashboard(criteria!, signal), validate: value => checkedNativeDashboard(value, criteria!) });
  const data = criteria ? dashboard.data : undefined;
  const empty = data && !data.appointments.length && !data.documents.length && !data.reviews.length
    && [data.summary.emVerificacao, data.summary.liberadas, data.summary.emExecucao, data.summary.concluidasAguardandoRevisao, data.summary.pendenciasDocumentais].every(value => value === 0)
    && data.evolution.series.every(item => item.concluidas + item.emAndamento + item.pendentes === 0);
  function submit(event: FormEvent) {
    event.preventDefault(); const next = new URLSearchParams({ from, to, scope });
    if (!nativeDashboardCriteria(next, defaults, unitId)) { setFormError('Informe um período válido de até 36 meses e uma abrangência disponível.'); return; }
    setFormError(''); setParams(next);
  }
  function clear() { setFrom(defaults.from); setTo(defaults.to); setScope('account'); setFormError(''); setParams(new URLSearchParams()); }
  return <div className="stack">
    <PageHeader title="Visão geral" description="Indicadores e atividades retornados pela API para os acessos da sua conta. O período usa dias UTC e os horários são exibidos em Brasília. Para restringir o painel à unidade do cabeçalho, escolha essa abrangência nos filtros." actions={<Button variant="secondary" disabled={!criteria || dashboard.isFetching} onClick={() => void dashboard.refetch()}>{dashboard.isFetching && data ? 'Atualizando…' : 'Atualizar painel'}</Button>}/>
    <form className={`panel ${styles.filters}`} onSubmit={submit} aria-label="Filtros do painel operacional">
      <Field label="De (UTC)"><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></Field>
      <Field label="Até (UTC)"><input type="date" value={to} onChange={event => setTo(event.target.value)}/></Field>
      <Field label="Abrangência"><select value={scope} onChange={event => setScope(event.target.value)}><option value="account">Acessos da conta</option><option value="unit" disabled={!unitId}>Unidade selecionada</option></select></Field>
      <Button type="submit">Buscar</Button><Button variant="ghost" onClick={clear}>Limpar</Button>
    </form>
    {(formError || !criteria) && <Feedback tone="warning">{formError || 'Os filtros deste endereço não são compatíveis com o painel. Informe ambas as datas, limite a consulta a 36 meses ou limpe os filtros.'}</Feedback>}
    {dashboard.isPending && <Spinner/>}
    {dashboard.isError && <Feedback tone="danger">{dashboard.error instanceof ApiError && dashboard.error.status === 403 ? 'A API não autorizou a consulta para esta abrangência. Confira seus escopos ou escolha Acessos da conta.' : 'Não foi possível conferir o painel operacional. Atualize a consulta para tentar novamente.'}</Feedback>}
    {data && <div className={styles.content} aria-busy={dashboard.isFetching}>
      <div className={styles.scope}><Badge>{criteria!.scope === 'unit' ? 'Unidade selecionada' : 'Acessos da conta'}</Badge><span>Período UTC: {criteria!.from.split('-').reverse().join('/')} a {criteria!.to.split('-').reverse().join('/')}</span></div>
      <NativeDashboardMetrics data={data.summary}/>
      {empty ? <div className="panel"><EmptyState title="Nenhuma atividade encontrada" description="A API não retornou atividades ou movimentações para este período e abrangência."/></div> : <>
        <NativeDashboardQueues key={JSON.stringify(criteria)} data={data}/>
        <NativeDashboardEvolution data={data.evolution}/>
      </>}
    </div>}
  </div>;
}
