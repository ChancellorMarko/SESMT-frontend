import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { denyVerifiedRead, InvalidReadResponse } from '../../shared/lib/verified-read';
import { useEditorRequest } from '../administration/useEditorRequest';
import { nativeNotificationType, useNativeNotifications, type NativeNotification } from './native-notifications';
import styles from '../../shared/ui/NativeRecords.module.css';

export function NativeNotificationsPage() {
  const { sessionKey } = useSession();
  return <Notifications key={sessionKey}/>;
}
function Notifications() {
  const { sessionKey, can } = useSession(), client = useQueryClient();
  const notices = useNativeNotifications(), request = useEditorRequest();
  const [read, setRead] = useState(''), [page, setPage] = useState(1);
  const [saving, setSaving] = useState(''), [error, setError] = useState<unknown>(), [confirmation, setConfirmation] = useState('');
  const denied = error instanceof ApiError && [401, 403, 404].includes(error.status) || error instanceof InvalidReadResponse;
  const allowed = can('notifications.read');
  const items = !denied ? notices.data?.items : undefined;
  const filtered = (items ?? []).filter(item => read === '' || (read === 'true') === Boolean(item.readAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), current = Math.min(page, pages);
  async function refresh() { const result = await notices.refetch(); if (result?.isSuccess) setError(undefined); }
  async function markRead(item: NativeNotification) {
    if (!allowed || denied || !items?.some(value => value.id === item.id && value.readAt === null) || notices.isFetching || request.isPending()) return;
    setSaving(item.id); setError(undefined); setConfirmation('');
    try {
      await request.run(async signal => {
        const response = await api.post<unknown>(`/notifications/${encodeURIComponent(item.id)}/read`, undefined, { signal });
        if (response !== undefined) throw new InvalidReadResponse();
      });
      if (!request.isActive()) return;
      // Re-read server state; never invent readAt or resolve the underlying task.
      await client.invalidateQueries({ queryKey: ['native-notifications', sessionKey] });
      if (request.isActive()) setConfirmation('Leitura registrada. A pendência do registro continua sendo acompanhada.');
    } catch (failure) {
      if (request.isActive()) {
        setError(failure);
        if (failure instanceof ApiError && [401, 403, 404].includes(failure.status) || failure instanceof InvalidReadResponse) {
          denyVerifiedRead(client, ['native-notifications', sessionKey], failure);
        }
      }
    } finally { if (request.isActive()) setSaving(''); }
  }
  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar notificações.</Feedback>;
  return <div className="stack">
    <PageHeader title="Notificações" description="Avisos destinados à sua conta, conforme os acessos atuais. Marcar como lido não encerra a pendência do registro." actions={<Button variant="secondary" disabled={notices.isFetching || Boolean(saving)} onClick={() => void refresh()}>Atualizar notificações</Button>}/>
    <div className={`panel ${styles.toolbar}`}><Field label="Leitura"><select value={read} disabled={Boolean(saving)} onChange={event => { setRead(event.target.value); setPage(1); }}><option value="">Todas</option><option value="false">Não lidas</option><option value="true">Lidas</option></select></Field><Badge>Escopo da conta</Badge></div>
    {notices.isPending && <Spinner/>}
    {(notices.isError || error !== undefined) && <Feedback tone="danger">{denied || notices.error instanceof ApiError && [401, 403, 404].includes(notices.error.status) ? 'Não foi possível autorizar a consulta ou a leitura deste aviso. Atualize seus acessos e a lista.' : 'Não foi possível conferir as notificações ou registrar a leitura. Tente atualizar a lista.'}</Feedback>}
    {confirmation && !notices.isError && !denied && <Feedback tone="success">{confirmation}</Feedback>}
    {items && !notices.isError && <section className={styles.results} aria-label="Notificações da conta" aria-busy={notices.isFetching}>
      {!filtered.length ? <EmptyState title="Nenhuma notificação" description="Não há avisos para o filtro escolhido."/> : <div className={styles.scroll} tabIndex={0} role="region" aria-label="Tabela de notificações"><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Aviso</th><th scope="col">Recebimento</th><th scope="col">Leitura</th></tr></thead><tbody>{filtered.slice((current - 1) * 20, current * 20).map(item => <tr key={item.id}><td><strong>{nativeNotificationType(item.type)}</strong><p className={styles.message}>{item.text}</p><InfoButton title={`Detalhes do aviso: ${nativeNotificationType(item.type)}`}><dl className={styles.details}><dt>Tipo</dt><dd>{item.type}</dd><dt>Registro</dt><dd>{item.resourceId}</dd><dt>Notificação</dt><dd>{item.id}</dd><dt>Leitura</dt><dd>{item.readAt ? formatDate(item.readAt) : 'Não lida'}</dd></dl></InfoButton></td><td>{formatDate(item.createdAt)}</td><td>{item.readAt ? <Badge>Lida</Badge> : <Button variant="secondary" disabled={Boolean(saving) || notices.isFetching} onClick={() => void markRead(item)}>{saving === item.id ? 'Registrando…' : 'Marcar como lida'}</Button>}</td></tr>)}</tbody></table></div>}
      <nav className={styles.footer} aria-label="Paginação de notificações"><span>{filtered.length} aviso(s) · página {current} de {pages}</span><div className="actions"><Button variant="secondary" disabled={current <= 1 || Boolean(saving)} onClick={() => setPage(current - 1)}>Anterior</Button><Button variant="secondary" disabled={current >= pages || Boolean(saving)} onClick={() => setPage(current + 1)}>Próxima</Button></div></nav>
    </section>}
  </div>;
}
