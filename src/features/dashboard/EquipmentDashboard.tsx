import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowUpRight, CheckCheck, ClipboardCheck, FileCheck2, Glasses, Hand, HardHat, PackageCheck, Unplug } from 'lucide-react';
import { API_MODE } from '../../shared/api/client';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { Badge, Button, Modal } from '../../shared/ui';
import { AnimatedNumber } from '../../shared/ui/animated-number';
import { Progress } from '../../shared/ui/progress';
import styles from './EquipmentDashboard.module.css';

// One synthetic cycle: each pending record appears in exactly one conference below.
const conferences = [
  { id: 'EPI-01', category: 'Capacetes', icon: HardHat, team: 'Equipe de manutenção', confirmed: 40, expected: 43, next: 'Conferir comprovantes de entrega', detail: 'Compare o recebimento e o comprovante correspondente para os três registros pendentes deste lote.' },
  { id: 'EPI-02', category: 'Luvas de proteção', icon: Hand, team: 'Equipe operacional', confirmed: 30, expected: 33, next: 'Revisar registros de substituição', detail: 'Confira a documentação de substituição dos três registros pendentes deste lote.' },
  { id: 'EPI-03', category: 'Óculos de proteção', icon: Glasses, team: 'Equipe de apoio', confirmed: 22, expected: 24, next: 'Conferir identificação dos comprovantes', detail: 'Confira a identificação dos dois registros pendentes deste lote.' },
];
const expected = conferences.reduce((total, item) => total + item.expected, 0);
const confirmed = conferences.reduce((total, item) => total + item.confirmed, 0);
const completion = Math.round(confirmed / expected * 100);

