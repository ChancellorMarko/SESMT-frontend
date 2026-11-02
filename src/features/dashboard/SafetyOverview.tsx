import { useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { ArrowUpRight, Check, CheckCheck, CircleHelp, ClipboardCheck, Clock3, HardHat, HeartPulse, Layers3, ShieldCheck, Unplug } from 'lucide-react';
import { API_MODE } from '../../shared/api/client';
import { Button, Modal } from '../../shared/ui';
import tableStyles from './OccurrenceTable.module.css';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { Progress } from '../../shared/ui/progress';
import { safetyOccurrences, safetyPriorityLabels, safetyScenario, type SafetyArea, type SafetyOccurrence, type SafetyPriority } from './safety-scenario';
import styles from './SafetyOverview.module.css';

const areas = [
  { id: '', label: 'Todos os registros', icon: Layers3 },
  { id: 'inspecoes', label: 'Inspeções', icon: ClipboardCheck },
  { id: 'saude', label: 'Saúde e capacitações', icon: HeartPulse },
  { id: 'epis', label: 'Equipamentos de proteção', icon: HardHat },
];

export function getSafetyArea(value: string | null): SafetyArea | '' {
  return value === 'inspecoes' || value === 'saude' || value === 'epis' ? value : '';
}

function reveal(reduce: boolean | null) {
  return {
    hidden: { opacity: reduce ? 1 : 0, y: reduce ? 0 : 24, filter: reduce ? 'blur(0px)' : 'blur(5px)' },
    visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: reduce ? 0 : .6, ease: 'easeOut' as const } },
  };
}

function PriorityTag({ priority, compact = false }: { priority: SafetyPriority; compact?: boolean }) {
  const shortLabels = { critical: 'Alta', attention: 'Atenção', routine: 'Rotina' };
  return <span className={`${styles.priority} ${styles[priority]}`} aria-label={safetyPriorityLabels[priority]} title={compact ? safetyPriorityLabels[priority] : undefined}><span aria-hidden="true" />{compact ? shortLabels[priority] : safetyPriorityLabels[priority]}</span>;
}

function KpiCard({ title, icon, children, featured = false, onDetails }: { title: string; icon: ReactNode; children: ReactNode; featured?: boolean; onDetails: () => void }) {
  const reduce = useAppReducedMotion();
  return <motion.article data-motion-card variants={reveal(reduce)} whileHover={reduce ? undefined : { y: -2 }} transition={{ duration: .32 }} className={`${styles.kpi} ${featured ? styles.featuredKpi : ''}`}>
    <div className={styles.kpiTitle}><span className={styles.kpiIcon} aria-hidden="true">{icon}</span><h3>{title}</h3></div>
    <button type="button" className={styles.info} aria-label={`Sobre o indicador: ${title}`} onClick={onDetails}><CircleHelp size={14} aria-hidden="true" /></button>
    {children}
  </motion.article>;
}

function PreventionChart() {
  const reduce = useAppReducedMotion();
  const gradient = useId();
  const path = 'M 8 154 C 40 154 40 119 74 119 S 116 139 147 101 S 177 115 211 91 S 245 63 279 91 S 309 119 345 84 S 381 91 415 56 S 447 74 481 40 S 527 61 555 24 S 579 32 594 17';
  return <motion.article variants={reveal(reduce)} className={`${styles.card} ${styles.chartCard}`}>
    <header className={styles.cardHeader}><div><h3>Ritmo de prevenção</h3><p>Dias sem acidentes</p></div></header>
    <div className={styles.chartSummary}><div><span>Dias sem acidentes</span><strong><AnimatedNumber value={safetyScenario.daysWithoutAccidents} duration={1.15} /><small>dias</small></strong></div><span className={styles.trend}><ShieldCheck size={13} aria-hidden="true" />Rotina preventiva</span></div>
    <div className={styles.chart} aria-hidden="true"><svg viewBox="0 0 600 184" preserveAspectRatio="none"><defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4679ee" stopOpacity=".16" /><stop offset="100%" stopColor="#4679ee" stopOpacity="0" /></linearGradient></defs>{[40, 90, 140].map(y => <path key={y} d={`M0 ${y} H600`} stroke="#e9edf2" strokeDasharray="3 5" />)}<motion.path d={`${path} L594 184 H8 Z`} fill={`url(#${gradient})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : .7, delay: reduce ? 0 : .3 }} /><motion.path data-motion-chart d={path} fill="none" stroke="#4679ee" strokeWidth="2.5" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1.15, delay: reduce ? 0 : .18, ease: 'easeOut' }} /></svg><div className={styles.chartLabels}><span>Organizar</span><span>Conferir</span><span>Acompanhar</span></div></div>
  </motion.article>;
}

