import { Link } from 'react-router';
import { ArrowUpRight, FileText } from 'lucide-react';
import type { DocumentReadDto as DocumentDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { Badge } from '../../shared/ui';
import { DocumentStatus } from './DocumentStatus';
import { daysUntil } from './expiry';

interface ExpirationListProps {
  documents: DocumentDto[];
  today: string;
  documentState?: unknown;
}

const cell = 'min-w-0 max-md:!border-0 max-md:!px-4 max-md:!py-2.5';
const label = 'mb-1.5 block text-[10px] font-medium text-slate-500 md:hidden';

/** A single semantic table that presents each document as a card on mobile. */
export function ExpirationList({ documents, today, documentState }: ExpirationListProps) {
  return <div role="region" aria-label="Tabela de vencimentos" tabIndex={0} className="table-wrap !rounded-2xl border border-slate-100 bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400">
    <table role="table" className="data-table !min-w-0 md:table-fixed max-md:block">
      <caption className="sr-only">Documentos da consulta de vencimentos</caption>
      <thead role="rowgroup" className="max-md:sr-only"><tr role="row">
        <th scope="col" className="md:w-[46%]">Documento</th>
        <th scope="col" className="md:w-[18%]">Situação</th>
        <th scope="col" className="md:w-[18%]">Vencimento</th>
        <th scope="col" className="md:w-[18%]">Prazo</th>
      </tr></thead>
      <tbody role="rowgroup" className="max-md:grid max-md:gap-3 max-md:bg-slate-50/50 max-md:p-3">
        {documents.map(document => {
          const remaining = daysUntil(document.validUntil || undefined, today);
          return <tr key={document.id} role="row" className="group max-md:grid max-md:grid-cols-2 max-md:rounded-2xl max-md:border max-md:border-slate-100 max-md:bg-white max-md:pb-2">
            <td role="cell" className={`${cell} max-md:col-span-2 max-md:!py-3.5`}>
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-1 hidden size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50/70 text-[#6582b0] sm:flex"><FileText size={18} strokeWidth={1.7} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <Link to={`/app/documentos/${encodeURIComponent(document.id)}`} state={documentState} className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 text-[13px] font-semibold leading-6 text-[#315884] hover:underline">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{document.title}</span><ArrowUpRight size={13} className="shrink-0 text-slate-400 transition-colors group-hover:text-indigo-600" aria-hidden="true" />
                  </Link>
                  <div className="mt-1 break-all text-[11px] tracking-wide text-slate-500">{document.code}</div>
                </div>
              </div>
            </td>
            <td role="cell" className={cell}><span aria-hidden="true" className={label}>Situação</span><DocumentStatus status={document.status} /></td>
            <td role="cell" className={`${cell} text-[12px] text-slate-600 [overflow-wrap:anywhere]`}><span aria-hidden="true" className={label}>Vencimento</span>{formatDate(document.validUntil)}</td>
            <td role="cell" className={cell}><span aria-hidden="true" className={label}>Prazo</span><Badge tone={document.status === 'EXPIRED' || remaining !== undefined && remaining <= 7 ? 'warning' : 'info'}>{remaining === undefined ? 'Sem data informada' : remaining < 0 ? `Há ${-remaining} dia(s)` : remaining === 0 ? 'Vence hoje' : `Em ${remaining} dia(s)`}</Badge></td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
