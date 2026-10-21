import { Link } from 'react-router';
import { ArrowUpRight, FileText, Layers3 } from 'lucide-react';
import type { DocumentDto } from '../../shared/contracts';
import { DocumentStatus } from './DocumentStatus';
import { formatDate } from './validation';
import type { DocumentNavigation } from './document-navigation';

const cell = 'max-md:!border-0 max-md:!px-4 max-md:!py-2.5';
const label = 'mb-1.5 block text-[10px] font-medium text-slate-500 md:hidden';

/** One semantic table; rows become compact document cards on small screens. */
export function DocumentList({ documents, typeNames, origin }: { documents: DocumentDto[]; typeNames: Map<string, string>; origin?: DocumentNavigation }) {
  return <table role="table" aria-label="Lista de documentos" className="data-table !min-w-0 max-md:block">
    <thead role="rowgroup" className="max-md:sr-only"><tr role="row">
      <th scope="col">Documento</th><th scope="col">Tipo</th><th scope="col">Situação</th><th scope="col">Validade</th><th scope="col">Versões vigentes</th>
    </tr></thead>
    <tbody role="rowgroup" className="max-md:grid max-md:gap-3 max-md:bg-slate-50/50 max-md:p-3">
      {documents.map(document => <tr key={document.id} role="row" className="group max-md:grid max-md:grid-cols-2 max-md:rounded-2xl max-md:border max-md:border-slate-100 max-md:bg-white max-md:pb-2">
        <td role="cell" className={`${cell} max-md:col-span-2 max-md:!py-4`}>
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50/70 text-[#6582b0] sm:flex"><FileText size={17} strokeWidth={1.7} aria-hidden="true" /></span>
            <div className="min-w-0"><Link to={`/app/documentos/${encodeURIComponent(document.id)}`} state={origin} className="inline-flex min-h-7 min-w-0 max-w-full items-center gap-2 text-[13px] font-semibold leading-6 text-[#315884] hover:underline">
              <span className="min-w-0 [overflow-wrap:anywhere]">{document.title}</span><ArrowUpRight size={13} className="shrink-0 text-slate-400 transition-colors group-hover:text-indigo-600" aria-hidden="true" />
            </Link><div className="mt-1 break-all text-[11px] tracking-wide text-slate-500">{document.code}</div></div>
          </div>
        </td>
        <td role="cell" className={`${cell} [overflow-wrap:anywhere] text-[12px] text-slate-500`}><span aria-hidden="true" className={label}>Tipo</span>{typeNames.get(document.typeId) ?? 'Tipo documental indisponível'}</td>
        <td role="cell" className={cell}><span aria-hidden="true" className={label}>Situação</span><DocumentStatus status={document.status} /></td>
        <td role="cell" className={`${cell} text-[12px] text-slate-600`}><span aria-hidden="true" className={label}>Validade</span>{document.validUntil ? formatDate(document.validUntil) : 'Não informada'}</td>
        <td role="cell" className={`${cell} text-[12px] text-slate-500`}><span aria-hidden="true" className={label}>Versões vigentes</span><span className="inline-flex items-center gap-1.5"><Layers3 size={13} className="text-slate-400" aria-hidden="true" />{document.activeVersionIds?.length ?? (document.activeVersionId ? 1 : 0)}</span></td>
      </tr>)}
    </tbody>
  </table>;
}
