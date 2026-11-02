import { documentIds, documentDirectory, documentScope } from './native-documents';

// Synthetic contract data, never an operational worker/account.
export const workerIds = { ...documentIds, position: '72000000-0000-4000-8000-000000000001' };
export const workerScope = documentScope;
export const workerDirectory = { ...documentDirectory, jobs: [{ id: workerIds.position, companyId: workerIds.company, name: 'Técnico de manutenção', status: 'ACTIVE' }], establishments: [], jobFunctions: [], workCenters: [] };
export const workerDraft = { name: 'Pessoa Fictícia', enrollment: 'QA-001', cpf: '00000000191', dateOfBirth: '1990-01-01', admissionDate: '2026-01-01', departmentId: workerIds.sector, positionId: workerIds.position };
export function workerReceipt() { const { cpf: _cpf, ...identity } = workerDraft; return { ...identity, id: workerIds.worker, companyId: workerIds.company, unitId: workerIds.unit,
  userId: null, dismissalDate: null, cpfMasked: '***.***.***-91', active: true }; }
export function workerProfile() { return { id: workerIds.worker, companyId: workerIds.company, unitId: workerIds.unit, sectorId: workerIds.sector, jobId: workerIds.position,
  fullName: workerDraft.name, registration: workerDraft.enrollment, admissionDate: workerDraft.admissionDate, status: 'ACTIVE', employmentType: null,
  revision: null, sourceReadOnly: true }; }
