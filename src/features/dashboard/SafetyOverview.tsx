import { useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, ClipboardCheck, Clock3, HardHat, HeartPulse, Layers3, ShieldCheck, Sparkles, Unplug } from 'lucide-react';
import { API_MODE } from '../../shared/api/client';
import { Button, Modal } from '../../shared/ui';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { Card } from '../../shared/ui/card';
import { Progress } from '../../shared/ui/progress';
import { safetyOccurrences, safetyPriorityLabels, safetyScenario, type SafetyArea, type SafetyOccurrence, type SafetyPriority } from './safety-scenario';

const areas = [
  { id: '', label: 'Todos os registros', icon: Layers3 },
  { id: 'inspecoes', label: 'Inspeções', icon: ClipboardCheck },
  { id: 'saude', label: 'ASO e treinamentos', icon: HeartPulse },
  { id: 'epis', label: 'EPIs', icon: HardHat },
];

export function getSafetyArea(value: string | null): SafetyArea | '' {
  return value === 'inspecoes' || value === 'saude' || value === 'epis' ? value : '';
}

const toneClasses = {
  emerald: 'border-emerald-100/90 shadow-[0_10px_30px_-10px_rgba(16,185,129,0.13)] hover:shadow-[0_14px_34px_-10px_rgba(16,185,129,0.27)]',
  blue: 'border-blue-100/90 shadow-[0_10px_30px_-10px_rgba(59,130,246,0.12)] hover:shadow-[0_14px_34px_-10px_rgba(59,130,246,0.25)]',
  amber: 'border-amber-100/90 shadow-[0_10px_30px_-10px_rgba(245,158,11,0.16)] hover:shadow-[0_14px_34px_-10px_rgba(245,158,11,0.29)]',
  rose: 'border-rose-100/90 shadow-[0_10px_30px_-10px_rgba(239,68,68,0.15)] hover:shadow-[0_14px_34px_-10px_rgba(239,68,68,0.28)]',
};
const priorityClasses: Record<SafetyPriority, string> = {
  critical: 'bg-rose-50 text-rose-700 ring-rose-200/60',
  attention: 'bg-amber-50 text-amber-800 ring-amber-200/60',
  routine: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
};

