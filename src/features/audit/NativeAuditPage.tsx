import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { formatDate } from '../../shared/lib/format';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeAudit, nativeAuditCriteria, nativeAuditPageSize, nativeAuditQuery } from './native-audit';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeAuditPage() {
  const { sessionKey } = useSession();
  return <Audit key={sessionKey}/>;
}
function Audit() {
  const { can, sessionKey } = useSession(), [params, setParams] = useAppQueryParams();
  const criteria = nativeAuditCriteria(params), allowed = can('audit.read');
  const [action, setAction] = useState(params.get('action') ?? ''), [resource, setResource] = useState(params.get('resourceType') ?? '');
  const [from, setFrom] = useState(params.get('from') ?? ''), [to, setTo] = useState(params.get('to') ?? '');
  const [formError, setFormError] = useState(''), [selectedId, select] = useState('');
  const search = params.toString();
  useEffect(() => { setAction(params.get('action') ?? ''); setResource(params.get('resourceType') ?? ''); setFrom(params.get('from') ?? ''); setTo(params.get('to') ?? ''); setFormError(''); select(''); }, [search]);
  const scope = ['native-audit', sessionKey];
  const events = useVerifiedRead({ queryKey: [...scope, criteria], scope, enabled: allowed && Boolean(criteria),
    request: signal => api.get<unknown>('/audit-logs', { query: nativeAuditQuery(criteria!), signal }),
    validate: value => checkedNativeAudit(value, criteria!) });
  const data = criteria ? events.data : undefined, selected = data?.items.find(item => item.id === selectedId);
  const pages = data ? Math.max(1, Math.ceil(data.total / nativeAuditPageSize)) : 1;
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ action: action.trim().toUpperCase(), resourceType: resource.trim().toLowerCase(), from, to })) if (value) next.set(key, value);
    if (!nativeAuditCriteria(next)) { setFormError('Confira os códigos e as datas. O início do período deve ser anterior ou igual ao fim.'); return; }
    setFormError(''); setParams(next);
  }
  function changePage(page: number) { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); }
  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar auditoria.</Feedback>;
  return <div className="stack">
    <PageHeader title="Auditoria" description="Histórico autorizado pela API para os escopos da sua conta. Os filtros de data usam dias em UTC; os horários dos registros são exibidos em Brasília. A unidade do cabeçalho não filtra esta consulta." actions={<Button variant="secondary" disabled={!criteria || events.isFetching} onClick={() => void events.refetch()}>Atualizar auditoria</Button>}/>
    <form className={`panel ${styles.toolbar}`} onSubmit={submit} aria-label="Filtros de auditoria">
      <Field label="Ação"><input value={action} maxLength={100} placeholder="Ex.: UPDATE" onChange={event => setAction(event.target.value)}/></Field>
      <Field label="Recurso"><input value={resource} maxLength={100} placeholder="Ex.: documento" onChange={event => setResource(event.target.value)}/></Field>
      <Field label="De (UTC)"><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></Field>
      <Field label="Até (UTC)"><input type="date" value={to} onChange={event => setTo(event.target.value)}/></Field>
      <Button type="submit">Buscar</Button><Button variant="ghost" onClick={() => { setParams(new URLSearchParams()); setAction(''); setResource(''); setFrom(''); setTo(''); setFormError(''); }}>Limpar</Button>
    </form>
    {(formError || !criteria) && <Feedback tone="warning">{formError || 'Os filtros do endereço são inválidos. Corrija a consulta ou limpe os filtros.'}</Feedback>}
    {events.isPending && <Spinner/>}
    {events.isError && <Feedback tone="danger">{events.error instanceof ApiError && events.error.status === 403 ? 'A API não autorizou a consulta de auditoria para esta conta.' : 'Não foi possível conferir os eventos de auditoria. Tente atualizar a consulta.'}</Feedback>}
    {data && criteria!.page > pages && <Feedback tone="warning">A página solicitada está além do fim da consulta. <Button variant="ghost" onClick={() => changePage(1)}>Ir para a primeira página</Button></Feedback>}
    {data && <section className={styles.results} aria-label="Eventos de auditoria" aria-busy={events.isFetching}>
      {!data.items.length ? <EmptyState title="Nenhum evento encontrado" description="Não há registros nesta página para os filtros e acessos atuais."/> : <div className={styles.scroll} tabIndex={0} role="region" aria-label="Tabela de auditoria"><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Data e hora</th><th scope="col">Ação e recurso</th><th scope="col">Resultado</th><th scope="col">Detalhes</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td>{formatDate(item.momento)}</td><td><strong>{item.acao}</strong><small>{item.recursoTipo}</small></td><td>{item.resultado ? <Badge>{item.resultado}</Badge> : 'Não informado'}</td><td><Button variant="ghost" onClick={() => select(item.id)} aria-label={`Ver evento ${item.id}`}>Ver evento</Button></td></tr>)}</tbody></table></div>}
      <nav className={styles.footer} aria-label="Paginação de auditoria"><span>{data.total} evento(s) · página {criteria!.page} de {pages}</span><div className="actions"><Button variant="secondary" disabled={criteria!.page <= 1 || events.isFetching} onClick={() => changePage(criteria!.page - 1)}>Anterior</Button><Button variant="secondary" disabled={criteria!.page >= pages || events.isFetching} onClick={() => changePage(criteria!.page + 1)}>Próxima</Button></div></nav>
    </section>}
    <Modal open={Boolean(selected)} title="Detalhes do evento" onClose={() => select('')}>{selected && <dl className={styles.details}>{[
      ['Evento', selected.id], ['Data e hora', formatDate(selected.momento)], ['Ação', selected.acao], ['Recurso', selected.recursoTipo], ['ID do recurso', selected.recursoId], ['Versão', selected.versao], ['Ator', selected.atorId], ['Declarante', selected.declaranteId], ['Empresa', selected.empresaId], ['Resultado', selected.resultado], ['Rastreamento', selected.traceId],
    ].map(([label, value]) => <div key={String(label)} className="contents"><dt>{label}</dt><dd>{value ?? 'Não informado'}</dd></div>)}</dl>}</Modal>
  </div>;
}
