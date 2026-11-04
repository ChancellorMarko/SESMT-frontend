import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import type { AssigneeDto, DocumentTypeDto, PageDto, SessionDto, WorkerDto } from '../shared/contracts';
import { handlers, resetDemo } from './handlers';
import * as fixtures from './fixtures';

const { COMPANY, UNIT_A, UNIT_B, id } = fixtures;
const originalFixtures = fixtures.makeFixtures;
const server = setupServer(...handlers);
const endpoints = ['/document-types', '/workers', '/assignees'] as const;
let token = '';
const send = (method: string, path: string, body?: unknown) => fetch(`http://localhost/api/v1${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'demo-csrf', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const query = (path: string, params: Record<string, string> = {}) => send('GET', `${path}?${new URLSearchParams({ ...(path === '/assignees' ? { purpose: 'DOCUMENT_OWNER' } : {}), ...params })}`);
async function read<T>(path: string, params: Record<string, string> = {}) {
  const response = await query(path, params);
  expect(response.status).toBe(200);
  return response.json() as Promise<PageDto<T>>;
}
async function login(role = 'gestor') {
  token = '';
  const response = await send('POST', '/auth/login', { email: `${role}@demo.sesmt.local`, password: 'Demo123!' });
  expect(response.status).toBe(200);
  token = (await response.json() as SessionDto).accessToken;
}
async function reseed(mutate: (data: ReturnType<typeof originalFixtures>) => void) {
  vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
    const data = originalFixtures(); mutate(data); return data;
  });
  resetDemo(); await login();
}
async function largePopulation() {
  await reseed(data => {
    for (let index = 0; index < 105; index++) {
      const suffix = String(index).padStart(3, '0');
      data.documentTypes.push({ ...data.documentTypes[1], id: id(1000 + index), name: `Tipo lookup ${suffix}`, code: `LOOKUP-${suffix}` });
      data.users.push({ ...data.users[0], id: id(2000 + index), displayName: `Pessoa lookup ${suffix}`, email: `lookup-${suffix}@demo.sesmt.local` });
      data.workers.push({ ...data.workers[0], id: id(3000 + index), fullName: `Trabalhador lookup ${suffix}`, registration: `LOOKUP-${suffix}` });
    }
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => { resetDemo(); await login(); });
afterEach(() => { vi.restoreAllMocks(); server.resetHandlers(); resetDemo(); });
afterAll(() => server.close());

describe('seleções documentais paginadas nos handlers HTTP de demonstração', () => {
  it.each([
    ['/document-types', 1104], ['/assignees', 2104], ['/workers', 3104],
  ])('resolve em %s um ID além dos primeiros 100 sem devolver a população inteira', async (path, selectedId) => {
    await largePopulation();
    const selected = id(Number(selectedId));
    const first = await read<{ id: string }>(String(path), { pageSize: '100' });
    expect(first.total).toBeGreaterThan(100);
    expect(first.items).toHaveLength(100);
    expect(first.items.some(item => item.id === selected)).toBe(false);
    const resolved = await read<{ id: string }>(String(path), { ids: `${selected},${selected}`, pageSize: '100' });
    expect(resolved).toMatchObject({ total: 1, page: 1, pageSize: 100 });
    expect(resolved.items.map(item => item.id)).toEqual([selected]);
  });

  it.each(endpoints)('pesquisa e pagina %s com total filtrado e ordem estável', async path => {
    await largePopulation();
    const first = await read<{ id: string }>(path, { q: 'LOOKUP', page: '1', pageSize: '20' });
    const last = await read<{ id: string }>(path, { q: 'LOOKUP', page: '6', pageSize: '20' });
    expect(first).toMatchObject({ total: 105, page: 1, pageSize: 20 });
    expect(first.items).toHaveLength(20);
    expect(last).toMatchObject({ total: 105, page: 6, pageSize: 20 });
    expect(last.items).toHaveLength(5);
    expect(first.items.some(item => last.items.some(other => other.id === item.id))).toBe(false);
    expect(await read(path, { q: 'LOOKUP', page: '1', pageSize: '20' })).toEqual(first);
    const exact = await read<{ id: string }>(path, { q: 'lookup 104' });
    expect(exact.items).toHaveLength(1);
    expect(exact.total).toBe(1);
  });

  it('pesquisa tipos por nome ou código e responsáveis somente pelo nome público', async () => {
    expect((await read<DocumentTypeDto>('/document-types', { q: 'proced' })).items.map(type => type.id)).toEqual([id(61)]);
    expect((await read<DocumentTypeDto>('/document-types', { q: 'gerenciamento' })).items.map(type => type.id)).toEqual([id(60)]);
    const people = await read<AssigneeDto>('/assignees', { q: 'MARINA' });
    expect(people).toMatchObject({ total: 1, items: [{ id: id(20), displayName: 'Marina Demo' }] });
    expect(Object.keys(people.items[0]).sort()).toEqual(['displayName', 'id']);
    expect((await read('/assignees', { q: 'gestor@demo' })).total).toBe(0);
    expect((await read<WorkerDto>('/workers', { q: 'DEMO-007', unitId: UNIT_B })).items.map(worker => worker.id)).toEqual([id(46)]);
  });

  it('combina IDs exatos e busca sem adicionar selecionados fora dos critérios', async () => {
    expect((await read('/document-types', { ids: `${id(60)},${id(61)}`, q: 'PROCED' })).items).toMatchObject([{ id: id(61) }]);
    expect((await read('/assignees', { ids: id(20), q: 'RAFAEL' })).total).toBe(0);
    expect((await read('/workers', { ids: id(40), q: 'BRUNO' })).total).toBe(0);
    expect((await read('/document-types', { ids: id(99999) })).total).toBe(0);
  });

  it('preserva ordem padrão e usa o ID para desempatar os nomes de uma seleção', async () => {
    await reseed(data => {
      data.users.push({ ...data.users[0], id: id(901), displayName: 'Mesmo nome de lookup', email: 'mesmo-2@demo.local' });
      data.users.push({ ...data.users[0], id: id(900), displayName: 'Mesmo nome de lookup', email: 'mesmo-1@demo.local' });
    });
    const original = await read<AssigneeDto>('/assignees', { pageSize: '100' });
    expect(original.items.slice(0, 3).map(user => user.id)).toEqual([id(20), id(21), id(22)]);
    const resolved = await read<AssigneeDto>('/assignees', { ids: `${id(901)},${id(900)}` });
    expect(resolved.items.map(user => user.id)).toEqual([id(900), id(901)]);
    expect((await read('/assignees', { pageSize: '100' })).items).toEqual(original.items);
  });

  it('mantém contexto e filtros dos trabalhadores antes de resolver IDs', async () => {
    const selected = { ids: `${id(40)},${id(44)},${id(46)}`, unitId: UNIT_A };
    expect((await read<WorkerDto>('/workers', selected)).items.map(worker => worker.id)).toEqual([id(40), id(44)]);
    expect((await read<WorkerDto>('/workers', { ...selected, status: 'ON_LEAVE' })).items.map(worker => worker.id)).toEqual([id(44)]);
    expect((await read('/workers', { ...selected, teamId: id(201) })).total).toBe(0);
    expect((await read('/workers', { ...selected, companyId: id(900) })).total).toBe(0);
    expect((await read('/workers', { ...selected, integrationStatus: 'PENDING' })).total).toBe(0);
    await login('trabalhador');
    expect((await read<WorkerDto>('/workers', { ids: `${id(40)},${id(41)}` })).items.map(worker => worker.id)).toEqual([id(40)]);
    expect((await query('/workers', { unitId: UNIT_B, ids: 'invalido' })).status).toBe(404);
  });

  it('não resolve trabalhadores de empresa alheia mesmo com ID e nome conhecidos', async () => {
    await reseed(data => { data.workers.push({ ...data.workers[0], id: id(900), companyId: id(999), fullName: 'Pessoa de empresa externa' }); });
    const result = await read('/workers', { ids: `${id(40)},${id(900)}`, q: 'Pessoa de empresa externa' });
    expect(result).toMatchObject({ total: 0, items: [] });
  });

  it('exclui responsáveis sem vínculo elegível antes dos IDs e da busca', async () => {
    await reseed(data => {
      const reference = data.users[0];
      data.users.push({ ...reference, id: id(900), displayName: 'Pessoa fora da empresa', scope: { ...reference.scope, companyIds: [id(999)] } });
      data.users.push({ ...reference, id: id(901), displayName: 'Pessoa fora da unidade', scope: { ...reference.scope, unitIds: [UNIT_B] } });
      data.users.push({ ...reference, id: id(902), displayName: 'Pessoa desativada', status: 'DISABLED' });
      data.users.push({ ...reference, id: id(903), displayName: 'Pessoa com concessão expirada', scope: { ...reference.scope, expiresAt: new Date(Date.now() - 86400000).toISOString() } });
      data.users.push({ ...reference, id: id(904), displayName: 'Pessoa convidada', status: 'INVITED' });
    });
    const result = await read<AssigneeDto>('/assignees', { unitId: UNIT_A, ids: [20, 900, 901, 902, 903, 904].map(id).join(',') });
    expect(result).toMatchObject({ total: 1, items: [{ id: id(20), displayName: 'Marina Demo' }] });
    expect((await read('/assignees', { unitId: UNIT_A, ids: id(901), q: 'Pessoa' })).total).toBe(0);
  });

  it('valida finalidade sem conceder permissões adicionais ao resolver responsáveis', async () => {
    for (const purpose of ['DOCUMENT_OWNER', 'DOCUMENT_RESPONSIBLE', 'UNIT_RESPONSIBLE', 'WORKER_MANAGER']) {
      expect((await query('/assignees', { purpose, ids: id(20) })).status).toBe(200);
    }
    for (const purpose of ['', 'UNKNOWN']) {
      const response = await query('/assignees', { purpose });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'INVALID_PURPOSE' });
    }
    await login('rh');
    expect((await query('/assignees', { purpose: 'WORKER_MANAGER', ids: id(20) })).status).toBe(200);
    expect((await query('/assignees', { purpose: 'DOCUMENT_OWNER', ids: 'invalido' })).status).toBe(403);
    expect((await query('/assignees', { purpose: 'UNIT_RESPONSIBLE', ids: id(20) })).status).toBe(403);
  });

  it.each(endpoints)('valida UUIDs e limite de 100 em %s, deduplicando a seleção', async path => {
    const selected = path === '/document-types' ? id(60) : path === '/workers' ? id(40) : id(20);
    for (const ids of ['', 'invalido', `${selected},`, `${selected},invalido`, Array.from({ length: 101 }, (_, index) => id(10000 + index)).join(',')]) {
      const response = await query(path, { ids });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: [{ field: 'ids' }] });
    }
    const hundred = await read<{ id: string }>(path, { ids: Array.from({ length: 100 }, () => selected).join(','), pageSize: '100' });
    expect(hundred).toMatchObject({ total: 1, items: [{ id: selected }] });
    const duplicateParameter = `${path}?${path === '/assignees' ? 'purpose=DOCUMENT_OWNER&' : ''}ids=${selected}&ids=${selected}`;
    expect((await send('GET', duplicateParameter)).status).toBe(422);
  });

  it.each(endpoints)('mantém os limites de página de %s e a autorização antes da validação de IDs', async path => {
    expect((await query(path, { page: '0' })).status).toBe(422);
    expect((await query(path, { pageSize: '101' })).status).toBe(422);
    await reseed(data => { data.users[0].roles = []; });
    expect((await query(path, { ids: 'invalido' })).status).toBe(403);
    token = '';
    expect((await query(path, { ids: 'invalido' })).status).toBe(401);
  });
});
