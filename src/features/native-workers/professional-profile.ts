import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
const id = z.string().uuid();
const profile = z.object({ id, companyId: id, unitId: id, departmentId: id.nullable(), positionId: id.nullable(),
  name: z.string().trim().min(1).max(200), enrollment: z.string().trim().min(1).max(30), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const context = z.object({ worker: profile, unitName: z.string().trim().min(1).max(150), requiresDepartment: z.boolean(),
  departments: z.array(z.object({ id, name: z.string().trim().min(1).max(150) })), positions: z.array(z.object({ id, name: z.string().trim().min(1).max(150) })) });
export type ProfessionalProfile = z.infer<typeof profile>;
export type ProfessionalContext = z.infer<typeof context>;
export function checkedProfessionalContext(value: unknown, expected: { id: string; unitId: string; companyIds: readonly string[] }): ProfessionalContext {
  const parsed = context.safeParse(value);
  if (!parsed.success || parsed.data.worker.id !== expected.id || parsed.data.worker.unitId !== expected.unitId || !expected.companyIds.includes(parsed.data.worker.companyId)
    || [parsed.data.departments, parsed.data.positions].some(rows => new Set(rows.map(row => row.id)).size !== rows.length)) throw new InvalidReadResponse();
  return parsed.data;
}
export const professionalFields = z.object({ name: z.string().trim().min(3, 'Informe o nome completo.').max(200).transform(value => value.split(' ').filter(Boolean).join(' ')).refine(value => !/\d/.test(value), 'O nome não pode conter números.').refine(value => value.split(/\s+/).length > 1, 'Informe nome e sobrenome.'),
  enrollment: z.string().trim().min(1, 'Informe a matrícula.').max(30), departmentId: id.nullable(), positionId: id.nullable(), reason: z.string().trim().min(3, 'Informe o motivo da alteração.').max(200) });
export function checkedProfessionalReceipt(value: unknown, opening: ProfessionalProfile, fields: z.infer<typeof professionalFields>) {
  const parsed = profile.safeParse(value);
  if (!parsed.success || parsed.data.id !== opening.id || parsed.data.companyId !== opening.companyId || parsed.data.unitId !== opening.unitId || parsed.data.revision !== opening.revision + 1
    || ['name','enrollment','departmentId','positionId'].some(key => parsed.data[key as keyof typeof parsed.data] !== fields[key as keyof typeof fields])) throw new InvalidReadResponse();
  return parsed.data;
}
