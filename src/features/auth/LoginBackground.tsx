import { useId } from 'react';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import styles from './LoginBackground.module.css';

/** Decorative React surface; no images, pointer listeners or animation timers. */
export function LoginBackground() {
  const patternId = useId();
  const reducedMotion = useAppReducedMotion();
  return <div className={styles.background} data-login-background data-reduced={reducedMotion} aria-hidden="true">
    <div className={styles.wash} />
    <svg className={styles.grid} viewBox="0 0 1440 960" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <pattern id={patternId} width="72" height="72" patternUnits="userSpaceOnUse">
          <path d="M72 0H0V72" fill="none" stroke="currentColor" strokeWidth=".75" />
        </pattern>
      </defs>
      <rect width="1440" height="960" fill={`url(#${patternId})`} />
      <g className={styles.cells} fill="currentColor">
        <rect x="144" y="144" width="72" height="72" />
        <rect x="432" y="72" width="72" height="72" />
        <rect x="72" y="576" width="72" height="72" />
        <rect x="504" y="720" width="72" height="72" />
        <rect x="1080" y="216" width="72" height="72" />
      </g>
      <path className={styles.contour} d="M-120 780C220 780 210 420 560 420S980 110 1560 110" fill="none" stroke="currentColor" strokeWidth="1" />
      <path className={styles.contour} d="M-120 824C264 824 254 464 604 464S1024 154 1560 154" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  </div>;
}
