import { Bell, CalendarDays, CheckCheck, ClipboardList, FileText, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import type { NotificationDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button } from '../../shared/ui';
import styles from './NotificationCard.module.css';

export interface NotificationCardProps {
  item: NotificationDto;
  href?: string;
  linkState?: unknown;
  busy: boolean;
  refreshing: boolean;
  saving: boolean;
  onMarkRead: () => void;
}

/** Resource access and destinations are resolved by the containing page. */
export function NotificationCard({ item, href, linkState, busy, refreshing, saving, onMarkRead }: NotificationCardProps) {
  const resourceType = item.resourceType.toUpperCase();
  const ResourceIcon = resourceType === 'DOCUMENT' ? FileText
    : resourceType === 'WORKER' ? UserRound
      : ['WORK_PERMIT', 'PERMIT', 'APPOINTMENT'].includes(resourceType) ? ClipboardList : Bell;

  return (
    <article
      aria-label={item.title}
      data-notification-state={item.readAt ? 'read' : 'unread'}
      className={`${styles.card} min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white [&_.badge]:max-w-full [&_.badge]:whitespace-normal [&_.badge]:[overflow-wrap:anywhere]`}
    >
      <div className="flex min-w-0 items-start gap-3 px-4 pt-5 sm:gap-4 sm:px-6 sm:pt-6">
        <span className={`${styles.icon} flex size-10 shrink-0 items-center justify-center rounded-2xl ${item.readAt ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-[#315884]'}`} aria-hidden="true">
          <ResourceIcon size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[11px] leading-5 text-slate-500">
            <Badge tone={item.readAt ? 'neutral' : 'info'}>{item.readAt ? 'Lida' : 'Não lida'}</Badge>
            <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
          </div>
          <h2 className="mt-3 !mb-0 !text-[16px] font-semibold leading-7 text-[#244a77] [overflow-wrap:anywhere]">{item.title}</h2>
          <p className="mt-2 !mb-0 whitespace-pre-wrap text-[13px] leading-6 text-slate-600 [overflow-wrap:anywhere]">{item.summary}</p>
        </div>
      </div>

      {(item.dueDate || item.readAt) && (
        <dl className="!m-0 flex min-w-0 flex-wrap gap-x-6 gap-y-3 px-4 pt-4 text-xs leading-5 sm:px-6">
          {item.dueDate && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-600">
              <dt className="inline-flex items-center gap-1.5 font-medium"><CalendarDays size={14} className="shrink-0 text-slate-400" aria-hidden="true" />Prazo:</dt>
              <dd className="!m-0 [overflow-wrap:anywhere]"><time dateTime={item.dueDate}>{formatDate(item.dueDate)}</time></dd>
            </div>
          )}
          {item.readAt && (
            <div className={`${styles.readReceipt} flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-slate-500`}>
              <dt className="inline-flex items-center gap-1.5 font-medium"><CheckCheck size={14} className="shrink-0 text-slate-400" aria-hidden="true" />Leitura registrada:</dt>
              <dd className="!m-0 [overflow-wrap:anywhere]"><time dateTime={item.readAt}>{formatDate(item.readAt)}</time></dd>
            </div>
          )}
        </dl>
      )}

      {(href || !item.readAt) && (
        <footer className="mx-4 mt-5 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-3 sm:mx-6">
          {href && <Link className={`${styles.recordLink} inline-flex min-h-11 max-w-full items-center gap-1.5 text-xs font-semibold leading-5 text-[#315884] [overflow-wrap:anywhere]`} to={href} state={linkState}>Abrir registro <span className={styles.arrow}>→</span></Link>}
          {!item.readAt && <Button className="min-h-11 max-w-full whitespace-normal text-center [overflow-wrap:anywhere]" variant="secondary" disabled={busy || refreshing || saving} aria-label={`Marcar como lida: ${item.title}`} onClick={onMarkRead}>{saving ? 'Registrando leitura…' : 'Marcar como lida'}</Button>}
        </footer>
      )}
      {item.readAt && !href && <div className="h-5 sm:h-6" aria-hidden="true" />}
    </article>
  );
}
