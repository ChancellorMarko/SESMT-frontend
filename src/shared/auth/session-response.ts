import type { SessionDto } from '../contracts';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !/[\u0000-\u0020\u007f]/.test(value);
const label = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);

function instant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return false;
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validCookieMetadata(value: Record<string, unknown>) {
  if (!['userId', 'roles', 'scopes'].some(key => Object.hasOwn(value, key))) return true;
  return identifier(value.userId)
    && Array.isArray(value.roles) && value.roles.every(label)
    && Array.isArray(value.scopes) && value.scopes.every(scope => record(scope)
      && label(scope.scopeType) && (scope.referenceId === null || identifier(scope.referenceId)));
}

/** Normalize both supported public responses without retaining credentials or identity claims. */
export function decodeSessionResponse(value: unknown): SessionDto | null {
  if (!record(value) || !identifier(value.accessToken) || !validCookieMetadata(value)) return null;
  const cookieResponse = Object.hasOwn(value, 'expiresAtUtc');
  const expiresAt = cookieResponse ? value.expiresAtUtc : value.accessExpiresAt;
  if (!instant(expiresAt) || (!cookieResponse || Object.hasOwn(value, 'tokenType')) && value.tokenType !== 'Bearer') return null;
  // /me remains the authority for the user's identity, permissions and scope.
  return { accessToken: value.accessToken, tokenType: 'Bearer', accessExpiresAt: expiresAt };
}
