import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAppQueryParams } from '../../shared/lib/app-query-params';
import { useSession } from '../../shared/auth/SessionProvider';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { isCivilDate } from '../documents/validation';
import { documentNavigation } from '../documents/document-navigation';
import { scopedQueryError } from '../../shared/lib/scoped-page';
import { checkedDocumentDashboard, documentDashboardLink } from './document-response';
import { DocumentPendingList } from './DocumentPendingList';
import { useDashboardQuery } from './use-dashboard-query';
const styles = {
  filters: 'items-end justify-start gap-3 rounded-3xl p-5 [&>.field]:min-w-0 [&>.field]:flex-[0_1_230px] max-sm:[&>.field]:basis-full',
  meta: 'flex flex-wrap items-center justify-between gap-x-6 gap-y-3',
  contextLabel: 'text-[12px] font-semibold text-[#496683]',
  timestamp: 'text-[10px] leading-5 text-slate-400',
  metrics: 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4',
  metric: 'flex min-w-0 flex-col gap-3 rounded-3xl border border-white bg-white/85 p-6 shadow-[0_6px_24px_-14px_rgba(24,59,104,0.15)] [&>a]:mt-auto [&>a]:pt-2 [&>a]:text-[11px] [&>a]:font-semibold [&>a]:text-[#54799e] [&>a]:no-underline',
  label: 'text-[12px] font-medium leading-5 text-slate-500',
  value: 'text-[36px] font-semibold leading-none tracking-[-.045em] text-[#315884]',
  detail: 'text-[11px] leading-6 text-slate-500',
  criteria: 'text-[10px] leading-6 text-slate-400 [&>summary]:min-h-8 [&>summary]:cursor-pointer [&>span]:block',
  pending: 'gap-0 overflow-hidden rounded-3xl p-0',
  sectionHeading: 'border-b border-slate-100 px-6 py-6 [&_h2]:text-[16px] [&_h2]:text-[#315884] [&_p]:mt-2 [&_p]:mb-0 [&_p]:text-[11px] [&>a]:text-[11px] [&>a]:font-semibold [&>a]:text-[#54799e] [&>a]:no-underline',
};

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
}

