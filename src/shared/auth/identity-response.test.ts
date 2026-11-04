import { describe, expect, it } from 'vitest';
import type { MeDto } from '../contracts';
import { decodeIdentityResponse } from './identity-response';

const identity: MeDto = {
  user: { id: 'account-1', displayName: 'Conta de teste', email: 'account@example.invalid' },
  roles: ['ADMIN'], permissions: ['documento:ler'], accessExpiresAt: '2099-01-01T00:00:00Z',
  scope: { companyIds: ['company-1'], unitIds: ['unit-1'], sectorIds: [], teamIds: [], ownOnly: false },
};

describe('resposta de identidade', () => {
  it('preserva somente identidade, permissões e escopo fornecidos explicitamente pelo servidor', () => {
    const source = { ...identity, workerId: 'worker-1', refreshToken: 'not-an-identity-field',
      user: { ...identity.user, secret: 'not-an-identity-field' }, scope: { ...identity.scope, expiresAt: '2099-01-01T00:00:00Z' } };
    const parsed = decodeIdentityResponse(source);
    expect(parsed).toEqual({ ...identity, workerId: 'worker-1', scope: source.scope });
    expect(parsed?.scope.unitIds).not.toBe(source.scope.unitIds);
    expect(parsed?.permissions).not.toBe(source.permissions);
  });

  it('aceita ausência explícita de módulos e unidades sem criar acesso a partir do perfil ADMIN', () => {
    const limited = { ...identity, permissions: [], scope: { companyIds: [], unitIds: [], sectorIds: [], teamIds: [], ownOnly: true } };
    expect(decodeIdentityResponse(limited)).toEqual(limited);
  });

  it('normaliza workerId nulo do adaptador .NET para ausência de vínculo com trabalhador', () => {
    const parsed = decodeIdentityResponse({ ...identity, workerId: null });
    expect(parsed).toEqual(identity);
    expect(parsed).not.toHaveProperty('workerId');
  });

  it('preserva uma concessão expirada para que a política de sessão a recuse', () => {
    expect(decodeIdentityResponse({ ...identity, scope: { ...identity.scope, expiresAt: '2020-01-01T00:00:00Z' } })?.scope.expiresAt).toBe('2020-01-01T00:00:00Z');
  });

  it.each([
    null, [], {}, { userId: 'account-1', roles: ['ADMIN'], scopes: [] },
    { ...identity, user: null }, { ...identity, user: { ...identity.user, id: '' } },
    { ...identity, user: { ...identity.user, displayName: '' } }, { ...identity, user: { ...identity.user, email: null } },
    { ...identity, roles: 'ADMIN' }, { ...identity, roles: [1] },
    { ...identity, permissions: undefined }, { ...identity, permissions: [''] }, { ...identity, permissions: ['documento:ler admin'] },
    { ...identity, scope: null }, { ...identity, scope: { ...identity.scope, unitIds: undefined } },
    { ...identity, scope: { ...identity.scope, companyIds: [1] } }, { ...identity, scope: { ...identity.scope, teamIds: {} } },
    { ...identity, scope: { ...identity.scope, sectorIds: [''] } }, { ...identity, scope: { ...identity.scope, ownOnly: 'false' } },
    { ...identity, scope: { ...identity.scope, expiresAt: 'invalid' } },
    { ...identity, scope: { ...identity.scope, expiresAt: '2030-02-30T00:00:00Z' } },
    { ...identity, scope: { ...identity.scope, expiresAt: '2030-01-01T00:00:00+14:01' } },
    { ...identity, accessExpiresAt: undefined }, { ...identity, accessExpiresAt: 'invalid' },
    { ...identity, accessExpiresAt: '2030-02-30T00:00:00Z' }, { ...identity, accessExpiresAt: '2030-01-01T00:00:00+15:00' },
    { ...identity, workerId: 1 },
  ])('recusa perfil incompleto ou inválido sem inferir permissões: %j', value => {
    expect(decodeIdentityResponse(value)).toBeNull();
  });
});
