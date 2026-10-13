import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DesignationDto } from '../../shared/contracts/designations';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, PageHeader, Spinner, type Tone } from '../../shared/ui';
import styles from './Designations.module.css';

const statusLabels: Record<string, string> = { ACTIVE: 'Vigente', REVOKED: 'Revogada', EXPIRED: 'Expirada' };
const statusTones: Record<string, Tone> = { ACTIVE: 'success', REVOKED: 'danger', EXPIRED: 'warning' };

export function DesignationsPage() {
  const { sessionKey, unitId, can } = useSession();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['designations', sessionKey, unitId, statusFilter],
    queryFn: ({ signal }) => api.get<DesignationDto[]>('/designations', {
      signal,
      query: { unitId, ...(statusFilter ? { status: statusFilter } : {}) },
    }),
    enabled: can('appointments.read') && Boolean(unitId),
  });

  if (!can('appointments.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar designações." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade para ver as designações." />;

  const designations = (query.data || []).filter(d =>
    !search || `${d.responsibleName} ${d.serviceNames.join(' ')} ${d.locationPattern}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
  );

  return <div className="stack">
    <PageHeader
      eyebrow="OPERAÇÃO"
      title="Designações operacionais"
      description="Vincule responsáveis aos serviços, locais e períodos de vigência para a operação de PTs."
      actions={can('appointments.write') ? <Link className="button button--primary" to="/app/designacoes/nova">Nova designação</Link> : undefined}
    />
    <Feedback>
      <ShieldCheck size={16} aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
      A cobertura por designação é conferida na abertura, liberação, início e retomada da PT. Designações expiradas ou revogadas bloqueiam a operação.
    </Feedback>
    <div className="panel stack">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label htmlFor="designation-search">Buscar</label>
          <input id="designation-search" type="search" placeholder="Nome, serviço ou local…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="designation-status">Situação</label>
          <select id="designation-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todas</option>
            <option value="ACTIVE">Vigentes</option>
            <option value="EXPIRED">Expiradas</option>
            <option value="REVOKED">Revogadas</option>
          </select>
        </div>
      </div>

      {query.isPending && <Spinner />}
      {query.isError && <Feedback tone="danger">Não foi possível carregar as designações. Tente novamente.</Feedback>}

      {query.isSuccess && designations.length === 0 && <EmptyState title="Nenhuma designação encontrada" description={search || statusFilter ? 'Ajuste os filtros ou crie uma designação.' : 'Crie a primeira designação para esta unidade.'} />}

      {designations.length > 0 && <div className={styles.cards}>
        {designations.map(d => (
          <Link key={d.id} to={`/app/designacoes/${d.id}`} className={`panel ${styles.card}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className={styles.cardHeader}>
              <div>
                <h3>{d.responsibleName}</h3>
                <p className="muted" style={{ fontSize: 12 }}>{d.locationPattern || 'Qualquer local'}</p>
              </div>
              <Badge tone={statusTones[d.status] || 'neutral'}>{statusLabels[d.status] || d.status}</Badge>
            </div>
            <div className={styles.serviceList}>
              {d.serviceNames.map((name, i) => <Badge key={i} tone="neutral">{name}</Badge>)}
            </div>
            <dl className={styles.metadata}>
              <div><dt>Vigência</dt><dd>{formatDate(d.validFrom)} a {formatDate(d.validUntil)}</dd></div>
              <div><dt>Criada em</dt><dd>{formatDate(d.createdAt)}</dd></div>
            </dl>
          </Link>
        ))}
      </div>}
    </div>
  </div>;
}
