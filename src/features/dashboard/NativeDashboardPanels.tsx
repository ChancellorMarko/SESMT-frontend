import { useState, type ReactNode } from 'react';
import { Badge, Button, EmptyState, InfoButton } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { nativeOperationalLabels, type NativeDashboard, type NativeAppointment } from './native-dashboard';
import styles from './NativeDashboardPage.module.css';

export function NativeDashboardMetrics({ data }: { data: NativeDashboard['summary'] }) {
  const metrics = [
    { label: 'Em verificação', value: data.emVerificacao, help: 'Atividades com PT em verificação, entre os registros autorizados no período.' },
    { label: 'Liberadas', value: data.liberadas, help: 'Atividades com PT liberada. Este indicador não substitui a consulta das condições de execução.' },
    { label: 'Em execução', value: data.emExecucao, help: 'Atividades cujo estado atual da PT é Em execução.' },
    { label: 'Revisões e correções', value: data.concluidasAguardandoRevisao, help: 'Encerramentos disponíveis para revisão ou correção no seu escopo, conforme a lista retornada pela API.' },
    { label: 'Requisitos pendentes', value: data.pendenciasDocumentais, help: 'Soma dos requisitos documentais faltantes nas PTs consultadas. Não representa a quantidade de pessoas ou de arquivos.' },
  ];
  return <dl className={styles.metrics} aria-label="Indicadores operacionais">{metrics.map(metric => <div key={metric.label}>
    <dt>{metric.label}<InfoButton title={metric.label}><p>{metric.help}</p></InfoButton></dt>
    <dd>{metric.value.toLocaleString('pt-BR')}</dd>
  </div>)}</dl>;
}