export function EquipmentDashboard({ can }: { can: (permission: string) => boolean }) {
  const reduce = useAppReducedMotion();
  const demo = API_MODE === 'demo';
  const [selected, setSelected] = useState<typeof conferences[number] | null>(null);
  const [followed, setFollowed] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'following'>('all');
  const allFilter = useRef<HTMLButtonElement>(null);
  const followingFilter = useRef<HTMLButtonElement>(null);
  const returnToFilter = useRef(false);
  const selectedFollowed = Boolean(selected && followed.includes(selected.id));
  // Keep an open dialog's trigger mounted until it closes, even after its filter no longer matches.
  const visibleConferences = conferences.filter(item => filter === 'all' || followed.includes(item.id) || selected?.id === item.id);
  useLayoutEffect(() => {
    if (!selected && returnToFilter.current) { returnToFilter.current = false; followingFilter.current?.focus(); }
  }, [selected]);
  function closeDetails() {
    returnToFilter.current = Boolean(filter === 'following' && selected && !followed.includes(selected.id));
    setSelected(null);
  }
  function showAll() { setFilter('all'); allFilter.current?.focus(); }
  const reveal = {
    initial: reduce ? false as const : { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0 : .6, ease: [.22, 1, .36, 1] as const },
  };
  const links = <div className={styles.links}>
    {can('documents.read') && <Link to="/app/documentos?q=EPI">Consultar comprovantes cadastrados<ArrowUpRight size={15} aria-hidden="true" /></Link>}
    {can('eligibility.read') && <Link to="/app/pendencias">Conferir requisitos por participante<ArrowUpRight size={15} aria-hidden="true" /></Link>}
  </div>;

  return <section className={styles.dashboard} data-motion-managed="true" aria-label="Painel de equipamentos de proteção">
    {demo ? <>
      <div className={styles.metrics}>
        {[
          { title: 'Entregas previstas', value: expected, caption: 'Registros previstos', icon: HardHat },
          { title: 'Comprovantes conferidos', value: confirmed, caption: `${completion}% dos registros previstos`, icon: FileCheck2 },
          { title: 'Registros a conferir', value: expected - confirmed, caption: 'Distribuídos nas três categorias', icon: ClipboardCheck, important: true },
          { title: 'Categorias do ciclo', value: conferences.length, caption: 'Capacetes, luvas e óculos', icon: PackageCheck },
        ].map(item => <motion.article key={item.title} {...reveal} whileHover={reduce ? undefined : { y: -6, scale: 1.01 }} className={`${styles.metric} ${item.important ? styles.metricImportant : ''}`}>
          <div className={styles.metricHeading}><h2>{item.title}</h2><item.icon size={18} aria-hidden="true" /></div><strong><AnimatedNumber value={item.value} /></strong><p>{item.caption}</p>
        </motion.article>)}
      </div>
      <div className={styles.columns}>
        <motion.section {...reveal} className={styles.card} aria-labelledby="equipment-deliveries">
          <header><h2 id="equipment-deliveries">Entregas e comprovantes</h2><p>O que já foi conferido e o que falta em cada categoria.</p></header>
          <div className={styles.total}><strong>{completion}<span>%</span></strong><p>do ciclo com comprovante conferido<small>{confirmed} de {expected} registros</small></p></div>
          <div className={styles.categories}>{conferences.map(item => <div className={styles.category} key={item.id}>
            <div><strong><item.icon size={16} aria-hidden="true" />{item.category}</strong><span>{item.confirmed} / {item.expected}</span></div>
            <Progress value={Math.round(item.confirmed / item.expected * 100)} aria-label={`Comprovantes conferidos: ${item.category}`} aria-valuetext={`${item.confirmed} de ${item.expected} registros`} indicatorClassName={styles.progress} />
            <p>{item.expected - item.confirmed} registros aguardam conferência</p>
          </div>)}</div>
          <p className={styles.note}>Cada comprovante é contado uma vez. Uma conferência documental não comprova adequação do equipamento à atividade.</p>
        </motion.section>
        <motion.section {...reveal} className={`${styles.card} ${styles.queue}`} aria-labelledby="equipment-conferences">
          <header className={styles.queueHeader}><div><h2 id="equipment-conferences">Conferências de EPIs</h2><p>Organize os oito registros pendentes por lote e equipe.</p></div><span className={styles.queueMark} aria-hidden="true"><ClipboardCheck size={22} /></span></header>
          <div className={styles.filters} role="group" aria-label="Filtrar lotes de EPIs">
            <button ref={allFilter} type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos os lotes<span aria-hidden="true">{conferences.length}</span></button>
            <button ref={followingFilter} type="button" aria-pressed={filter === 'following'} onClick={() => setFilter('following')}>Em acompanhamento<span aria-hidden="true">{followed.length}</span></button>
          </div>
          <p role="status" className={styles.filterResult}>{filter === 'all' ? `${conferences.length} lotes para organizar` : `${followed.length} ${followed.length === 1 ? 'lote em acompanhamento' : 'lotes em acompanhamento'}`}</p>
          <div className={styles.rows}>{visibleConferences.length ? visibleConferences.map(item => <motion.article layout={!reduce} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .25 }} className={styles.row} key={item.id}>
            <div className={styles.rowTop}><div className={styles.lotIdentity}><span className={styles.lotIcon} aria-hidden="true"><item.icon size={18} /></span><div><strong>{item.category}</strong><span>{item.id}</span></div></div><Badge tone="warning">{item.expected - item.confirmed} a conferir</Badge></div>
            <h3>{item.next}</h3><p>{item.team}</p>
            <div className={styles.rowFooter}>{followed.includes(item.id) ? <span className={styles.followed}><CheckCheck size={14} aria-hidden="true" />Em acompanhamento</span> : <span className={styles.pending}>Conferência pendente</span>}
              <Button variant="ghost" onClick={() => setSelected(item)} aria-label={`Ver conferência: ${item.category}`}>Ver conferência<ArrowUpRight size={14} aria-hidden="true" /></Button>
            </div>
          </motion.article>) : <div className={styles.empty}><span aria-hidden="true"><CheckCheck size={24} /></span><h3>Nenhum lote em acompanhamento</h3><p>Abra um lote e acompanhe os próximos passos para encontrá-lo aqui. A conferência continua pendente.</p><Button variant="secondary" onClick={showAll}>Ver todos os lotes<ArrowUpRight size={14} aria-hidden="true" /></Button></div>}</div>
        </motion.section>
      </div>
      {links}
    </> : <motion.div {...reveal} className={`${styles.card} ${styles.disconnected}`}><Unplug size={28} aria-hidden="true" /><h2>Sem entregas disponíveis</h2><p>Consulte os comprovantes e requisitos disponíveis.</p>{links}</motion.div>}
    <Modal open={demo && Boolean(selected)} title={selected ? `Conferência de ${selected.category.toLowerCase()}` : 'Conferência de EPIs'} onClose={closeDetails}>
      {selected && <div className={styles.details}><Badge tone="info">{selected.id}</Badge><p>{selected.detail}</p><p><strong>Equipe:</strong> {selected.team}</p>
        <p role="status" className={selectedFollowed ? styles.success : styles.followupStatus}>{selectedFollowed && <CheckCheck size={17} aria-hidden="true" />}{selectedFollowed ? 'Lote em acompanhamento.' : 'Conferência pendente.'}</p>
        <div className={styles.detailActions}><Button variant={selectedFollowed ? 'secondary' : 'primary'} onClick={() => setFollowed(current => current.includes(selected.id) ? current.filter(id => id !== selected.id) : [...current, selected.id])}>{selectedFollowed ? 'Retirar acompanhamento' : 'Acompanhar'}</Button><Button variant="secondary" onClick={closeDetails}>Fechar</Button></div>
      </div>}
    </Modal>
  </section>;
}
