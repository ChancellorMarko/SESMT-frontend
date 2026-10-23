import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowUpRight, BookOpen, CalendarClock, CalendarDays, Check, CheckCheck, ChevronRight, ClipboardList, FileCheck2, FileClock, Files, GraduationCap, HeartPulse, Layers3, Sparkles, Unplug, Users } from 'lucide-react';
import { API_MODE } from '../../shared/api/client';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { Button, Modal } from '../../shared/ui';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { asoPlanningQueue, asoRenewalWindows, asoReviewQueue, healthScenario, trainingMatrix, trainingPlanningQueue, trainingRenewal, trainingTopics, type HealthExample } from './health-scenario';
import styles from './HealthDashboard.module.css';

type HealthView = 'asos' | 'nrs';
type Access = (permission: string) => boolean;
const views: { id: HealthView; label: string; accessibleLabel: string; icon: typeof HeartPulse }[] = [
  { id: 'asos', label: 'Saúde ocupacional', accessibleLabel: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)', icon: HeartPulse },
  { id: 'nrs', label: 'Capacitações', accessibleLabel: 'Capacitações e normas regulamentadoras (NR)', icon: GraduationCap },
];

function Metric({ title, value, note, icon, featured = false }: { title: string; value: number; note: string; icon: ReactNode; featured?: boolean }) {
  const reduce = useAppReducedMotion();
  return <motion.article className={`${styles.metric} ${featured ? styles.featuredMetric : ''}`} whileHover={reduce ? undefined : { y: -5 }} transition={{ duration: reduce ? 0 : .26 }}>
    <div className={styles.metricTitle}><span aria-hidden="true">{icon}</span><h3>{title}</h3></div>
    <strong className={styles.metricValue}><AnimatedNumber value={value} /></strong><p>{note}</p>
  </motion.article>;
}

function ExampleRow({ example, followed, onOpen }: { example: HealthExample; followed: boolean; onOpen: () => void }) {
  return <li className={styles.exampleRow}>
    <div><span className={styles.rowEyebrow}>{example.team}</span><h4>{example.title}</h4>{example.topic && <span className={styles.rowTheme}>{example.topic}</span>}<p>{example.quantity} {example.unit}<span aria-hidden="true"> · </span><span className={followed ? styles.followed : ''}>{followed ? <><Check size={12} aria-hidden="true" />Em acompanhamento local</> : example.status}</span></p></div>
    <button type="button" className={styles.detailButton} aria-label={`Ver detalhe: ${example.title}`} onClick={onOpen}><span>Ver detalhe</span><ChevronRight size={17} aria-hidden="true" /></button>
  </li>;
}

function Resources({ view, can }: { view: HealthView; can: Access }) {
  const hasDocuments = can('documents.read'), hasRequirements = can('eligibility.read');
  if (!hasDocuments && !hasRequirements) return null;
  return <nav className={styles.resources} aria-label={view === 'asos' ? 'Consultas de ASOs' : 'Consultas de capacitações'}>
    {hasDocuments && <Link to={view === 'asos' ? '/app/documentos?q=ASO' : '/app/documentos?q=treinamento'}><Files size={17} aria-hidden="true" />{view === 'asos' ? 'Buscar documentos de ASO' : 'Buscar comprovantes de treinamento'}<ArrowUpRight size={14} aria-hidden="true" /></Link>}
    {hasDocuments && view === 'asos' && <Link to="/app/vencimentos?q=ASO"><CalendarClock size={17} aria-hidden="true" />Consultar vencimentos de ASOs<ArrowUpRight size={14} aria-hidden="true" /></Link>}
    {hasRequirements && <Link to="/app/pendencias"><ClipboardList size={17} aria-hidden="true" />Conferir requisitos documentais<ArrowUpRight size={14} aria-hidden="true" /></Link>}
  </nav>;
}

function Disconnected({ view, can }: { view: HealthView; can: Access }) {
  return <div className={styles.disconnected}>
    <span className={styles.disconnectedIcon}><Unplug size={28} aria-hidden="true" /></span>
    <h3>{view === 'asos' ? 'Integração de ASOs ainda não conectada' : 'Integração de capacitações ainda não conectada'}</h3>
    <p>{view === 'asos' ? 'Indicadores, renovações e planejamento ocupacional dependem dos dados da integração de ASOs.' : 'A matriz por equipe, os comprovantes e o planejamento de turmas dependem da integração de capacitações.'} As consultas disponíveis seguem suas permissões.</p>
    <Resources view={view} can={can} />
  </div>;
}

