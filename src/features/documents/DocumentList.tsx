import { Link } from 'react-router';
import { ArrowUpRight, FileText, Layers3 } from 'lucide-react';
import type { DocumentReadDto as DocumentDto } from '../../shared/contracts';
import { DocumentStatus } from './DocumentStatus';
import { formatDate } from './validation';
import type { DocumentNavigation } from './document-navigation';
import { InfoButton } from '../../shared/ui';
import styles from './DocumentWorkspace.module.css';

const cell = '!align-top [overflow-wrap:anywhere] max-md:!border-0 max-md:!px-3 max-md:!py-1';
const label = 'mb-1 block text-[11px] font-medium text-slate-500 md:hidden';

/** Compact rows retain status and validity; supplementary mobile fields open on demand. */
export function DocumentList({ documents, typeNames, origin }: { documents: DocumentDto[]; typeNames: Map<string, string>; origin?: DocumentNavigation }) {
  return <table role="table" aria-label="Lista de documentos" className={`data-table !min-w-0 table-fixed max-md:block ${styles.documentTable}`}>
    <thead role="rowgroup" className="max-md:sr-only"><tr role="row">
      <th scope="col" className="!whitespace-normal md:w-[35%]">Documento</th><th scope="col" className="!whitespace-normal max-md:hidden md:w-[22%]">Tipo</th><th scope="col" className="!whitespace-normal md:w-[16%]">Situação</th><th scope="col" className="!whitespace-normal md:w-[14%]">Validade</th><th scope="col" className="!whitespace-normal max-md:hidden md:w-[13%]">Versões vigentes</th><th scope="col" className="md:hidden">Mais informações</th>
    </tr></thead>
    <tbody role="rowgroup" className="max-md:block">
      {documents.map(document => <tr key={document.id} role="row" className={`group max-md:grid max-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] max-md:border-b max-md:border-slate-200 max-md:py-2 ${styles.documentRow}`}>
        <td role="cell" className={`${cell} max-md:col-span-2`}>
          <div className="flex min-w-0 items-start gap-3">
            <span className={styles.documentMark}><FileText size={17} strokeWidth={1.7} aria-hidden="true" /></span>
            <div className="min-w-0"><div className={styles.documentCode}>{document.code}</div><Link to={`/app/documentos/${encodeURIComponent(document.id)}`} state={origin} className={styles.documentLink}>
              <span className="min-w-0 [overflow-wrap:anywhere]">{document.title}</span><ArrowUpRight size={14} aria-hidden="true" />
            </Link></div>
          </div>
        </td>
        <td role="cell" className={`${cell} max-md:hidden text-[12px] text-slate-500`}>{typeNames.get(document.typeId) ?? 'Tipo documental indisponível'}</td>
        <td role="cell" className={`${cell} max-md:col-start-1 max-md:row-start-2`}><span aria-hidden="true" className={label}>Situação</span><DocumentStatus status={document.status} /></td>
        <td role="cell" className={`${cell} max-md:col-start-2 max-md:row-start-2 text-[12px] text-slate-600`}><span aria-hidden="true" className={label}>Validade</span>{document.validUntil ? <time dateTime={document.validUntil}>{formatDate(document.validUntil)}</time> : 'Não informada'}</td>
        <td role="cell" className={`${cell} max-md:hidden text-[12px] text-slate-500`}><span className={styles.versionCount}><Layers3 size={14} aria-hidden="true" />{document.activeVersionIds?.length ?? (document.activeVersionId ? 1 : 0)}</span></td>
        <td role="cell" className="!px-0 !py-2 max-md:!border-0 max-md:col-start-3 max-md:row-start-1 md:hidden"><InfoButton title={document.code}><dl><div><dt>Tipo documental</dt><dd>{typeNames.get(document.typeId) ?? 'Tipo documental indisponível'}</dd></div><div><dt>Versões vigentes</dt><dd>{document.activeVersionIds?.length ?? (document.activeVersionId ? 1 : 0)}</dd></div></dl></InfoButton></td>
      </tr>)}
    </tbody>
  </table>;
}
