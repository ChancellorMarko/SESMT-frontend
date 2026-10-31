import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';

// SESMT.API/Contracts/Users/UserRequests.cs: UserResponse (official native API).
export const nativeUserDetails = z.object({ name: z.string().trim().min(1, 'Informe o nome.').max(200), email: z.string().trim().email('Informe um e-mail válido.').max(254).transform(value => value.toLowerCase()) });
const nativeUser = nativeUserDetails.extend({
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
