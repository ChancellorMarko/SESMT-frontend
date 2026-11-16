import type { CSSProperties } from 'react';
import { Flame, HardHat, HeartPulse, type LucideIcon } from 'lucide-react';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import styles from './LoginBackground.module.css';

const ink = '#183b68';
const ring = 2 * Math.PI * 52;
const status = [
  { label: 'Em dia', color: '#5fd39a' },
  { label: 'Vencendo', color: '#f6b93b' },
  { label: 'Vencidos', color: '#f07a66' },
];
const deadlines: { title: string; detail: string; due: string; icon: LucideIcon; tint: string; tone: string; pill: string; pillText: string }[] = [
  { title: 'Trabalho em altura', detail: 'Treinamento', due: '5 dias', icon: HardHat, tint: '#e8f0fe', tone: '#2f6fe4', pill: '#fdf1d8', pillText: '#8f6200' },
  { title: 'Exame médico', detail: '3 pessoas', due: '12 dias', icon: HeartPulse, tint: '#e4f6ee', tone: '#1f9d6b', pill: '#e8f0fe', pillText: '#2f5fb8' },
  { title: 'Extintores', detail: 'Revisão', due: 'Hoje', icon: Flame, tint: '#fde9e5', tone: '#d9482f', pill: '#fde9e5', pillText: '#b93620' },
];

/** Decorative preview of the product: unit status, people and upcoming deadlines. No images, pointer listeners or timers. */
export function LoginBackground({ ready = true }: { ready?: boolean }) {
  const reducedMotion = useAppReducedMotion();
  const step = (index: number) => ({ '--i': index }) as CSSProperties;
  return <div className={styles.background} data-login-background data-ready={ready} data-reduced={reducedMotion} aria-hidden="true">
    <svg className={styles.art} viewBox="0 0 640 540" preserveAspectRatio="xMidYMid meet" focusable="false">
      <g className={styles.enter} style={step(0)}>
        <rect className={styles.deep} x="40" y="40" width="300" height="250" rx="24" fill={ink} />
        <text x="68" y="82" fill="#b9cbe3" fontSize="14">Situação da unidade</text>
        <circle cx="130" cy="180" r="52" fill="none" stroke="#ffffff22" strokeWidth="14" />
        <circle className={styles.ring} cx="130" cy="180" r="52" fill="none" stroke="#5fd39a" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${ring * .92} ${ring}`} transform="rotate(-90 130 180)" style={{ '--ring': ring * .92 } as CSSProperties} />
        <text x="130" y="189" fill="#fff" fontSize="26" fontWeight="600" textAnchor="middle">92%</text>
        {status.map((item, index) => <g key={item.label}>
          <circle cx="222" cy={150 + index * 30} r="5" fill={item.color} />
          <text x="236" y={155 + index * 30} fill="#dfe8f5" fontSize="13.5">{item.label}</text>
        </g>)}
      </g>
      <g className={styles.enter} style={step(1)}><g className={styles.float}>
        <rect className={styles.paper} x="372" y="84" width="232" height="66" rx="18" />
        <circle cx="406" cy="117" r="17" fill="#27a57a" />
        <path d="m398 117.500 5.500 5.500 10.500-11" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="434" y="113" fill={ink} fontSize="13.5" fontWeight="600">Documento aprovado</text>
        <text x="434" y="131" fill="#7d8ba0" fontSize="11.500">agora mesmo</text>
      </g></g>
      <g className={styles.enter} style={step(2)}><g className={styles.float} style={step(3)}>
        <rect className={styles.paper} x="384" y="174" width="212" height="54" rx="27" />
        {['#3b7bf0', '#f6b93b', '#27a57a'].map((color, index) => <circle key={color} cx={413 + index * 25} cy="201" r="17" fill={color} stroke="#fff" strokeWidth="3" />)}
        <text x="492" y="206" fill={ink} fontSize="13.5" fontWeight="600">128 pessoas</text>
      </g></g>
      <g className={styles.enter} style={step(3)}>
        <rect className={styles.paper} x="230" y="252" width="374" height="248" rx="22" />
        <text x="258" y="292" fill={ink} fontSize="15" fontWeight="600">Próximos prazos</text>
        {deadlines.map(({ icon: Icon, ...item }, index) => {
          const y = 314 + index * 56;
          return <g key={item.title} className={styles.row} style={step(index)}>
            <rect x="258" y={y} width="40" height="40" rx="12" fill={item.tint} />
            <Icon x={268} y={y + 10} size={20} strokeWidth={1.9} color={item.tone} />
            <text x="312" y={y + 17} fill="#24364f" fontSize="13.5" fontWeight="600">{item.title}</text>
            <text x="312" y={y + 34} fill="#7d8ba0" fontSize="11.500">{item.detail}</text>
            <rect x="506" y={y + 7} width="72" height="26" rx="13" fill={item.pill} />
            <text x="542" y={y + 24.500} fill={item.pillText} fontSize="12" fontWeight="600" textAnchor="middle">{item.due}</text>
          </g>;
        })}
      </g>
    </svg>
  </div>;
}
