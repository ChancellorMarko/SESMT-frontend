import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import type { PageDto, SessionDto, UserDto } from '../shared/contracts';
import type { AccountInvitationAcceptDto, AccountInvitationInspectDto, AccountInvitationSummaryDto } from '../shared/contracts/account-invitations';
import { handlers, resetDemo } from './handlers';
import * as fixtures from './fixtures';

const { COMPANY, UNIT_A, UNIT_B, id } = fixtures;
const originalFixtures = fixtures.makeFixtures;
const server = setupServer(...handlers);
let token = '';
const password = 'Minha nova senha de acesso 2026!';
function send(method: string, path: string, body?: unknown, options: { revision?: number; csrf?: string; key?: string } = {}) {
  return fetch(`http://localhost/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': options.csrf ?? 'demo-csrf', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.revision ? { 'If-Match': `"${options.revision}"` } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function login(role = 'admin') {
  token = '';
  const result = await (await send('POST', '/auth/login', { email: `${role}@demo.sesmt.local`, password: 'Demo123!' })).json();
  const session = role === 'admin' ? await (await send('POST', '/auth/mfa/verify', { challengeId: result.challengeId, code: '123456' })).json() as SessionDto : result as SessionDto;
  token = session.accessToken;
}
async function invite(role = 'HR', ownOnly = false) {
  const result = await send('POST', '/users', { displayName: 'Pessoa convidada', email: 'convidada@example.invalid', roles: [role], scope: { companyIds: [COMPANY], unitIds: [UNIT_A], sectorIds: [id(5)], teamIds: [], ownOnly } });
  expect(result.status).toBe(201); const user = await result.json() as UserDto;
  const summary = await (await send('GET', `/users/${user.id}/invitation`)).json() as AccountInvitationSummaryDto;
  return { user, summary, invitationToken: new URL(summary.demoActivationPath!, 'https://example.invalid').hash.slice('#token='.length) };
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { vi.restoreAllMocks(); server.resetHandlers(); resetDemo(); });
beforeEach(async () => { resetDemo(); await login(); });

describe('primeiro acesso na demonstração MSW', () => {
  it('cria convite sem senha, inspeciona contexto e autentica com a senha definida depois do aceite', async () => {
    const { user, summary, invitationToken } = await invite();
    expect(user).toMatchObject({ status: 'INVITED', revision: 1 });
    expect(summary).toMatchObject({ userId: user.id, userRevision: 1, status: 'PENDING', deliveryStatus: 'SIMULATED' });
    await send('POST', '/auth/logout'); token = '';
    expect((await send('POST', '/auth/login', { email: user.email, password: 'Demo123!' })).status).toBe(401);
    const inspection = await (await send('POST', '/auth/invitations/inspect', { token: invitationToken })).json() as AccountInvitationInspectDto;
    expect(inspection).toMatchObject({ displayName: user.displayName, emailMasked: 'c••••••@example.invalid', mfaRequired: false });
    expect(inspection).not.toHaveProperty('email'); expect(inspection).not.toHaveProperty('roles');
    const accepted = await send('POST', '/auth/invitations/accept', { token: invitationToken, newPassword: password });
    expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ invitationId: inspection.invitationId, nextStep: 'LOGIN' });
    expect((await send('GET', '/me')).status).toBe(401);
    expect((await send('POST', '/auth/login', { email: user.email, password: 'Demo123!' })).status).toBe(401);
    const session = await send('POST', '/auth/login', { email: user.email, password });
    expect(session.status).toBe(200); token = (await session.json() as SessionDto).accessToken;
    expect(await (await send('GET', '/me')).json()).toMatchObject({ user: { id: user.id, email: user.email }, roles: ['HR'] });
  });

  it('rejeita ativação por alteração administrativa e protege a gravação com CSRF', async () => {
    const { user, invitationToken } = await invite();
    expect((await send('PATCH', `/users/${user.id}/access`, { status: 'ACTIVE' }, { revision: user.revision })).status).toBe(409);
    const invalid = await send('POST', '/auth/invitations/accept', { token: invitationToken, newPassword: password }, { csrf: '' });
    expect(invalid.status).toBe(403); expect(await invalid.json()).toMatchObject({ code: 'CSRF_INVALID' });
    expect((await send('POST', '/auth/invitations/inspect', { token: invitationToken })).status).toBe(200);
    const users = await (await send('GET', '/users')).json() as PageDto<UserDto>;
    expect(users.items.find(item => item.id === user.id)).toMatchObject({ status: 'INVITED', revision: 1 });
  });

  it('revoga o convite ao desabilitar a conta e recusa o token mesmo após reativação indevida', async () => {
    const { user, invitationToken } = await invite();
    const disabled = await send('PATCH', `/users/${user.id}/access`, { status: 'DISABLED' }, { revision: 1 });
    expect(disabled.status).toBe(200);
    expect(await (await send('GET', `/users/${user.id}/invitation`)).json()).toMatchObject({ status: 'REVOKED' });
    expect(await (await send('POST', '/auth/invitations/inspect', { token: invitationToken })).json()).toMatchObject({ code: 'INVITATION_REVOKED' });
    expect((await send('PATCH', `/users/${user.id}/access`, { status: 'ACTIVE' }, { revision: 2 })).status).toBe(409);
    expect((await send('POST', '/auth/invitations/accept', { token: invitationToken, newPassword: password })).status).toBe(410);
  });

  it('aceita uma só vez em concorrência, ou repete o mesmo recibo para a mesma chave', async () => {
    const { invitationToken } = await invite();
    const body = { token: invitationToken, newPassword: password };
    const results = await Promise.all([send('POST', '/auth/invitations/accept', body, { key: 'accept-1' }), send('POST', '/auth/invitations/accept', body, { key: 'accept-1' })]);
    expect(results.map(item => item.status)).toEqual([200, 200]);
    const receipts = await Promise.all(results.map(item => item.json() as Promise<AccountInvitationAcceptDto>));
    expect(receipts[0]).toEqual(receipts[1]);
    expect((await send('POST', '/auth/invitations/accept', { ...body, newPassword: `${password} diferente` }, { key: 'accept-1' })).status).toBe(409);
    expect((await send('POST', '/auth/invitations/accept', body, { key: 'accept-2' })).status).toBe(409);
  });

  it('não permite sessão administrativa por senha nova ou pelo código MFA fixo da demonstração', async () => {
    const { user, invitationToken } = await invite('ADMIN');
    await send('POST', '/auth/logout'); token = '';
    expect(await (await send('POST', '/auth/invitations/accept', { token: invitationToken, newPassword: password })).json()).toMatchObject({ nextStep: 'MFA_SETUP_REQUIRED' });
    const loginResult = await send('POST', '/auth/login', { email: user.email, password });
    expect(loginResult.status).toBe(403); expect(await loginResult.json()).toMatchObject({ code: 'MFA_SETUP_REQUIRED' });
    expect((await send('POST', '/auth/mfa/verify', { challengeId: 'demo-challenge', code: '123456' })).status).toBe(401);
    expect((await send('GET', '/me')).status).toBe(401);
  });

  it('não expõe links de convite a outro perfil ou administrador fora do escopo', async () => {
    const { user } = await invite();
    await login('rh'); expect((await send('GET', `/users/${user.id}/invitation`)).status).toBe(403);
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures();
      data.users.find(item => item.roles.includes('ADMIN'))!.scope.unitIds = [UNIT_B];
      data.users.push({ ...user, scope: { ...user.scope, unitIds: [UNIT_A] } });
      return data;
    });
    resetDemo(); await login();
    expect((await send('GET', `/users/${user.id}/invitation`)).status).toBe(404);
  });

  it('bloqueia conta nova ownOnly sem vincular a identidade à Camila da demonstração', async () => {
    const { user, invitationToken } = await invite('WORKER', true);
    await send('POST', '/auth/logout'); token = '';
    expect(await (await send('POST', '/auth/invitations/accept', { token: invitationToken, newPassword: password })).json()).toMatchObject({ nextStep: 'WORKER_LINK_REQUIRED' });
    const result = await send('POST', '/auth/login', { email: user.email, password });
    expect(result.status).toBe(403); expect(await result.json()).toMatchObject({ code: 'WORKER_LINK_REQUIRED' });
    expect((await send('GET', '/me')).status).toBe(401);
    expect((await send('GET', `/workers/${id(40)}`)).status).toBe(401);
    expect((await send('GET', `/documents?workerId=${id(40)}`)).status).toBe(401);
  });
});
