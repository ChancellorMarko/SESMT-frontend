import type { NotificationDto, PageDto } from '../../shared/contracts';
import { checkedPage, isRecord, isSafePage, ScopedPageError, shortText } from '../../shared/lib/scoped-page';

export function validReadAt(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false;
  const day = value.slice(0, 10), date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}

export function isNotification(value: unknown): value is NotificationDto {
  return isRecord(value) && shortText(value.id, 200) && Boolean(value.id.trim())
    && shortText(value.type, 200) && Boolean(value.type.trim()) && shortText(value.title, 500) && Boolean(value.title.trim())
    && shortText(value.summary) && shortText(value.resourceType, 200) && Boolean(value.resourceType.trim())
    && shortText(value.resourceId, 2000) && Boolean(value.resourceId.trim()) && shortText(value.createdAt, 100)
    && (value.dueDate === undefined || shortText(value.dueDate, 100)) && (value.readAt === undefined || validReadAt(value.readAt));
}

export function notificationCriteriaError(params: URLSearchParams): string {
  const keys = Array.from(params.keys());
  if (keys.some(key => params.getAll(key).length > 1)) return 'O endereço contém filtros repetidos. Corrija ou limpe os filtros para consultar notificações.';
  if (keys.some(key => !['read', 'page', 'unitId'].includes(key))) return 'O endereço contém filtros desconhecidos. Limpe os filtros para consultar notificações.';
  const read = params.get('read');
  if (read !== null && !['', 'true', 'false'].includes(read)) return 'O filtro de leitura do endereço é inválido. Selecione uma opção disponível ou limpe os filtros.';
  if (!isSafePage(params.get('page'), 20)) return 'A página do endereço é inválida. Volte à primeira página ou limpe os filtros.';
  return '';
}

/** Verify the envelope and selected reading criterion for both responses and cached data. */
export function checkedNotificationsPage(value: unknown, expected: { page: number; pageSize: number; read: string }): PageDto<NotificationDto> {
  if (!['', 'true', 'false'].includes(expected.read)) throw new ScopedPageError();
  return checkedPage(value, expected, (item): item is NotificationDto => isNotification(item)
    && (expected.read === '' || (expected.read === 'true' ? item.readAt !== undefined : item.readAt === undefined)));
}
