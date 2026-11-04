import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { InfoButton } from '../../shared/ui';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import styles from './DashboardHero.module.css';

type HeroProps = {
  variant: 'overview' | 'inspecoes' | 'saude' | 'epis';
  title: string;
  description: string;
  action?: { label: string; to: string };
  back?: boolean;
};

export function DashboardHero({ title, description, action, back = false }: HeroProps) {
  const reduce = useAppReducedMotion();
  return <motion.header className={styles.hero} data-motion-managed="true" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .25 }}>
    <div className={styles.copy}>
      {back && <Link to="/app/dashboard" className={styles.back}><ArrowLeft size={14} aria-hidden="true" />Visão geral</Link>}
      <div className="page-heading"><h1>{title}</h1><InfoButton title={title}><p>{description}</p></InfoButton></div>
    </div>
    {action && <Link className="button button--secondary" to={action.to}>{action.label}<ArrowUpRight size={16} aria-hidden="true" /></Link>}
  </motion.header>;
}
