import type { DocumentHistoryReadDto, DocumentReadDto, DocumentVersionReadDto, FileDto } from '../../shared/contracts';
import { checkedPage, isRecord, shortText } from '../../shared/lib/scoped-page';
import { InvalidReadResponse, readIdentifier as id } from '../../shared/lib/verified-read';
import { documentSummary } from './document-page';
import { documentStatuses, isCivilDate } from './validation';

const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => shortText(item, 1000));
const stamp = (value: unknown) => shortText(value, 100) && Number.isFinite(Date.parse(value));
const revision = (value: Record<string, unknown>) => value.sourceReadOnly === true ? value.revision === null : Number.isSafeInteger(value.revision) && Number(value.revision) > 0;
const status = (value: unknown) => typeof value === 'string' && documentStatuses.some(item => item === value);

export function checkedDocumentDetail(value: unknown, documentId: string, unitId: string): DocumentReadDto {
  if (!documentSummary(value, unitId) || value.id !== documentId || !id(value.companyId) || !id(value.ownerId) || !id(value.typeId)
    || value.sectorId != null && !id(value.sectorId)
    || !['PUBLIC', 'INTERNAL', 'RESTRICTED', 'MEDICAL'].includes(value.accessClass)
    || !ids(value.workerIds) || !ids(value.responsibleIds) || !texts(value.keywords) || !texts(value.availableActions)
    || !ids(value.activeVersionIds) || value.currentVersionId != null && !id(value.currentVersionId)
    || value.activeVersionId != null && !id(value.activeVersionId)) throw new InvalidReadResponse();
  return value;
}

function file(value: unknown, native = false): value is FileDto {
  return isRecord(value) && id(value.id) && shortText(value.name, 1000) && Boolean(value.name.trim())
    && shortText(value.mimeType, 200) && Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) >= 0
    && shortText(value.sha256, 256) && typeof value.scanStatus === 'string'
    && (native ? ['PENDING', 'CLEAN', 'REJECTED', 'ERROR', 'UNKNOWN'] : ['PENDING', 'CLEAN', 'REJECTED']).includes(value.scanStatus);
}
function snapshot(value: unknown) {
  // A historical or prepared snapshot may legitimately reference another unit.
  return isRecord(value) && id(value.typeId) && id(value.companyId) && id(value.unitId)
    && shortText(value.code, 200) && shortText(value.title, 1000)
    && typeof value.issueDate === 'string' && isCivilDate(value.issueDate)
    && [value.validFrom, value.validUntil].every(date => date == null || typeof date === 'string' && isCivilDate(date));
}
function version(value: unknown, documentId: string): value is DocumentVersionReadDto {
  if (!isRecord(value) || value.sourceReadOnly !== undefined && typeof value.sourceReadOnly !== 'boolean' || !id(value.id) || value.documentId !== documentId || !Number.isSafeInteger(value.versionNumber) || Number(value.versionNumber) < 1
    || !(status(value.status) || value.sourceReadOnly === true && value.status === 'REJECTED') || !revision(value)
    || !(shortText(value.reason, 10000) || value.sourceReadOnly === true && value.reason === null)
    || !stamp(value.createdAt) || !id(value.createdBy) || !texts(value.availableActions)
    || (value.sourceReadOnly === true ? value.metadataSnapshot !== null : !snapshot(value.metadataSnapshot))
    || !(value.sourceReadOnly === true && value.file === null || file(value.file, value.sourceReadOnly === true))
    || !Array.isArray(value.signatureEvidences)) return false;
  const evidenceIds = new Set<string>();
  for (const evidence of value.signatureEvidences) {
    if (!isRecord(evidence) || !id(evidence.id) || evidenceIds.has(evidence.id) || evidence.versionId !== value.id
      || !shortText(evidence.signerName, 500) || !stamp(evidence.signedAt) || evidence.method !== 'UPLOADED_EVIDENCE'
      || !file(evidence.file) || evidence.evidenceFileId !== evidence.file.id
      || !['PENDING', 'VERIFIED', 'REJECTED'].includes(String(evidence.verificationStatus))) return false;
    evidenceIds.add(evidence.id);
  }
  return (value.review == null || isRecord(value.review) && ['ACCEPT', 'REQUEST_CHANGES'].includes(String(value.review.decision)) && shortText(value.review.comment, 10000))
    && (value.approval == null || isRecord(value.approval) && (value.approval.approvedAt == null || stamp(value.approval.approvedAt)) && (value.approval.comment == null || shortText(value.approval.comment, 10000)));
}
export function checkedDocumentVersion(value: unknown, documentId: string, versionId: string) {
  if (!version(value, documentId) || value.id !== versionId) throw new InvalidReadResponse();
  return value;
}
export function checkedDocumentVersions(value: unknown, documentId: string, page: number) {
  return checkedPage(value, { page, pageSize: 10 }, (item): item is DocumentVersionReadDto => version(item, documentId));
}
export function checkedDocumentHistory(value: unknown, documentId: string, page: number) {
  return checkedPage(value, { page, pageSize: 10 }, (item): item is DocumentHistoryReadDto => isRecord(item) && item.documentId === documentId
    && (item.versionId == null || id(item.versionId)) && shortText(item.action, 200) && Boolean(item.action.trim()) && stamp(item.occurredAt)
    && isRecord(item.actor) && (item.actor.id === null || id(item.actor.id)) && (item.actor.displayName === null || shortText(item.actor.displayName, 500))
    && (item.reason == null || shortText(item.reason, 10000)));
}