function TrainingMatrix({ prefix }: { prefix: string }) {
  const caption = 'Equipes fictícias. A presença do arquivo não comprova capacitação ou conformidade.';
  return <>
    <div className={styles.tableScroll} role="region" aria-label="Matriz demonstrativa de capacitações" tabIndex={0}>
      <table className={styles.matrix}>
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Equipe de exemplo</th>{trainingTopics.map(topic => <th key={topic} scope="col">{topic}</th>)}</tr></thead>
        <tbody>{trainingMatrix.map(row => <tr key={row.team}>
          <th scope="row">{row.team}<small>{row.people} posições fictícias</small></th>
          {row.evidence.map((count, index) => <td key={trainingTopics[index]}>
            <span className={count < row.people ? styles.matrixMissing : styles.matrixAvailable}>{count}<span> / {row.people}</span></span>
            <span className={styles.cellLabel}>{count < row.people ? `${row.people - count} a reunir` : 'Arquivos disponíveis'}</span>
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className={styles.teamMatrix}>
      <ul className={styles.teamList} aria-label="Capacitações por equipe">{trainingMatrix.map((row, rowIndex) => <li key={row.team}>
        <article aria-labelledby={`${prefix}-team-${rowIndex}`}>
          <header className={styles.teamHeader}><h4 id={`${prefix}-team-${rowIndex}`}>{row.team}</h4><span>{row.people} posições fictícias</span></header>
          <dl className={styles.teamTopics}>{row.evidence.map((count, index) => <div key={trainingTopics[index]}>
            <dt>{trainingTopics[index]}</dt>
            <dd><span className={count < row.people ? styles.matrixMissing : styles.matrixAvailable}>{count} de {row.people} arquivos</span><span className={styles.cellLabel}>{count < row.people ? `${row.people - count} a reunir` : 'Arquivos disponíveis'}</span></dd>
          </div>)}</dl>
        </article>
      </li>)}</ul>
      <p className={styles.matrixCaption}>{caption}</p>
    </div>
  </>;
}

export function HealthDashboard({ can }: { can: Access }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const view: HealthView = params.get('healthView') === 'nrs' ? 'nrs' : 'asos';
  const reduce = useAppReducedMotion(), prefix = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const state: unknown = location.state;
    if (!state || typeof state !== 'object' || !('dashboardTabFocus' in state) || state.dashboardTabFocus !== view) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    tabs.current[view === 'nrs' ? 1 : 0]?.focus({ preventScroll: true });
  }, [location.key, location.state, view]);
  const [detail, setDetail] = useState<HealthExample | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});
  const isDemo = API_MODE === 'demo';
  useEffect(() => { setDetail(null); }, [view]);
  function select(next: HealthView) {
    if (params.get('healthView') === next) return;
    setParams(previous => { const updated = new URLSearchParams(previous); updated.set('healthView', next); return updated; });
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % views.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + views.length) % views.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;
    event.preventDefault(); select(views[next].id); tabs.current[next]?.focus();
  }
  const localCount = Object.values(followed).filter(Boolean).length;
  return <div className={styles.dashboard} data-health-dashboard data-motion-managed>
    <div className={styles.topline}><span><HeartPulse size={15} aria-hidden="true" />Documentação e planejamento</span>{isDemo && <span className={styles.demoLabel}><Sparkles size={13} aria-hidden="true" />Cenário demonstrativo · dados sintéticos</span>}</div>
    <div className={styles.tabs} role="tablist" aria-label="Saúde e capacitações">
      {views.map((item, index) => <button key={item.id} ref={node => { tabs.current[index] = node; }} type="button" role="tab" aria-label={item.accessibleLabel} id={`${prefix}-tab-${item.id}`} aria-controls={`${prefix}-panel-${item.id}`} aria-selected={view === item.id} tabIndex={view === item.id ? 0 : -1} onClick={() => select(item.id)} onKeyDown={event => handleTabKey(event, index)}><item.icon size={17} aria-hidden="true" />{item.label}</button>)}
    </div>
    {isDemo && <p className={styles.scenarioNote}>Equipes e quantidades fictícias para explorar a interface. As ações de acompanhamento ficam nesta página e não alteram cadastros.{localCount > 0 && <span className={styles.localCount}><CheckCheck size={13} aria-hidden="true" />{localCount} {localCount === 1 ? 'exemplo em acompanhamento' : 'exemplos em acompanhamento'}</span>}</p>}

    <motion.section id={`${prefix}-panel-asos`} role="tabpanel" aria-labelledby={`${prefix}-tab-asos`} tabIndex={0} hidden={view !== 'asos'} className={styles.tabPanel} initial={false} animate={{ opacity: view === 'asos' ? 1 : 0, y: view === 'asos' || reduce ? 0 : 14 }} transition={{ duration: reduce ? 0 : .38 }}>
      <header className={styles.sectionTitle}><div><span className={styles.eyebrow}>Saúde ocupacional</span><h2>Atestados de saúde ocupacional (ASO)</h2><p>Acompanhe renovações, conferências de arquivos e a organização do atendimento.</p></div><span className={styles.sectionIcon}><HeartPulse size={26} strokeWidth={1.5} aria-hidden="true" /></span></header>
      {!isDemo ? <Disconnected view="asos" can={can} /> : <>
        <div className={styles.metrics}>
          <Metric title="ASOs a renovar" value={healthScenario.asoRenewals} note="Soma das três janelas do cenário" icon={<FileClock size={18} />} featured />
          <Metric title="Conferências documentais" value={healthScenario.asoReviews} note="Arquivos na fila administrativa" icon={<FileCheck2 size={18} />} />
          <Metric title="Exames a organizar" value={healthScenario.examsToOrganize} note="Solicitações fictícias, sem reserva" icon={<CalendarDays size={18} />} />
          <Metric title="Agendamentos a confirmar" value={healthScenario.appointmentsToConfirm} note="Datas aguardando confirmação no exemplo" icon={<CalendarClock size={18} />} />
        </div>
        <div className={styles.asoGrid}>
          <article className={`${styles.card} ${styles.renewalCard}`}>
            <header className={styles.cardHeader}><div><h3>Janelas de renovação</h3><p>Distribuição dos {healthScenario.asoRenewals} documentos do exemplo</p></div><CalendarClock size={18} aria-hidden="true" /></header>
            <div className={styles.renewalTotal}><strong>{healthScenario.asoRenewals}</strong><span>ASOs no planejamento<span>Datas sintéticas cadastradas</span></span></div>
            <div className={styles.windowChart} aria-hidden="true">{asoRenewalWindows.map(item => <motion.span key={item.tone} className={styles[item.tone]} style={{ flexGrow: item.count }} initial={reduce ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reduce ? 0 : .6, delay: reduce ? 0 : .12 }} />)}</div>
            <ul className={styles.windows}>{asoRenewalWindows.map(item => <li key={item.tone}><span className={`${styles.windowDot} ${styles[item.tone]}`} aria-hidden="true" /><div><strong>{item.label}</strong><span>{item.note}</span></div><b>{item.count}</b></li>)}</ul>
            <p className={styles.footnote}>Janelas de planejamento da demonstração. Não definem periodicidade legal ou conclusão de avaliação ocupacional.</p>
          </article>
          <article className={styles.card}>
            <header className={styles.cardHeader}><div><h3>Fila de conferência documental</h3><p>Cadastro, versão e recebimento dos arquivos</p></div><FileCheck2 size={18} aria-hidden="true" /></header>
            <ul className={styles.queue}>{asoReviewQueue.map(item => <ExampleRow key={item.id} example={item} followed={Boolean(followed[item.id])} onOpen={() => setDetail(item)} />)}</ul>
          </article>
        </div>
        <article className={`${styles.card} ${styles.scheduleCard}`}>
          <header className={styles.cardHeader}><div><h3>Organização do atendimento</h3><p>Etapas administrativas do cenário de ASOs</p></div><CalendarDays size={18} aria-hidden="true" /></header>
          <ul className={styles.schedule}>{asoPlanningQueue.map((item, index) => <li key={item.id}><span className={styles.stepNumber} aria-hidden="true">0{index + 1}</span><div><h4>{item.title}</h4><p>{item.quantity} {item.unit} · {item.team}</p><span className={followed[item.id] ? styles.followed : styles.scheduleStatus}>{followed[item.id] ? 'Em acompanhamento local' : item.status}</span></div><button type="button" className={styles.detailButton} aria-label={`Ver detalhe: ${item.title}`} onClick={() => setDetail(item)}><span>Ver planejamento</span><ChevronRight size={17} aria-hidden="true" /></button></li>)}</ul>
        </article>
        <Resources view="asos" can={can} />
      </>}
    </motion.section>

    <motion.section id={`${prefix}-panel-nrs`} role="tabpanel" aria-labelledby={`${prefix}-tab-nrs`} tabIndex={0} hidden={view !== 'nrs'} className={styles.tabPanel} initial={false} animate={{ opacity: view === 'nrs' ? 1 : 0, y: view === 'nrs' || reduce ? 0 : 14 }} transition={{ duration: reduce ? 0 : .38 }}>
      <header className={styles.sectionTitle}><div><span className={styles.eyebrow}>Evidências e desenvolvimento</span><h2>Capacitações por equipe</h2><p>Organize comprovantes, lacunas de registro e turmas. A associação às normas regulamentadoras (NR) depende da matriz homologada.</p></div><span className={styles.sectionIcon}><GraduationCap size={28} strokeWidth={1.5} aria-hidden="true" /></span></header>
      {!isDemo ? <Disconnected view="nrs" can={can} /> : <>
        <div className={styles.metrics}>
          <Metric title="Comprovantes disponíveis" value={healthScenario.trainingEvidence} note={`De ${healthScenario.trainingExpected} posições da matriz fictícia`} icon={<BookOpen size={18} />} featured />
          <Metric title="Lacunas de registro" value={healthScenario.trainingExpected - healthScenario.trainingEvidence} note="Posições ainda sem arquivo no cenário" icon={<Layers3 size={18} />} />
          <Metric title="Turmas a planejar" value={healthScenario.trainingGroups} note="Grupos com organização pendente" icon={<Users size={18} />} />
          <Metric title="Renovações a programar" value={healthScenario.trainingRenewals} note="Comprovantes disponíveis a acompanhar" icon={<CalendarClock size={18} />} />
        </div>
        <article className={`${styles.card} ${styles.matrixCard}`}>
          <header className={styles.cardHeader}><div><h3>Matriz de evidências por equipe</h3><p>Arquivos disponíveis / posições previstas no exemplo</p></div><span className={styles.matrixLegend}><span aria-hidden="true" />Há registros a reunir</span></header>
          <TrainingMatrix prefix={prefix} />
          <p className={styles.footnote}>Temas ilustrativos já usados no sistema. A associação a NRs específicas e seus critérios depende da matriz homologada; nenhum prazo normativo é definido aqui.</p>
        </article>
        <div className={styles.trainingGrid}>
          <article className={styles.card}><header className={styles.cardHeader}><div><h3>Planejamento de capacitações</h3><p>Próximos grupos para organizar no cenário</p></div><Users size={18} aria-hidden="true" /></header><ul className={styles.queue}>{trainingPlanningQueue.map(item => <ExampleRow key={item.id} example={item} followed={Boolean(followed[item.id])} onOpen={() => setDetail(item)} />)}</ul></article>
          <article className={`${styles.card} ${styles.renewalCallout}`}><span className={styles.calloutIcon}><CalendarClock size={24} aria-hidden="true" /></span><span className={styles.eyebrow}>Próximo ciclo</span><h3>Renovar com antecedência.</h3><p>Três comprovantes disponíveis entram na janela fictícia de acompanhamento. Confira o período cadastrado e a matriz aplicável antes de planejar a renovação.</p>{followed[trainingRenewal.id] && <span className={styles.followed}><Check size={13} aria-hidden="true" />Em acompanhamento local</span>}<button type="button" className={styles.calloutButton} aria-label={`Ver detalhe: ${trainingRenewal.title}`} onClick={() => setDetail(trainingRenewal)}>Ver renovações do exemplo<ArrowUpRight size={15} aria-hidden="true" /></button></article>
        </div>
        <Resources view="nrs" can={can} />
      </>}
    </motion.section>

    <Modal open={isDemo && Boolean(detail)} title={detail?.title ?? 'Detalhe do exemplo'} onClose={() => setDetail(null)}>
      {detail && <div className={styles.modalBody}>
        <span className={styles.modalDemo}><Sparkles size={14} aria-hidden="true" />Exemplo fictício · acompanhamento local</span>
        <dl className={styles.detailFacts}><div><dt>Equipe</dt><dd>{detail.team}</dd></div>{detail.topic && <div><dt>Tema</dt><dd>{detail.topic}</dd></div>}<div><dt>Quantidade</dt><dd>{detail.quantity} {detail.unit}</dd></div><div><dt>Etapa do cenário</dt><dd>{detail.status}</dd></div></dl>
        <p>{detail.context}</p><div className={styles.nextStep}><h3>Próximo cuidado</h3><p>{detail.nextStep}</p></div>
        <p className={styles.followupStatus} role="status">{followed[detail.id] ? 'Em acompanhamento local' : 'Este exemplo ainda não está em acompanhamento local.'}</p>
        <div className={styles.modalActions}><Button variant="secondary" onClick={() => setDetail(null)}>Fechar detalhe</Button><Button onClick={() => setFollowed(previous => ({ ...previous, [detail.id]: !previous[detail.id] }))}>{followed[detail.id] ? <><CheckCheck size={16} aria-hidden="true" />Retirar acompanhamento</> : <><Check size={16} aria-hidden="true" />Acompanhar exemplo</>}</Button></div>
        <p className={styles.footnote}>Essa marcação vale enquanto esta página estiver aberta. Não confere documentos, agenda atendimentos ou altera requisitos.</p>
      </div>}
    </Modal>
  </div>;
}
