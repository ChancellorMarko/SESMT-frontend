import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';
import { useAppReducedMotion } from '../motion/MotionPreferences';
import { cn } from '../lib/cn';

export function AnimatedNumber({ value, suffix = '', duration = 1.1, className }: { value: number; suffix?: string; duration?: number; className?: string }) {
  const reduceMotion = useAppReducedMotion();
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat('pt-BR').format(safeValue);
  useEffect(() => {
    if (reduceMotion) { if (element.current) element.current.textContent = formatted; previous.current = safeValue; return; }
    const animation = animate(previous.current, safeValue, {
      duration, ease: [0.22, 1, 0.36, 1],
      onUpdate: current => { if (element.current) element.current.textContent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(current); },
    });
    previous.current = safeValue;
    return () => animation.stop();
  }, [safeValue, formatted, duration, reduceMotion]);
  return <span className={cn('tabular-nums', className)}><span className="sr-only">{formatted}{suffix}</span><span aria-hidden="true"><span ref={element}>{formatted}</span>{suffix}</span></span>;
}
