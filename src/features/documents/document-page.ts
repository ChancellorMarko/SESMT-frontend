import type { DocumentReadDto } from '../../shared/contracts';
import { checkedPage, isRecord, shortText } from '../../shared/lib/scoped-page';
import { documentStatuses, isCivilDate } from './validation';

/** Check the envelope and selected unit before rendering links from a remote response. */
export function documentSummary(item: unknown, unitId: string): item is DocumentReadDto {
  return (
    isRecord(item)
    && (item.sourceReadOnly === undefined || typeof item.sourceReadOnly === 'boolean')
    && (item.unitId === unitId || item.sourceReadOnly === true && item.unitId === null)
    && shortText(item.code, 200) && Boolean(item.code.trim())
    && shortText(item.title, 1000) && Boolean(item.title.trim())
    && shortText(item.typeId, 200) && Boolean(item.typeId.trim())
    && typeof item.status === 'string' && documentStatuses.some(status => status === item.status)
    && (item.sourceReadOnly === true ? item.revision === null : Number.isSafeInteger(item.revision) && Number(item.revision) > 0)
    && typeof item.issueDate === 'string' && isCivilDate(item.issueDate)
    && (item.validFrom == null || typeof item.validFrom === 'string' && isCivilDate(item.validFrom))
    && (item.validUntil == null || typeof item.validUntil === 'string' && isCivilDate(item.validUntil))
    && Array.isArray(item.activeVersionIds) && item.activeVersionIds.every(id => shortText(id, 200) && Boolean(id.trim())));
}

export function checkedDocumentPage(value: unknown, page: number, unitId: string, pageSize = 10, workerId?: string, companyId?: string) {
  return checkedPage<DocumentReadDto>(value, { page, pageSize }, (item): item is DocumentReadDto => documentSummary(item, unitId)
    && (!workerId || Array.isArray(item.workerIds) && item.workerIds.includes(workerId)) && (!companyId || item.companyId === companyId));
}
