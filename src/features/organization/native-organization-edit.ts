import { z } from 'zod';
import { api } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedOrganization, companyFields, departmentFields, positionFields, unitFields, type OrganizationResource } from './native-organization';
const id = z.string().uuid(), text = z.string(), nullable = text.nullable(), version = z.string().regex(/^[a-f0-9]{64}$/);
const common = { id, companyId: id, unitId: id.nullable(), version };
const profile = z.discriminatedUnion('resource', [
  z.object({ ...common, resource: z.literal('companies'), values: z.object({ corporateName: text.max(255), fantasyName: text.max(255), cnpj: text.length(14), tipoEmpresa: z.enum(['INTERNA','PRESTADORA']), email: nullable, phone: nullable }).strict() }).strict(),
  z.object({ ...common, resource: z.literal('units'), values: z.object({ companyId: id, code: text.max(50), name: text.max(150), type: text.max(30), cep: nullable, address: nullable, number: nullable, complement: nullable, neighborhood: nullable, city: nullable, state: nullable }).strict() }).strict(),
  z.object({ ...common, resource: z.literal('departments'), values: z.object({ unitId: id, name: text.max(150), description: nullable, responsibleId: id.nullable() }).strict() }).strict(),
  z.object({ ...common, resource: z.literal('positions'), values: z.object({ companyId: id, name: text.max(150), description: nullable, cbo: nullable }).strict() }).strict(),
]);
export type OrganizationEditProfile = z.infer<typeof profile>;
export function checkedEditProfile(value: unknown, resource: OrganizationResource, expectedId: string, companies: readonly string[], expectedUnit?: string | null): OrganizationEditProfile {
  const p = profile.safeParse(value);
  if (!p.success || p.data.resource !== resource || p.data.id !== expectedId || !companies.includes(p.data.companyId)
    || expectedUnit !== undefined && p.data.unitId !== expectedUnit
    || p.data.resource === 'companies' && (p.data.companyId !== p.data.id || p.data.unitId !== null)
    || p.data.resource === 'units' && (p.data.values.companyId !== p.data.companyId || p.data.unitId !== p.data.id)
    || p.data.resource === 'departments' && p.data.values.unitId !== p.data.unitId
    || p.data.resource === 'positions' && (p.data.values.companyId !== p.data.companyId || p.data.unitId !== null)) throw new InvalidReadResponse();
  return p.data;
}
export function checkedOrganizationHistory(value: unknown) {
  const p = z.array(z.object({ id, actorName: text.nullable(), occurredAt: z.string().datetime({ offset: true }), version, reason: z.string().max(200).nullable() }).strict()).safeParse(value);
  if (!p.success || new Set(p.data.map(e => e.id)).size !== p.data.length) throw new InvalidReadResponse(); return p.data;
}
export function fieldsForEdit(p: OrganizationEditProfile): Record<string,string> {
  return Object.fromEntries(Object.entries(p.values).map(([key,value]) => [key,value ?? '']));
}
export async function saveOrganizationEdit(opening: OrganizationEditProfile, fields: Record<string,string>, reason: string, confirmed: boolean, signal: AbortSignal) {
  const schema = opening.resource === 'companies' ? companyFields : opening.resource === 'units' ? unitFields.extend({ type: z.string().trim().min(1).max(30) }) : opening.resource === 'departments' ? departmentFields : positionFields;
  const parsed = schema.safeParse(fields);
  if (!parsed.success || !confirmed || reason.trim().length < 3 || reason.trim().length > 200) throw new NativeFormError(parsed.success ? 'Informe o motivo e confirme as alterações.' : parsed.error.issues[0].message);
  const context = checkedOrganization(await api.get<unknown>('/organization-management',{signal}));
  if (!context[opening.resource].some(r => r.id === opening.id && r.canEdit)) throw new NativeContextConflict('O acesso ao cadastro mudou. Atualize a consulta.');
  const path = `/organization-management/${opening.resource}/${opening.id}`;
  const read = (raw: unknown) => checkedEditProfile(raw,opening.resource,opening.id,[opening.companyId],opening.unitId);
  const fresh = read(await api.get<unknown>(path,{signal}));
  if (fresh.version !== opening.version) throw new NativeContextConflict('O cadastro foi alterado. Seus dados foram mantidos. Feche a janela e atualize a consulta.');
  const values: Record<string,unknown> = { ...parsed.data, ...(opening.resource === 'departments' ? { responsibleId: opening.values.responsibleId } : {}) };
  for (const key of ['email','phone','description','cbo','complement']) if (values[key] === '') values[key] = null;
  if (opening.resource === 'companies' && (values.cnpj !== opening.values.cnpj || values.tipoEmpresa !== opening.values.tipoEmpresa)
    || 'companyId' in opening.values && values.companyId !== opening.values.companyId
    || opening.resource === 'departments' && values.unitId !== opening.values.unitId) throw new NativeFormError('Preserve a identidade e o vínculo do cadastro.');
  const saved = read(await api.patch<unknown>(path,{expectedVersion:opening.version,reason:reason.trim(),confirmation:true,values},{signal}));
  if (saved.version === opening.version || Object.entries(values).some(([k,v]) => (saved.values as Record<string,unknown>)[k] !== v)) throw new InvalidReadResponse();
  const stored = read(await api.get<unknown>(path,{signal}));
  if (JSON.stringify(saved) !== JSON.stringify(stored)) throw new InvalidReadResponse();
}
