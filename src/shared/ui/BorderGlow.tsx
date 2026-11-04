'use client';

import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useAppReducedMotion } from '../motion/MotionPreferences';
import styles from './BorderGlow.module.css';

type GlowVariables = CSSProperties & Record<`--${string}`, string | number>;
type AnimationOptions = {
  start?: number; end?: number; duration?: number; delay?: number;
  ease?: (value: number) => number; onUpdate: (value: number) => void; onEnd?: () => void;
};
export type BorderGlowProps = {
  children: ReactNode; className?: string; edgeSensitivity?: number; glowColor?: string;
  backgroundColor?: string; borderRadius?: number; glowRadius?: number; glowIntensity?: number;
  coneSpread?: number; animated?: boolean; colors?: readonly string[]; fillOpacity?: number;
};

const defaultColors = ['#c084fc', '#f472b6', '#38bdf8'];
const gradientPositions = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const gradientKeys = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'] as const;
const colorMap = [0, 1, 2, 0, 1, 2, 1];
const pointerQuery = '(hover: hover) and (pointer: fine)';

function buildGlowVars(color: string, intensity: number): GlowVariables {
  const match = color.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  const [h, s, l] = match ? match.slice(1).map(Number) : [40, 80, 80];
  const variables: GlowVariables = {};
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  opacities.forEach((opacity, index) => {
    variables[`--glow-color${keys[index]}`] = `hsl(${h}deg ${s}% ${l}% / ${Math.max(0, Math.min(opacity * intensity, 100))}%)`;
  });
  return variables;
}

function buildGradientVars(colors: readonly string[]): GlowVariables {
  const palette = colors.length ? colors : defaultColors;
  const variables: GlowVariables = {};
  gradientKeys.forEach((key, index) => {
    variables[key] = `radial-gradient(at ${gradientPositions[index]}, ${palette[Math.min(colorMap[index], palette.length - 1)]} 0px, transparent 50%)`;
  });
  variables['--gradient-base'] = `linear-gradient(${palette[0]} 0 100%)`;
  return variables;
}

function isLightColor(color: string) {
  const value = color.trim().replace('#', '');
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(value)) return false;
  const hex = value.length === 3 ? value.split('').map(character => character + character).join('') : value;
  const red = parseInt(hex.slice(0, 2), 16), green = parseInt(hex.slice(2, 4), 16), blue = parseInt(hex.slice(4, 6), 16);
  return red * .2126 + green * .7152 + blue * .0722 > 180;
}

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
const easeInCubic = (value: number) => value * value * value;

/** The supplied sweep animation, with cancellation on unmount or preference change. */
function animateValue({ start = 0, end = 100, duration = 1000, delay = 0, ease = easeOutCubic, onUpdate, onEnd }: AnimationOptions) {
  let frame = 0;
  let canceled = false;
  const timer = window.setTimeout(() => {
    const startedAt = performance.now();
    function tick(now: number) {
      if (canceled) return;
      const progress = Math.min(Math.max((now - startedAt) / duration, 0), 1);
      onUpdate(start + (end - start) * ease(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else onEnd?.();
    }
    frame = requestAnimationFrame(tick);
  }, delay);
  return () => { canceled = true; window.clearTimeout(timer); cancelAnimationFrame(frame); };
}

/** BorderGlow supplied by the user, adapted to TypeScript and local CSS Modules. */
export function BorderGlow({ children, className = '', edgeSensitivity = 30, glowColor = '40 80 80', backgroundColor = '#120F17', borderRadius = 28, glowRadius = 40, glowIntensity = 1, coneSpread = 25, animated = false, colors = defaultColors, fillOpacity = .5 }: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useAppReducedMotion();

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card || reduceMotion || event.pointerType !== 'mouse' || !window.matchMedia(pointerQuery).matches) return;
    const bounds = card.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const centerX = bounds.width / 2, centerY = bounds.height / 2;
    const dx = x - centerX, dy = y - centerY;
    const kx = dx === 0 ? Infinity : centerX / Math.abs(dx);
    const ky = dy === 0 ? Infinity : centerY / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    let angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  }, [reduceMotion]);

  const resetPointer = useCallback(() => { cardRef.current?.style.setProperty('--edge-proximity', '0'); }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (!animated || reduceMotion) { resetPointer(); return; }
    const angleStart = 110, angleEnd = 465;
    card.classList.add(styles.sweepActive);
    card.style.setProperty('--cursor-angle', `${angleStart}deg`);
    const setAngle = (value: number) => card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`);
    const stop = [
      animateValue({ duration: 500, onUpdate: value => card.style.setProperty('--edge-proximity', String(value)) }),
      animateValue({ ease: easeInCubic, duration: 1500, end: 50, onUpdate: setAngle }),
      animateValue({ delay: 1500, duration: 2250, start: 50, end: 100, onUpdate: setAngle }),
      animateValue({ ease: easeInCubic, delay: 2500, duration: 1500, start: 100, end: 0, onUpdate: value => card.style.setProperty('--edge-proximity', String(value)), onEnd: () => card.classList.remove(styles.sweepActive) }),
    ];
    return () => { stop.forEach(cancel => cancel()); card.classList.remove(styles.sweepActive); resetPointer(); };
  }, [animated, reduceMotion, resetPointer]);

  const variables: GlowVariables = {
    '--card-bg': backgroundColor, '--edge-sensitivity': Math.max(0, Math.min(edgeSensitivity, 79)),
    '--border-radius': `${borderRadius}px`, '--glow-padding': `${glowRadius}px`, '--cone-spread': coneSpread,
    '--fill-opacity': fillOpacity, ...buildGlowVars(glowColor, glowIntensity), ...buildGradientVars(colors),
  };

  return <div ref={cardRef} onPointerEnter={handlePointerMove} onPointerMove={handlePointerMove} onPointerLeave={resetPointer} onPointerCancel={resetPointer} className={`${styles.root} ${isLightColor(backgroundColor) ? styles.light : ''} ${className}`} style={variables}>
    <span className={styles.edgeLight} aria-hidden="true" />
    <div className={styles.inner}>{children}</div>
  </div>;
}

export default BorderGlow;