function EquipmentGauge() {
  const reduce = useAppReducedMotion();
  const circumference = 2 * Math.PI * 58;
  return <motion.article variants={reveal(reduce)} className={`${styles.card} ${styles.gaugeCard}`}>
    <header className={styles.cardHeader}><div><h3>Entregas de equipamentos</h3><p>Equipamentos de proteção individual (EPI)</p></div><HardHat size={17} aria-hidden="true" /></header>
    <div className={styles.gauge}><svg viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="58" fill="none" stroke="#edf1f8" strokeWidth="12" /><motion.circle cx="75" cy="75" r="58" fill="none" stroke="#4679ee" strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} transform="rotate(-90 75 75)" initial={reduce ? false : { strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - safetyScenario.epiDelivered / 100) }} transition={{ duration: reduce ? 0 : 1.1, delay: reduce ? 0 : .2 }} /></svg><div><strong><AnimatedNumber value={safetyScenario.epiDelivered} suffix="%" /></strong><span>entregas</span></div></div>
    <p><strong>{safetyScenario.epiDelivered}</strong> de {safetyScenario.epiExpected} entregas previstas</p><span className={styles.gaugeFootnote}>A entrega não comprova aptidão.</span>
  </motion.article>;
}

function WorkflowCard({ canReadDocuments }: { canReadDocuments: boolean }) {
  const reduce = useAppReducedMotion();
  return <motion.article variants={reveal(reduce)} className={`${styles.card} ${styles.workflowCard}`}>
    <span className={styles.workflowIcon} aria-hidden="true"><ShieldCheck size={25} strokeWidth={1.4} /></span><h3>Documentos da unidade</h3><p>Consulte vigências, versões e responsáveis.</p>
    <div className={styles.workflowSteps}><span><Check size={12} aria-hidden="true" />Conferir</span><span><Check size={12} aria-hidden="true" />Liberar</span><span><Check size={12} aria-hidden="true" />Acompanhar</span></div>
    {canReadDocuments && <Link className={styles.workflowLink} to="/app/documentos">Consultar documentos da unidade<ArrowUpRight size={14} aria-hidden="true" /></Link>}
  </motion.article>;
}

function OccurrenceRow({ occurrence, reviewed, onOpen }: { occurrence: SafetyOccurrence; reviewed: boolean; onOpen: () => void }) {
  const reduce = useAppReducedMotion();
  return <motion.tr role="row" variants={reveal(reduce)}>
    <td role="cell"><strong>{occurrence.title}</strong><small>{occurrence.id}</small>{reviewed && <small>Em acompanhamento</small>}</td>
    <td role="cell" className={tableStyles.location}>{occurrence.team}<small>{occurrence.location}</small></td>
    <td role="cell"><PriorityTag priority={occurrence.priority} compact /></td>
    <td role="cell"><button type="button" className="info-button" aria-label={`Ver detalhes: ${occurrence.title}`} title={`Ver detalhes: ${occurrence.title}`} aria-haspopup="dialog" onClick={onOpen}><span aria-hidden="true">?</span></button></td>
  </motion.tr>;
}

