import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { Monitor, Sparkles, Waves } from 'lucide-react';
import styles from './MotionPreferences.module.css';

export type MotionPreference = 'system' | 'full' | 'reduced';
export const MOTION_PREFERENCE_KEY = 'ampara.motionPreference';
const mediaQuery = '(prefers-reduced-motion: reduce)';
type MotionPreferences = {
  preference: MotionPreference;
  setPreference: (preference: MotionPreference) => void;
  reduced: boolean;
  systemReduced: boolean;
};
const Context = createContext<MotionPreferences | null>(null);
const isPreference = (value: unknown): value is MotionPreference => value === 'system' || value === 'full' || value === 'reduced';

function readPreference(): MotionPreference {
  try { const value = window.localStorage.getItem(MOTION_PREFERENCE_KEY); return isPreference(value) ? value : 'system'; }
  catch { return 'system'; }
}
function systemReduced() { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(mediaQuery).matches; }
function subscribeSystem(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(mediaQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
function useSystemReduced() { return useSyncExternalStore(subscribeSystem, systemReduced, () => false); }

/** One explicit preference controls both CSS and JavaScript animation engines. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [preference, changePreference] = useState<MotionPreference>(readPreference);
  const deviceReduced = useSystemReduced();
  const reduced = preference === 'reduced' || preference === 'system' && deviceReduced;
  const setPreference = useCallback((next: MotionPreference) => {
    if (!isPreference(next)) return;
    changePreference(next);
    try { window.localStorage.setItem(MOTION_PREFERENCE_KEY, next); } catch { /* The current session remains usable with blocked storage. */ }
  }, []);
  useEffect(() => {
    function synchronize(event: StorageEvent) {
      if (event.key === MOTION_PREFERENCE_KEY || event.key === null) changePreference(event.key === null ? 'system' : isPreference(event.newValue) ? event.newValue : 'system');
    }
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousMotion = root.getAttribute('data-motion'), previousPreference = root.getAttribute('data-motion-preference');
    root.dataset.motion = reduced ? 'reduced' : 'full';
    root.dataset.motionPreference = preference;
    return () => {
      if (previousMotion === null) root.removeAttribute('data-motion'); else root.setAttribute('data-motion', previousMotion);
      if (previousPreference === null) root.removeAttribute('data-motion-preference'); else root.setAttribute('data-motion-preference', previousPreference);
    };
  }, [reduced, preference]);
  const value = useMemo(() => ({ preference, setPreference, reduced, systemReduced: deviceReduced }), [preference, setPreference, reduced, deviceReduced]);
  return <Context.Provider value={value}><MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig></Context.Provider>;
}

export function useMotionPreferences() {
  const context = useContext(Context);
  if (!context) throw new Error('MotionProvider não encontrado.');
  return context;
}

/** Standalone components and tests retain the device default outside the app provider. */
export function useAppReducedMotion() {
  const context = useContext(Context);
  const deviceReduced = useSystemReduced();
  return context?.reduced ?? deviceReduced;
}

const choices = [
  { value: 'full', title: 'Completas', description: 'Transições de telas, entrada de cartões e respostas ao passar o mouse.', Icon: Sparkles },
  { value: 'reduced', title: 'Reduzidas', description: 'Uma interface estável, com os efeitos de movimento desativados.', Icon: Waves },
  { value: 'system', title: 'Seguir dispositivo', description: 'Usa a preferência de movimento do seu navegador ou dispositivo.', Icon: Monitor },
] as const;

export function MotionPreferencesContent() {
  const { preference, setPreference, reduced, systemReduced: deviceReduced } = useMotionPreferences();
  const id = useId();
  return <div className={styles.root}>
    <p className={styles.description}>Escolha como a interface acompanha suas ações. A preferência fica salva neste navegador.</p>
    <fieldset className={styles.choices}>
      <legend className="sr-only">Intensidade das animações</legend>
      {choices.map(({ value, title, description, Icon }) => <label key={value} className={styles.choice}>
        <input type="radio" name={`${id}-motion`} value={value} checked={preference === value} onChange={() => setPreference(value)} />
        <span className={styles.icon} aria-hidden="true"><Icon size={20} /></span>
        <span><strong>{title}</strong><small>{description}</small></span>
      </label>)}
    </fieldset>
    <p className={styles.status} role="status">{reduced ? 'Animações reduzidas neste navegador.' : 'Animações completas neste navegador.'}{preference === 'system' && deviceReduced && ' O dispositivo está solicitando movimento reduzido. Se desejar ver as transições, selecione Completas.'}</p>
  </div>;
}
