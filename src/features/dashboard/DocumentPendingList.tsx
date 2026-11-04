import { ArrowUpRight, FileText } from 'lucide-react';
import { Link } from 'react-router';
import type { DashboardDto } from '../../shared/contracts';
import { Badge } from '../../shared/ui';
import type { DocumentNavigation } from '../documents/document-navigation';

interface DocumentPendingListProps {
  items: DashboardDto['pendingItems'];
  canReadDocuments: boolean;
  origin?: DocumentNavigation;
}

const cell = 'min-w-0 !align-top [overflow-wrap:anywhere] max-md:!border-0 max-md:!px-4 max-md:!py-2.5';
const label = 'mb-1.5 block text-[10px] font-medium text-slate-500 md:hidden';

export function DocumentPendingList({ items, canReadDocuments, origin }: DocumentPendingListProps) {
  return <div className="table-wrap !min-w-0">
    <table role="table" aria-label="Pendências documentais do painel" className="data-table !min-w-0 table-fixed max-md:block">
      <thead role="rowgroup" className="max-md:sr-only"><tr role="row">
        <th scope="col" className="!whitespace-normal md:w-[46%]">Documento</th>
        <th scope="col" className="!whitespace-normal md:w-[18%]">Prazo</th>
        <th scope="col" className="!whitespace-normal md:w-[18%]">Situação</th>
        <th scope="col" className="!whitespace-normal md:w-[18%]">Consulta</th>
      </tr></thead>
      <tbody role="rowgroup" className="max-md:grid max-md:gap-3 max-md:bg-slate-50/50 max-md:p-3">
        {items.map(item => {
          const status = item.status === 'EXPIRED' ? 'Vencido' : item.status === 'IN_REVIEW' ? 'Em revisão' : item.status === 'ACTIVE' ? 'A vencer' : 'Acompanhar';
          const canOpen = item.resourceType.toUpperCase() === 'DOCUMENT' && canReadDocuments;
          return <tr key={item.id} role="row" className="group max-md:grid max-md:grid-cols-2 max-md:rounded-2xl max-md:border max-md:border-slate-100 max-md:bg-white max-md:pb-2">
            <td role="cell" className={`${cell} max-md:col-span-2 max-md:!py-4`}>
              <span aria-hidden="true" className={label}>Documento</span>
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50/70 text-[#6582b0] sm:flex"><FileText size={17} strokeWidth={1.7} aria-hidden="true" /></span>
                <span className="min-w-0 text-[13px] font-semibold leading-6 text-[#315884] [overflow-wrap:anywhere]">{item.title}</span>
              </div>
            </td>
            <td role="cell" className={`${cell} text-[12px] leading-6 text-slate-600 tabular-nums`}>
              <span aria-hidden="true" className={label}>Prazo</span>
              {item.dueDate ? <time dateTime={item.dueDate}>{item.dueDate.split('-').reverse().join('/')}</time> : 'Sem data informada'}
            </td>
            <td role="cell" className={`${cell} [&_.badge]:max-w-full [&_.badge]:whitespace-normal [&_.badge]:text-left [&_.badge]:[overflow-wrap:anywhere]`}>
              <span aria-hidden="true" className={label}>Situação</span>
              <Badge tone={item.status === 'IN_REVIEW' ? 'info' : item.status === 'EXPIRED' || item.status === 'ACTIVE' ? 'warning' : 'neutral'}>{status}</Badge>
            </td>
            <td role="cell" className={`${cell} max-md:col-span-2`}>
              <span aria-hidden="true" className={label}>Consulta</span>
              {canOpen ? <Link to={`/app/documentos/${encodeURIComponent(item.resourceId)}`} state={origin} className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 text-[11px] font-semibold leading-5 text-[#54799e] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
                <span className="min-w-0 [overflow-wrap:anywhere]">Ver documento</span><ArrowUpRight size={13} className="shrink-0" aria-hidden="true" />
              </Link> : <span className="muted text-[11px] leading-6">Consulta indisponível</span>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
