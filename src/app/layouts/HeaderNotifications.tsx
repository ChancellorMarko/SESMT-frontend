import { useId, useMemo } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { checkedPage, isRecord, shortText } from '../../shared/lib/scoped-page';
import styles from './HeaderNotifications.module.css';
import { NATIVE_MODULES } from '../../shared/api/native-mode';
import { useNativeNotifications } from '../../features/notifications/native-notifications';

type UnreadNotice = { id: string; readAt?: undefined };

function isUnreadNotice(value: unknown): value is UnreadNotice {
  return isRecord(value) && shortText(value.id, 200) && Boolean(value.id.trim()) && value.readAt === undefined;
}

/** Only the verified total is exposed in the header, never notification contents. */
export function HeaderNotifications({ className }: { className?: string }) {
  return NATIVE_MODULES ? <NativeHeaderNotifications className={className}/> : <LegacyHeaderNotifications className={className}/>;
}

function NativeHeaderNotifications({ className }: { className?: string }) {
  const { can } = useSession();
  const unread = useNativeNotifications(), descriptionId = useId();
  const total = unread.data?.items.filter(item => item.readAt === null).length;
  if (!can('notifications.read')) return null;
  return <Link to="/app/notificacoes" className={`${className || ''} ${styles.trigger} relative`} aria-label="Abrir notificações" title="Abrir notificações" aria-describedby={total === undefined ? undefined : descriptionId}>
    <Bell size={18} className={styles.bell} aria-hidden="true"/>
    {total !== undefined && <span id={descriptionId} className="sr-only">{total} {total === 1 ? 'notificação não lida' : 'notificações não lidas'}.</span>}
    {total !== undefined && total > 0 && <span data-notification-count={total} aria-hidden="true" className={`${styles.count} absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[#fffefa] bg-[#4679ee] px-0.5 text-[8px] font-semibold text-white`}>{total > 99 ? '99+' : total}</span>}
  </Link>;
}

function LegacyHeaderNotifications({ className }: { className?: string }) {
  const { can, sessionKey, unitId } = useSession();
  const descriptionId = useId();
  const allowed = can('notifications.read');
  const scope = ['notifications', sessionKey, unitId];
  const denial = useQuery<unknown>({ queryKey: [...scope, 'access-denial'], queryFn: async () => null, enabled: false, staleTime: Infinity, gcTime: Infinity });
  const enabled = allowed && Boolean(unitId) && !denial.data;
  const unread = useQuery({
    queryKey: [...scope, 'header-unread'],
    queryFn: async ({ signal }) => checkedPage(await api.get<unknown>('/notifications', { query: { unitId, page: 1, pageSize: 1, read: false }, signal }), { page: 1, pageSize: 1 }, isUnreadNotice),
    enabled,
  });
  const verifiedTotal = useMemo(() => {
    if (unread.data === undefined) return undefined;
    try { return checkedPage(unread.data, { page: 1, pageSize: 1 }, isUnreadNotice).total; }
    catch { return undefined; }
  }, [unread.data]);
  const total = enabled && !unread.isError && unread.isSuccess ? verifiedTotal : undefined;

  if (!allowed) return null;
  return <Link to="/app/notificacoes" className={`${className || ''} ${styles.trigger} relative`} aria-label="Abrir notificações" aria-describedby={total === undefined ? undefined : descriptionId} title="Abrir notificações">
    <Bell className={styles.bell} size={18} aria-hidden="true" />
    {total !== undefined && <span id={descriptionId} className="sr-only">{total === 0 ? 'Nenhuma notificação não lida.' : `${total} ${total === 1 ? 'notificação não lida' : 'notificações não lidas'}.`}</span>}
    {total !== undefined && total > 0 && <>
      <span key={`${sessionKey}:${unitId}:${total}`} data-notification-count={total} aria-hidden="true" className={`${styles.count} absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[#fffefa] bg-[#4679ee] px-0.5 text-[8px] font-semibold leading-none text-white`}>{total > 99 ? '99+' : total}</span>
      <span aria-hidden="true" className="absolute bottom-1 right-1 size-1.5 rounded-full bg-[#4679ee]" />
    </>}
  </Link>;
}
