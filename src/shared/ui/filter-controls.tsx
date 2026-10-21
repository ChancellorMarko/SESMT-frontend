import { useId, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Button } from './index';

export function FilterDisclosure({ open, onOpenChange, count = 0, label = 'Mais filtros', children }: {
  open: boolean; onOpenChange: (open: boolean) => void; count?: number; label?: string; children: ReactNode;
}) {
  const id = useId();
  return <div className="border-t border-slate-100 pt-3">
    <Button variant="ghost" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)} className="!w-full !justify-start !px-2">
      <SlidersHorizontal size={15} aria-hidden="true" />
      {label}
      {count > 0 && <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">{count}<span className="sr-only"> aplicados</span></span>}
      <ChevronDown size={15} aria-hidden="true" className={`ml-auto transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </Button>
    <div id={id} hidden={!open} className="pt-4">{children}</div>
  </div>;
}

export type AppliedFilter = { key: string; label: string; value: string };

export function AppliedFilters({ filters, onRemove }: { filters: AppliedFilter[]; onRemove: (key: string) => void }) {
  if (!filters.length) return null;
  return <div role="group" aria-label="Filtros aplicados" className="flex flex-wrap items-center gap-2">
    <span className="mr-1 text-[11px] font-medium text-slate-500">Em uso</span>
    {filters.map(filter => <button key={filter.key} type="button" onClick={() => onRemove(filter.key)}
      aria-label={`Remover filtro: ${filter.label}`} title={`${filter.label}: ${filter.value}`}
      className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5 text-left text-[11px] leading-5 text-indigo-800 transition-colors hover:border-indigo-200 hover:bg-indigo-100/70">
      <span className="min-w-0 truncate"><span className="font-medium">{filter.label}:</span> {filter.value}</span>
      <X size={12} className="shrink-0" aria-hidden="true" />
    </button>)}
  </div>;
}
