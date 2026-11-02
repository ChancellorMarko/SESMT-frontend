import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

// SESMT.API/Contracts/Users/UserRequests.cs: UserResponse (official native API).
export const nativeUserDetails = z.object({ name: z.string().trim().min(1, 'Informe o nome.').max(200), email: z.string().trim().email('Informe um e-mail válido.').max(200).transform(value => value.toLowerCase()) });
export const nativeUser = nativeUserDetails.extend({
  id: z.string().uuid(), name: z.string().trim().min(1).max(200),
  email: z.string().email().max(254), roles: z.array(z.string().trim().min(1).max(200)),
  scopeIds: z.array(z.string().uuid()), active: z.boolean(),
});
export type NativeUser = z.infer<typeof nativeUser>;
export function checkedNativeUsers(value: unknown): NativeUser[] {
  const parsed = z.array(nativeUser).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(user => user.id)).size !== parsed.data.length) throw new InvalidReadResponse();
  return parsed.data;
}

const unique = (values: readonly string[]) => new Set(values).size === values.length;
const accessVersion = z.string().regex(/^[a-f0-9]{64}$/);
const managementContext = z.object({
  action: z.enum(['criar', 'editar']), target: nativeUser.nullable(), accessVersion: accessVersion.nullable(),
  roles: z.array(z.object({ code: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(200), description: z.string().max(2000) })),
  scopes: z.array(z.object({ id: z.string().uuid(), type: z.enum(['EMPRESA', 'UNIDADE', 'SETOR']), name: z.string().trim().min(1).max(500), companyId: z.string().uuid(), companyName: z.string().trim().min(1).max(255) })),
});
export type UserManagementContext = z.infer<typeof managementContext>;
export const sameUserSelection = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(value => b.includes(value));
export function checkedUserContext(value: unknown, action: 'criar' | 'editar', userId?: string): UserManagementContext {
  const parsed = managementContext.safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const data = parsed.data;
  const target = data.target;
  if (data.action !== action || !unique(data.roles.map(role => role.code)) || !unique(data.scopes.map(scope => scope.id))
      || (action === 'criar' ? target !== null || data.accessVersion !== null : !target || target.id !== userId || !data.accessVersion || !target.active)
      || data.target && (!unique(data.target.roles) || !unique(data.target.scopeIds)
        || !data.target.roles.every(code => data.roles.some(role => role.code === code))
        || !data.target.scopeIds.every(id => data.scopes.some(scope => scope.id === id)))) throw new InvalidReadResponse();
  return data;
}
export function checkedUserAccess(value: unknown, id: string, roles: string[], scopeIds: string[], previousVersion: string) {
  const parsed = z.object({ user: nativeUser, accessVersion }).safeParse(value);
  if (!parsed.success || parsed.data.user.id !== id || !parsed.data.user.active || parsed.data.accessVersion === previousVersion
    || !sameUserSelection(parsed.data.user.roles, roles) || !sameUserSelection(parsed.data.user.scopeIds, scopeIds)) throw new InvalidReadResponse();
  return parsed.data;
}
