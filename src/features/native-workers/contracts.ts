import { z } from 'zod';
import { nativeId } from '../native-operations/contracts';
import { checkedDocumentDirectory } from '../native-documents/contracts';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { isCivilDate } from '../documents/validation';
import { NativeFormError } from '../native-operations/NativeCommandDialog';

export function checkedWorkerDirectory(value: unknown) {
  const base = checkedDocumentDirectory(value);
  const jobs = z.object({ jobs: z.array(z.object({ id: nativeId, companyId: nativeId, name: z.string().min(1), status: z.enum(['ACTIVE', 'INACTIVE']) })) }).safeParse(value);
  if (!jobs.success || new Set(jobs.data.jobs.map(j => j.id)).size !== jobs.data.jobs.length || jobs.data.jobs.some(j => !base.companies.some(c => c.id === j.companyId))) throw new InvalidReadResponse();
  return { ...base, jobs: jobs.data.jobs };
}
export function normalizedCpf(raw: string): string | undefined {
  const value = raw.replace(/[.\-\s]/g, '');
  if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return;
  for (let length = 9; length <= 10; length++) {
    const sum = [...value.slice(0, length)].reduce((result, digit, index) => result + Number(digit) * (length + 1 - index), 0);
    const rest = sum % 11, check = rest < 2 ? 0 : 11 - rest;
    if (check !== Number(value[length])) return;
  }
  return value;
}
export interface WorkerDraft { name: string; enrollment: string; cpf: string; dateOfBirth: string; admissionDate: string; departmentId: string; positionId: string }
export function workerCreateBody(draft: WorkerDraft, companyId: string, unitId: string, today: string) {
  const name = draft.name.trim().replace(/ +/g, ' '), enrollment = draft.enrollment.trim(), cpf = normalizedCpf(draft.cpf);
  if (name.length < 2 || name.length > 200 || /[\p{Nd}\p{Cc}]/u.test(name) || !enrollment || enrollment.length > 30 || /\p{Cc}/u.test(enrollment)) throw new NativeFormError('Informe nome e matrícula válidos. O nome não pode conter números.');
  if (!cpf) throw new NativeFormError('Confira os 11 dígitos do CPF.');
  if (!isCivilDate(draft.dateOfBirth) || !isCivilDate(draft.admissionDate) || draft.dateOfBirth > today || draft.dateOfBirth > draft.admissionDate) throw new NativeFormError('Confira nascimento e admissão. O nascimento não pode ser futuro nem posterior à admissão.');
  if (![companyId, unitId, ...[draft.departmentId, draft.positionId].filter(Boolean)].every(id => nativeId.safeParse(id).success)) throw new NativeFormError('Confira a unidade, o setor e o cargo selecionados.');
  return { companyId, unitId, name, enrollment, cpf, dateOfBirth: draft.dateOfBirth, admissionDate: draft.admissionDate,
    departmentId: draft.departmentId || null, positionId: draft.positionId || null, dismissalDate: null, userId: null };
}
export type WorkerCreateBody = ReturnType<typeof workerCreateBody>;
const receipt = z.object({ id: nativeId, companyId: nativeId, unitId: nativeId, departmentId: nativeId.nullable(), positionId: nativeId.nullable(), userId: nativeId.nullable(),
  name: z.string().min(2), enrollment: z.string().min(1), cpfMasked: z.string(), dateOfBirth: z.string().refine(isCivilDate), admissionDate: z.string().refine(isCivilDate), dismissalDate: z.string().nullable(), active: z.literal(true) });
/** Verify the native receipt locally; retain only the ID, never cache identity-document fields. */
export function checkedWorkerCreated(value: unknown, body: WorkerCreateBody) {
  const result = receipt.safeParse(value);
  if (!result.success || result.data.cpfMasked !== `***.***.***-${body.cpf.slice(-2)}` || result.data.dismissalDate !== null || result.data.userId !== null) throw new InvalidReadResponse();
  for (const key of ['companyId', 'unitId', 'departmentId', 'positionId', 'name', 'enrollment', 'dateOfBirth', 'admissionDate'] as const) if (result.data[key] !== body[key]) throw new InvalidReadResponse();
  return result.data.id;
}