function Pager({ page, pages, count, onChange, label }: { page: number; pages: number; count: number; onChange: (page: number) => void; label: string }) {
  return <nav className={styles.pager} aria-label={`Paginação de ${label}`}><span>{count} registro(s) · {page}/{pages}</span><div className="actions"><Button variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button><Button variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima</Button></div></nav>;
}
function Panel({ title, children, help, actions }: { title: string; children: ReactNode; help: string; actions?: ReactNode }) {
  return <section className={styles.panel} aria-label={title}><header className={styles.panelHeader}><div className={styles.panelTitle}><h2>{title}</h2><InfoButton title={title}><p>{help}</p></InfoButton></div>{actions}</header>{children}</section>;
}
function AppointmentInfo({ item }: { item: NativeAppointment }) {
  return <InfoButton title={`Detalhes: ${item.title}`}><dl className={styles.details}>
    <dt>Atividade</dt><dd>{item.title}</dd><dt>Início</dt><dd>{formatDate(item.startsAt)}</dd><dt>Fim</dt><dd>{formatDate(item.endsAt)}</dd>
    <dt>Agendamento</dt><dd>{item.id}</dd><dt>Permissão</dt><dd>{item.workPermitId ?? 'Sem PT vinculada'}</dd><dt>Empresa</dt><dd>{item.companyId}</dd><dt>Local</dt><dd>{item.localId ?? 'Não informado'}</dd>
    <dt>Revisão</dt><dd>{item.reviewStatus === 'AGUARDANDO_REVISAO' ? 'Aguardando revisão' : item.reviewStatus === 'DEVOLVIDA' ? 'Devolvida' : item.reviewStatus === 'APROVADA' ? 'Aprovada' : 'Não informada'}</dd>
  </dl></InfoButton>;
}
function Appointments({ items }: { items: NativeDashboard['appointments'] }) {
  const [selectedPage, setPage] = useState(1), pages = Math.max(1, Math.ceil(items.length / 5)), page = Math.min(selectedPage, pages);
  const sorted = [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  return <Panel title="Atividades no período" help="Atividades autorizadas, filtradas pela data de início. Os horários são exibidos em Brasília. Agendamentos sem PT vinculada não recebem uma situação operacional presumida.">
    {items.length ? <div className={styles.tableScroll} role="region" aria-label="Tabela de atividades" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Atividade</th><th scope="col">Início</th><th scope="col">Situação</th></tr></thead><tbody>{sorted.slice((page - 1) * 5, page * 5).map(item => <tr key={item.id}>
      <td><div className={styles.recordTitle}><strong>{item.title}</strong><AppointmentInfo item={item}/></div></td><td>{formatDate(item.startsAt)}</td><td><Badge tone={item.operationalStatus === 'LIBERADA' ? 'success' : item.operationalStatus === 'SUSPENSA' || item.operationalStatus === 'DEVOLVIDA' ? 'warning' : 'neutral'}>{item.operationalStatus ? nativeOperationalLabels[item.operationalStatus] : item.workPermitId ? 'Não informada' : 'Sem PT vinculada'}</Badge></td>
    </tr>)}</tbody></table></div> : <EmptyState title="Nenhuma atividade" description="Não há atividades retornadas para este período e abrangência."/>}
    <Pager page={page} pages={pages} count={items.length} onChange={setPage} label="atividades"/>
  </Panel>;
}
function Pendencies({ data }: { data: NativeDashboard }) {
  const [tab, setTab] = useState<'documents' | 'reviews'>('documents'), [selectedPage, setPage] = useState(1);
  const items = data[tab], pages = Math.max(1, Math.ceil(items.length / 5)), page = Math.min(selectedPage, pages);
  function changeTab(next: 'documents' | 'reviews') { setTab(next); setPage(1); }
  return <Panel title="Pendências de PT" help="Requisitos são filtrados pela data de criação da PT; revisões, pela data de encerramento. Por isso, as listas podem conter permissões que não aparecem entre as atividades iniciadas no período." actions={<div className={styles.switches} role="group" aria-label="Tipo de pendência"><Button variant={tab === 'documents' ? 'primary' : 'ghost'} aria-pressed={tab === 'documents'} onClick={() => changeTab('documents')}>Documentais ({data.documents.length})</Button><Button variant={tab === 'reviews' ? 'primary' : 'ghost'} aria-pressed={tab === 'reviews'} onClick={() => changeTab('reviews')}>Revisões ({data.reviews.length})</Button></div>}>
    {items.length ? <div className={styles.tableScroll} role="region" aria-label="Tabela de pendências" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Permissão</th><th scope="col">{tab === 'documents' ? 'Requisitos' : 'Encerramento'}</th><th scope="col">Detalhes</th></tr></thead><tbody>{items.slice((page - 1) * 5, page * 5).map(item => {
      const title = data.appointments.find(activity => activity.workPermitId === item.workPermitId)?.title;
      return <tr key={item.workPermitId}><td><strong>{title ?? 'Permissão de trabalho'}</strong><small title={item.workPermitId}>{item.workPermitId.slice(0, 8)}</small></td><td>{'pendingRequirements' in item ? <Badge tone="warning">{item.pendingRequirements} pendente(s)</Badge> : formatDate(item.completedAt)}</td><td><InfoButton title={`Permissão ${item.workPermitId}`}><dl className={styles.details}>
        <dt>Permissão</dt><dd>{item.workPermitId}</dd><dt>Empresa</dt><dd>{item.companyId}</dd><dt>Local</dt><dd>{item.localId ?? 'Não informado'}</dd>
        {'pendingRequirements' in item ? <><dt>Requisitos faltantes</dt><dd>{item.pendingRequirements}</dd><dt>Situação</dt><dd>{nativeOperationalLabels[item.operationalStatus]}</dd><dt>Criação</dt><dd>{formatDate(item.occurredAt)}</dd></> : <><dt>Versão</dt><dd>{item.version}</dd><dt>Encerramento</dt><dd>{formatDate(item.completedAt)}</dd><dt>Serviços</dt><dd>{item.serviceCodes.join(' · ') || 'Não informados'}</dd></>}
      </dl></InfoButton></td></tr>;
    })}</tbody></table></div> : <EmptyState title={tab === 'documents' ? 'Nenhuma pendência documental' : 'Nenhuma revisão retornada'} description="Nenhum registro para o período e abrangência consultados."/>}
    <Pager page={page} pages={pages} count={items.length} onChange={setPage} label="pendências"/>
  </Panel>;
}
export function NativeDashboardQueues({ data }: { data: NativeDashboard }) {
  return <div className={styles.queues}><Appointments items={data.appointments}/><Pendencies data={data}/></div>;
}
