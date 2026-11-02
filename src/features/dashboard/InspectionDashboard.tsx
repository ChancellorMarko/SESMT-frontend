import { useState } from 'react';
import { Link } from 'react-router';
import { motion, type Variants } from 'framer-motion';
import { ArrowRight, CalendarDays, CheckCheck, CheckCircle2, ClipboardCheck, Clock3, FileText, Flag, MapPin, RotateCcw, SearchCheck, UserRound } from 'lucide-react';
import { API_MODE } from '../../shared/api/client';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { Badge, Button, Feedback, Modal } from '../../shared/ui';
import { getInspectionSummary, inspectionFindings, inspectionPriorityLabel, inspectionStatusLabel, inspectionVisits, type InspectionFinding } from './inspection-scenario';
import styles from './InspectionDashboard.module.css';

type Selection = { type: 'finding'; id: string } | { type: 'visit'; id: string };
type ActionFilter = 'all' | 'high' | 'in-progress';

function DestinationLinks({ can }: { can: (permission: string) => boolean }) {
  return <div className={styles.destinationLinks}>
    {can('appointments.read') && <Link className={styles.destinationLink} to="/app/agenda?q=Inspe%C3%A7%C3%A3o"><CalendarDays size={17} aria-hidden="true" />Agenda de inspeções<ArrowRight size={16} aria-hidden="true" /></Link>}
    {can('eligibility.read') && <Link className={styles.destinationLink} to="/app/pendencias"><ClipboardCheck size={17} aria-hidden="true" />Consultar pendências<ArrowRight size={16} aria-hidden="true" /></Link>}
    {can('documents.read') && <Link className={styles.destinationLink} to="/app/documentos"><FileText size={17} aria-hidden="true" />Consultar documentos<ArrowRight size={16} aria-hidden="true" /></Link>}
  </div>;
}

function FindingMeta({ finding }: { finding: InspectionFinding }) {
  return <dl className={styles.findingMeta}>
    <div><dt><MapPin size={14} aria-hidden="true" />Local</dt><dd>{finding.location}</dd></div>
    <div><dt><UserRound size={14} aria-hidden="true" />Responsável</dt><dd>{finding.owner}</dd></div>
    <div><dt><Clock3 size={14} aria-hidden="true" />Prazo</dt><dd>{finding.deadline}</dd></div>
  </dl>;
}

