import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import type { Training } from './contracts';

const id = z.guid(), hash = z.string().regex(/^[a-f0-9]{64}$/), positive = z.number().int().positive();
export const evidenceStates = { EMPTY: 'Sem comprovante vinculado', CURRENT: 'Vínculo atualizado', UNAVAILABLE: 'Comprovante indisponível neste acesso',
  TRAINING_CHANGED: 'Treinamento alterado: confira o vínculo', DOCUMENT_CHANGED: 'Documento alterado: confira a versão', EXPIRED: 'Revisar vigência do documento',
  SIGNATURE_PENDING: 'Assinatura documental pendente', REVOKED: 'Treinamento invalidado' } as const;
const binding = z.object({ documentId: id, versionId: id, versionNumber: positive, documentRevision: positive,
  code: z.string().trim().min(1), title: z.string().trim().min(1), fileHash: hash, linkedTrainingRevision: positive, linkedAt: z.string().datetime({ offset: true }) });
const receipt = z.object({ trainingId: id, unitId: id, trainingRevision: positive, canManage: z.boolean(),
  state: z.enum(['EMPTY', 'CURRENT', 'UNAVAILABLE', 'TRAINING_CHANGED', 'DOCUMENT_CHANGED', 'EXPIRED', 'SIGNATURE_PENDING', 'REVOKED']), evidence: binding.nullable() });
export type EvidenceReceipt = z.infer<typeof receipt>;
const option = z.object({ documentId: id, versionId: id, documentRevision: positive, versionNumber: positive,
  code: z.string().trim().min(1), title: z.string().trim().min(1), fileHash: hash });
export type EvidenceOption = z.infer<typeof option>;
export function checkedEvidence(value: unknown, training: Pick<Training, 'id' | 'unitId' | 'revision'>, ownOnly: boolean) {
  const parsed = receipt.safeParse(value);
  if (!parsed.success || parsed.data.trainingId !== training.id || parsed.data.unitId !== training.unitId || parsed.data.trainingRevision !== training.revision
    || ownOnly && parsed.data.canManage || ['EMPTY', 'UNAVAILABLE'].includes(parsed.data.state) !== (parsed.data.evidence === null)
    || parsed.data.evidence && parsed.data.evidence.linkedTrainingRevision > training.revision
    || parsed.data.state === 'CURRENT' && parsed.data.evidence?.linkedTrainingRevision !== training.revision) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedEvidenceOptions(value: unknown, training: Training, page: number, q: string) {
  const parsed = z.object({ trainingId: z.literal(training.id), unitId: z.literal(training.unitId), trainingRevision: z.literal(training.revision),
    items: z.array(option), total: z.number().int().nonnegative(), page: z.literal(page), pageSize: z.literal(20) }).safeParse(value);
  if (!parsed.success || parsed.data.items.length !== Math.min(20, Math.max(parsed.data.total - (page - 1) * 20, 0))
    || new Set(parsed.data.items.map(i => i.versionId)).size !== parsed.data.items.length
    || parsed.data.items.some(i => !`${i.code} ${i.title}`.toLowerCase().includes(q.toLowerCase()))) throw new InvalidReadResponse();
  return parsed.data;
}
export function sameBinding(receipt: EvidenceReceipt, expected: EvidenceOption) {
  const value = receipt.evidence;
  return value !== null && value.documentId === expected.documentId && value.versionId === expected.versionId && value.documentRevision === expected.documentRevision
    && value.versionNumber === expected.versionNumber && value.fileHash === expected.fileHash && value.linkedTrainingRevision === receipt.trainingRevision;
}
