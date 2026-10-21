import { useId } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, ClipboardCheck, HardHat, HeartPulse, ShieldCheck } from 'lucide-react';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import styles from './DashboardHero.module.css';

type HeroVariant = 'overview' | 'inspecoes' | 'saude' | 'epis';
type HeroProps = {
  variant: HeroVariant;
  title: string;
  description: string;
  action?: { label: string; to: string };
  back?: boolean;
};

const content = {
  overview: { eyebrow: 'SEU ESPAÇO DE SEGURANÇA', note: 'Conectar o cuidado à operação.', icon: ShieldCheck },
  inspecoes: { eyebrow: 'OLHAR ATENTO. PRÓXIMO PASSO CLARO.', note: 'Observar. Registrar. Acompanhar.', icon: ClipboardCheck },
  saude: { eyebrow: 'CUIDADO QUE ACOMPANHA PESSOAS', note: 'Documentos e capacitações, lado a lado.', icon: HeartPulse },
  epis: { eyebrow: 'PROTEÇÃO EM CADA DETALHE', note: 'Da entrega ao acompanhamento.', icon: HardHat },
};

/** Decorative product illustrations. They never encode a score, completion or authorization. */
function HeroArtwork({ variant }: { variant: HeroVariant }) {
  const id = useId();
  const reduce = useAppReducedMotion();
  const paint = (name: string) => `url(#${id}-${name})`;
  return <svg viewBox="0 0 340 280" fill="none" aria-hidden="true" focusable="false" className={styles.illustration}>
    <defs>
      <linearGradient id={`${id}-surface`} x1="90" y1="48" x2="241" y2="237" gradientUnits="userSpaceOnUse"><stop stopColor="#fffefa" /><stop offset="1" stopColor="#b9d2ff" /></linearGradient>
      <linearGradient id={`${id}-blue`} x1="105" y1="67" x2="250" y2="229" gradientUnits="userSpaceOnUse"><stop stopColor="#88b2ff" /><stop offset=".5" stopColor="#4679ee" /><stop offset="1" stopColor="#234fbe" /></linearGradient>
      <linearGradient id={`${id}-edge`} x1="110" y1="51" x2="247" y2="237" gradientUnits="userSpaceOnUse"><stop stopColor="#d2e2ff" /><stop offset="1" stopColor="#668fe0" /></linearGradient>
      <linearGradient id={`${id}-glass`} x1="59" y1="81" x2="274" y2="225" gradientUnits="userSpaceOnUse"><stop stopColor="#c0d7ff" stopOpacity=".25" /><stop offset="1" stopColor="#6e9dff" stopOpacity=".03" /></linearGradient>
      <radialGradient id={`${id}-halo`}><stop stopColor="#76a9ff" stopOpacity=".23" /><stop offset="1" stopColor="#76a9ff" stopOpacity="0" /></radialGradient>
    </defs>
    <circle cx="172" cy="144" r="132" fill={paint('halo')} />
    <ellipse cx="174" cy="232" rx="92" ry="13" fill="#071b38" opacity=".3" />
    <ellipse cx="171" cy="153" rx="143" ry="104" stroke="#a0c2ff" strokeOpacity=".13" transform="rotate(-23 171 153)" />
    <ellipse cx="171" cy="153" rx="117" ry="83" stroke="#a0c2ff" strokeOpacity=".09" transform="rotate(-23 171 153)" />
    <path d="m39 167 15-9m230-72 15-9M71 71l8 4m182 153 8 4" stroke="#b7d0ff" strokeOpacity=".4" strokeWidth="2" strokeLinecap="round" />
    <circle cx="65" cy="191" r="4" fill="#88b1ff" /><circle cx="281" cy="119" r="3" fill="#d3e5ff" />
    <circle cx="251" cy="59" r="5" stroke="#adcaff" strokeOpacity=".6" />
    <motion.g initial={false} animate={reduce ? { y: 0 } : { y: [0, -5, 0] }} transition={reduce ? { duration: 0 } : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
      {variant === 'overview' && <>
        <path d="m171 51 76 29v66c0 42-29 76-76 96-47-20-76-54-76-96V80l76-29Z" fill={paint('glass')} stroke="#aacaff" strokeOpacity=".23" />
        <path d="m171 66 61 23v54c0 35-23 63-61 80-38-17-61-45-61-80V89l61-23Z" fill={paint('edge')} />
        <path d="m166 62 61 23v54c0 35-23 63-61 80-38-17-61-45-61-80V85l61-23Z" fill={paint('surface')} />
        <path d="m166 81 44 17v40c0 26-16 47-44 61-28-14-44-35-44-61V98l44-17Z" fill={paint('blue')} />
        <path d="m145 137 15 15 30-33" stroke="#fffefa" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m133 104 29-11" stroke="#dce9ff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
        <g transform="translate(235 177) rotate(9)"><rect width="51" height="42" rx="12" fill="#234f86" stroke="#8fb9ff" strokeOpacity=".45" /><path d="M13 26v-6m12 6V12m12 14V8" stroke="#c8ddff" strokeWidth="4" strokeLinecap="round" /></g>
      </>}
      {variant === 'inspecoes' && <>
        <g transform="translate(102 56) rotate(-8 72 84)">
          <rect x="8" y="8" width="139" height="172" rx="18" fill="#4e79bd" />
          <rect width="139" height="172" rx="18" fill={paint('surface')} />
          <rect x="40" y="-7" width="59" height="27" rx="9" fill="#86a8df" />
          <rect x="47" y="-4" width="45" height="17" rx="6" fill="#dbe7fa" />
          <rect x="20" y="43" width="27" height="27" rx="8" fill="#d5e3fa" /><path d="m27 56 5 5 9-11" stroke="#4679ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 49h47M60 62h31" stroke="#9cb7df" strokeWidth="5" strokeLinecap="round" />
          <rect x="20" y="85" width="27" height="27" rx="8" fill="#d5e3fa" /><path d="m27 98 5 5 9-11" stroke="#4679ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 91h47M60 104h36" stroke="#9cb7df" strokeWidth="5" strokeLinecap="round" />
          <path d="M23 138h83m-83 12h55" stroke="#c7d7ed" strokeWidth="4" strokeLinecap="round" />
        </g>
        <circle cx="246" cy="180" r="32" fill={paint('blue')} stroke="#9cbfff" strokeWidth="2" />
        <circle cx="246" cy="180" r="13" stroke="#fffefa" strokeWidth="4" /><path d="m256 190 9 9" stroke="#fffefa" strokeWidth="5" strokeLinecap="round" />
        <path d="M80 113v23m-11-12h23" stroke="#b8d2ff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
      </>}
      {variant === 'saude' && <>
        <g transform="translate(95 57) rotate(-11 74 89)"><rect x="9" y="9" width="140" height="171" rx="17" fill="#4f7bc1" /><rect width="140" height="171" rx="17" fill={paint('edge')} /><path d="M25 32h55M25 49h86" stroke="#d9e7ff" strokeWidth="5" strokeLinecap="round" /></g>
        <g transform="translate(115 73) rotate(8 68 81)"><rect x="7" y="6" width="132" height="161" rx="17" fill="#4c70aa" /><rect width="132" height="161" rx="17" fill={paint('surface')} /><rect x="18" y="20" width="39" height="6" rx="3" fill="#a5bfdf" /><path d="M18 39h80M18 51h55M18 126h80M18 138h51" stroke="#c2d4eb" strokeWidth="4" strokeLinecap="round" /><path d="M15 91h22l12-19 15 36 13-22h37" stroke="#4679ee" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>
        <circle cx="240" cy="66" r="27" fill={paint('blue')} stroke="#a2c2ff" strokeWidth="2" /><path d="M240 55v22m-11-11h22" stroke="#fffefa" strokeWidth="5" strokeLinecap="round" />
        <path d="m69 189 6 6 13-14" stroke="#b8d2ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />
      </>}
      {variant === 'epis' && <>
        <path d="m90 167 30-91 89-19 47 72-36 79-87 12-43-53Z" fill={paint('glass')} stroke="#a9c8ff" strokeOpacity=".19" />
        <path d="M95 174c0-57 30-96 77-96 48 0 78 39 78 96" fill={paint('edge')} />
        <path d="M101 170c0-54 28-90 71-90 45 0 72 36 72 90" fill={paint('surface')} />
        <path d="M164 75h17v104h-17V75Z" fill={paint('blue')} />
        <path d="M140 91c-18 14-27 38-28 66m89-66c18 14 27 38 28 66" stroke="#a5c3ef" strokeWidth="5" strokeLinecap="round" />
        <path d="M89 167h165c9 0 15 9 10 17-13 19-43 31-92 31-45 0-76-11-91-28-8-9-3-20 8-20Z" fill={paint('blue')} />
        <path d="M89 168h165c4 0 5 4 2 6-19 12-139 13-168 1-4-2-3-7 1-7Z" fill="#8fb7ff" />
        <path d="M113 125c5-12 13-23 23-29" stroke="#fffefa" strokeWidth="6" strokeLinecap="round" />
        <g transform="translate(238 187) rotate(-9)"><rect width="50" height="38" rx="11" fill="#234f86" stroke="#8fb9ff" strokeOpacity=".45" /><path d="m14 18 7 7 14-15" stroke="#cfE1ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>
      </>}
    </motion.g>
  </svg>;
}

export function DashboardHero({ variant, title, description, action, back = false }: HeroProps) {
  const reduce = useAppReducedMotion();
  const presentation = content[variant];
  return <motion.header className={[styles.hero, styles[variant]].filter(Boolean).join(' ')} data-motion-managed="true" initial={reduce ? false : { opacity: .35, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .65, ease: [.22, 1, .36, 1] }}>
    <div className={styles.copy}>
      <div className={styles.topline}>
        {back && <Link to="/app/dashboard" className={styles.back}><ArrowLeft size={14} aria-hidden="true" />Visão geral</Link>}
        <p className={styles.eyebrow}><span className={styles.mark}><presentation.icon size={14} aria-hidden="true" /></span>{presentation.eyebrow}</p>
      </div>
      <h1>{title}</h1>
      <p className={styles.description}>{description}</p>
      {action && <Link className={`button button--secondary ${styles.action}`} to={action.to}>{action.label}<ArrowUpRight size={16} aria-hidden="true" /></Link>}
    </div>
    <motion.div className={styles.art} initial={reduce ? false : { opacity: 0, x: 20, rotate: -3 }} animate={{ opacity: 1, x: 0, rotate: 0 }} transition={{ duration: reduce ? 0 : .9, delay: reduce ? 0 : .08, ease: [.22, 1, .36, 1] }}><HeroArtwork variant={variant} /><p>{presentation.note}</p></motion.div>
  </motion.header>;
}
