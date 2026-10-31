/**
 * The API grants access; this module only names equivalent frontend read checks.
 * Native resources/actions come from the official backend's Permission entity and
 * seeder. No role, token claim, wildcard or naming heuristic grants a capability.
 * Writes/workflows need their own route, DTO and action contracts before mapping.
 */
export const nativeReadRequirements: Readonly<Record<string, readonly string[]>> = {
  'documents.read': ['documento:ler'],
  'workers.read': ['trabalhador:ler'],
  'users.read': ['usuario:ler'],
  // This screen combines four resources; one resource must not unlock the rest.
  'organization.read': ['empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler'],
};

export function hasPermission(granted: readonly string[], permission: string): boolean {
  if (!permission || !Array.isArray(granted)) return false;
  if (granted.includes(permission)) return true;
  const requirements = Object.hasOwn(nativeReadRequirements, permission) ? nativeReadRequirements[permission] : undefined;
  return !!requirements?.length && requirements.every(required => granted.includes(required));
}
