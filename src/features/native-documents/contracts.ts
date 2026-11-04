import { z } from 'zod';
import { nativeId } from '../native-operations/contracts';
import { checkedNativeDirectory } from '../native-operations/directory';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { isCivilDate } from '../documents/validation';
import { isIsoInstant } from '../../shared/auth/session-response';

const civil = z.string().refine(isCivilDate), instant = z.string().refine(isIsoInstant);
const count = z.number().int().min(0).max(2147483647), revision = z.number().int().min(1).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/i).transform(v => v.toLowerCase());
export const documentStatuses = ['RASCUNHO', 'EM_REVISAO', 'APROVADO', 'VIGENTE', 'VENCIDO', 'SUBSTITUIDO', 'ARQUIVADO'] as const;
export const statusLabels: Record<string, string> = { RASCUNHO: 'Rascunho', EM_REVISAO: 'Em conferência', APROVADO: 'Aprovado', VIGENTE: 'Vigente', VENCIDO: 'Vencido', SUBSTITUIDO: 'Substituído', ARQUIVADO: 'Arquivado', EM_REVISAO_VERSAO: 'Em conferência', APROVADA: 'Aprovada', SUBSTITUIDA: 'Substituída', REJEITADA: 'Reprovada' };
const secrecy = z.enum(['Publico', 'Interno', 'Restrito', 'Medico']);
const metadata = z.string().max(1000000).refine(value => { try { const data = JSON.parse(value); return data && typeof data === 'object' && !Array.isArray(data); } catch { return false; } });
const documentFields = z.object({ id: nativeId, documentTypeId: nativeId, companyId: nativeId, unitId: nativeId.nullable(), departmentId: nativeId.nullable(),
  ownerId: nativeId, code: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(255), description: z.string().max(2000).nullable(),
  status: z.enum(documentStatuses), secrecyLevel: secrecy, issueDate: civil, validFromDate: civil.nullable(), validUntilDate: civil.nullable(),
  keywords: z.array(z.string()), metadata, active: z.literal(true), revision, currentVersionNumber: count,
});
const document = documentFields.refine(v => !v.departmentId || Boolean(v.unitId))
  .refine(v => !v.validFromDate || !v.validUntilDate || v.validUntilDate >= v.validFromDate);
export type NativeDocument = z.infer<typeof document>;
export type DocumentScope = { companyIds: readonly string[]; unitIds: readonly string[]; sectorIds: readonly string[] };
export function checkedDocument(value: unknown, id: string | undefined, scope: DocumentScope, unitId?: string) {
  const parsed = document.safeParse(value);
  if (!parsed.success || id && parsed.data.id !== id || unitId && parsed.data.unitId !== unitId
    || !(scope.companyIds.includes(parsed.data.companyId) || parsed.data.unitId && scope.unitIds.includes(parsed.data.unitId)
      || parsed.data.departmentId && scope.sectorIds.includes(parsed.data.departmentId))) throw new InvalidReadResponse();
  return parsed.data;
}
const version = z.object({ id: nativeId, documentId: nativeId, storedFileId: nativeId, versionNumber: revision, fileHash: hash,
  justification: z.string().max(2000).nullable(), state: z.enum(['RASCUNHO', 'EM_REVISAO', 'APROVADA', 'VIGENTE', 'SUBSTITUIDA', 'REJEITADA']),
  isCurrent: z.boolean(), authorId: nativeId, approverId: nativeId.nullable(), approvedAt: instant.nullable(), reviewedAt: instant.nullable(), createdAt: instant,
}).refine(v => v.isCurrent === (v.state === 'VIGENTE'));
export type NativeDocumentVersion = z.infer<typeof version>;
export function checkedVersion(value: unknown, documentId: string) {
  const parsed = version.safeParse(value);
  if (!parsed.success || parsed.data.documentId !== documentId) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedVersions(value: unknown, item: NativeDocument) {
  if (!Array.isArray(value)) throw new InvalidReadResponse();
  const versions = value.map(v => checkedVersion(v, item.id));
  if (new Set(versions.map(v => v.id)).size !== versions.length || new Set(versions.map(v => v.versionNumber)).size !== versions.length
    || versions.filter(v => v.isCurrent).length > 1 || versions.some(v => v.versionNumber > item.currentVersionNumber)
    || item.currentVersionNumber > 0 && !versions.some(v => v.versionNumber === item.currentVersionNumber)) throw new InvalidReadResponse();
  return versions.sort((a, b) => b.versionNumber - a.versionNumber);
}
const mime = z.enum(['application/pdf', 'image/png', 'image/jpeg']);
const policy = z.object({ maxSizeBytes: z.number().int().min(1).max(50 * 1024 * 1024), allowedMimeTypes: z.array(mime).min(1) });
export type FilePolicy = z.infer<typeof policy>;
export function checkedFilePolicy(value: unknown) { const parsed = policy.safeParse(value); if (!parsed.success || new Set(parsed.data.allowedMimeTypes).size !== parsed.data.allowedMimeTypes.length) throw new InvalidReadResponse(); return parsed.data; }
const typeSummary = z.object({ id: nativeId, code: z.string().min(1), name: z.string().min(1), category: z.string(), active: z.literal(true) });
export function checkedDocumentTypes(value: unknown) { const parsed = z.array(typeSummary).safeParse(value); if (!parsed.success || new Set(parsed.data.map(v => v.id)).size !== parsed.data.length) throw new InvalidReadResponse(); return parsed.data; }
export function checkedDocumentType(value: unknown, id: string) {
  const parsed = typeSummary.extend({ secrecyLevel: secrecy, metadataSchema: metadata, requiresSignature: z.boolean(), requiresApproval: z.boolean() }).safeParse(value);
  if (!parsed.success || parsed.data.id !== id) throw new InvalidReadResponse(); return parsed.data;
}
export function checkedDocumentDirectory(value: unknown) {
  const base = checkedNativeDirectory(value);
  const parsed = z.object({ sectors: z.array(z.object({ id: nativeId, unitId: nativeId, name: z.string().min(1), status: z.enum(['ACTIVE', 'INACTIVE']) })) }).safeParse(value);
  if (!parsed.success || new Set(parsed.data.sectors.map(v => v.id)).size !== parsed.data.sectors.length
    || parsed.data.sectors.some(v => !base.units.some(u => u.id === v.unitId))) throw new InvalidReadResponse();
  return { ...base, sectors: parsed.data.sectors };
}
export function nativeDocumentReturn(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000 || value && !value.startsWith('?') || /[#\u0000-\u001f]/.test(value)) return '';
  const params = new URLSearchParams(value);
  if ([...params.keys()].some(key => params.getAll(key).length > 1)) return '';
  return value;
}
