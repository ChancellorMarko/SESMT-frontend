import type { FileDto } from './index';

/** Proposed integration proof contract; production rules and storage belong to the API. */
export interface WorkerIntegrationPolicyDto {
  version: string; evidenceRequired: boolean; allowNotApplicable: boolean;
  maxFileSizeBytes: number; allowedMimeTypes: string[]; description: string;
}
export interface WorkerIntegrationEvidenceDto {
  id: string; workerId: string; companyId: string; unitId: string;
  source: 'UPLOAD' | 'DOCUMENT_VERSION'; documentId?: string; documentVersionId?: string;
  file: FileDto; status: 'PENDING' | 'APPROVED' | 'REJECTED'; revision: number;
  submittedAt: string; submittedBy: string; submittedByName: string;
  reviewedAt?: string; reviewedBy?: string; reviewedByName?: string; reviewComment?: string;
}
export interface WorkerIntegrationOptionsDto {
  policy: WorkerIntegrationPolicyDto;
  documents: { documentId: string; title: string; code: string; versions: { id: string; versionNumber: number; file: FileDto }[] }[];
}
export interface WorkerIntegrationEvidenceReviewDto { decision: 'APPROVE' | 'REJECT'; comment: string; confirmed: true }
