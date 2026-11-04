import { InfoButton } from '../../shared/ui';
import type { NativeDashboard } from './native-dashboard';
import styles from './NativeDashboardPage.module.css';

function monthLabel(value: string) {
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`)).replace('.', '');
  return `${month}/${value.slice(2, 4)}`;
}
export function NativeDashboardEvolution({ data }: { data: NativeDashboard['evolution'] }) {
  const maximum = Math.max(1, ...data.series.map(item => item.concluidas + item.emAndamento + item.pendentes));
  return <section className={styles.panel} aria-label="Movimentações de PT">
    <header className={styles.panelHeader}><h2>Movimentações de PT</h2><InfoButton title="Movimentações de PT"><p>Contagem de mudanças de estado registradas no período, agrupadas por mês UTC. Uma mesma PT pode gerar mais de uma movimentação. Conclusões contam entradas em Concluída; andamento inclui execução e suspensão; preparação inclui verificação, liberação e devolução.</p></InfoButton></header>
    <div className={styles.legend} aria-hidden="true"><span><i className={styles.concluded}/>Conclusões</span><span><i className={styles.inProgress}/>Andamento</span><span><i className={styles.preparation}/>Preparação</span></div>
    <div className={styles.chartScroll} tabIndex={0} role="region" aria-label="Gráfico mensal de movimentações; dados completos na tabela abaixo">
      <div className={styles.chart} style={{ gridTemplateColumns: `repeat(${data.series.length}, minmax(42px, 1fr))`, minWidth: data.series.length * 48 }} aria-hidden="true">{data.series.map(item => <div key={item.mes} className={styles.month} title={`${monthLabel(item.mes)}: ${item.concluidas} conclusões, ${item.emAndamento} andamento, ${item.pendentes} preparação`}>
        <div className={styles.barTrack}><div className={styles.bar} style={{ height: `${(item.concluidas + item.emAndamento + item.pendentes) / maximum * 100}%` }}>
          {([['concluidas', styles.concluded], ['emAndamento', styles.inProgress], ['pendentes', styles.preparation]] as const).map(([key, color]) => item[key] > 0 && <span key={key} className={color} style={{ flex: item[key] }}/>)}</div></div><span className={styles.monthLabel}>{monthLabel(item.mes)}</span>
      </div>)}</div>
    </div>
    <details className={styles.historyData}><summary>Ver dados por mês</summary><div className={styles.tableScroll} role="region" aria-label="Tabela mensal de movimentações" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Mês UTC</th><th scope="col">Conclusões</th><th scope="col">Andamento</th><th scope="col">Preparação</th></tr></thead><tbody>{data.series.map(item => <tr key={item.mes}><th scope="row">{monthLabel(item.mes)}</th><td>{item.concluidas.toLocaleString('pt-BR')}</td><td>{item.emAndamento.toLocaleString('pt-BR')}</td><td>{item.pendentes.toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div></details>
  </section>;
}
