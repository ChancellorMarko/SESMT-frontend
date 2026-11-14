import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, InfoButton, Spinner } from '../../shared/ui';
import {
  checkedNativeDeadlines, deadlineHref, deadlineLabels, deadlineWindows, readableDeadlineKinds, requestNativeDeadlines,
  type DeadlineKind, type NativeDeadline,
} from './native-deadlines';
import styles from './NativeDashboardPage.module.css';

const PAGE_SIZE = 10;
const civil = (value: string) => value.split('-').reverse().join('/');
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function Due({ item, reference }: { item: NativeDeadline; reference: string }) {
  const distance = daysBetween(reference, item.dueOn);
  if (item.status === 'OVERDUE') return <Badge tone="danger">{distance === -1 ? 'Venceu ontem' : `Vencido há ${-distance} dias`}</Badge>;
  return <Badge tone={distance <= 7 ? 'warning' : 'neutral'}>{distance === 0 ? 'Vence hoje' : distance === 1 ? 'Vence amanhã' : `Vence em ${distance} dias`}</Badge>;
}

/** Shown only to accounts that may read at least one source; the API repeats every check. */
export function NativeDeadlinesPanel() {
  const { can } = useSession();
  return readableDeadlineKinds(can).length ? <Deadlines/> : null;
}

function Deadlines() {
  const { sessionKey } = useSession();
  const [days, setDays] = useState<number>(30), [kind, setKind] = useState<DeadlineKind | 'ALL'>('ALL'), [selectedPage, setPage] = useState(1);
  const read = useVerifiedRead({ queryKey: ['native-deadlines', sessionKey, days], scope: ['native-deadlines', sessionKey], enabled: true,
    request: signal => requestNativeDeadlines(days, signal), validate: value => checkedNativeDeadlines(value, days) });
  const data = read.data;
  const items = data?.items.filter(item => kind === 'ALL' || item.kind === kind) ?? [];
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE)), page = Math.min(selectedPage, pages);
  const help = 'Datas de renovação de treinamentos, da próxima avaliação do ASO e de troca de EPI registradas nos módulos, em todas as unidades que sua conta pode consultar. O período e a abrangência dos filtros do painel não se aplicam aqui. Só o registro mais recente de cada assunto é considerado. O painel não indica aptidão nem qualificação: confira cada registro no módulo correspondente. Vencimentos de documentos ficam na página Vencimentos.';
  return <section className={styles.panel} aria-label="Renovações">
    <header className={styles.panelHeader}>
      <div className={styles.panelTitle}><div><h2>Renovações</h2><p className={styles.panelScope}>Treinamentos, ASO e EPI · todas as unidades da sua conta</p></div><InfoButton title="Renovações"><p>{help}</p></InfoButton></div>
      <div className={styles.switches} role="group" aria-label="Janela de renovações">{deadlineWindows.map(value => <Button key={value} variant={value === days ? 'primary' : 'ghost'} aria-pressed={value === days} onClick={() => { setDays(value); setPage(1); }}>{value} dias</Button>)}</div>
    </header>
    {read.isPending ? <Spinner/> : read.isError ? <Feedback tone="danger">{read.error instanceof ApiError && read.error.status === 403 ? 'A API não autorizou a consulta de renovações para os acessos da sua conta.' : 'Não foi possível conferir as renovações. Atualize a consulta para tentar novamente.'}</Feedback> : data && <>
      <dl className={styles.deadlineSummary} aria-label="Resumo de renovações">
        <div><dt>Vencidos</dt><dd>{data.summary.overdue.toLocaleString('pt-BR')}</dd></div>
        <div><dt>Vencem em até {data.days} dias</dt><dd>{data.summary.dueSoon.toLocaleString('pt-BR')}</dd></div>
      </dl>
      {data.kinds.length > 1 && <div className={`${styles.switches} ${styles.deadlineKinds}`} role="group" aria-label="Tipo de renovação">{(['ALL', ...data.kinds] as const).map(value => <Button key={value} variant={value === kind ? 'primary' : 'ghost'} aria-pressed={value === kind} onClick={() => { setKind(value); setPage(1); }}>{value === 'ALL' ? 'Todos' : deadlineLabels[value]}</Button>)}</div>}
      {data.kinds.length < 3 && <p className={styles.deadlineNote}>Fontes fora dos acessos da sua conta não entram nesta lista: {(['TRAINING', 'ASO', 'EPI'] as const).filter(value => !data.kinds.includes(value)).map(value => deadlineLabels[value]).join(', ')}.</p>}
      {data.truncated && <Feedback tone="warning">A lista mostra as {data.items.length} renovações mais próximas de {data.total.toLocaleString('pt-BR')}. Use os filtros de cada módulo para ver os demais.</Feedback>}
      {!items.length ? <EmptyState title="Nenhuma renovação nesta janela" description={`A API não retornou itens vencidos ou que vencem nos próximos ${data.days} dias nas fontes que sua conta pode consultar. Registros sem data de renovação não aparecem aqui.`}/>
        : <div className={styles.tableScroll} role="region" aria-label="Tabela de renovações" tabIndex={0}><table className={`data-table ${styles.table}`}>
          <thead><tr><th scope="col">Situação</th><th scope="col">Item</th><th scope="col">Pessoa</th><th scope="col">Data</th></tr></thead>
          <tbody>{items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(item => <tr key={`${item.kind}:${item.id}`}>
            <td><Due item={item} reference={data.referenceDate}/></td>
            <td><Link to={deadlineHref(item)}>{item.label}</Link><small>{deadlineLabels[item.kind]} · {item.unitName}</small></td>
            <td>{item.workerName}</td>
            <td>{civil(item.dueOn)}</td>
          </tr>)}</tbody>
        </table></div>}
      {pages > 1 && <nav className={styles.pager} aria-label="Paginação de renovações"><span>{items.length} item(ns) · {page}/{pages}</span><div className="actions"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</Button></div></nav>}
    </>}
  </section>;
}