function PriorityTag({ priority }: { priority: SafetyPriority }) {
  const reduce = useReducedMotion();
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${priorityClasses[priority]}`}>
    <motion.span aria-hidden="true" className="size-1.5 rounded-full bg-current" animate={priority === 'critical' && !reduce ? { opacity: [1, .35, 1] } : undefined} transition={{ duration: 1.8, repeat: Infinity }} />
    {safetyPriorityLabels[priority]}
  </span>;
}

function KpiCard({ title, icon, tone, children, onDetails }: { title: string; icon: ReactNode; tone: keyof typeof toneClasses; children: ReactNode; onDetails: () => void }) {
  const reduce = useReducedMotion();
  return <motion.article variants={{ hidden: { opacity: 0, y: reduce ? 0 : 14 }, visible: { opacity: 1, y: 0 } }} whileHover={reduce ? undefined : { y: -4, scale: 1.01 }} transition={{ duration: .22 }} className={`relative flex min-w-0 flex-col overflow-hidden rounded-3xl border bg-white/90 p-3.5 transition-shadow sm:p-5 duration-300 xl:p-6 ${toneClasses[tone]}`}>
    <div className="mb-3 flex min-h-12 items-start justify-between gap-1 pr-5 sm:mb-5 sm:min-h-10 sm:gap-2 sm:pr-7">
      <div className="flex min-w-0 items-start gap-2 text-[11px] font-medium text-slate-600 [&>svg]:hidden [&>svg]:shrink-0 sm:text-[12px] sm:[&>svg]:block">{icon}<h3 className="m-0 min-w-0 break-words text-[11px] font-medium leading-4 text-slate-600 sm:text-[12px] sm:leading-5">{title}</h3></div>
      <button type="button" className="absolute right-1 top-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-400 sm:right-3 sm:top-3 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label={`Sobre o indicador: ${title}`} onClick={onDetails}><CircleHelp size={15} aria-hidden="true" /></button>
    </div>
    {children}
  </motion.article>;
}

function OccurrenceCard({ occurrence, reviewed, onOpen }: { occurrence: SafetyOccurrence; reviewed: boolean; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const Icon = occurrence.area === 'inspecoes' ? ClipboardCheck : occurrence.area === 'saude' ? HeartPulse : HardHat;
  return <motion.article layout={!reduce} variants={{ hidden: { opacity: 0, y: reduce ? 0 : 12 }, visible: { opacity: 1, y: 0 } }} whileHover={reduce ? undefined : { y: -4 }} className="group grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-[22px] border border-white bg-white/85 p-3.5 shadow-[0_6px_22px_-12px_rgba(24,59,104,0.12)] transition-shadow hover:shadow-[0_12px_28px_-12px_rgba(24,59,104,0.24)] sm:flex sm:flex-col sm:gap-0 sm:p-5">
    <div className="row-span-2 flex items-start justify-between gap-3 sm:mb-5 sm:items-center"><span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef3fa] text-[#325884] sm:size-11 sm:rounded-2xl"><Icon size={20} strokeWidth={1.6} aria-hidden="true" /></span><span className="hidden sm:inline-flex"><PriorityTag priority={occurrence.priority} /></span></div>
    <div className="min-w-0"><p className="m-0 mb-1 text-[9px] font-semibold uppercase tracking-[.1em] text-slate-400 sm:mb-2 sm:text-[10px] sm:tracking-[.13em]">{occurrence.category}</p><h3 className="m-0 text-[14px] font-semibold leading-snug tracking-[-.02em] text-[#183b68] sm:text-[16px]">{occurrence.title}</h3></div>
    <div className="col-start-2 sm:hidden"><PriorityTag priority={occurrence.priority} /></div>
    <p className="col-span-2 m-0 text-[11px] leading-5 text-slate-500 sm:mt-3 sm:mb-5 sm:text-[12px] sm:leading-6">{occurrence.description}</p>
    <div className="col-span-2 mt-1 flex items-center gap-2 border-t border-slate-100 pt-2 sm:mt-auto sm:gap-2.5 sm:pt-4"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#e8edf5] text-[9px] font-bold text-[#547092] sm:size-7" aria-hidden="true">{occurrence.initials}</span><div className="min-w-0"><p className="m-0 text-[10px] font-medium text-slate-600">{occurrence.team}</p><p className="m-0 text-[10px] leading-4 text-slate-400 sm:leading-5">{occurrence.location}</p></div></div>
    <button type="button" className="col-span-2 mt-1 flex min-h-11 w-full items-center justify-between rounded-xl bg-[#f4f6fa] px-3 text-left text-[11px] font-semibold text-[#315884] transition-colors hover:bg-[#e8eff9] sm:mt-4" onClick={onOpen} aria-label={`Ver detalhes: ${occurrence.title}`}>{reviewed ? <><span className="inline-flex items-center gap-1.5"><CheckCheck size={14} className="shrink-0" /> Em acompanhamento · exemplo</span><ChevronRight size={14} className="shrink-0" /></> : <>Ver detalhes <ArrowUpRight size={15} aria-hidden="true" /></>}</button>
  </motion.article>;
}

export function SafetyOverview({ canReadDocuments }: { canReadDocuments: boolean }) {
  const [params, setParams] = useSearchParams();
  const area = getSafetyArea(params.get('area'));
  const reduce = useReducedMotion();
  const tabsId = useId();
  const demo = API_MODE === 'demo';
  const [selected, setSelected] = useState<SafetyOccurrence | null>(null);
  const [indicator, setIndicator] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const occurrences = safetyOccurrences.filter(item => !area || item.area === area);
  const currentAreaLabel = areas.find(item => item.id === area)?.label;

  return <section className="space-y-5 sm:space-y-7" aria-label="Panorama de segurança do trabalho">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-1.5 rounded-full border border-white bg-white/70 px-3 py-1.5 text-[10px] font-semibold text-[#59728e]"><Sparkles size={12} aria-hidden="true" />{demo ? 'Cenário ilustrativo de SST' : 'Indicadores de SST'}</span><span className="text-[11px] leading-5 text-slate-500">{demo ? 'Números sintéticos para explorar a interface' : 'Aguardando conexão dos módulos de SST'}</span></div>
      {area && <Link to="/app/dashboard" className="inline-flex min-h-9 items-center gap-1.5 text-[11px] font-semibold text-[#315884]">Voltar à visão geral <ArrowUpRight size={14} /></Link>}
    </div>

    <motion.div initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .08 } } }} className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <KpiCard title="Dias sem acidentes" icon={<ShieldCheck size={16} className="text-emerald-500" aria-hidden="true" />} tone="emerald" onDetails={() => setIndicator('Dias sem acidentes')}>
        <div className="mb-3 flex flex-wrap items-baseline gap-1 sm:mb-4 sm:gap-2"><strong className="text-[38px] font-semibold sm:text-[43px] leading-none tracking-[-.055em] text-[#183b68]">{demo ? <AnimatedNumber value={safetyScenario.daysWithoutAccidents} /> : '—'}</strong>{demo && <span className="text-[11px] text-slate-400">dias</span>}</div>
        {demo ? <div className="mb-3 flex h-5 items-end gap-[3px] sm:mb-4 sm:h-8 sm:gap-[5px]" aria-hidden="true">{[25, 35, 30, 45, 39, 50, 44, 56, 51, 65, 59, 71, 68, 78, 72, 87, 82, 94, 89, 100].map((height, i) => <span key={i} className={`flex-1 rounded-t-sm ${i > 16 ? 'bg-emerald-400' : 'bg-emerald-100'}`} style={{ height: `${height}%` }} />)}</div> : <p className="mb-3 h-5 text-[10px] sm:mb-4 sm:h-8 text-slate-400">Nenhum histórico consultado</p>}
        <p className={`mt-auto mb-0 flex items-start gap-1.5 text-[10px] font-medium leading-4 [&>svg]:mt-0.5 [&>svg]:shrink-0 ${demo ? 'text-emerald-700' : 'text-slate-500'}`}>{demo ? <Check size={12} aria-hidden="true" /> : <Unplug size={12} aria-hidden="true" />}{demo ? 'Meta atingida no exemplo' : 'Não conectado'}</p>
      </KpiCard>

      <KpiCard title="Índice de entrega de EPIs" icon={<HardHat size={16} className="text-blue-500" aria-hidden="true" />} tone="blue" onDetails={() => setIndicator('Índice de entrega de EPIs')}>
        <div className="mb-3 flex flex-wrap items-baseline gap-1 sm:mb-4 sm:gap-2"><strong className="text-[38px] font-semibold sm:text-[43px] leading-none tracking-[-.055em] text-[#183b68]">{demo ? <AnimatedNumber value={safetyScenario.epiDelivered} suffix="%" /> : '—'}</strong></div>
        {demo ? <Progress value={safetyScenario.epiDelivered} aria-label="Entregas de EPIs no cenário ilustrativo" className="mb-3 h-2 bg-blue-50" indicatorClassName="bg-gradient-to-r from-blue-300 to-blue-500" /> : <div className="mb-3 h-2 rounded-full bg-slate-100" aria-hidden="true" />}
        <p className="mb-3 break-words text-[10px] leading-4 text-slate-400 sm:mb-4">{demo ? '92 de 100 entregas previstas · exemplo' : 'Entregas não informadas'}</p>
        <p className="mt-auto mb-0 flex items-start gap-1.5 text-[10px] font-medium leading-4 [&>svg]:mt-0.5 [&>svg]:shrink-0 text-blue-600"><ArrowUpRight size={12} aria-hidden="true" />{demo ? '8 entregas para acompanhar' : 'Não conectado'}</p>
      </KpiCard>

      <KpiCard title="ASOs e treinamentos" icon={<HeartPulse size={16} className="text-amber-500" aria-hidden="true" />} tone="amber" onDetails={() => setIndicator('ASOs e treinamentos')}>
        <div className="mb-3 flex flex-wrap items-baseline gap-1 sm:mb-4 sm:gap-2"><strong className="text-[38px] font-semibold sm:text-[43px] leading-none tracking-[-.055em] text-[#183b68]">{demo ? <AnimatedNumber value={safetyScenario.upcomingExpirations} /> : '—'}</strong>{demo && <span className="text-[11px] text-slate-400">a vencer</span>}</div>
        <div className="mb-3 inline-flex max-w-full items-start gap-1 rounded-xl bg-amber-50 px-2 py-1 text-[9px] font-medium leading-4 text-amber-700 sm:mb-4 sm:gap-1.5 sm:rounded-full sm:px-2.5 sm:py-1.5 sm:text-[10px] [&>svg]:mt-0.5 [&>svg]:shrink-0"><Clock3 size={12} aria-hidden="true" />{demo ? 'Janela ilustrativa de 30 dias' : 'Prazos indisponíveis'}</div>
        <p className="mt-auto mb-0 flex items-start gap-1.5 text-[10px] font-medium leading-4 [&>svg]:mt-0.5 [&>svg]:shrink-0 text-amber-700">{demo ? 'Planejar próximas renovações' : 'Não conectado'}<ArrowRight size={12} aria-hidden="true" /></p>
      </KpiCard>

      <KpiCard title="Inspeções de risco pendentes" icon={<ClipboardCheck size={16} className="text-rose-500" aria-hidden="true" />} tone="rose" onDetails={() => setIndicator('Inspeções de risco pendentes')}>
        <div className="mb-3 flex flex-wrap items-baseline gap-1 sm:mb-4 sm:gap-2"><strong className="text-[38px] font-semibold sm:text-[43px] leading-none tracking-[-.055em] text-[#183b68]">{demo ? <AnimatedNumber value={safetyScenario.inspectionBacklog} /> : '—'}</strong>{demo && <span className="text-[11px] text-slate-400">registros</span>}</div>
        <div className="mb-3 sm:mb-4">{demo ? <PriorityTag priority="critical" /> : <span className="text-[10px] text-slate-400">Prioridade indisponível</span>}</div>
        <button type="button" className="mt-auto flex min-h-11 items-center justify-between gap-1 text-left text-[10px] font-semibold text-rose-600" onClick={() => demo ? setSelected(safetyOccurrences[0]) : setIndicator('Inspeções de risco pendentes')}>{demo ? 'Conferir exemplo prioritário' : 'Não conectado'}<ArrowUpRight size={13} aria-hidden="true" /></button>
      </KpiCard>
    </motion.div>

    <div className="overflow-hidden rounded-[28px] border border-white/90 bg-[#e7ecf4]/55 p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#6f8daf]" /><span className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#6b819a]">ACOMPANHAMENTO PREVENTIVO</span></div><h2 className="m-0 text-[21px] font-semibold tracking-[-.035em] text-[#183b68]">{area ? currentAreaLabel : 'Ocorrências e vistorias'}</h2><p className="mt-2 mb-0 text-[12px] text-slate-500">{demo ? 'Explore os exemplos de acompanhamento da equipe.' : 'Os registros aparecerão após a integração dos módulos.'}</p></div><span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/60 px-3 py-1.5 text-[10px] text-slate-500"><span className="size-1.5 rounded-full bg-slate-400" />{demo ? 'Demonstração visual' : 'Sem dados conectados'}</span></div>

      <div className="mb-5 flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/60 bg-white/45 p-1.5" aria-label="Filtrar cenário por área">
        {areas.map(item => <button key={item.id} type="button" aria-pressed={area === item.id} onClick={() => { const next = new URLSearchParams(params); if (item.id) next.set('area', item.id); else next.delete('area'); setParams(next, { replace: true }); }} className={`relative flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-medium transition-colors ${area === item.id ? 'text-[#183b68]' : 'text-slate-500 hover:text-[#183b68]'}`}>
          {area === item.id && <motion.span layoutId={`${tabsId}-area`} className="absolute inset-0 rounded-xl border border-white bg-white shadow-[0_3px_14px_-5px_rgba(24,59,104,0.15)]" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 35 }} />}
          <item.icon size={14} className="relative" aria-hidden="true" /><span className="relative">{item.label}</span>
        </button>)}
      </div>

      {demo ? <motion.div initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : .07 } } }} className={`grid gap-4 ${area ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]' : 'lg:grid-cols-3'}`}>
        {occurrences.map(item => <OccurrenceCard key={item.id} occurrence={item} reviewed={reviewed.includes(item.id)} onOpen={() => { setSelected(item); setFeedback(''); }} />)}
        {area && <Card className="flex flex-col justify-between rounded-[22px] border border-white/70 bg-white/35 p-6 shadow-none"><div><span className="mb-4 inline-flex size-10 items-center justify-center rounded-full bg-white text-[#6b87a5]"><ShieldCheck size={20} aria-hidden="true" /></span><h3 className="mb-3 text-[16px] text-[#315884]">Uma visão antes da ação</h3><p className="m-0 text-[12px] leading-6 text-slate-500">Esta área mostra um cenário visual. As decisões de segurança continuam nos fluxos aprovados, com os requisitos e responsáveis da operação.</p></div>{canReadDocuments && <Link to="/app/documentos" className="mt-6 inline-flex min-h-10 items-center gap-2 text-[11px] font-semibold text-[#315884]">Consultar documentos da unidade <ArrowUpRight size={14} /></Link>}</Card>}
      </motion.div> : <div className="flex flex-col items-center rounded-[22px] border border-dashed border-[#cbd6e4] bg-white/45 px-6 py-12 text-center"><Unplug size={25} strokeWidth={1.5} className="mb-4 text-[#839ab4]" aria-hidden="true" /><h3 className="mb-2 text-[16px] text-[#315884]">Módulo ainda não conectado</h3><p className="m-0 max-w-md text-[12px] leading-6 text-slate-500">Não há registros disponíveis para {area ? currentAreaLabel?.toLowerCase() : 'inspeções, EPIs e saúde ocupacional'}. A ausência de dados não indica conformidade.</p>{canReadDocuments && <Link to="/app/documentos" className="mt-5 inline-flex min-h-10 items-center gap-2 text-[11px] font-semibold text-[#315884]">Consultar documentos <ArrowUpRight size={14} /></Link>}</div>}
      <p className="mt-4 mb-0 text-[10px] leading-5 text-slate-500">{demo ? 'Os exemplos acima não refletem a unidade selecionada. Interações são locais e não emitem documentos nem autorizam atividades.' : 'As métricas exigem fonte validada; nenhum valor foi presumido para módulos sem integração.'}</p>
    </div>

    <Modal open={Boolean(indicator)} title={indicator ?? ''} onClose={() => setIndicator(null)}>
      <div className="space-y-5"><span className="inline-flex rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700">{demo ? 'Cenário ilustrativo de SST' : 'Integração pendente'}</span><p className="text-sm leading-7 text-slate-600">{demo ? 'Este indicador usa números sintéticos para demonstrar a nova experiência visual. Ele não foi calculado a partir dos documentos, trabalhadores ou operações da unidade selecionada e não comprova conformidade.' : 'Este domínio ainda não possui fonte conectada nesta interface. A ausência de registros não equivale a zero ocorrências nem a uma situação segura.'}</p><p className="text-xs leading-6 text-slate-500">As consultas e ações operacionais continuam disponíveis na seção de agenda e permissões abaixo.</p><Button onClick={() => setIndicator(null)}>Entendi</Button></div>
    </Modal>

    <Modal open={Boolean(selected)} title={selected?.title ?? 'Detalhes do cenário'} onClose={() => { setSelected(null); setFeedback(''); }}>
      {selected && <div className="space-y-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700">Exemplo visual · {selected.id}</span><PriorityTag priority={selected.priority} /></div><p className="text-sm leading-7 text-slate-600">{selected.detail}</p><div className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><p className="m-0 text-xs font-semibold text-slate-600">Acompanhamento nesta demonstração</p><p className="mt-2 mb-0 text-xs leading-6 text-slate-500">A ação abaixo altera apenas este exemplo em memória. Nenhum registro real, autorização ou condição de aptidão será alterado.</p></div>{feedback && <p role="status" className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-xs leading-6 text-emerald-800"><CheckCheck size={16} className="mt-1 shrink-0" aria-hidden="true" />{feedback}</p>}<div className="flex flex-wrap gap-2"><Button disabled={reviewed.includes(selected.id)} onClick={() => { setReviewed(current => current.includes(selected.id) ? current : [...current, selected.id]); setFeedback('Exemplo marcado para acompanhamento. A alteração será descartada ao sair deste painel.'); }}><Check size={15} />{reviewed.includes(selected.id) ? 'Em acompanhamento no exemplo' : 'Acompanhar exemplo'}</Button><Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button></div></div>}
    </Modal>
  </section>;
}

