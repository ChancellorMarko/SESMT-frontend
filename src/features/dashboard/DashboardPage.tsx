import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { FileCheck2, FileClock, Files, TriangleAlert } from 'lucide-react';
import { api } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DashboardDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { isCivilDate } from '../documents/validation';
import styles from './dashboard.module.css';

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
}

function documentFilter(indicator: DashboardDto['indicators'][number] & { targetFilter?: Record<string, string> }, unitId?: string) {
  const params = new URLSearchParams();
  const acceptedFilters = new Set(['companyId', 'unitId', 'sectorId', 'q', 'typeId', 'workerId', 'status', 'responsibleId', 'validUntilFrom', 'validUntilTo', 'issueDateFrom', 'issueDateTo']);
  for (const [key, value] of Object.entries(indicator.targetFilter ?? {})) if (acceptedFilters.has(key) && value) params.set(key, value);
  if (!indicator.targetFilter) {
    const status = ({ DOCUMENTS_EXPIRED: 'EXPIRED', DOCUMENTS_IN_REVIEW: 'IN_REVIEW', DOCUMENTS_ACTIVE: 'ACTIVE' } as Record<string, string>)[indicator.code];
    if (status) params.set('status', status);
  }
  if (unitId) params.set('unitId', unitId);
  return `/app/documentos${params.size ? `?${params}` : ''}`;
}

const indicatorVisuals = {
  DOCUMENTS_ACTIVE: { icon: FileCheck2, tone: 'teal' },
  DOCUMENTS_EXPIRING: { icon: FileClock, tone: 'amber' },
  DOCUMENTS_EXPIRED: { icon: TriangleAlert, tone: 'coral' },
  DOCUMENTS_IN_REVIEW: { icon: Files, tone: 'blue' },
};

