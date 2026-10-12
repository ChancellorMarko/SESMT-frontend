import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { CalendarClock, ArrowUpRight } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, PageDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { dateOnly, formatDate } from '../../shared/lib/format';
import { errorMessage } from './validation';
import { DocumentStatus } from './DocumentStatus';
import { daysUntil, expiryQuery, expiryWindow, expiryWindows, positivePage } from './expiry';
import styles from './expiry.module.css';

export function ExpirationsPage() {
  const { unitId, sessionKey, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  // Refresh the civil day even when the operator leaves this screen open overnight.
  const [today, setToday] = useState(() => dateOnly());
  useEffect(() => {
    const update = () => setToday(dateOnly());
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);
  const previousUnit = params.get('unitId');
  useEffect(() => {
    if (!unitId || previousUnit === unitId) return;
    const next = new URLSearchParams(params); next.set('unitId', unitId);
    if (previousUnit) next.delete('page');
    setParams(next, { replace: true });
  }, [unitId, previousUnit, params, setParams]);
  const expired = params.get('view') === 'expired';
  const days = expiryWindow(params.get('days'));
  const page = positivePage(params.get('page'));
  const filters = expiryQuery(params, today);
  const list = useQuery({
    queryKey: ['documents', 'expirations', sessionKey, unitId, page, filters],
    queryFn: ({ signal }) => api.get<PageDto<DocumentDto>>('/documents', { signal, query: { unitId, page, pageSize: 10, ...filters } }),
    enabled: Boolean(unitId) && can('documents.read') && (!previousUnit || previousUnit === unitId),
  });
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  function setPage(value: number) { const next = new URLSearchParams(params); next.set('page', String(value)); setParams(next); }
  function refresh() { const current = dateOnly(); if(current !== today) setToday(current); else void list.refetch(); }
  const documentsLink = `/app/documentos?${new URLSearchParams({ ...filters, ...(unitId ? { unitId } : {}) })}`;
  return <div className="stack">
    <PageHeader eyebrow="PLANEJAMENTO DOCUMENTAL" title="Vencimentos" description="Antecipe renovações e acompanhe documentos vencidos da unidade selecionada." actions={<Link className="button button--secondary" to={documentsLink}>Abrir no repositório <ArrowUpRight size={16} aria-hidden="true" /></Link>} />
    <section className={`panel ${styles.filters}`} aria-label="Consulta de vencimentos">
      <Field label="Consultar"><select value={expired ? 'expired' : 'upcoming'} onChange={e => change('view', e.target.value)}><option value="upcoming">A vencer</option><option value="expired">Vencidos</option></select></Field>
      {!expired && <Field label="Antecedência"><select value={days} onChange={e => change('days', e.target.value)}>{expiryWindows.map(value => <option key={value} value={value}>Próximos {value} dias</option>)}</select></Field>}
      <form className={styles.search} onSubmit={e => { e.preventDefault(); change('q', search.trim().slice(0, 200)); }}><Field label="Buscar por título ou código"><input value={search} onChange={e => setSearch(e.target.value)} maxLength={200} placeholder="Ex.: PGR, relatório, DOC-001" /></Field><Button type="submit">Buscar</Button></form>
    </section>
    <div className={styles.period}><CalendarClock size={23} aria-hidden="true" /><div><strong>{expired ? 'Documentos com situação vencida' : `Vencimentos de ${formatDate(today)} a ${formatDate('validUntilTo' in filters ? filters.validUntilTo : undefined)}`}</strong><p>{expired ? 'A situação exibida é a informada pelo serviço documental.' : 'A consulta reúne documentos vigentes com uma data de vencimento no período.'}</p></div><Button variant="secondary" disabled={list.isFetching || !unitId || !can('documents.read')} onClick={refresh}>Atualizar</Button></div>
    {!can('documents.read') ? <Feedback tone="warning">Seu perfil não possui acesso à consulta documental.</Feedback> : !unitId ? <Feedback tone="warning">Selecione uma unidade para consultar os vencimentos.</Feedback> : list.isPending ? <Spinner /> : list.isError ? <div className="panel stack"><Feedback tone="danger">{errorMessage(list.error)}</Feedback><Button variant="secondary" onClick={() => void list.refetch()}>Tentar novamente</Button></div> : <section className="panel stack" aria-label="Resultado da consulta">
      <div className={styles.resultTitle}><h2>{expired ? 'Documentos vencidos' : 'Documentos a vencer'}</h2><Badge tone={expired ? 'danger' : 'warning'}>{list.data?.total ?? 0} documento(s)</Badge></div>
      {!list.data?.items.length ? <EmptyState title={page > 1 ? 'Esta página não possui documentos' : 'Nenhum vencimento encontrado'} description={page > 1 ? 'Volte à primeira página para consultar o resultado atualizado.' : 'Altere o período ou a busca para consultar outros documentos.'} /> : <div className={`table-wrap ${styles.results}`}><table className="data-table"><thead><tr><th>Documento</th><th>Situação</th><th>Vencimento</th><th>Prazo</th></tr></thead><tbody>{list.data.items.map(document => {
        const remaining = daysUntil(document.validUntil, today);
        return <tr key={document.id}><td><Link to={`/app/documentos/${document.id}`}><strong>{document.title}</strong></Link><small>{document.code}</small></td><td><span className={styles.mobileLabel} aria-hidden="true">Situação</span><DocumentStatus status={document.status} /></td><td><span className={styles.mobileLabel} aria-hidden="true">Vencimento</span>{formatDate(document.validUntil)}</td><td><span className={styles.mobileLabel} aria-hidden="true">Prazo</span><Badge tone={expired || remaining !== undefined && remaining <= 7 ? 'warning' : 'info'}>{remaining === undefined ? 'Sem data informada' : remaining < 0 ? `Há ${-remaining} dia(s)` : remaining === 0 ? 'Vence hoje' : `Em ${remaining} dia(s)`}</Badge></td></tr>;
      })}</tbody></table></div>}
      <div className="pagination"><span>Página {page} de {Math.max(1, Math.ceil((list.data?.total ?? 0) / 10))}</span><div className="actions">{page > 1 && !list.data?.items.length && <Button variant="secondary" onClick={() => setPage(1)}>Primeira página</Button>}<Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={page * 10 >= (list.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Próxima</Button></div></div>
    </section>}
  </div>;
}
