import { Link } from 'react-router';
import { ArrowUpRight, FileText, Layers3 } from 'lucide-react';
import type { DocumentReadDto as DocumentDto } from '../../shared/contracts';
import { DocumentStatus } from './DocumentStatus';
import { formatDate } from './validation';
import type { DocumentNavigation } from './document-navigation';
import styles from './DocumentWorkspace.module.css';

const cell = '!align-top [overflow-wrap:anywhere] max-md:!border-0 max-md:!px-4 max-md:!py-2.5';
const label = 'mb-1.5 block text-[11px] font-medium text-slate-500 md:hidden';

/** One semantic table; rows become compact document cards on small screens. */
export function DocumentList({ documents, typeNames, origin }: { documents: DocumentDto[]; typeNames: Map<string, string>; origin?: DocumentNavigation }) {
  return <table role="table" aria-label="Lista de documentos" className={`data-table !min-w-0 table-fixed max-md:block ${styles.documentTable}`}>
    <thead role="rowgroup" className="max-md:sr-only"><tr role="row">
      <th scope="col" className="!whitespace-normal md:w-[35%]">Documento</th><th scope="col" className="!whitespace-normal md:w-[22%]">Tipo</th><th scope="col" className="!whitespace-normal md:w-[16%]">Situação</th><th scope="col" className="!whitespace-normal md:w-[14%]">Validade</th><th scope="col" className="!whitespace-normal md:w-[13%]">Versões vigentes</th>
    </tr></thead>
    <tbody role="rowgroup" className="max-md:grid max-md:gap-3 max-md:bg-slate-50/50 max-md:p-3">
      {documents.map(document => <tr key={document.id} role="row" className={`group max-md:grid max-md:grid-cols-2 max-md:rounded-2xl max-md:border max-md:border-slate-100 max-md:bg-white max-md:pb-2 ${styles.documentRow}`}>
        <td role="cell" className={`${cell} max-md:col-span-2 max-md:!py-4`}>
          <div className="flex min-w-0 items-start gap-3">
            <span className={styles.documentMark}><FileText size={17} strokeWidth={1.7} aria-hidden="true" /></span>
            <div className="min-w-0"><div className={styles.documentCode}>{document.code}</div><Link to={`/app/documentos/${encodeURIComponent(document.id)}`} state={origin} className={styles.documentLink}>
              <span className="min-w-0 [overflow-wrap:anywhere]">{document.title}</span><ArrowUpRight size={14} aria-hidden="true" />
            </Link></div>
          </div>
        </td>
        <td role="cell" className={`${cell} text-[12px] text-slate-500`}><span aria-hidden="true" className={label}>Tipo</span>{typeNames.get(document.typeId) ?? 'Tipo documental indisponível'}</td>
        <td role="cell" className={cell}><span aria-hidden="true" className={label}>Situação</span><DocumentStatus status={document.status} /></td>
        <td role="cell" className={`${cell} text-[12px] text-slate-600`}><span aria-hidden="true" className={label}>Validade</span>{document.validUntil ? <time dateTime={document.validUntil}>{formatDate(document.validUntil)}</time> : 'Não informada'}</td>
        <td role="cell" className={`${cell} text-[12px] text-slate-500`}><span aria-hidden="true" className={label}>Versões vigentes</span><span className={styles.versionCount}><Layers3 size={14} aria-hidden="true" />{document.activeVersionIds?.length ?? (document.activeVersionId ? 1 : 0)}</span></td>
      </tr>)}
    </tbody>
  </table>;
}
