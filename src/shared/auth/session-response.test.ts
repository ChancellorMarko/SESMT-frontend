import { describe, expect, it } from 'vitest';
import type { CookieSessionResponse } from '../contracts';
import { decodeSessionResponse } from './session-response';

const expiry = '2099-01-01T00:00:00Z';
const wire: CookieSessionResponse = {
  accessToken: 'cookie-access-token', expiresAtUtc: expiry,
  userId: '00000000-0000-4000-8000-000000000001', roles: ['ADMIN'],
  scopes: [{ scopeType: 'EMPRESA', referenceId: '00000000-0000-4000-8000-000000000002' }, { scopeType: 'GLOBAL', referenceId: null }],
};

describe('public cookie session response', () => {
  it('normalizes expiresAtUtc and drops identity claims and refresh credentials', () => {
    const session = decodeSessionResponse({ ...wire, refreshToken: 'must-not-be-retained', refreshTokenExpiresAtUtc: expiry });
    expect(session).toEqual({ accessToken: wire.accessToken, tokenType: 'Bearer', accessExpiresAt: expiry });
    expect(Object.keys(session!)).toEqual(['accessToken', 'tokenType', 'accessExpiresAt']);
  });

  it('preserves the supported BrowserSession response without inventing claims', () => {
    const legacy = { accessToken: 'legacy-access-token', tokenType: 'Bearer', accessExpiresAt: expiry };
    expect(decodeSessionResponse(legacy)).toEqual(legacy);
    expect(decodeSessionResponse({ accessToken: 'minimal-cookie-token', expiresAtUtc: expiry })).toEqual({
      accessToken: 'minimal-cookie-token', tokenType: 'Bearer', accessExpiresAt: expiry,
    });
  });

  it.each(['2000-02-29T12:30:00.1234567Z', '2030-01-01T10:00:00-03:00', '2030-01-01T00:00:00+14:00'])('accepts a valid ISO instant without applying the browser clock: %s', value => {
    expect(decodeSessionResponse({ ...wire, expiresAtUtc: value })?.accessExpiresAt).toBe(value);
  });

  it('accepts empty role/scope arrays without turning them into local privileges', () => {
    expect(decodeSessionResponse({ ...wire, roles: [], scopes: [] })).toEqual({
      accessToken: wire.accessToken, tokenType: 'Bearer', accessExpiresAt: expiry,
    });
  });

  it.each([
    null, undefined, [], 'session', {},
    { ...wire, accessToken: '' }, { ...wire, accessToken: ' ' }, { ...wire, accessToken: 'token with-space' },
    { ...wire, expiresAtUtc: '2030-02-30T00:00:00Z' }, { ...wire, expiresAtUtc: '1900-02-29T00:00:00Z' },
    { ...wire, expiresAtUtc: '2030-01-01' }, { ...wire, expiresAtUtc: '2030-01-01T24:00:00Z' },
    { ...wire, expiresAtUtc: '2030-01-01T00:00:00' }, { ...wire, expiresAtUtc: '2030-01-01T00:00:00+14:01' },
    { ...wire, expiresAtUtc: null, accessExpiresAt: expiry }, { ...wire, tokenType: 'Basic' },
    { ...wire, userId: '' }, { ...wire, userId: undefined }, { ...wire, roles: 'ADMIN' },
    { ...wire, roles: [1] }, { ...wire, roles: [' '] }, { ...wire, scopes: {} },
    { ...wire, scopes: [null] }, { ...wire, scopes: [{ scopeType: '', referenceId: null }] },
    { ...wire, scopes: [{ scopeType: 'EMPRESA' }] }, { ...wire, scopes: [{ scopeType: 'EMPRESA', referenceId: 1 }] },
    { accessToken: 'token', expiresAtUtc: expiry, roles: [] },
    { accessToken: 'token', accessExpiresAt: expiry }, { accessToken: 'token', tokenType: 'bearer', accessExpiresAt: expiry },
  ])('rejects malformed session data: %j', value => {
    expect(decodeSessionResponse(value)).toBeNull();
  });
});
