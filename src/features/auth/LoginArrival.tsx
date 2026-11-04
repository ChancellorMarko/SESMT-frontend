import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import styles from './AuthPages.module.css';

export type LoginArrivalPhase = 'loading' | 'leaving' | 'ready';

/** A bounded welcome on route entry; authentication changes never restart it. */
export function useLoginArrival(): LoginArrivalPhase {
  const reduced = useAppReducedMotion();
  const finished = useRef(reduced);
  const [phase, setPhase] = useState<LoginArrivalPhase>(reduced ? 'ready' : 'loading');
  useEffect(() => {
    if (finished.current) return;
    if (reduced) {
      finished.current = true;
      setPhase('ready');
      return;
    }
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setPhase('leaving');
      exitTimer = setTimeout(() => {
        finished.current = true;
        setPhase('ready');
      }, 320);
    }, 900);
    return () => { clearTimeout(timer); clearTimeout(exitTimer); };
  }, [reduced]);
  return phase;
}

export function LoginPreloader({ leaving }: { leaving: boolean }) {
  return <div className={styles.preloader} data-testid="login-preloader" data-leaving={leaving || undefined} role="status" aria-live="polite" aria-atomic="true">
    <div className={styles.preloaderGlow} aria-hidden="true" />
    <div className={styles.preloaderIdentity}>
      <BrandLogo priority className={styles.preloaderLogo} />
      <div className={styles.preloaderTrack} aria-hidden="true"><span /></div>
      <p>Preparando seu espaço.</p>
      <span className="sr-only">Carregando o acesso à Ampara.</span>
    </div>
  </div>;
}
