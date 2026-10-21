import { useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, ClipboardCheck, Clock3, HardHat, HeartPulse, Layers3, ShieldCheck, Sparkles, Unplug } from 'lucide-react';
import { API_MODE } from '../../shared/api/client';
import { Button, Modal } from '../../shared/ui';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { Progress } from '../../shared/ui/progress';
import { safetyOccurrences, safetyPriorityLabels, safetyScenario, type SafetyArea, type SafetyOccurrence, type SafetyPriority } from './safety-scenario';
import styles from './SafetyOverview.module.css';

const areas = [
  { id: '', label: 'Todos os registros', icon: Layers3 },
  { id: 'inspecoes', label: 'Inspeções', icon: ClipboardCheck },
  { id: 'saude', label: 'ASO e treinamentos', icon: HeartPulse },
  { id: 'epis', label: 'EPIs', icon: HardHat },
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

function PriorityTag({ priority }: { priority: SafetyPriority }) {
  return <span className={`${styles.priority} ${styles[priority]}`}><span aria-hidden="true" />{safetyPriorityLabels[priority]}</span>;
}

function KpiCard({ title, icon, children, featured = false, onDetails }: { title: string; icon: ReactNode; children: ReactNode; featured?: boolean; onDetails: () => void }) {
  const reduce = useAppReducedMotion();
  return <motion.article data-motion-card variants={reveal(reduce)} whileHover={reduce ? undefined : { y: -7, scale: 1.015 }} transition={{ duration: .32 }} className={`${styles.kpi} ${featured ? styles.featuredKpi : ''}`}>
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
    <header className={styles.cardHeader}><div><h3>Ritmo de prevenção</h3><p>Uma visão do acompanhamento</p></div><span className={styles.exampleBadge}>Ilustração</span></header>
    <div className={styles.chartSummary}><div><span>Dias sem acidentes</span><strong><AnimatedNumber value={safetyScenario.daysWithoutAccidents} duration={1.15} /><small>dias no exemplo</small></strong></div><span className={styles.trend}><ShieldCheck size={13} aria-hidden="true" />Rotina preventiva</span></div>
    <div className={styles.chart} aria-hidden="true"><svg viewBox="0 0 600 184" preserveAspectRatio="none"><defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4679ee" stopOpacity=".16" /><stop offset="100%" stopColor="#4679ee" stopOpacity="0" /></linearGradient></defs>{[40, 90, 140].map(y => <path key={y} d={`M0 ${y} H600`} stroke="#e9edf2" strokeDasharray="3 5" />)}<motion.path d={`${path} L594 184 H8 Z`} fill={`url(#${gradient})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : .7, delay: reduce ? 0 : .3 }} /><motion.path data-motion-chart d={path} fill="none" stroke="#4679ee" strokeWidth="2.5" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1.15, delay: reduce ? 0 : .18, ease: 'easeOut' }} /></svg><div className={styles.chartLabels}><span>Organizar</span><span>Conferir</span><span>Acompanhar</span></div></div>
    <p className={styles.chartCaption}>Traçado visual de exemplo. Não representa uma série de ocorrências da unidade.</p>
  </motion.article>;
}

function EquipmentGauge() {
  const reduce = useAppReducedMotion();
  const circumference = 2 * Math.PI * 58;
  return <motion.article variants={reveal(reduce)} className={`${styles.card} ${styles.gaugeCard}`}>
    <header className={styles.cardHeader}><div><h3>Entregas de EPIs</h3><p>Lote ilustrativo</p></div><HardHat size={17} aria-hidden="true" /></header>
    <div className={styles.gauge}><svg viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="58" fill="none" stroke="#edf1f8" strokeWidth="12" /><motion.circle cx="75" cy="75" r="58" fill="none" stroke="#4679ee" strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} transform="rotate(-90 75 75)" initial={reduce ? false : { strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - safetyScenario.epiDelivered / 100) }} transition={{ duration: reduce ? 0 : 1.1, delay: reduce ? 0 : .2 }} /></svg><div><strong><AnimatedNumber value={safetyScenario.epiDelivered} suffix="%" /></strong><span>no cenário</span></div></div>
    <p><strong>{safetyScenario.epiDelivered}</strong> de {safetyScenario.epiExpected} entregas previstas</p><span className={styles.gaugeFootnote}>A entrega não comprova aptidão.</span>
  </motion.article>;
}