export function InspectionDashboard({ can }: { can: (permission: string) => boolean }) {
  const reduce = useAppReducedMotion();
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [following, setFollowing] = useState<string[]>([]);
  const summary = API_MODE === 'demo' ? getInspectionSummary() : null;
  const reveal: Variants = {
    hidden: { opacity: 0, y: 22 },
    visible: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.5, ease: 'easeOut' } },
  };

  if (!summary) return <section className={styles.dashboard} data-motion-managed="true" aria-labelledby="inspection-unavailable-title">
    <div className={styles.unavailable}>
      <span className={styles.unavailableIcon}><SearchCheck size={30} aria-hidden="true" /></span>
      <h2 id="inspection-unavailable-title">Sem registros de inspeções</h2>
      <p>Sem registros de inspeções disponíveis.</p>
      <DestinationLinks can={can} />
    </div>
  </section>;

  const filteredFindings = summary.openFindings.filter(finding => filter === 'all' || (filter === 'high' ? finding.priority === 'high' : finding.status === 'in-progress'));
  const selectedFinding = selection?.type === 'finding' ? inspectionFindings.find(finding => finding.id === selection.id) : undefined;
  const selectedVisit = selection?.type === 'visit' ? inspectionVisits.find(visit => visit.id === selection.id) : undefined;
  const tracked = !!selectedFinding && following.includes(selectedFinding.id);
  const maxAreaCount = Math.max(...summary.byArea.map(item => item.count), 1);
  const metrics = [
    { label: 'Vistorias no ciclo', value: summary.visitCount, description: 'Roteiro de vistorias', icon: SearchCheck },
    { label: 'Achados em aberto', value: summary.openFindings.length, description: 'Com ação a acompanhar', icon: Flag },
    { label: 'Ações em andamento', value: summary.inProgressCount, description: 'Dentro do plano de ação', icon: ClipboardCheck },
    { label: 'Reinspeções previstas', value: summary.reinspections.length, description: 'Visitas de retorno no roteiro', icon: RotateCcw },
  ];

  return <motion.section className={styles.dashboard} data-motion-managed="true" aria-label="Painel de inspeções" initial={reduce ? false : 'hidden'} animate="visible" variants={{ visible: { transition: { staggerChildren: reduce ? 0 : 0.07 } } }}>
    <div className={styles.metrics}>
      {metrics.map(({ label, value, description, icon: Icon }) => <motion.article key={label} className={styles.metric} variants={reveal}>
        <div className={styles.metricTop}><span>{label}</span><Icon size={20} aria-hidden="true" /></div>
        <strong className={styles.metricValue}>{value}</strong><p>{description}</p>
      </motion.article>)}
    </div>

    <div className={styles.insightGrid}>
      <motion.section className={styles.panel} variants={reveal} aria-labelledby="inspection-findings-title">
        <div className={styles.sectionHeading}><div><h2 id="inspection-findings-title">Onde estão os achados</h2></div><span className={styles.totalPill}>{summary.openFindings.length} em aberto</span></div>
        <p className={styles.sectionDescription}>Compare as áreas para organizar o acompanhamento das correções.</p>
        <figure className={styles.chart} aria-labelledby="inspection-chart-caption">
          <figcaption id="inspection-chart-caption">Achados em aberto por área</figcaption>
          <ul>{summary.byArea.map(item => <li key={item.area}>
            <div className={styles.barLabel}><span>{item.area}</span><strong>{item.count}<span className={styles.srOnly}> {item.count === 1 ? 'achado em aberto' : 'achados em aberto'}</span></strong></div>
            <div className={styles.barTrack} aria-hidden="true"><motion.span initial={reduce ? false : { width: 0 }} animate={{ width: `${item.count / maxAreaCount * 100}%` }} transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.2 }} /></div>
          </li>)}</ul>
        </figure>
      </motion.section>

      <motion.section className={styles.returnPanel} variants={reveal} aria-labelledby="inspection-returns-title">
        <div className={styles.returnIcon}><RotateCcw size={23} aria-hidden="true" /></div>

        <h2 id="inspection-returns-title">Reinspeções previstas</h2>
        <p>Acompanhe os retornos agendados.</p>
        <ul className={styles.returnList}>{summary.reinspections.map(visit => <li key={visit.id}>
          <button type="button" onClick={() => setSelection({ type: 'visit', id: visit.id })} aria-label={`Ver reinspeção: ${visit.area}`}>
            <span><strong>{visit.area}</strong><small>{visit.reinspection}</small></span><ArrowRight size={19} aria-hidden="true" />
          </button>
        </li>)}</ul>
      </motion.section>
    </div>

    <motion.section className={styles.panel} variants={reveal} aria-labelledby="inspection-actions-title">
      <div className={styles.sectionHeading}><div><h2 id="inspection-actions-title">Plano de ação das inspeções</h2></div><span className={styles.totalPill}>{filteredFindings.length} {filteredFindings.length === 1 ? 'ação' : 'ações'}</span></div>
      <div className={styles.filterRow} role="group" aria-label="Filtrar ações de inspeção">
        {([{ value: 'all', label: 'Todas' }, { value: 'high', label: 'Alta prioridade' }, { value: 'in-progress', label: 'Em andamento' }] as const).map(item => <button key={item.value} type="button" className={styles.filterButton} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      </div>
      <div className={styles.actionGrid}>
        {filteredFindings.map(finding => <article className={styles.actionCard} key={finding.id}>
          <div className={styles.actionTags}><Badge tone={finding.priority === 'high' ? 'danger' : finding.priority === 'medium' ? 'warning' : 'neutral'}>Prioridade {inspectionPriorityLabel[finding.priority].toLocaleLowerCase('pt-BR')}</Badge><span>{finding.area}</span></div>
          <h3>{finding.title}</h3>
          <FindingMeta finding={finding} />
          <div className={styles.actionFooter}><span className={styles.actionStatus}><span aria-hidden="true" className={finding.status === 'in-progress' ? styles.activeDot : styles.plannedDot} />{inspectionStatusLabel[finding.status]}</span><Button variant="ghost" onClick={() => setSelection({ type: 'finding', id: finding.id })} aria-label={`Ver achado: ${finding.title}`}>Ver achado<ArrowRight size={16} aria-hidden="true" /></Button></div>
          {following.includes(finding.id) && <span className={styles.following}><CheckCheck size={15} aria-hidden="true" />Em acompanhamento</span>}
        </article>)}
      </div>
    </motion.section>

    <motion.section className={styles.panel} variants={reveal} aria-labelledby="inspection-route-title">
      <div className={styles.sectionHeading}><div><h2 id="inspection-route-title">Roteiro de vistorias</h2></div><CalendarDays size={22} aria-hidden="true" /></div>
      <p className={styles.sectionDescription}>Locais visitados e itens conferidos.</p>
      <ul className={styles.visitList}>{inspectionVisits.map(visit => {
        const open = summary.openFindings.filter(finding => finding.inspectionId === visit.id).length;
        return <li key={visit.id}>
          <span className={styles.visitIcon}>{visit.status === 'completed' ? <CheckCircle2 size={20} aria-hidden="true" /> : <SearchCheck size={20} aria-hidden="true" />}</span>
          <div className={styles.visitDescription}><span>{visit.area} · {visit.schedule}</span><h3>{visit.title}</h3><p>{visit.checkedItems}/{visit.totalItems} itens conferidos · {open} {open === 1 ? 'achado em aberto' : 'achados em aberto'}</p></div>
          <Badge tone={visit.status === 'completed' ? 'success' : 'info'}>{visit.status === 'completed' ? 'Vistoria concluída' : 'Em vistoria'}</Badge>
          <Button variant="secondary" onClick={() => setSelection({ type: 'visit', id: visit.id })} aria-label={`Ver vistoria: ${visit.title}`}>Ver vistoria<ArrowRight size={16} aria-hidden="true" /></Button>
        </li>;
      })}</ul>
      <div className={styles.resourceFooter}><DestinationLinks can={can} /></div>
    </motion.section>

    <Modal open={!!selection} title={selectedFinding?.title ?? selectedVisit?.title ?? 'Detalhes da vistoria'} onClose={() => setSelection(null)}>
      <div className={styles.dialogContent}>
        {selectedFinding && <>
          <div className={styles.actionTags}><Badge tone={selectedFinding.priority === 'high' ? 'danger' : selectedFinding.priority === 'medium' ? 'warning' : 'neutral'}>Prioridade {inspectionPriorityLabel[selectedFinding.priority].toLocaleLowerCase('pt-BR')}</Badge><Badge tone="info">{inspectionStatusLabel[selectedFinding.status]}</Badge></div>
          <FindingMeta finding={selectedFinding} />
          <div className={styles.detailBlock}><h3>Observação</h3><p>{selectedFinding.observation}</p></div>
          <div className={styles.detailBlock}><h3>Próximo passo</h3><p>{selectedFinding.nextStep}</p></div>
          {tracked && <Feedback tone="success">Achado em acompanhamento.</Feedback>}
          <Button disabled={tracked} onClick={() => setFollowing(previous => previous.includes(selectedFinding.id) ? previous : [...previous, selectedFinding.id])}><CheckCheck size={17} aria-hidden="true" />{tracked ? 'Em acompanhamento' : 'Acompanhar'}</Button>
        </>}
        {selectedVisit && <>
          <dl className={styles.findingMeta}><div><dt>Área</dt><dd>{selectedVisit.area}</dd></div><div><dt>Responsável</dt><dd>{selectedVisit.owner}</dd></div><div><dt>Visita</dt><dd>{selectedVisit.schedule}</dd></div><div><dt>Itens conferidos</dt><dd>{selectedVisit.checkedItems} de {selectedVisit.totalItems}</dd></div><div><dt>Reinspeção</dt><dd>{selectedVisit.reinspection ?? 'A programar'}</dd></div></dl>
          <div className={styles.detailBlock}><h3>Achados desta vistoria</h3><ul className={styles.modalFindingList}>{inspectionFindings.filter(finding => finding.inspectionId === selectedVisit.id).map(finding => <li key={finding.id}><span>{finding.title}</span><Badge tone={finding.status === 'resolved' ? 'success' : 'info'}>{inspectionStatusLabel[finding.status]}</Badge></li>)}</ul></div>
          <p className={styles.sectionDescription}>Cada achado mantém seu próprio acompanhamento.</p>
        </>}
      </div>
    </Modal>
  </motion.section>;
}
