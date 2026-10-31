import { describe, expect, it } from 'vitest';
import { checkedDocumentDetail, checkedDocumentHistory, checkedDocumentVersion, checkedDocumentVersions } from './document-read';

const metadata = { code: 'DOC-1', title: 'Documento', typeId: 'type-a', companyId: 'company-a', unitId: 'unit-a', ownerId: 'user-a', accessClass: 'INTERNAL', issueDate: '2026-10-01' };
const document = { ...metadata, id: 'doc-a', status: 'ACTIVE', revision: 1, activeVersionIds: ['version-a'], currentVersionId: 'version-a', workerIds: ['worker-a'], responsibleIds: [], keywords: [], availableActions: [] };
const file = { id: 'file-a', name: 'arquivo.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'test-hash', scanStatus: 'CLEAN' };
const version = { id: 'version-a', documentId: 'doc-a', versionNumber: 1, reason: 'Revisão', status: 'ACTIVE', revision: 1, metadataSnapshot: metadata, file, createdAt: '2026-10-01T12:00:00Z', createdBy: 'user-a', signatureEvidences: [], availableActions: [] };
const page = (items: unknown[], number = 1) => ({ items, total: items.length, page: number, pageSize: 10 });

describe('leitura de documento e versões', () => {
  it('aceita metadados atuais e lacunas nativas sem fabricar snapshots', () => {
    expect(checkedDocumentDetail(document, 'doc-a', 'unit-a')).toBe(document);
    expect(checkedDocumentDetail({ ...document, sourceReadOnly: true, unitId: null, revision: null }, 'doc-a', 'unit-a').sourceReadOnly).toBe(true);
    const native = { ...version, sourceReadOnly: true, revision: null, reason: null, metadataSnapshot: null, file: null };
    expect(checkedDocumentVersion(native, 'doc-a', 'version-a')).toBe(native);
  });
  it.each([{ id: 'doc-b' }, { unitId: 'unit-b' }, { availableActions: null }, { workerIds: [null] }, { keywords: {} }, { currentVersionId: '../version-b' }, { sourceReadOnly: 'true' }])('recusa detalhes incompatíveis: %j', change => {
    expect(() => checkedDocumentDetail({ ...document, ...change }, 'doc-a', 'unit-a')).toThrow();
  });
  it.each([{ id: 'version-b' }, { documentId: 'doc-b' }, { signatureEvidences: null }, { versionNumber: 0 }, { file: { ...file, scanStatus: 'UNKNOWN' } }, { metadataSnapshot: null }, { revision: null }, { sourceReadOnly: true, revision: null }])('recusa outra versão ou conteúdo inconsistente: %j', change => {
    expect(() => checkedDocumentVersion({ ...version, ...change }, 'doc-a', 'version-a')).toThrow();
  });
  it('preserva snapshot autorizado de outra unidade e recusa evidência de outra versão', () => {
    expect(checkedDocumentVersion({ ...version, metadataSnapshot: { ...metadata, unitId: 'unit-b' } }, 'doc-a', 'version-a').metadataSnapshot?.unitId).toBe('unit-b');
    expect(() => checkedDocumentVersion({ ...version, signatureEvidences: [{ id: 'evidence-a', versionId: 'version-b', signerName: 'Responsável', signedAt: version.createdAt, method: 'UPLOADED_EVIDENCE', evidenceFileId: file.id, file, verificationStatus: 'VERIFIED' }] }, 'doc-a', 'version-a')).toThrow();
  });
  it('confere paginação e vínculo em todas as versões e eventos', () => {
    expect(checkedDocumentVersions(page([version]), 'doc-a', 1).total).toBe(1);
    expect(() => checkedDocumentVersions(page([{ ...version, documentId: 'doc-b' }]), 'doc-a', 1)).toThrow();
    expect(() => checkedDocumentVersions(page([version], 2), 'doc-a', 1)).toThrow();
    const event = { id: 'event-a', documentId: 'doc-a', versionId: null, action: 'DOCUMENT_CREATED', occurredAt: version.createdAt, actor: { id: null, displayName: null } };
    expect(checkedDocumentHistory(page([event]), 'doc-a', 1).total).toBe(1);
    expect(() => checkedDocumentHistory(page([{ ...event, documentId: 'doc-b' }]), 'doc-a', 1)).toThrow();
    expect(() => checkedDocumentHistory(page([{ ...event, actor: null }]), 'doc-a', 1)).toThrow();
  });
});
