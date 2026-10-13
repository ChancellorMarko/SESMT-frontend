import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, LockKeyhole, RefreshCw } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentaryReadinessDto } from '../../shared/contracts/requirements';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { filterReadiness, readinessCounts, readinessCsv, statusLabels } from './readiness';
import styles from './readiness.module.css';

export function DocumentaryReadinessPage() {
  const { unitId, sessionKey, can } = useSession();
  const [search, setSearch] = useSearchParams();
  const readiness = useQuery({ queryKey: ['documentary-readiness', sessionKey, unitId], queryFn: ({ signal }) => api.get<DocumentaryReadinessDto>('/documentary-readiness', { query: { unitId }, signal }), enabled: can('eligibility.read') && Boolean(unitId) });
  const filters = { query: search.get('q') || '', teamId: search.get('teamId') || '', serviceTypeId: search.get('serviceTypeId') || '', status: search.get('status') || 'pending' };
  const rows = readiness.isError ? [] : readiness.data?.rows || [];
  const groups = filterReadiness(rows, filters);
  const counts = readinessCounts(groups);
  const teams = [...new Map(rows.map(row => [row.teamId, row.teamName])).entries()];
  const services = [...new Map(rows.flatMap(row => (row.services ?? [{ id: row.serviceTypeId, name: row.serviceLabel }]).map(service => [service.id, service.name] as const))).entries()];
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    setSearch(next, { replace: true });
  }
  function exportCsv() {
    const blob = new Blob([readinessCsv(groups)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `pendencias-documentais${API_MODE === 'demo' ? '-DEMONSTRACAO' : ''}.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!can('eligibility.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à conferência documental." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para consultar as pendências documentais." />;
  return <div className="stack">
    <PageHeader eyebrow="DOCUMENTOS POR PESSOA E SERVIÇO" title="Pendências documentais" description="Organize a conferência dos próximos serviços e dos atendimentos em aberto." actions={<>
      {can('requirements.read') && <Link className="button button--secondary" to="/app/configuracoes/requisitos">Consultar matriz</Link>}
      <Button variant="secondary" onClick={() => void readiness.refetch()} disabled={readiness.isFetching}><RefreshCw size={16} aria-hidden="true" /> {readiness.isFetching ? 'Atualizando…' : 'Atualizar pendências'}</Button>
    </>} />
    <Feedback>A situação é documental e considera a função, o local e o período de cada serviço. A execução exige a liberação explícita na PT, com checklist e ciências conferidos.</Feedback>
    <section className={`panel ${styles.filters}`} aria-label="Filtros de pendências">
      <Field label="Buscar pessoa ou atendimento"><input type="search" placeholder="Nome, código, local ou requisito" value={filters.query} onChange={event => setFilter('q', event.target.value)} /></Field>
      <Field label="Equipe"><select value={filters.teamId} onChange={event => setFilter('teamId', event.target.value)}><option value="">Todas as equipes</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Serviço"><select value={filters.serviceTypeId} onChange={event => setFilter('serviceTypeId', event.target.value)}><option value="">Todos os serviços</option>{services.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field label="Situação documental"><select value={filters.status} onChange={event => setFilter('status', event.target.value)}><option value="pending">Com pendências</option><option value="ready">Conferida</option><option value="all">Todas as situações</option></select></Field>
      <Button variant="ghost" onClick={() => setSearch({}, { replace: true })}>Limpar filtros</Button>
    </section>
    {readiness.isPending ? <Spinner /> : readiness.isError ? <Feedback tone="danger">{readiness.error.message} <Button variant="ghost" onClick={() => void readiness.refetch()}>Tentar novamente</Button></Feedback> : <>
      <div className={styles.summary} role="status" aria-live="polite"><span><strong>{counts.appointments}</strong> atendimento(s)</span><span><strong>{counts.people}</strong> pessoa(s)</span><span><strong>{counts.pending}</strong> requisito(s) pendente(s)</span></div>
      <div className={styles.resultHeader}><p className="muted small">Cada requisito é contado por pessoa e atendimento. Consulta em {readiness.data && formatDate(readiness.data.generatedAt)}.</p><Button variant="secondary" disabled={!groups.length || readiness.isFetching} onClick={exportCsv}><Download size={16} aria-hidden="true" /> Exportar consulta CSV</Button></div>
      {!groups.length ? <EmptyState title="Nenhum atendimento nesta consulta" description="Consulte outras situações ou ajuste os filtros. Somente os atendimentos do seu alcance são exibidos." /> : groups.map(({ row, people }) => <section className={`panel stack ${styles.appointment}`} aria-label={`Pendências de ${row.appointmentCode}`} key={row.appointmentId}>
        <div className={styles.appointmentHeader}><div><p className="eyebrow">{row.appointmentCode}</p><h2>{row.serviceLabel}</h2><p className="muted">{row.teamName} · {row.location}</p><p className="muted small">{formatDate(row.startsAt)} → {formatDate(row.endsAt)} · Horários de Brasília</p></div>{can('appointments.read') && <Link className="button button--secondary" aria-label={`${can('eligibility.write') || can('eligibility.review') ? 'Abrir conferência' : 'Consultar atendimento'} de ${row.appointmentCode}`} to={`/app/agenda/${row.appointmentId}`}>{can('eligibility.write') || can('eligibility.review') ? 'Abrir conferência' : 'Consultar atendimento'}</Link>}</div>
        {people.map(person => <article className={styles.person} key={person.workerId}>
          <div className={styles.personHeader}><div><h3>{person.name}</h3><p className="muted small">Função no serviço: {person.serviceFunction}</p></div><Badge tone={person.eligible ? 'success' : 'warning'}>{person.eligible ? 'Documentação conferida' : 'Pendência documental'}</Badge></div>
          <ul className={styles.requirements}>{person.items.map(item => <li key={item.requirementId}><div><strong>{item.label}</strong>{item.restricted ? <p className="muted small"><LockKeyhole size={13} aria-hidden="true" /> Conferência restrita por profissional autorizado.</p> : item.reason && <p className="muted small">{item.reason}</p>}</div><Badge tone={item.status === 'APPROVED' ? 'success' : ['REJECTED', 'EXPIRED'].includes(item.status) ? 'danger' : 'warning'}>{statusLabels[item.status]}</Badge></li>)}</ul>
          {!person.items.length && <Feedback tone="warning">A matriz não definiu requisitos aplicáveis. Confira a configuração antes de liberar.</Feedback>}
        </article>)}
        <div className={styles.resultHeader}><small className="muted">Matriz {row.eligibility.requirementVersion} · Consulta em {formatDate(row.eligibility.checkedAt)}</small>{row.permitId && can('permits.read') && <Link to={`/app/pts/${row.permitId}`}>Acompanhar PT →</Link>}</div>
      </section>)}
    </>}
  </div>;
}
