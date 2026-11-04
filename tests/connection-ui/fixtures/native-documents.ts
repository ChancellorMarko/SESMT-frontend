import { createHash } from 'node:crypto';
import type { NativeDocument, NativeDocumentVersion } from '../../../src/features/native-documents/contracts';

// Controlled contract fixtures. No real worker, company or file is used by these tests.
export const documentIds = { company: '71000000-0000-4000-8000-000000000001', unit: '71000000-0000-4000-8000-000000000002',
  user: '71000000-0000-4000-8000-000000000003', type: '71000000-0000-4000-8000-000000000004', document: '71000000-0000-4000-8000-000000000005',
  version: '71000000-0000-4000-8000-000000000006', file: '71000000-0000-4000-8000-000000000007', worker: '71000000-0000-4000-8000-000000000008',
  foreign: '71000000-0000-4000-8000-000000000009', sector: '71000000-0000-4000-8000-000000000010' };
export const pdfContent = '%PDF-1.7\nDocumento ficticio para teste\n%%EOF';
export const pdfHash = createHash('sha256').update(pdfContent).digest('hex');
const ids = documentIds;
export function nativeDocumentFixture(): NativeDocument { return { id: ids.document, documentTypeId: ids.type, companyId: ids.company, unitId: ids.unit, departmentId: null,
  ownerId: ids.user, code: 'NR-TESTE', title: 'Certificado de treinamento', description: null, status: 'RASCUNHO', secrecyLevel: 'Interno',
  issueDate: '2026-10-01', validFromDate: null, validUntilDate: '2027-10-01', keywords: [], metadata: '{}', active: true, revision: 1, currentVersionNumber: 0 }; }
export function nativeVersionFixture(): NativeDocumentVersion { return { id: ids.version, documentId: ids.document, storedFileId: ids.file, versionNumber: 1, fileHash: pdfHash,
  justification: null, state: 'EM_REVISAO', isCurrent: false, authorId: ids.user, approverId: null, approvedAt: null, reviewedAt: null, createdAt: '2026-11-01T12:00:00Z' }; }
export function nativeTypeFixture() { return { id: ids.type, code: 'TREINAMENTO', name: 'Treinamento', category: 'Treinamento', secrecyLevel: 'Interno',
  active: true, metadataSchema: '{}', requiresSignature: false, requiresApproval: true }; }
export const documentFilePolicy = { maxSizeBytes: 1024 * 1024, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'] };
export const documentScope = { companyIds: [ids.company], unitIds: [ids.unit], sectorIds: [ids.sector], teamIds: [], ownOnly: false };
export const documentDirectory = { companies: [{ id: ids.company, name: 'Empresa autorizada', status: 'ACTIVE' }], units: [{ id: ids.unit, companyId: ids.company, name: 'Unidade Matriz', status: 'ACTIVE' }], sectors: [{ id: ids.sector, unitId: ids.unit, name: 'Manutenção', status: 'ACTIVE' }] };
