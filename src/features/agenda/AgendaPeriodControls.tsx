import { Button } from '../../shared/ui';
import { agendaPeriodRange, type AgendaPeriod } from './agenda-presentation';

export function AgendaPeriodControls({ from, to, today, disabled, onChange }: {
  from: string; to: string; today: string; disabled: boolean; onChange: (period: AgendaPeriod) => void;
}) {
  const periods = [
    { key: 'today', label: 'Hoje', accessible: 'Filtrar agenda para hoje' },
    { key: 'seven-days', label: 'Próximos 7 dias', accessible: 'Filtrar agenda para os próximos 7 dias, incluindo hoje' },
    { key: 'all', label: 'Todo o período', accessible: 'Consultar agenda sem limite de período' },
  ] as const;
  return <div role="group" aria-label="Períodos rápidos da agenda" className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/65 p-3 sm:flex-row sm:items-center">
    <span className="text-[11px] font-medium text-slate-500 sm:mr-1">Período rápido</span>
    <div className="flex min-w-0 flex-wrap gap-2">{periods.map(period => {
      const range = agendaPeriodRange(period.key, today);
      const selected = from === range.from && to === range.to;
      return <Button key={period.key} variant={selected ? 'primary' : 'ghost'} aria-label={period.accessible} aria-pressed={selected} disabled={disabled} onClick={() => onChange(period.key)}>{period.label}</Button>;
    })}</div>
  </div>;
}
