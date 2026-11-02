import type { ComponentProps } from 'react';
import { motion } from 'framer-motion';
import { useAppReducedMotion } from '../motion/MotionPreferences';
import { cn } from '../lib/cn';

export function Progress({ value, className, indicatorClassName, ...props }: Omit<ComponentProps<'div'>, 'children'> & { value: number | null; indicatorClassName?: string }) {
  const reduceMotion = useAppReducedMotion();
  const percentage = value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
  return <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={percentage === undefined ? 'Sem dados disponíveis' : `${percentage}%`} className={cn('h-2.5 w-full overflow-hidden rounded-full bg-slate-100', className)} {...props}>
    <motion.div aria-hidden="true" initial={false} animate={{ width: `${percentage ?? 0}%` }} transition={{ duration: reduceMotion ? 0 : .65 }} className={cn('h-full rounded-full bg-emerald-500', indicatorClassName)} />
  </div>;
}
