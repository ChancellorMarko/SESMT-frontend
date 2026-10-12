import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from './handlers';
import * as fixtures from './fixtures';
import type { OrganizationDto, PageDto, SessionDto, UserDto } from '../shared/contracts';

const { COMPANY, UNIT_A, UNIT_B, id } = fixtures;
const originalFixtures = fixtures.makeFixtures;
const server = setupServer(...handlers);
let token = '';
function send(method: string, path: string, body?: unknown, options: { revision?: number; key?: string; csrf?: string } = {}) {
  return fetch(`http://localhost/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': options.csrf ?? 'demo-csrf', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.revision ? { 'If-Match': `"${options.revision}"` } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function login() {
  token = '';
  const challenge = await (await send('POST', '/auth/login', { email: 'admin@demo.sesmt.local', password: 'Demo123!' })).json();
  const result = await send('POST', '/auth/mfa/verify', { challengeId: challenge.challengeId, code: '123456' });
  expect(result.status).toBe(200); token = (await result.json() as SessionDto).accessToken;
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { vi.restoreAllMocks(); server.resetHandlers(); resetDemo(); });
beforeEach(async () => { resetDemo(); await login(); });

describe('gestão de usuários e organização na demonstração', () => {
  it('combina unidade e busca de nome/e-mail antes de paginar usuários', async () => {
    const matching = await (await send('GET', `/users?unitId=${UNIT_A}&q=CAMILA`)).json() as PageDto<UserDto>;
    expect(matching.items.map(user => user.id)).toEqual([id(24)]); expect(matching.total).toBe(1);
    expect((await (await send('GET', `/users?unitId=${UNIT_B}&q=CAMILA`)).json() as PageDto<UserDto>).total).toBe(0);
    expect((await (await send('GET', `/users?q=tecnico%40demo`)).json() as PageDto<UserDto>).items.map(user => user.id)).toEqual([id(25)]);
    expect((await send('GET', `/users?unitId=${id(999)}`)).status).toBe(404);
  });

  it('não permite que um administrador limitado liste ou altere concessões fora de sua autoridade', async () => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); data.users.find(user => user.roles.includes('ADMIN'))!.scope.unitIds = [UNIT_A]; return data;
    });
    resetDemo(); await login();
    const users = await (await send('GET', '/users')).json() as PageDto<UserDto>;
    expect(users.items.map(user => user.id)).toEqual(expect.arrayContaining([id(23), id(24)]));
    expect(users.items.map(user => user.id)).not.toContain(id(20));
    const result = await send('PATCH', `/users/${id(20)}/access`, { roles: ['WORKER'], status: 'DISABLED' }, { revision: 1 });
    expect(result.status).toBe(404);
  });

  it('filtra cargos/funções e bloqueia edição de cadastros globais de outra empresa', async () => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures();
      data.organization.companies.push({ id: id(900), name: 'Outra empresa', status: 'ACTIVE', revision: 1 });
      for (const [key, recordId] of [['establishments', 901], ['jobs', 902], ['jobFunctions', 903]] as const) data.organization[key].push({ id: id(recordId), companyId: id(900), name: 'Cadastro externo', status: 'ACTIVE', revision: 1 });
      return data;
    });
    resetDemo(); await login();
    const organization = await (await send('GET', '/organization')).json() as OrganizationDto;
    expect(organization.jobs.every(item => item.companyId === COMPANY)).toBe(true);
    expect(organization.jobFunctions.every(item => item.companyId === COMPANY)).toBe(true);
    for (const [path, recordId] of [['companies', 900], ['establishments', 901], ['jobs', 902], ['job-functions', 903]] as const) {
      expect((await send('PATCH', `/${path}/${id(recordId)}`, { name: 'Alteração fora de alcance' }, { revision: 1 })).status).toBe(404);
    }
  });

  it('recusa escrita administrativa sem CSRF válido', async () => {
    const result = await send('PATCH', `/jobs/${id(8)}`, { name: 'Alteração sem proteção' }, { revision: 1, csrf: '' });
    expect(result.status).toBe(403); expect(await result.json()).toMatchObject({ code: 'CSRF_INVALID' });
    const organization = await (await send('GET', '/organization')).json() as OrganizationDto;
    expect(organization.jobs.find(item => item.id === id(8))).toMatchObject({ name: 'Operador', revision: 1 });
  });

  it('preserva corpo e ETag do recibo idempotente após alterações posteriores no cadastro', async () => {
    const path = `/jobs/${id(8)}`, first = { name: 'Primeira alteração' };
    const initial = await send('PATCH', path, first, { revision: 1, key: 'edit-1' });
    expect(initial.status).toBe(200); const receipt = await initial.json();
    expect((await send('PATCH', path, { name: 'Segunda alteração' }, { revision: 2, key: 'edit-2' })).status).toBe(200);
    const replay = await send('PATCH', path, first, { revision: 1, key: 'edit-1' });
    expect(await replay.json()).toEqual(receipt); expect(replay.headers.get('ETag')).toBe('"2"');
    const organization = await (await send('GET', '/organization')).json() as OrganizationDto;
    expect(organization.jobs.find(item => item.id === id(8))).toMatchObject({ name: 'Segunda alteração', revision: 3 });
  });

  it('promover a administrador exige MFA e recusa concessão sem unidade', async () => {
    const path = `/users/${id(21)}/access`;
    const invalid = await send('PATCH', path, { scope: { companyIds: [COMPANY], unitIds: [] } }, { revision: 1 });
    expect(invalid.status).toBe(422);
    const promoted = await send('PATCH', path, { roles: ['ADMIN'] }, { revision: 1 });
    expect(promoted.status).toBe(200); expect(await promoted.json()).toMatchObject({ mfaRequired: true, revision: 2 });
  });

  it('um e-mail existente não recebe segundo convite por variação de maiúsculas', async () => {
    const result = await send('POST', '/users', { displayName: 'Duplicado', email: 'ADMIN@demo.sesmt.local', roles: ['HR'], scope: { companyIds: [COMPANY], unitIds: [UNIT_A], sectorIds: [], teamIds: [], ownOnly: false } });
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ code: 'EMAIL_IN_USE' });
  });
});