function WorkflowCard({ canReadDocuments }: { canReadDocuments: boolean }) {
  const reduce = useAppReducedMotion();
  return <motion.article variants={reveal(reduce)} className={`${styles.card} ${styles.workflowCard}`}>
    <span className={styles.workflowIcon} aria-hidden="true"><ShieldCheck size={25} strokeWidth={1.4} /></span><span className={styles.eyebrow}>Antes da atividade</span><h3>Um cuidado<br />em cada etapa.</h3><p>Documentos, requisitos e responsáveis acompanham a operação.</p>
    <div className={styles.workflowSteps}><span><Check size={12} aria-hidden="true" />Conferir</span><span><Check size={12} aria-hidden="true" />Liberar</span><span><Check size={12} aria-hidden="true" />Acompanhar</span></div>
    {canReadDocuments && <Link className={styles.workflowLink} to="/app/documentos">Consultar documentos da unidade<ArrowUpRight size={14} aria-hidden="true" /></Link>}
  </motion.article>;
}

function OccurrenceIllustration({ area }: { area: SafetyArea }) {
  return <svg viewBox="0 0 280 130" aria-hidden="true" className={styles.illustration}>
    <ellipse cx="141" cy="113" rx="78" ry="9" fill="#183b68" opacity=".08" />
    {area === 'epis' ? <g><path d="M88 89c0-32 19-55 49-55s51 23 51 55" fill="#88b0eb" /><path d="M103 89c0-27 13-48 34-48s35 21 35 48" fill="#bfd3f2" /><path d="M132 31h12v57h-12z" fill="#4679ee" /><path d="M77 87h121c4 0 7 5 4 9-7 11-31 17-65 17-29 0-53-6-64-15-5-4-2-11 4-11" fill="#285b9e" /><path d="M80 87h115c2 0 3 3 1 4-15 8-88 9-116 0-2-1-2-4 0-4" fill="#638fd1" /><path d="M101 61c4-9 11-17 20-20" stroke="#eef5ff" strokeWidth="5" strokeLinecap="round" /></g> : area === 'saude' ? <g transform="translate(91 13) rotate(-7 50 55)"><rect x="9" y="8" width="92" height="100" rx="9" fill="#c8d4e4" /><rect width="92" height="100" rx="9" fill="#fffefa" /><rect x="14" y="17" width="33" height="5" rx="2.5" fill="#a9b8cc" /><path d="M15 68h14l9-13 11 28 11-18h18" fill="none" stroke="#4679ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 32h62M15 40h46" stroke="#e0e7ed" strokeWidth="4" strokeLinecap="round" /><circle cx="77" cy="18" r="11" fill="#e6eefc" /><path d="M77 13v10m-5-5h10" stroke="#4679ee" strokeWidth="2.5" strokeLinecap="round" /></g> : <g><rect x="93" y="34" width="89" height="71" rx="9" fill="#6b83a0" /><rect x="101" y="42" width="73" height="40" rx="5" fill="#c9d6e3" /><circle cx="126" cy="62" r="13" fill="#edf2f8" /><circle cx="126" cy="62" r="6" fill="#6b83a0" /><rect x="150" y="49" width="12" height="25" rx="3" fill="#9ab1ca" /><rect x="84" y="80" width="108" height="8" rx="3" fill="#35577e" /><path d="M90 88v21m94-21v21" stroke="#35577e" strokeWidth="7" strokeLinecap="round" /><path d="M199 45v54M208 45v54M199 54h9m-9 12h9m-9 12h9m-9 12h9" stroke="#d5ad6c" strokeWidth="3" strokeLinecap="round" /><circle cx="186" cy="26" r="10" fill="#edcd92" /></g>}
    <circle cx="213" cy="27" r="13" fill="#fffefa" opacity=".42" /><circle cx="65" cy="55" r="5" fill="#fffefa" opacity=".54" />
  </svg>;
}