export function DashboardPage() {
  const { sessionKey, unitId, can } = useSession();
  const [search, setSearch] = useAppQueryParams();
  const from = search.get('from') ?? '';
  const to = search.get('to') ?? '';
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to]);
  const invalidDates = !!from && !isCivilDate(from) || !!to && !isCivilDate(to);
  const invalidQuery = Array.from(search.keys()).some(key => !['from', 'to'].includes(key) || search.getAll(key).length > 1);
  const invalidRange = invalidQuery || invalidDates || !!from && !!to && from > to;
  const draftFromError = draftFrom && !isCivilDate(draftFrom) ? 'Informe uma data inicial válida.' : undefined;
  const draftToError = draftTo && !isCivilDate(draftTo) ? 'Informe uma data final válida.' : draftFrom && draftTo && draftFrom > draftTo ? 'A data final deve ser igual ou posterior à inicial.' : undefined;
  const draftInvalid = Boolean(draftFromError || draftToError);
  const hasDraftChanges = draftFrom !== from || draftTo !== to;
  const checkResponse = useCallback((value: unknown) => checkedDocumentDashboard(value, { unitId: unitId ?? '', from, to }), [unitId, from, to]);
  const dashboard = useDashboardQuery({
    resource: 'dashboard', sessionKey, unitId, criteria: [from, to], check: checkResponse,
    query: { unitId, from: from || undefined, to: to || undefined },
    enabled: can('dashboard.read') && !!unitId && !invalidRange,
  });
  const documentOrigin = !invalidRange ? documentNavigation({ documentDashboardReturnTo: { unitId, search: search.size ? `?${search}` : '' } }, unitId, can('dashboard.read')) : undefined;
  if (!can('dashboard.read')) return <Feedback tone="warning">Seu acesso não permite consultar este painel.</Feedback>;
  if (!unitId) return <Feedback tone="warning">Selecione uma unidade para consultar o painel documental.</Feedback>;

  return <div className="stack">
    <PageHeader eyebrow="VISÃO GERAL" title="Painel documental" description="Vigência, revisão e atenção aos prazos da unidade selecionada." actions={<Button variant="secondary" onClick={() => void dashboard.retry()} disabled={dashboard.isFetching || invalidRange}>Atualizar</Button>} />
    <form className={`panel toolbar ${styles.filters}`} onSubmit={(event) => {
      event.preventDefault();
      if (draftInvalid) return;
      const next = new URLSearchParams();
      if (draftFrom) next.set('from', draftFrom);
      if (draftTo) next.set('to', draftTo);
      setSearch(next, { flushSync: true });
    }}>
      <Field label="Período inicial" error={draftFromError}><input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></Field>
      <Field label="Período final" error={draftToError}><input type="date" value={draftTo} min={isCivilDate(draftFrom) ? draftFrom : undefined} onChange={(event) => setDraftTo(event.target.value)} /></Field>
      <Button type="submit" disabled={draftInvalid}>Aplicar período</Button>
      {(invalidQuery || from || to || draftFrom || draftTo) && <Button variant="ghost" onClick={() => { setDraftFrom(''); setDraftTo(''); setSearch(new URLSearchParams(), { flushSync: true }); }}>Limpar filtros</Button>}
      {hasDraftChanges && <span role="status" className="text-[11px] leading-5 text-amber-700">Há alterações no período ainda não aplicadas ao painel.</span>}
    </form>
    {invalidRange && <Feedback tone="danger">{invalidQuery ? 'Os filtros na URL são inválidos. Corrija ou limpe a seleção para consultar o painel.' : 'O intervalo na URL é inválido. Corrija as datas para consultar o painel.'}</Feedback>}
    {dashboard.isPending && !invalidRange && <Spinner />}
    {dashboard.isError && !invalidRange && <Feedback tone="danger">{scopedQueryError(dashboard.error, 'painel documental')} <Button variant="ghost" onClick={() => void dashboard.retry()} disabled={dashboard.isFetching}>Tentar novamente</Button></Feedback>}
    {dashboard.data && !dashboard.isError && !invalidRange && <>
      <div className={styles.meta}><span className={styles.contextLabel}>Documentos e alertas</span><span className={styles.timestamp}>Atualizado em {dateTime(dashboard.data.generatedAt)} · America/Sao_Paulo</span></div>
      {dashboard.data.indicators.length ? <div className={styles.metrics}>{dashboard.data.indicators.map((indicator) => {
        const target = documentDashboardLink(indicator, { unitId, from, to });
        return <article className={styles.metric} key={indicator.code}>
        <span className={styles.label}>{indicator.label}</span>
        <strong className={styles.value}>{new Intl.NumberFormat('pt-BR').format(indicator.value)}</strong>
        <span className={`muted ${styles.detail}`}>{indicator.formula}</span>
        <details className={styles.criteria}><summary>Critérios do indicador</summary><span>Fonte: {indicator.source} · {indicator.period}</span><span>Atualização: {dateTime(indicator.updatedAt)}</span></details>
        {can('documents.read') && (target ? <Link to={target} state={documentOrigin}>Consultar documentos →</Link> : <span className="text-[10px] leading-5 text-slate-400">Consulta detalhada indisponível para este indicador.</span>)}
      </article>;
      })}</div> : <EmptyState title="Indicadores indisponíveis" description="A API ainda não retornou indicadores para este contexto." />}
      <section className={`panel stack ${styles.pending}`}>
        <div className={`${styles.meta} ${styles.sectionHeading}`}><div><h2>Pendências para acompanhar</h2><p className="muted">Ações e prazos informados pelo serviço documental.</p></div>{can('documents.read') && <Link to="/app/documentos" state={documentOrigin}>Abrir central →</Link>}</div>
        {dashboard.data.pendingItems.length ? <DocumentPendingList items={dashboard.data.pendingItems} canReadDocuments={can('documents.read')} origin={documentOrigin} /> : <EmptyState title="Nenhuma pendência retornada" description="O painel reflete apenas os módulos e o escopo consultados." />}
      </section>
      <Feedback tone="info">Riscos, saúde ocupacional, EPI e treinamentos serão incorporados nas próximas fases. A ausência desses módulos não representa conformidade.</Feedback>
    </>}
  </div>;
}
