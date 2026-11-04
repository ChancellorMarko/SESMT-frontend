import { cn } from '../lib/cn';

/** The user-selected primary logo, with a real transparent background. */
export function BrandLogo({ tone = 'light', compact = false, className = '', priority = false }: {
  tone?: 'light' | 'dark';
  compact?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const source = compact ? 'icon.png' : 'logo-principal.png';
  return <img
    className={cn('block h-auto w-[220px] max-w-full object-contain', compact ? 'size-11 shrink-0' : tone === 'dark' ? 'rounded-xl bg-white p-2.5' : '', className)}
    src={`/brand/ampara/${source}`}
    alt="Ampara SESMT"
    width={compact ? 48 : 240}
    height={compact ? 48 : 97}
    decoding={priority ? 'sync' : 'async'}
    fetchPriority={priority ? 'high' : undefined}
  />;
}