function OccurrenceCard({ occurrence, reviewed, onOpen }: { occurrence: SafetyOccurrence; reviewed: boolean; onOpen: () => void }) {
  const reduce = useAppReducedMotion();
  return <motion.article layout={!reduce} variants={reveal(reduce)} whileHover={reduce ? undefined : { y: -7, scale: 1.01 }} transition={{ duration: .32 }} className={styles.occurrence}>
    <div className={`${styles.poster} ${styles[occurrence.area]}`}><OccurrenceIllustration area={occurrence.area} /><span className={styles.posterTag}><PriorityTag priority={occurrence.priority} /></span><span className={styles.posterCode}>{occurrence.id} · EXEMPLO</span></div>
    <div className={styles.occurrenceBody}><span className={styles.eyebrow}>{occurrence.category}</span><h3>{occurrence.title}</h3><p>{occurrence.description}</p><div className={styles.owner}><span aria-hidden="true">{occurrence.initials}</span><div><strong>{occurrence.team}</strong><small>{occurrence.location}</small></div></div><button type="button" className={styles.occurrenceAction} aria-label={`Ver detalhes: ${occurrence.title}`} onClick={onOpen}>{reviewed ? <><span><CheckCheck size={14} aria-hidden="true" />Em acompanhamento · exemplo</span><ChevronRight size={14} aria-hidden="true" /></> : <>Ver detalhes<ArrowUpRight size={14} aria-hidden="true" /></>}</button></div>
  </motion.article>;
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
  const disconnected = <span className={styles.kpiNote}><Unplug size={12} aria-hidden="true" />Não conectado</span>;

  return <motion.section className={styles.overview} aria-label="Panorama de segurança do trabalho" initial={reduce ? false : 'hidden'} animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .075 } } }}>
    <div className={styles.scenarioBar}><div><span className={styles.scenarioLabel}><Sparkles size={12} aria-hidden="true" />{demo ? 'Cenário ilustrativo de SST' : 'Indicadores de SST'}</span><span>{demo ? 'Números sintéticos para explorar a interface' : 'Aguardando conexão dos módulos de SST'}</span></div>{area && <Link to="/app/dashboard">Voltar à visão geral<ArrowUpRight size={14} aria-hidden="true" /></Link>}</div>

    <motion.div className={styles.kpis} variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .075 } } }}>
      <KpiCard title="Dias sem acidentes" icon={<ShieldCheck size={17} />} onDetails={() => setIndicator('Dias sem acidentes')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.daysWithoutAccidents} /> : '—'}</strong>{demo && <small>dias</small>}{demo && <div className={styles.miniBars} aria-hidden="true">{[30, 52, 43, 70, 57, 85, 69, 100].map((height, i) => <motion.span key={i} initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: reduce ? 0 : .2 + i * .045, duration: reduce ? 0 : .45 }} style={{ height: `${height}%` }} />)}</div>}</div>{demo ? <span className={styles.kpiNote}><Check size={12} aria-hidden="true" />Meta atingida no exemplo</span> : disconnected}
      </KpiCard>
      <KpiCard title="Índice de entrega de EPIs" icon={<HardHat size={17} />} onDetails={() => setIndicator('Índice de entrega de EPIs')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.epiDelivered} suffix="%" /> : '—'}</strong></div>{demo ? <><Progress value={safetyScenario.epiDelivered} aria-label="Entregas de EPIs no cenário ilustrativo" className={styles.deliveryProgress} indicatorClassName={styles.deliveryIndicator} /><span className={styles.kpiNote}>92 de 100 entregas previstas · exemplo</span></> : disconnected}
      </KpiCard>
      <KpiCard title="ASOs e treinamentos" icon={<HeartPulse size={17} />} onDetails={() => setIndicator('ASOs e treinamentos')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.upcomingExpirations} /> : '—'}</strong>{demo && <small>a vencer</small>}</div>{demo ? <span className={styles.kpiNote}><Clock3 size={12} aria-hidden="true" />Janela ilustrativa de 30 dias</span> : disconnected}
      </KpiCard>
      <KpiCard title="Inspeções de risco pendentes" featured icon={<ClipboardCheck size={17} />} onDetails={() => setIndicator('Inspeções de risco pendentes')}>
        <div className={styles.kpiValue}><strong>{demo ? <AnimatedNumber value={safetyScenario.inspectionBacklog} /> : '—'}</strong>{demo && <small>registros</small>}</div><button type="button" className={styles.priorityAction} onClick={() => demo ? setSelected(safetyOccurrences[0]) : setIndicator('Inspeções de risco pendentes')}>{demo ? 'Conferir exemplo prioritário' : 'Não conectado'}<ArrowUpRight size={13} aria-hidden="true" /></button>
      </KpiCard>
    </motion.div>

    {demo && <motion.div className={styles.bento} variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .08 } } }}><PreventionChart /><EquipmentGauge /><WorkflowCard canReadDocuments={canReadDocuments} /></motion.div>}

    <div className={styles.preventive}><header className={styles.sectionHeader}><div><span className={styles.eyebrow}>Acompanhamento preventivo</span><h2>{area ? currentAreaLabel : 'Ocorrências e vistorias'}</h2><p>{demo ? 'Explore os exemplos de acompanhamento da equipe.' : 'Os registros aparecerão após a integração dos módulos.'}</p></div><span className={styles.exampleBadge}>{demo ? 'Demonstração visual' : 'Sem dados conectados'}</span></header>
      <div className={styles.filters} aria-label="Filtrar cenário por área">{areas.map(item => <button key={item.id} type="button" aria-pressed={area === item.id} onClick={() => { const next = new URLSearchParams(params); if (item.id) next.set('area', item.id); else next.delete('area'); setParams(next, { replace: true }); }}><item.icon size={14} aria-hidden="true" /><span>{item.label}</span>{area === item.id && <motion.span aria-hidden="true" layoutId={`${tabsId}-area`} className={styles.activeFilter} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }} />}</button>)}</div>
      {demo ? <motion.div className={`${styles.occurrences} ${area ? styles.filteredOccurrences : ''}`} variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .08 } } }}>{occurrences.map(item => <OccurrenceCard key={item.id} occurrence={item} reviewed={reviewed.includes(item.id)} onOpen={() => { setSelected(item); setFeedback(''); }} />)}</motion.div> : <div className={styles.disconnected}><Unplug size={25} strokeWidth={1.5} aria-hidden="true" /><h3>Módulo ainda não conectado</h3><p>Não há registros disponíveis para {area ? currentAreaLabel?.toLowerCase() : 'inspeções, EPIs e saúde ocupacional'}. A ausência de dados não indica conformidade.</p>{canReadDocuments && <Link to="/app/documentos">Consultar documentos<ArrowUpRight size={14} aria-hidden="true" /></Link>}</div>}
      <p className={styles.disclaimer}>{demo ? 'Os exemplos acima não refletem a unidade selecionada. Interações são locais e não emitem documentos nem autorizam atividades.' : 'As métricas exigem fonte validada; nenhum valor foi presumido para módulos sem integração.'}</p>
    </div>

    <Modal open={Boolean(indicator)} title={indicator ?? ''} onClose={() => setIndicator(null)}>
      <div className="space-y-5"><span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700">{demo ? 'Cenário ilustrativo de SST' : 'Integração pendente'}</span><p className="text-sm leading-7 text-slate-600">{demo ? 'Este indicador usa números sintéticos para demonstrar a nova experiência visual. Ele não foi calculado a partir dos documentos, trabalhadores ou operações da unidade selecionada e não comprova conformidade.' : 'Este domínio ainda não possui fonte conectada nesta interface. A ausência de registros não equivale a zero ocorrências nem a uma situação segura.'}</p><p className="text-xs leading-6 text-slate-500">As consultas e ações operacionais continuam disponíveis na seção de agenda e permissões abaixo.</p><Button onClick={() => setIndicator(null)}>Entendi</Button></div>
    </Modal>

    <Modal open={Boolean(selected)} title={selected?.title ?? 'Detalhes do cenário'} onClose={() => { setSelected(null); setFeedback(''); }}>
      {selected && <div className="space-y-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700">Exemplo visual · {selected.id}</span><PriorityTag priority={selected.priority} /></div><p className="text-sm leading-7 text-slate-600">{selected.detail}</p><div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><p className="m-0 text-xs font-semibold text-slate-600">Acompanhamento nesta demonstração</p><p className="mt-2 mb-0 text-xs leading-6 text-slate-500">A ação abaixo altera apenas este exemplo em memória. Nenhum registro real, autorização ou condição de aptidão será alterado.</p></div>{feedback && <p role="status" className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-xs leading-6 text-emerald-800"><CheckCheck size={16} className="mt-1 shrink-0" aria-hidden="true" />{feedback}</p>}<div className="flex flex-wrap gap-2"><Button disabled={reviewed.includes(selected.id)} onClick={() => { setReviewed(current => current.includes(selected.id) ? current : [...current, selected.id]); setFeedback('Exemplo marcado para acompanhamento. A alteração será descartada ao sair deste painel.'); }}><Check size={15} />{reviewed.includes(selected.id) ? 'Em acompanhamento no exemplo' : 'Acompanhar exemplo'}</Button><Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button></div></div>}
    </Modal>
  </motion.section>;
}

