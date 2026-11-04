import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from './handlers';
import * as fixtures from './fixtures';
import type { AuditLogDto, OrganizationItemDto, PageDto, SessionDto } from '../shared/contracts';

const { COMPANY, UNIT_A, UNIT_B, id } = fixtures;
const originalFixtures = fixtures.makeFixtures;
const server = setupServer(...handlers);
let token = '';
const send = (method: string, path: string, body?: unknown, revision?: number) => fetch(`http://localhost/api/v1${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'demo-csrf', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
async function login(role = 'gestor') {
  token = '';
  const response = await send('POST', '/auth/login', { email: `${role}@demo.sesmt.local`, password: 'Demo123!' });
  expect(response.status).toBe(200);
  const result = await response.json();
  const session = role === 'admin' ? await (await send('POST', '/auth/mfa/verify', { challengeId: result.challengeId, code: '123456' })).json() as SessionDto : result as SessionDto;
  token = session.accessToken;
}
async function create(path: string, value: unknown) {
  const response = await send('POST', path, value);
  expect(response.ok).toBe(true);
  return response.json() as Promise<OrganizationItemDto>;
}
async function records(query = '') {
  const response = await send('GET', `/audit-logs?pageSize=100${query ? `&${query}` : ''}`);
  expect(response.status).toBe(200);
  return (await response.json() as PageDto<AuditLogDto>).items;
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); server.resetHandlers(); resetDemo(); });
beforeEach(async () => { resetDemo(); await login(); });

describe('escopo organizacional e data civil da auditoria demo', () => {
  it('separa criação de setores/centros e alteração de unidades pelo filtro da unidade', async () => {
    const sectorA = await create('/sectors', { name: 'Setor A de teste', unitId: UNIT_A });
    const sectorB = await create('/sectors', { name: 'Setor B de teste', unitId: UNIT_B });
    const centerA = await create('/work-centers', { name: 'Centro A de teste', unitId: UNIT_A, sectorId: sectorA.id });
    const centerB = await create('/work-centers', { name: 'Centro B de teste', unitId: UNIT_B, sectorId: sectorB.id });
    expect((await send('PATCH', `/units/${UNIT_A}`, { name: 'Matriz atualizada' }, 1)).ok).toBe(true);
    expect((await send('PATCH', `/units/${UNIT_B}`, { name: 'Operação atualizada' }, 1)).ok).toBe(true);
    const idsA = (await records(`unitId=${UNIT_A}`)).filter(item => item.resourceType === 'ORGANIZATION').map(item => item.resourceId);
    const idsB = (await records(`unitId=${UNIT_B}`)).filter(item => item.resourceType === 'ORGANIZATION').map(item => item.resourceId);
    expect(idsA).toEqual(expect.arrayContaining([sectorA.id, centerA.id, UNIT_A]));
    expect(idsA).not.toContain(sectorB.id);
    expect(idsA).not.toContain(centerB.id); expect(idsA).not.toContain(UNIT_B);
    expect(idsB).toEqual(expect.arrayContaining([sectorB.id, centerB.id, UNIT_B]));
    expect(idsB).not.toContain(sectorA.id); expect(idsB).not.toContain(centerA.id); expect(idsB).not.toContain(UNIT_A);
    expect((await records()).filter(item => item.resourceType === 'ORGANIZATION')).toHaveLength(6);
  });
  it('mantém globais da empresa aplicáveis e omite organização sem proprietário comprovável', async () => {
    // Represent a legacy orphan in the fixture; new writes must reject missing ownership.
    const orphan = { id: id(950), name: 'Cargo legado sem vínculo de empresa', status: 'ACTIVE' as const, revision: 1 };
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); data.organization.jobs.push(orphan);
      data.audit.push({ id: crypto.randomUUID(), actorId: id(20), action: 'ORGANIZATION_CREATED', resourceType: 'ORGANIZATION', resourceId: orphan.id, occurredAt: new Date().toISOString(), requestId: crypto.randomUUID(), outcome: 'DEMO' });
      return data;
    });
    resetDemo(); await login();
    for (const [path, recordId] of [['companies', COMPANY], ['establishments', id(4)], ['jobs', id(8)], ['job-functions', id(10)]]) {
      expect((await send('PATCH', `/${path}/${recordId}`, { name: `Nome atualizado ${path}` }, 1)).ok).toBe(true);
    }
    const foreignCompany = await create('/companies', { name: 'Outra organização sem acesso', taxId: '12345678000199', classification: 'SERVICE_PROVIDER' });
    expect((await send('POST', '/jobs', { name: 'Novo cargo sem vínculo de empresa' })).status).toBe(422);
    const otherEstablishment = await create('/establishments', { name: 'Outro estabelecimento', companyId: COMPANY });
    for (const query of ['', `unitId=${UNIT_A}`, `unitId=${UNIT_B}`]) {
      const ids = (await records(query)).filter(item => item.resourceType === 'ORGANIZATION').map(item => item.resourceId);
      expect(ids).toEqual(expect.arrayContaining([COMPANY, id(4), id(8), id(10)]));
      expect(ids).not.toContain(foreignCompany.id); expect(ids).not.toContain(orphan.id); expect(ids).not.toContain(otherEstablishment.id);
    }
  });
  it('não entrega eventos de outra unidade ao auditor com escopo restrito, mesmo sem filtro', async () => {
    const sectorA = await create('/sectors', { name: 'Setor permitido', unitId: UNIT_A });
    const sectorB = await create('/sectors', { name: 'Setor fora do escopo', unitId: UNIT_B });
    await login('admin');
    const response = await send('PATCH', `/users/${id(22)}/access`, { roles: ['AUDITOR'], scope: { companyIds: [COMPANY], unitIds: [UNIT_A], sectorIds: [id(5), id(6)], teamIds: [], ownOnly: false, expiresAt: new Date(Date.now() + 86400000).toISOString() } }, 1);
    expect(response.ok).toBe(true);
    await login('auditor');
    const ids = (await records()).filter(item => item.resourceType === 'ORGANIZATION').map(item => item.resourceId);
    expect(ids).toContain(sectorA.id); expect(ids).not.toContain(sectorB.id);
    expect((await send('GET', `/audit-logs?unitId=${UNIT_B}`)).status).toBe(404);
  });
  it('exclui cadastros globais de outra empresa, inclusive quando não há filtro de unidade', async () => {
    const foreignCompany = id(900), foreignJob = id(901);
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures();
      data.organization.companies.push({ id: foreignCompany, name: 'Outra empresa', status: 'ACTIVE', revision: 1 });
      data.organization.jobs.push({ id: foreignJob, name: 'Cargo de outra empresa', companyId: foreignCompany, status: 'ACTIVE', revision: 1 });
      for (const resourceId of [foreignCompany, foreignJob]) data.audit.push({ id: crypto.randomUUID(), actorId: id(20), action: 'ORGANIZATION_CREATED', resourceType: 'ORGANIZATION', resourceId, occurredAt: new Date().toISOString(), requestId: crypto.randomUUID(), outcome: 'DEMO' });
      return data;
    });
    resetDemo(); await login();
    for (const query of ['', `unitId=${UNIT_A}`]) {
      const ids = (await records(query)).map(item => item.resourceId);
      expect(ids).not.toContain(foreignCompany); expect(ids).not.toContain(foreignJob);
    }
  });
  it('considera 01h UTC como o dia anterior em São Paulo no filtro do período', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-11T01:00:00Z'));
    resetDemo(); await login();
    const previousDay = await records(`unitId=${UNIT_A}&from=2026-10-10&to=2026-10-10`);
    expect(previousDay.length).toBeGreaterThan(0);
    expect(previousDay.every(item => item.occurredAt === '2026-10-11T01:00:00.000Z')).toBe(true);
    expect(await records(`unitId=${UNIT_A}&from=2026-10-11&to=2026-10-11`)).toEqual([]);
  });
});
