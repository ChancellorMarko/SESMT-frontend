import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Spinner } from '../../shared/ui';
import records from '../../shared/ui/NativeRecords.module.css';
import { checkedEquipmentPage, equipmentDay, localEquipmentDay, type Delivery } from '../native-equipment/contracts';
import { checkedPage, formatDay, statuses, trainingStatus } from '../native-training/contracts';
import type { WorkerDocumentNavigation } from './worker-document-navigation';
import styles from './WorkerDetail.module.css';

const previewSize = 3;

export function WorkerSafetyPanel({ workerId, unitId, companyId, origin }: {
  workerId: string; unitId: string; companyId: string; origin?: WorkerDocumentNavigation;
}) {
  const { sessionKey, me, can } = useSession();
  const equipment = can('epi:ler'), training = can('treinamento:ler');
  const [selection, select] = useState<'equipment' | 'training'>();
  const active = selection === 'training' && training || !equipment ? 'training' : 'equipment';
  const scope = { unitId, companyIds: [companyId], ownOnly: Boolean(me?.scope.ownOnly), workerId: me?.workerId, subjectWorkerId: workerId };
  const enabled = Boolean(me?.scope.companyIds.includes(companyId) && (!scope.ownOnly || scope.workerId === workerId));
  const query = { unitId, workerId, page: 1, pageSize: previewSize };
  const read = useVerifiedRead({
    queryKey: ['worker-safety', sessionKey, unitId, companyId, workerId, active],
    enabled: enabled && (active === 'equipment' ? equipment : training),
    request: signal => api.get<unknown>(active === 'equipment' ? '/equipment/deliveries' : '/trainings', { query, signal }),
    validate: value => active === 'training' ? checkedPage(value, scope, 1, '', '', previewSize)
      : checkedEquipmentPage(value, scope, 1, true, previewSize),
  });
  const isEquipment = active === 'equipment';
  const rows = read.data?.items.map(item => 'title' in item ? ({
          id: item.id, title: item.title, date: formatDay(item.completedOn), next: formatDay(item.renewalOn), status: statuses[trainingStatus(item)],
        }) : equipmentRow(item as Delivery)) ?? [];
  function equipmentRow(item: Delivery) {
    return {
        id: item.id, title: item.equipmentName, date: equipmentDay(item.deliveredOn), next: equipmentDay(item.replacementOn),
        status: item.returnedOn ? 'Devolvido' : item.replacementOn && item.replacementOn <= localEquipmentDay() ? 'Troca prevista' : 'Em uso',
    };
  }
  function destination(id?: string) {
    const params = new URLSearchParams({ unitId, workerId });
    if (id) params.set(isEquipment ? 'entrega' : 'registro', id);
    return `/app/${isEquipment ? 'epis' : 'treinamentos'}?${params}`;
  }
  if (!enabled || !equipment && !training) return null;
  return <section id="seguranca" tabIndex={-1} className={`panel stack ${styles.section}`} aria-labelledby="worker-safety-heading">
    <h2 id="worker-safety-heading">EPIs e treinamentos</h2>
    {equipment && training && <div className="actions" role="group" aria-label="Registros do trabalhador">
      <Button variant={isEquipment ? 'primary' : 'secondary'} aria-pressed={isEquipment} onClick={() => select('equipment')}>Entregas de EPI</Button>
      <Button variant={!isEquipment ? 'primary' : 'secondary'} aria-pressed={!isEquipment} onClick={() => select('training')}>Treinamentos</Button>
    </div>}
    {read.isError ? <Feedback tone="danger">Não foi possível consultar estes registros. <Button variant="ghost" onClick={() => void read.refetch()}>Tentar novamente</Button></Feedback>
      : read.isPending ? <Spinner/> : read.data && <>
        {rows.length ? <div className={records.scroll} role="region" aria-label={isEquipment ? 'Entregas recentes' : 'Treinamentos recentes'} tabIndex={0}>
          <table className={`data-table ${records.table}`}><thead><tr>
            <th scope="col">{isEquipment ? 'Equipamento' : 'Curso'}</th><th scope="col">{isEquipment ? 'Entrega' : 'Conclusão'}</th>
            <th scope="col">{isEquipment ? 'Troca prevista' : 'Renovação prevista'}</th><th scope="col">Situação</th>
          </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
            <td><Link to={destination(row.id)} state={origin}>{row.title}</Link></td><td>{row.date}</td><td>{row.next}</td><td>{row.status}</td>
          </tr>)}</tbody></table>
        </div> : <p>{isEquipment ? 'Nenhuma entrega registrada nesta unidade.' : 'Nenhum treinamento registrado nesta unidade.'}</p>}
        <div className={records.footer}>
          <span>{read.data.total} {read.data.total === 1 ? 'registro' : 'registros'}</span>
          <Link className="button button--secondary" to={destination()} state={origin}>{isEquipment ? 'Ver todas as entregas' : 'Ver todos os treinamentos'}</Link>
        </div>
      </>}
  </section>;
}
