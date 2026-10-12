import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ClipboardCheck, MapPin, Search } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { FinalReviewStatus, OperationStatus, WorkPermitDto } from '../../shared/contracts/work-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { operationLabels, PermitStatus, reviewLabels } from './PermitStatus';
import { errorMessage } from './validation';
import styles from './permits.module.css';

export function PermitsPage() {
  const { sessionKey, unitId } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const operationStatus = params.get('operationStatus') || '';
  const reviewStatus = params.get('reviewStatus') || '';
  const permits = useQuery({ queryKey: ['work-permits', sessionKey, unitId, q, operationStatus, reviewStatus], queryFn: ({ signal }) => api.get<WorkPermitDto[]>('/work-permits', { signal, query: { unitId, q, operationStatus, reviewStatus } }) });
  function filter(key: string, value: string) { setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true }); }
  return <div className="stack">
    <PageHeader eyebrow="ATENDIMENTOS EM CAMPO" title="Permissões de trabalho" description="Acompanhe a verificação, a execução e a revisão de cada atendimento." actions={<Link to="/app/agenda" className="button button--primary">Abrir agenda</Link>} />
    <section className="panel stack" aria-label="Busca de permissões de trabalho">
      <div className={styles.filters}>
        <Field label="Buscar PT"><div className={styles.search}><Search size={17} aria-hidden="true" /><input type="search" aria-label="Buscar PT" placeholder="Número, serviço, local ou equipe" value={q} onChange={event => filter('q', event.target.value)} /></div></Field>
        <Field label="Situação operacional"><select aria-label="Situação operacional" value={operationStatus} onChange={event => filter('operationStatus', event.target.value)}><option value="">Todas</option>{Object.entries(operationLabels).map(([value, label]) => <option key={value} value={value as OperationStatus}>{label}</option>)}</select></Field>
        <Field label="Revisão do encerramento"><select aria-label="Revisão do encerramento" value={reviewStatus} onChange={event => filter('reviewStatus', event.target.value)}><option value="">Todas</option>{Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value as FinalReviewStatus}>{label}</option>)}</select></Field>
      </div>
      {permits.isPending ? <Spinner /> : permits.isError ? <div className="stack"><Feedback tone="danger">{errorMessage(permits.error)}</Feedback><Button variant="secondary" onClick={() => permits.refetch()}>Tentar novamente</Button></div> : permits.data.length === 0 ? <EmptyState title="Nenhuma PT encontrada" description="Ajuste os filtros ou consulte os agendamentos da unidade selecionada." /> : <>
        <p className="muted">{permits.data.length} atendimento{permits.data.length === 1 ? '' : 's'} no seu alcance de acesso.</p>
        <div className={styles.permitGrid}>{permits.data.map(permit => {
          const count = permit.sciences.filter(science => science.version === permit.version).length;
          return <article className={styles.permitCard} key={permit.id}>
            <div className={styles.cardTop}><span className={styles.code}><ClipboardCheck size={17} aria-hidden="true" />{permit.code}</span><span className="muted">v{permit.version}</span></div>
            <h2><Link to={`/app/pts/${permit.id}`}>{permit.appointment.serviceLabel}</Link></h2>
            <p className={styles.location}><MapPin size={15} aria-hidden="true" />{permit.appointment.location}</p>
            <PermitStatus operationStatus={permit.operationStatus} reviewStatus={permit.reviewStatus} />
            <dl className={styles.cardMeta}><div><dt>Equipe</dt><dd>{permit.appointment.teamName}</dd></div><div><dt>Responsável</dt><dd>{permit.appointment.responsibleName}</dd></div><div><dt>Agendamento</dt><dd>{formatDate(permit.appointment.startsAt)}</dd></div></dl>
            <div className={styles.cardBottom}><Badge tone={count === permit.appointment.participants.length ? 'success' : 'warning'}>Ciências {count}/{permit.appointment.participants.length}</Badge><Link to={`/app/pts/${permit.id}`} className="button button--secondary">Consultar PT</Link></div>
          </article>;
        })}</div>
      </>}
    </section>
  </div>;
}