export function DashboardPage() {
  const { sessionKey, unitId, can } = useSession();
  const [search, setSearch] = useSearchParams();
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to]);
  const invalidDates = !!from && !isCivilDate(from) || !!to && !isCivilDate(to);
  const invalidRange = invalidDates || !!from && !!to && from > to;
  const draftFromError = draftFrom && !isCivilDate(draftFrom) ? 'Informe uma data inicial válida.' : undefined;
  const draftToError = draftTo && !isCivilDate(draftTo) ? 'Informe uma data final válida.' : draftFrom && draftTo && draftFrom > draftTo ? 'A data final deve ser igual ou posterior à inicial.' : undefined;
  const draftInvalid = Boolean(draftFromError || draftToError);
  const dashboard = useQuery({
    queryKey: ['dashboard', sessionKey, unitId, from, to],
    queryFn: ({ signal }) => api.get<DashboardDto>('/dashboard', { query: { unitId, from: from || undefined, to: to || undefined }, signal }),
    enabled: can('dashboard.read') && !!unitId && !invalidRange,
  });
  if (!can('dashboard.read')) return <Feedback tone="warning">Seu acesso não permite consultar este painel.</Feedback>;
  if (!unitId) return <Feedback tone="warning">Selecione uma unidade para consultar o painel documental.</Feedback>;

  return <div className="stack">
    <PageHeader eyebrow="VISÃO GERAL" title="Painel documental" description="Vigência, revisão e atenção aos prazos da unidade selecionada." actions={<Button variant="secondary" onClick={() => dashboard.refetch()} disabled={dashboard.isFetching || invalidRange}>Atualizar</Button>} />
    <form className="panel toolbar" onSubmit={(event) => {
      event.preventDefault();
      if (draftInvalid) return;
      const next = new URLSearchParams();
      if (draftFrom) next.set('from', draftFrom);
      if (draftTo) next.set('to', draftTo);
      setSearch(next);
    }}>
      <Field label="Período inicial" error={draftFromError}><input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></Field>
      <Field label="Período final" error={draftToError}><input type="date" value={draftTo} min={isCivilDate(draftFrom) ? draftFrom : undefined} onChange={(event) => setDraftTo(event.target.value)} /></Field>
      <Button type="submit" disabled={draftInvalid}>Aplicar período</Button>
      {(from || to || draftFrom || draftTo) && <Button variant="ghost" onClick={() => { setDraftFrom(''); setDraftTo(''); setSearch(new URLSearchParams()); }}>Limpar filtros</Button>}
    </form>
    {invalidRange && <Feedback tone="danger">O intervalo na URL é inválido. Corrija as datas para consultar o painel.</Feedback>}
    {dashboard.isPending && !invalidRange && <Spinner />}
    {dashboard.isError && !invalidRange && <Feedback tone="danger">{dashboard.error.message} <Button variant="ghost" onClick={() => dashboard.refetch()} disabled={dashboard.isFetching}>Tentar novamente</Button></Feedback>}
    {dashboard.data && !dashboard.isError && !invalidRange && <>
      <div className={styles.meta}><Badge tone="neutral">Documentos e alertas</Badge><span className="muted">Atualizado em {dateTime(dashboard.data.generatedAt)} · America/Sao_Paulo</span></div>
      {dashboard.data.indicators.length ? <div className={styles.metrics}>{dashboard.data.indicators.map((indicator) => {
        const visual = indicatorVisuals[indicator.code as keyof typeof indicatorVisuals] ?? { icon: Files, tone: 'blue' };
        return <article className={`panel ${styles.metric}`} key={indicator.code}>
        <div className={styles.metricHeader}><span className={`${styles.metricIcon} ${styles[visual.tone]}`}><visual.icon size={22} aria-hidden="true" /></span><span className={styles.label}>{indicator.label}</span></div>
        <strong className={styles.value}>{new Intl.NumberFormat('pt-BR').format(indicator.value)}</strong>
        <span className={`muted ${styles.detail}`}>{indicator.formula}</span>
        <span className={`muted ${styles.detail}`}>Fonte: {indicator.source} · {indicator.period}</span>
        <span className={`muted ${styles.detail}`}>Atualização: {dateTime(indicator.updatedAt)}</span>
        {can('documents.read') && <Link to={documentFilter(indicator, unitId)}>Consultar documentos →</Link>}
      </article>;
      })}</div> : <EmptyState title="Indicadores indisponíveis" description="A API ainda não retornou indicadores para este contexto." />}
      <section className="panel stack">
        <div className={styles.meta}><div><h2>Pendências para acompanhar</h2><p className="muted">Ações e prazos informados pelo serviço documental.</p></div>{can('documents.read') && <Link to="/app/documentos">Abrir central →</Link>}</div>
        {dashboard.data.pendingItems.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Documento</th><th>Prazo</th><th>Situação</th><th>Consulta</th></tr></thead><tbody>{dashboard.data.pendingItems.map((item) => <tr key={item.id}>
          <td>{item.title}</td><td>{item.dueDate ? item.dueDate.split('-').reverse().join('/') : 'Sem data informada'}</td><td><Badge tone="warning">{item.status === 'EXPIRED' ? 'Vencido' : item.status === 'IN_REVIEW' ? 'Em revisão' : 'Acompanhar'}</Badge></td>
          <td>{item.resourceType.toUpperCase() === 'DOCUMENT' && can('documents.read') ? <Link to={`/app/documentos/${encodeURIComponent(item.resourceId)}`}>Ver documento</Link> : <span className="muted">Consulta indisponível</span>}</td>
        </tr>)}</tbody></table></div> : <EmptyState title="Nenhuma pendência retornada" description="O painel reflete apenas os módulos e o escopo consultados." />}
      </section>
      <Feedback tone="info">Riscos, saúde ocupacional, EPI e treinamentos serão incorporados nas próximas fases. A ausência desses módulos não representa conformidade.</Feedback>
    </>}
  </div>;
}
