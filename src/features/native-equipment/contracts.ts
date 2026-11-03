import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

const id = z.string().uuid(), text = z.string().trim().min(1), day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value);
export const equipmentSchema = z.object({ id, companyId: id, code: text.max(30), name: text.max(160), approvalCertificate: z.string().max(30).nullable(), manufacturer: z.string().max(120).nullable(), model: z.string().max(120).nullable(), revision: z.number().int().positive() });
export const deliverySchema = z.object({ id, companyId: id, unitId: id, workerId: id, workerName: text, equipmentId: id, equipmentCode: text, equipmentName: text, approvalCertificate: z.string().nullable(),
  quantity: z.number().int().min(1).max(1000), size: z.string().max(30).nullable(), deliveredOn: day, replacementOn: day.nullable(), notes: z.string().max(500).nullable(), returnedOn: day.nullable(), returnReason: z.string().max(200).nullable(), revision: z.number().int().positive() })
  .refine(value => (!value.replacementOn || value.replacementOn >= value.deliveredOn) && (!value.returnedOn || value.returnedOn >= value.deliveredOn && Boolean(value.returnReason)));
const contextSchema = z.object({ unitId: id, companyId: id, unitName: text, ownOnly: z.boolean(), canCreate: z.boolean(), canEdit: z.boolean(), canDeliver: z.boolean(), canReturn: z.boolean(),
  workers: z.array(z.object({ id, name: text, enrollment: text })), equipment: z.array(z.object({ id, name: text, code: text })) });
export type Equipment = z.infer<typeof equipmentSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type EquipmentContext = z.infer<typeof contextSchema>;
export type EquipmentScope = { unitId: string; companyIds: readonly string[]; ownOnly: boolean; workerId?: string | null };
export function checkedEquipmentContext(value: unknown, scope: EquipmentScope) {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success || parsed.data.unitId !== scope.unitId || !scope.companyIds.includes(parsed.data.companyId) || parsed.data.ownOnly !== scope.ownOnly
    || [parsed.data.workers, parsed.data.equipment].some(rows => new Set(rows.map(row => row.id)).size !== rows.length)
    || scope.ownOnly && (parsed.data.canCreate || parsed.data.canEdit || parsed.data.canDeliver || parsed.data.canReturn || parsed.data.workers.length)) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedEquipment(value: unknown, scope: EquipmentScope): Equipment {
  const parsed = equipmentSchema.safeParse(value);
  if (!parsed.success || !scope.companyIds.includes(parsed.data.companyId)) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedDelivery(value: unknown, scope: EquipmentScope): Delivery {
  const parsed = deliverySchema.safeParse(value);
  if (!parsed.success || !scope.companyIds.includes(parsed.data.companyId) || parsed.data.unitId !== scope.unitId || scope.ownOnly && parsed.data.workerId !== scope.workerId) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedEquipmentPage(value: unknown, scope: EquipmentScope, page: number, deliveries: boolean) {
  const parsed = z.object({ items: z.array(z.unknown()), total: z.number().int().nonnegative(), page: z.literal(page), pageSize: z.literal(20) }).safeParse(value);
  if (!parsed.success || parsed.data.items.length > 20 || parsed.data.items.length > parsed.data.total) throw new InvalidReadResponse();
  const items = parsed.data.items.map(item => deliveries ? checkedDelivery(item, scope) : checkedEquipment(item, scope));
  if (new Set(items.map(item => item.id)).size !== items.length) throw new InvalidReadResponse();
  return { ...parsed.data, items };
}
export const catalogFields = z.object({ code: text.max(30).transform(value => value.toUpperCase()), name: text.max(160), approvalCertificate: z.string().trim().max(30), manufacturer: z.string().trim().max(120), model: z.string().trim().max(120) });
export const deliveryFields = z.object({ workerId: id, equipmentId: id, quantity: z.number().int().min(1).max(1000), size: z.string().trim().max(30), deliveredOn: day, replacementOn: z.union([day, z.literal('')]), notes: z.string().trim().max(500) })
  .refine(value => !value.replacementOn || value.replacementOn >= value.deliveredOn, 'A troca prevista deve ser posterior ou igual à entrega.');
export function localEquipmentDay() {
  const parts = new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date());
  return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export const equipmentDay = (value: string | null) => value ? value.split('-').reverse().join('/') : '—';
