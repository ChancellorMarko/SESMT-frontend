import { Link } from 'react-router';
import { ArrowUpRight, UserRound } from 'lucide-react';
import type { WorkerReadDto as WorkerDto } from '../../shared/contracts';
import { Badge } from '../../shared/ui';
import { dateLabel, integrationStatusLabels, integrationStatusTone, workerStatusLabels } from './support';
import styles from './WorkersWorkspace.module.css';
import type { WorkerNavigation } from './worker-navigation';

export function WorkerList({ workers, companyName, unitName, sectorName, origin }: {
  workers: WorkerDto[];
  companyName: (id: string) => string;
  unitName: (id: string | null) => string;
  sectorName: (id: string | null) => string;
  origin?: WorkerNavigation;
}) {
  return <div className={styles.tableRegion} role="region" aria-label="Tabela de trabalhadores" tabIndex={0}>
    <table role="table" className={`data-table ${styles.table}`}>
      <caption className="sr-only">Trabalhadores encontrados</caption>
      <thead role="rowgroup"><tr role="row">
        <th scope="col">Trabalhador</th><th scope="col">Matrícula</th><th scope="col">Empresa / Unidade / Setor</th><th scope="col">Integração</th><th scope="col">Situação</th><th scope="col"><span className="sr-only">Ações</span></th>
      </tr></thead>
      <tbody role="rowgroup">{workers.map(worker => {
        const integration = worker.integrationStatus || (worker.sourceReadOnly ? undefined : 'PENDING');
        const path = `/app/trabalhadores/${encodeURIComponent(worker.id)}`;
        return <tr role="row" key={worker.id}>
          <td role="cell" className={styles.identityCell}><div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true"><UserRound size={18} strokeWidth={1.7} /></span>
            <div><Link to={path} state={origin} className={styles.name}>{worker.fullName}</Link>{worker.employmentType && <small>{worker.employmentType}</small>}</div>
          </div></td>
          <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Matrícula</span><span className={styles.registration}>{worker.registration}</span></td>
          <td role="cell" className={styles.organizationCell}><span className={styles.mobileLabel} aria-hidden="true">Empresa / Unidade / Setor</span><span>{companyName(worker.companyId)}</span><small>{unitName(worker.unitId)} · {sectorName(worker.sectorId)}</small></td>
          <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Integração</span>{integration ? <Badge tone={integrationStatusTone[integration]}>{integrationStatusLabels[integration]}</Badge> : <span className="muted">Não informada</span>}{worker.integrationValidUntil && <small>Até <time dateTime={worker.integrationValidUntil}>{dateLabel(worker.integrationValidUntil)}</time></small>}</td>
          <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Situação cadastral</span><Badge tone={worker.status === 'ACTIVE' ? 'success' : worker.status === 'ON_LEAVE' ? 'warning' : 'neutral'}>{workerStatusLabels[worker.status]}</Badge></td>
          <td role="cell" className={styles.actionCell}><Link className={`button button--secondary ${styles.consult}`} to={path} state={origin} aria-label={`Consultar ${worker.fullName}`}>Consultar<ArrowUpRight size={14} aria-hidden="true" /></Link></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
