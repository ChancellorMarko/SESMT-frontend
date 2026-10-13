import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { NotificationDto, PageDto } from '../../shared/contracts';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import styles from './notifications.module.css';

function targetPath(item: NotificationDto) {
  const type = item.resourceType.toUpperCase();
  const routes: Record<string, string> = {
    DOCUMENT: '/app/documentos',
    WORKER: '/app/trabalhadores',
    WORK_PERMIT: '/app/pts',
    PERMIT: '/app/pts',
    APPOINTMENT: '/app/agenda',
  };
  const base = routes[type];
  return base && item.resourceId ? `${base}/${encodeURIComponent(item.resourceId)}` : undefined;
}

function pageNumber(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function NotificationsPage() {
  const { sessionKey, unitId, can } = useSession();
  const [search, setSearch] = useSearchParams();
  const requestedRead = search.get('read');
  const read = requestedRead === 'true' || requestedRead === 'false' ? requestedRead : '';
  const page = pageNumber(search.get('page'));
  const [confirmation, setConfirmation] = useState('');
  const client = useQueryClient();
  const notices = useQuery({ queryKey: ['notifications', sessionKey, unitId, read, page], queryFn: ({ signal }) => api.get<PageDto<NotificationDto>>('/notifications', { query: { unitId, page, pageSize: 20, read: read === '' ? undefined : read === 'true' }, signal }), enabled: can('notifications.read') });
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch<NotificationDto>(`/notifications/${encodeURIComponent(id)}/read`, {}),
    onMutate: () => setConfirmation(''),
    onSuccess: async (item) => {
      setConfirmation(`Leitura registrada: ${item.title}. A pendência do registro continua sendo acompanhada.`);
      await client.invalidateQueries({ queryKey: ['notifications', sessionKey] });
    },
  });
  useEffect(() => {
    const next = new URLSearchParams(search);
    if (search.has('page') && search.get('page') !== String(page)) next.set('page', String(page));
    if (requestedRead !== null && requestedRead !== read) next.delete('read');
    if (next.toString() !== search.toString()) setSearch(next, { replace: true });
  }, [page, read, requestedRead, search, setSearch]);
  const lastPage = notices.data ? Math.max(1, Math.ceil(notices.data.total / notices.data.pageSize)) : page;
  useEffect(() => {
    if (!notices.data || notices.isFetching || notices.isError || page <= lastPage) return;
    const next = new URLSearchParams(search);
    next.set('page', String(lastPage));
    setSearch(next, { replace: true });
  }, [lastPage, notices.data, notices.isError, notices.isFetching, page, search, setSearch]);
  if (!can('notifications.read')) return <Feedback tone="warning">Seu acesso não permite consultar notificações.</Feedback>;
  function setPage(nextPage: number) { const next = new URLSearchParams(search); next.set('page', String(nextPage)); setSearch(next); }
  function changeRead(value: string) { const next = new URLSearchParams(); if (value) next.set('read', value); setConfirmation(''); markRead.reset(); setSearch(next); }
  return <div className="stack">
    <PageHeader eyebrow="ACOMPANHAMENTO" title="Notificações" description="Avisos do seu escopo. Marcar como lido registra a leitura e mantém a pendência do documento." />
    <div className="panel toolbar"><Field label="Leitura"><select value={read} disabled={markRead.isPending} onChange={(event) => changeRead(event.target.value)}><option value="">Todas</option><option value="false">Não lidas</option><option value="true">Lidas</option></select></Field><Button variant="secondary" disabled={notices.isFetching || markRead.isPending} onClick={() => notices.refetch()}>{notices.isFetching && !notices.isPending ? 'Atualizando…' : 'Atualizar'}</Button>{read && <Button variant="ghost" disabled={markRead.isPending} onClick={() => changeRead('')}>Limpar filtro</Button>}</div>
    {notices.isPending && <Spinner />}
    {notices.isError && <Feedback tone="danger">{notices.error.message} <Button variant="ghost" disabled={notices.isFetching} onClick={() => notices.refetch()}>Tentar novamente</Button></Feedback>}
    {markRead.isError && <Feedback tone="danger">Não foi possível registrar a leitura. {markRead.error.message}</Feedback>}
    {confirmation && <Feedback tone="success">{confirmation}</Feedback>}
    {notices.data && !notices.isError && page <= lastPage && <section className="panel stack" aria-label="Lista de notificações">
      {notices.data.items.length ? notices.data.items.map((item) => {
        const href = targetPath(item);
        const itemType = item.resourceType.toUpperCase();
        const permitted = itemType === 'DOCUMENT'
          ? can('documents.read')
          : itemType === 'WORKER'
          ? can('workers.read')
          : ['WORK_PERMIT', 'PERMIT'].includes(itemType)
          ? can('permits.read')
          : itemType === 'APPOINTMENT'
          ? can('appointments.read')
          : false;
        const saving = markRead.isPending && markRead.variables === item.id;
        return <article key={item.id} className={styles.notice} aria-label={item.title}><div className="actions"><Badge tone={item.readAt ? 'neutral' : 'info'}>{item.readAt ? 'Lida' : 'Não lida'}</Badge><span className="muted">{formatDate(item.createdAt)}</span></div><h2>{item.title}</h2><p>{item.summary}</p>{item.dueDate && <p className="muted">Prazo: {formatDate(item.dueDate)}</p>}<div className="actions">{href && permitted && <Link to={href}>Abrir registro →</Link>}{!item.readAt && <Button variant="secondary" disabled={markRead.isPending} aria-label={`Marcar como lida: ${item.title}`} onClick={() => markRead.mutate(item.id)}>{saving ? 'Registrando leitura…' : 'Marcar como lida'}</Button>}</div></article>;
      }) : <EmptyState title="Nenhuma notificação" description="Não há avisos para este filtro e unidade." />}
      <div className="actions"><span className="muted">{notices.data.total} notificações · página {page} de {lastPage}</span><Button variant="ghost" onClick={() => setPage(page - 1)} disabled={page <= 1 || notices.isFetching || markRead.isPending}>Anterior</Button><Button variant="ghost" onClick={() => setPage(page + 1)} disabled={page >= lastPage || notices.isFetching || markRead.isPending}>Próxima</Button></div>
    </section>}
  </div>;
}
