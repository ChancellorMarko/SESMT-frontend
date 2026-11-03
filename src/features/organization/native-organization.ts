import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

const id = z.string().uuid(), name = z.string().trim().min(1).max(255);
const named = z.object({ id, name, canEdit: z.boolean().default(false) });
const context = z.object({
  canCreateCompany: z.boolean(),
  companies: z.array(named.extend({ canCreateUnit: z.boolean(), canCreatePosition: z.boolean() })),
  units: z.array(named.extend({ code: z.string().min(1).max(50), companyId: id, canCreateDepartment: z.boolean() })),
  departments: z.array(named.extend({ unitId: id })), positions: z.array(named.extend({ companyId: id })),
});
export type NativeOrganization = z.infer<typeof context>;
export type OrganizationResource = 'companies' | 'units' | 'departments' | 'positions';
export const organizationResources = [
  { key: 'companies', label: 'Empresas', singular: 'empresa', path: '/companies', permission: 'empresa:criar', editPermission: 'empresa:editar' },
  { key: 'units', label: 'Unidades', singular: 'unidade', path: '/locations', permission: 'unidade:criar', editPermission: 'unidade:editar' },
  { key: 'departments', label: 'Setores', singular: 'setor', path: '/departments', permission: 'setor:criar', editPermission: 'setor:editar' },
  { key: 'positions', label: 'Cargos', singular: 'cargo', path: '/positions', permission: 'cargo:criar', editPermission: 'cargo:editar' },
] as const;
export function checkedOrganization(value: unknown): NativeOrganization {
  const parsed = context.safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const data = parsed.data;
  for (const rows of [data.companies, data.units, data.departments, data.positions]) if (new Set(rows.map(row => row.id)).size !== rows.length) throw new InvalidReadResponse();
  if (data.units.some(unit => !data.companies.some(company => company.id === unit.companyId))
    || data.positions.some(position => !data.companies.some(company => company.id === position.companyId))
    || data.departments.some(department => !data.units.some(unit => unit.id === department.unitId))) throw new InvalidReadResponse();
  return data;
}
export const companyFields = z.object({ corporateName: name, fantasyName: name,
  cnpj: z.string().trim().transform(value => value.replace(/[.\-/\s]/g, '').toUpperCase()).refine(value => /^[A-Z0-9]{12}\d{2}$/.test(value), 'Informe um CNPJ com 14 caracteres e os dois dígitos finais.'),
  tipoEmpresa: z.enum(['INTERNA', 'PRESTADORA']), email: z.union([z.literal(''), z.string().trim().email().max(200)]).transform(value => value.toLowerCase()), phone: z.string().trim().max(20) });
export const unitFields = z.object({ companyId: id, code: z.string().trim().min(1, 'Informe o código.').max(50), name: name.max(150), type: z.enum(['MATRIZ', 'FILIAL']),
  cep: z.string().transform(value => value.replace(/[\s-]/g, '')).refine(value => /^\d{8}$/.test(value), 'Informe um CEP com 8 dígitos.'),
  address: z.string().trim().min(1, 'Informe o endereço.').max(200), number: z.string().trim().min(1, 'Informe o número ou S/N.').max(20),
  complement: z.string().trim().max(100), neighborhood: z.string().trim().min(1, 'Informe o bairro.').max(100), city: z.string().trim().min(1, 'Informe a cidade.').max(120),
  state: z.enum(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) });
export const departmentFields = z.object({ unitId: id, name: name.max(150), description: z.string().trim().max(500) });
export const positionFields = z.object({ companyId: id, name: name.max(150), description: z.string().trim().max(500), cbo: z.string().trim().max(10) });
export const companyReceipt = z.object({ id, corporateName: name, fantasyName: name, cnpj: z.string().length(14), tipoEmpresa: z.enum(['INTERNA','PRESTADORA']), email: z.string().nullable(), phone: z.string().nullable(), active: z.literal(true) });
export const unitReceipt = unitFields.extend({ id, active: z.literal(true), complement: z.string().nullable() });
export const departmentReceipt = departmentFields.extend({ id, active: z.literal(true), description: z.string().nullable() });
export const positionReceipt = positionFields.extend({ id, active: z.literal(true), description: z.string().nullable(), cbo: z.string().nullable() });
