import type { MeDto } from '../contracts';
import { isIsoInstant } from './session-response';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !/[\u0000-\u0020\u007f]/.test(value);
const label = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const identifiers = (value: unknown): value is string[] => Array.isArray(value) && value.every(identifier);

/** A successful identity request must explicitly provide permissions and scope. */
export function decodeIdentityResponse(value: unknown): MeDto | null {
  if (!record(value) || !record(value.user) || !record(value.scope)) return null;
  const { user, scope } = value;
  if (!identifier(user.id) || !label(user.displayName) || !label(user.email)
    || !Array.isArray(value.roles) || !value.roles.every(label)
    || !identifiers(value.permissions) || !isIsoInstant(value.accessExpiresAt)
    || !identifiers(scope.companyIds) || !identifiers(scope.unitIds)
    || !identifiers(scope.sectorIds) || !identifiers(scope.teamIds) || typeof scope.ownOnly !== 'boolean'
    || scope.expiresAt !== undefined && !isIsoInstant(scope.expiresAt)
    || value.workerId !== undefined && value.workerId !== null && !identifier(value.workerId)) return null;
  // Keep only the validated public identity, never inferred roles or token claims.
  return {
    user: { id: user.id, displayName: user.displayName, email: user.email },
    roles: [...value.roles], permissions: [...value.permissions], accessExpiresAt: value.accessExpiresAt,
    scope: { companyIds: [...scope.companyIds], unitIds: [...scope.unitIds], sectorIds: [...scope.sectorIds],
      teamIds: [...scope.teamIds], ownOnly: scope.ownOnly,
      ...(scope.expiresAt !== undefined ? { expiresAt: scope.expiresAt } : {}) },
    ...(value.workerId !== undefined && value.workerId !== null ? { workerId: value.workerId } : {}),
  };
}
