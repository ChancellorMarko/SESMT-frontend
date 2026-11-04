import type { DocumentVersionReadDto as DocumentVersionDto } from '../../shared/contracts';
import { Button } from '../../shared/ui';
import { DocumentStatus } from './DocumentStatus';
import { formatDate } from './validation';
import styles from './DocumentVersionList.module.css';

export function DocumentVersionList({ versions, selectedId, currentVersionId, activeVersionIds, onSelect }: {
  versions: DocumentVersionDto[]; selectedId?: string | null; currentVersionId?: string | null; activeVersionIds: string[]; onSelect: (id: string) => void;
}) {
  return <div className={styles.wrap}><table role="table" aria-label="Versões disponíveis" className={`data-table ${styles.table}`}>
    <thead role="rowgroup"><tr role="row"><th scope="col">Versão</th><th scope="col">Arquivo</th><th scope="col">Situação</th><th scope="col">Verificação</th><th scope="col">Criada em</th><th scope="col">Consulta</th></tr></thead>
    <tbody role="rowgroup">{versions.map(item => <tr role="row" key={item.id} className={item.id === selectedId ? styles.selected : undefined}>
      <td role="cell" className={styles.identity}><strong>v{item.versionNumber}</strong><small>{activeVersionIds.includes(item.id) ? 'Versão vigente' : currentVersionId === item.id ? 'Versão em trabalho' : 'Versão do histórico'}</small>{activeVersionIds.includes(item.id) && currentVersionId === item.id && <small>Também em trabalho</small>}</td>
      <td role="cell" className={styles.file}><span className={styles.mobileLabel} aria-hidden="true">Arquivo</span>{item.file?.name || 'Indisponível'}</td>
      <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Situação</span><DocumentStatus status={item.status} /></td>
      <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Verificação</span><DocumentStatus status={item.file?.scanStatus || 'UNKNOWN'} /></td>
      <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Criada em</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></td>
      <td role="cell" className={styles.action}><Button variant={item.id === selectedId ? 'primary' : 'secondary'} aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)}>Consultar v{item.versionNumber}</Button></td>
    </tr>)}</tbody>
  </table></div>;
}
