import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from '../../mocks/handlers';
import { id, UNIT_A } from '../../mocks/fixtures';
import type { OrganizationItemDto, SessionDto } from '../../shared/contracts';

const server = setupServer(...handlers);
let accessToken = '';
const send = (method: string, path: string, body?: unknown, revision?: number) => fetch(`http://localhost/api/v1${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'demo-csrf', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); resetDemo(); });
beforeEach(async () => {
  resetDemo(); accessToken = '';
  const login = await send('POST', '/auth/login', { email: 'gestor@demo.sesmt.local', password: 'Demo123!' });
  expect(login.status).toBe(200);
  const session = await login.json() as SessionDto;
  accessToken = session.accessToken;
});

describe('Atualização parcial da organização no modo demo', () => {
  it('inativa e reativa setor enviando somente a situação, preservando nome e vínculo', async () => {
    const createdResponse = await send('POST', '/sectors', { name: '  Setor de demonstração  ', unitId: UNIT_A });
    expect(createdResponse.ok).toBe(true);
    const created = await createdResponse.json() as OrganizationItemDto;
    const inactiveResponse = await send('PATCH', `/sectors/${created.id}`, { status: 'INACTIVE' }, created.revision);
    expect(inactiveResponse.status).toBe(200);
    const inactive = await inactiveResponse.json() as OrganizationItemDto;
    expect(inactive).toMatchObject({ name: 'Setor de demonstração', unitId: UNIT_A, status: 'INACTIVE', revision: 2 });
    const activeResponse = await send('PATCH', `/sectors/${created.id}`, { status: 'ACTIVE' }, inactive.revision);
    expect(activeResponse.status).toBe(200);
    expect(await activeResponse.json()).toMatchObject({ name: 'Setor de demonstração', unitId: UNIT_A, status: 'ACTIVE', revision: 3 });
  });
  it('continua validando o nome quando ele é fornecido na alteração', async () => {
    const response = await send('PATCH', `/sectors/${id(5)}`, { name: '  ' }, 1);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: [{ field: 'name', code: 'VALIDATION_FAILED', message: 'Preencha este campo.' }] });
  });
  it('continua bloqueando a inativação de setor com trabalhadores vinculados', async () => {
    const response = await send('PATCH', `/sectors/${id(5)}`, { status: 'INACTIVE' }, 1);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RESOURCE_IN_USE' });
  });
});
