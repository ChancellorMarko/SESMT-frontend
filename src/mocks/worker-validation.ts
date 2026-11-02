import { z } from 'zod';
import type { WorkerDto } from '../shared/contracts';
import { isCivilDate } from '../features/documents/validation';

const civilDate = z.string().refine(isCivilDate, 'Informe uma data civil válida.');
const assignment = z.object({
  companyId: z.string().min(1).optional(), unitId: z.string().min(1), sectorId: z.string().min(1),
  jobId: z.string().min(1).nullable().optional(), jobFunctionId: z.string().min(1).nullable().optional(),
  workCenterId: z.string().min(1).nullable().optional(), managerId: z.string().min(1).nullable().optional(),
}).strict();
const editable = {
  registration: z.string().trim().min(1, 'Informe a matrícula.').max(80),
  fullName: z.string().trim().min(2, 'Informe o nome completo.').max(160),
  employmentType: z.string().trim().min(1, 'Informe o tipo de vínculo.').max(80),
  managerId: z.string().min(1).nullable().optional(),
};
const create = assignment.extend({ ...editable, companyId: z.string().min(1), admissionDate: civilDate }).strict();
const patch = z.object(editable).partial().strict().refine(value => Object.keys(value).length > 0, 'Informe ao menos um campo para alterar.');
const movement = z.object({
  type: z.enum(['ADMISSION', 'TRANSFER', 'LEAVE', 'RETURN', 'TERMINATION']),
  effectiveDate: civilDate, reason: z.string().trim().min(2, 'Descreva o motivo da movimentação.').max(2000),
  newAssignment: assignment.optional(),
}).strict();
const integration = z.object({
  status: z.enum(['INTEGRATED', 'PENDING', 'EXPIRED', 'NOT_APPLICABLE']), integratedAt: civilDate,
  validUntil: civilDate.optional(), responsibleId: z.string().min(1).optional(),
  responsibleName: z.string().trim().max(160).optional(), evidenceFileName: z.string().trim().max(255).optional(),
  evidenceId: z.string().trim().min(1).max(100).optional(), policyVersion: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict().refine(value => !value.validUntil || value.validUntil >= value.integratedAt, { path: ['validUntil'], message: 'A validade não pode ser anterior à realização.' });

export class WorkerMutationError extends Error {
  readonly status = 422;
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string, public field?: string) { super(message); }
}
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new WorkerMutationError(issue.message, issue.path.join('.') || undefined);
}
export const workerCreatePayload = (body: unknown) => parse(create, body);
export const workerPatchPayload = (body: unknown) => parse(patch, body);
export const workerIntegrationPayload = (body: unknown) => parse(integration, body);
export function workerMovementPayload(body: unknown, worker: WorkerDto, today: string) {
  const value = parse(movement, body);
  const allowed: Record<WorkerDto['status'], readonly string[]> = { ACTIVE: ['TRANSFER', 'LEAVE', 'TERMINATION'], ON_LEAVE: ['RETURN', 'TERMINATION'], TERMINATED: ['ADMISSION'] };
  if (!allowed[worker.status].includes(value.type)) throw new WorkerMutationError('Esta movimentação não é compatível com a situação atual.', 'type');
  if (value.effectiveDate < worker.admissionDate || value.effectiveDate > today) throw new WorkerMutationError('A data efetiva deve estar entre a admissão e hoje.', 'effectiveDate');
  const changesAssignment = value.type === 'TRANSFER' || value.type === 'ADMISSION';
  if (changesAssignment && !value.newAssignment) throw new WorkerMutationError('Informe o vínculo de destino.', 'newAssignment');
  if (!changesAssignment && value.newAssignment) throw new WorkerMutationError('Esta movimentação não altera o vínculo.', 'newAssignment');
  return value;
}