export function SafetyOverview({ canReadDocuments }: { canReadDocuments: boolean }) {
  const [params, setParams] = useSearchParams();
  const area = getSafetyArea(params.get('area'));
  const reduce = useAppReducedMotion();
  const tabsId = useId();
  const demo = API_MODE === 'demo';
  const [selected, setSelected] = useState<SafetyOccurrence | null>(null);
  const [indicator, setIndicator] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const occurrences = safetyOccurrences.filter(item => !area || item.area === area);
  const currentAreaLabel = areas.find(item => item.id === area)?.label;
  const disconnected = <span className={styles.kpiNote}><Unplug size={12} aria-hidden="true" />Sem dados</span>;

  return <motion.section className={styles.overview} aria-label="Panorama de segurança do trabalho" initial={reduce ? false : 'hidden'} animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .075 } } }}>

    <motion.div className={styles.kpis} variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .075 } } }}>
      <KpiCard title="Dias sem acidentes" icon={<ShieldCheck size={17} />} onDetails={() => setIndicator('Dias sem acidentes')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.daysWithoutAccidents} /> : '—'}</strong>{demo && <small>dias</small>}{demo && <div className={styles.miniBars} aria-hidden="true">{[30, 52, 43, 70, 57, 85, 69, 100].map((height, i) => <motion.span key={i} initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: reduce ? 0 : .2 + i * .045, duration: reduce ? 0 : .45 }} style={{ height: `${height}%` }} />)}</div>}</div>{demo ? <span className={styles.kpiNote}><Check size={12} aria-hidden="true" />Dias registrados</span> : disconnected}
      </KpiCard>
      <KpiCard title="Índice de entrega de EPIs" icon={<HardHat size={17} />} onDetails={() => setIndicator('Índice de entrega de EPIs')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.epiDelivered} suffix="%" /> : '—'}</strong></div>{demo ? <><Progress value={safetyScenario.epiDelivered} aria-label="Entregas de EPIs" className={styles.deliveryProgress} indicatorClassName={styles.deliveryIndicator} /><span className={styles.kpiNote}>92 de 100 entregas previstas</span></> : disconnected}
      </KpiCard>
      <KpiCard title="Saúde e capacitações" icon={<HeartPulse size={17} />} onDetails={() => setIndicator('Saúde e capacitações')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.upcomingExpirations} /> : '—'}</strong>{demo && <small>a vencer</small>}</div>{demo ? <span className={styles.kpiNote}><Clock3 size={12} aria-hidden="true" />ASOs e treinamentos · próximos 30 dias</span> : disconnected}
      </KpiCard>
      <KpiCard title="Inspeções de risco pendentes" featured icon={<ClipboardCheck size={17} />} onDetails={() => setIndicator('Inspeções de risco pendentes')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.inspectionBacklog} /> : '—'}</strong>{demo && <small>registros</small>}</div><button type="button" className={styles.priorityAction} onClick={() => demo ? setSelected(safetyOccurrences[0]) : setIndicator('Inspeções de risco pendentes')}>{demo ? 'Conferir prioridade' : 'Sem dados'}<ArrowUpRight size={13} aria-hidden="true" /></button>
      </KpiCard>
    </motion.div>

    {demo && <details className={styles.moreIndicators}><summary><CircleHelp size={16} aria-hidden="true" />Ver gráficos de segurança</summary><motion.div className={styles.bento} variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .08 } } }}><PreventionChart /><EquipmentGauge /><WorkflowCard canReadDocuments={canReadDocuments} /></motion.div></details>}

    <div className={styles.preventive}><header className={styles.sectionHeader}><div><h2>{area ? currentAreaLabel : 'Ocorrências e vistorias'}</h2></div></header>
      <div className={styles.filters} aria-label="Filtrar registros por área">{areas.map(item => <button key={item.id} type="button" aria-pressed={area === item.id} onClick={() => { const next = new URLSearchParams(params); if (item.id) next.set('area', item.id); else next.delete('area'); setParams(next, { replace: true }); }}><item.icon size={14} aria-hidden="true" /><span>{item.label}</span>{area === item.id && <motion.span aria-hidden="true" layoutId={`${tabsId}-area`} className={styles.activeFilter} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }} />}</button>)}</div>
      {demo ? <div className={tableStyles.wrap}><table role="table" aria-label="Ocorrências e vistorias" className={`data-table ${tableStyles.table}`}><thead role="rowgroup"><tr role="row"><th scope="col">Registro</th><th scope="col" className={tableStyles.location}>Equipe e local</th><th scope="col">Prioridade</th><th scope="col"><span className="sr-only">Ver detalhes</span></th></tr></thead><motion.tbody role="rowgroup" variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .05 } } }}>{occurrences.map(item => <OccurrenceRow key={item.id} occurrence={item} reviewed={reviewed.includes(item.id)} onOpen={() => { setSelected(item); setFeedback(''); }} />)}</motion.tbody></table></div> : <div className={styles.disconnected}><Unplug size={25} strokeWidth={1.5} aria-hidden="true" /><h3>Sem registros disponíveis</h3>{canReadDocuments && <Link to="/app/documentos">Consultar documentos<ArrowUpRight size={14} aria-hidden="true" /></Link>}</div>}
    </div>

    <Modal open={Boolean(indicator)} title={indicator ?? ''} onClose={() => setIndicator(null)}>
      <div className="space-y-4"><p className="text-sm leading-6 text-slate-600">{demo ? indicator === 'Dias sem acidentes' ? 'Intervalo acompanhado sem registro de acidentes.' : indicator === 'Índice de entrega de EPIs' ? 'Entregas previstas e comprovantes de equipamentos.' : indicator === 'Saúde e capacitações' ? 'Documentos e capacitações com vencimento nos próximos 30 dias.' : 'Inspeções que precisam de acompanhamento.' : 'Sem informações disponíveis.'}</p><Button onClick={() => setIndicator(null)}>Fechar</Button></div>
    </Modal>

    <Modal open={Boolean(selected)} title={selected?.title ?? 'Detalhes do registro'} onClose={() => { setSelected(null); setFeedback(''); }}>
      {selected && <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-slate-600">{selected.id} · {selected.category}</span><PriorityTag priority={selected.priority} /></div><p className="text-sm text-slate-600">{selected.team} · {selected.location}</p><p className="text-sm leading-7 text-slate-600">{selected.detail}</p>{feedback && <p role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 p-4 text-xs leading-6 text-emerald-800"><CheckCheck size={16} className="mt-1 shrink-0" aria-hidden="true" />{feedback}</p>}<div className="flex flex-wrap gap-2"><Button disabled={reviewed.includes(selected.id)} onClick={() => { setReviewed(current => current.includes(selected.id) ? current : [...current, selected.id]); setFeedback('Registro em acompanhamento.'); }}><Check size={15} />{reviewed.includes(selected.id) ? 'Em acompanhamento' : 'Acompanhar'}</Button><Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button></div></div>}
    </Modal>
  </motion.section>;
}

