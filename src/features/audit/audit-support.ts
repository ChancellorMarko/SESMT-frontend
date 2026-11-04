import type { AuditLogDto, PageDto } from '../../shared/contracts';
import { dateOnly } from '../../shared/lib/format';
import { checkedPage, isRecord, ScopedPageError, shortText } from '../../shared/lib/scoped-page';

export const actionCode = (value: string) => value.length <= 100 && /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(value);
const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value) && !/[\u0000-\u0020\u007f/?#\\]/.test(value);

function auditItem(value: unknown): value is AuditLogDto {
  return isRecord(value) && identifier(value.id) && identifier(value.actorId) && identifier(value.resourceId) && identifier(value.requestId)
    && shortText(value.action, 100) && actionCode(value.action) && shortText(value.resourceType, 100) && actionCode(value.resourceType)
    && shortText(value.outcome, 100) && actionCode(value.outcome) && shortText(value.occurredAt, 100);
}

export function validCivilDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

interface AuditPageCriteria {
  page: number;
  pageSize: number;
  action?: string;
  from?: string;
  to?: string;
}

/** Verify both fresh responses and cached pages against the applied query. */
export function checkedAuditPage(value: unknown, expected: AuditPageCriteria): PageDto<AuditLogDto> {
  const { action = '', from = '', to = '' } = expected;
  if (action && !actionCode(action) || !validCivilDate(from) || !validCivilDate(to) || from && to && from > to) throw new ScopedPageError();
  const page = checkedPage<AuditLogDto>(value, expected, auditItem);
  for (const item of page.items) {
    if (action && item.action !== action) throw new ScopedPageError();
    if (from || to) {
      const instant = new Date(item.occurredAt);
      if (!Number.isFinite(instant.getTime())) throw new ScopedPageError();
      const day = dateOnly(instant);
      if (from && day < from || to && day > to) throw new ScopedPageError();
    }
  }
  return page;
}
