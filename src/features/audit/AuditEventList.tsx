import { Clock3 } from 'lucide-react';
import type { AuditLogDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { Badge } from '../../shared/ui';

interface AuditEventListProps {
  events: AuditLogDto[];
  actionLabels: Record<string, string>;
}

const cell = 'min-w-0 [overflow-wrap:anywhere] max-lg:!border-0 max-lg:!px-4 max-lg:!py-2.5';
const label = 'mb-1.5 block text-[10px] font-medium text-slate-500 lg:hidden';

/** A single read-only table; each event becomes a card below desktop widths. */
export function AuditEventList({ events, actionLabels }: AuditEventListProps) {
  return <div role="region" aria-label="Tabela dos eventos de auditoria" tabIndex={0} className="table-wrap !rounded-2xl border border-slate-100 bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400">
    <table role="table" className="data-table !min-w-0 lg:table-fixed max-lg:block">
      <caption className="sr-only">Trilha de eventos de auditoria</caption>
      <thead role="rowgroup" className="max-lg:sr-only"><tr role="row">
        <th scope="col" className="lg:w-[17%]">Data e hora</th>
        <th scope="col" className="lg:w-[23%]">Ação</th>
        <th scope="col" className="lg:w-[17%]">Recurso</th>
        <th scope="col" className="lg:w-[13%]">Ator</th>
        <th scope="col" className="lg:w-[14%]">Resultado</th>
        <th scope="col" className="lg:w-[16%]">Rastreio</th>
      </tr></thead>
      <tbody role="rowgroup" className="max-lg:grid max-lg:gap-3 max-lg:bg-slate-50/50 max-lg:p-3">
        {events.map(item => <tr key={item.id} role="row" className="max-lg:grid max-lg:grid-cols-2 max-lg:rounded-2xl max-lg:border max-lg:border-slate-100 max-lg:bg-white max-lg:py-2">
          <td role="cell" className={`${cell} max-lg:col-span-2 text-[12px] text-slate-500`}>
            <span aria-hidden="true" className={label}>Data e hora</span>
            <span className="inline-flex min-w-0 items-start gap-2"><Clock3 size={13} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><span>{formatDate(item.occurredAt)}</span></span>
          </td>
          <td role="cell" className={`${cell} max-lg:col-span-2 text-[13px] font-semibold text-[#315884]`}>
            <span aria-hidden="true" className={label}>Ação</span>
            {Object.hasOwn(actionLabels, item.action) ? actionLabels[item.action] : item.action}
          </td>
          <td role="cell" className={`${cell} max-lg:col-span-2 text-[12px] text-slate-600`}>
            <span aria-hidden="true" className={label}>Recurso</span>
            <span className="block">{item.resourceType}</span><small className="mt-1 block text-slate-500">{item.resourceId}</small>
          </td>
          <td role="cell" className={`${cell} text-slate-500`}>
            <span aria-hidden="true" className={label}>Ator</span><small>{item.actorId}</small>
          </td>
          <td role="cell" className={`${cell} [&_.badge]:max-w-full [&_.badge]:whitespace-normal [&_.badge]:[overflow-wrap:anywhere]`}>
            <span aria-hidden="true" className={label}>Resultado</span>
            <Badge tone={item.outcome === 'SUCCESS' ? 'success' : item.outcome === 'DENIED' || item.outcome === 'ERROR' ? 'danger' : item.outcome === 'DEMO' ? 'info' : 'warning'}>{item.outcome === 'SUCCESS' ? 'Concluído' : item.outcome === 'DENIED' ? 'Negado' : item.outcome === 'ERROR' ? 'Falha' : item.outcome === 'DEMO' ? 'Demonstração' : item.outcome}</Badge>
          </td>
          <td role="cell" className={`${cell} max-lg:col-span-2 text-slate-500`}>
            <span aria-hidden="true" className={label}>Rastreio</span><small>{item.requestId}</small>
          </td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}
