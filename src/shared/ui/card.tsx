import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('min-w-0 rounded-3xl border border-white/80 bg-white/80 text-slate-900 shadow-[0_12px_40px_-20px_rgba(67,92,171,0.18)] backdrop-blur-md', className)} {...props} />;
}
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-2 p-6', className)} {...props} />;
}
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('m-0 text-base font-semibold tracking-tight', className)} {...props} />;
}
export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('m-0 text-sm leading-relaxed text-slate-500', className)} {...props} />;
}
export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6 pb-6', className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center gap-3 px-6 pb-6', className)} {...props} />;
}
