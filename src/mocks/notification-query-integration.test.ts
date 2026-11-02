import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import type { NotificationDto, PageDto, SessionDto } from '../shared/contracts';
import { handlers, resetDemo } from './handlers';
import * as fixtures from './fixtures';

const { UNIT_A, UNIT_B, id } = fixtures;
const originalFixtures = fixtures.makeFixtures;
const server = setupServer(...handlers);
let token = '';
const send = (method: string, path: string, csrf = true) => fetch(`http://localhost/api/v1${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, ...(csrf ? { 'X-CSRF-Token': 'demo-csrf' } : {}) },
});
async function login(role = 'gestor') {
  const response = await fetch('http://localhost/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'demo-csrf' }, body: JSON.stringify({ email: `${role}@demo.sesmt.local`, password: 'Demo123!' }) });
  expect(response.status).toBe(200); token = (await response.json() as SessionDto).accessToken;
}
async function notices(unit = UNIT_A) {
  const response = await send('GET', `/notifications?unitId=${unit}`);
  expect(response.status).toBe(200); return (await response.json() as PageDto<NotificationDto>).items;
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(async () => { resetDemo(); await login(); });
afterEach(() => { vi.restoreAllMocks(); server.resetHandlers(); resetDemo(); });
afterAll(() => server.close());

describe('notificações demonstrativas respeitam método, contexto e critérios', () => {
  it.each(['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])('não registra leitura por %s', async method => {
    const response = await send(method, `/notifications/${id(150)}/read`);
    expect(response.status).toBe(405);
    expect((await notices()).find(item => item.id === id(150))?.readAt).toBeUndefined();
  });
  it('rejeita uma rota ampliada, preservando a notificação', async () => {
    expect((await send('PATCH', `/notifications/${id(150)}/read/extra`)).status).toBe(405);
    expect((await notices())[0].readAt).toBeUndefined();
  });
  it('exige CSRF e não registra leitura em outra unidade selecionada', async () => {
    expect((await send('PATCH', `/notifications/${id(150)}/read?unitId=${UNIT_A}`, false)).status).toBe(403);
    expect((await send('PATCH', `/notifications/${id(150)}/read?unitId=${UNIT_B}`)).status).toBe(404);
    expect((await notices()).find(item => item.id === id(150))?.readAt).toBeUndefined();
  });
  it('registra somente a leitura e preserva seu primeiro horário nas repetições', async () => {
    const path = `/notifications/${id(150)}/read?unitId=${UNIT_A}`;
    const first = await send('PATCH', path); expect(first.status).toBe(200);
    const saved = await first.json() as NotificationDto;
    const again = await send('PATCH', path); expect(again.status).toBe(200);
    expect(await again.json()).toEqual(saved);
    expect(saved.id).toBe(id(150)); expect(Number.isFinite(Date.parse(saved.readAt!))).toBe(true);
    const document = await send('GET', `/documents/${saved.resourceId}`);
    expect(await document.json()).toMatchObject({ status: 'ACTIVE', revision: 1 });
    const unread = await send('GET', `/notifications?unitId=${UNIT_A}&read=false`);
    expect((await unread.json() as PageDto<NotificationDto>).items.some(item => item.id === saved.id)).toBe(false);
  });
  it('aplica a unidade antes da contagem e paginação', async () => {
    const first = await send('GET', `/notifications?unitId=${UNIT_A}&page=2&pageSize=2`);
    expect(await first.json()).toMatchObject({ total: 3, page: 2, pageSize: 2, items: [{ id: id(152) }] });
    expect((await notices(UNIT_B)).map(item => item.id)).toEqual([id(153)]);
  });
  it('recusa recursos ocultos pelo escopo da pessoa e documentos médicos', async () => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); data.documents[0].accessClass = 'MEDICAL'; return data;
    });
    resetDemo(); await login();
    expect((await notices()).some(item => item.id === id(150))).toBe(false);
    expect((await send('PATCH', `/notifications/${id(150)}/read?unitId=${UNIT_A}`)).status).toBe(404);
    await login('trabalhador');
    expect((await send('PATCH', `/notifications/${id(151)}/read?unitId=${UNIT_A}`)).status).toBe(404);
  });
  it.each(['read=unknown', 'read=', 'read=true&read=false', 'unitId=a&unitId=b', 'page=0', 'page=1.5', 'page=01', 'page=9007199254740992', 'pageSize=0', 'pageSize=101', 'pageSize=20&pageSize=10', 'q=ignored'])('recusa critérios ambíguos ou inválidos: %s', async criteria => {
    expect((await send('GET', `/notifications?${criteria}`)).status).toBe(422);
  });
  it('não altera uma notificação quando os critérios de escrita são inválidos', async () => {
    expect((await send('PATCH', `/notifications/${id(150)}/read?unitId=${UNIT_A}&unitId=${UNIT_B}`)).status).toBe(422);
    expect((await send('PATCH', `/notifications/${id(150)}/read?read=false`)).status).toBe(422);
    expect((await notices())[0].readAt).toBeUndefined();
  });
  it('exige sessão e recusa uma unidade não concedida', async () => {
    expect((await send('GET', `/notifications?unitId=${id(999)}`)).status).toBe(404);
    token = ''; expect((await send('GET', '/notifications')).status).toBe(401);
  });
});

describe('consulta demonstrativa da trilha de auditoria', () => {
  it.each(['POST', 'PATCH', 'DELETE'])('não altera nem entrega a trilha por %s', async method => {
    expect((await send(method, '/audit-logs')).status).toBe(405);
  });
  it.each(['page=0', 'page=Infinity', 'page=01', 'page=9007199254740992', 'page=1&page=2', 'action=CREATE&action=UPDATE', 'action=with%20space', 'from=2026-02-30', 'from=2026-10-02&to=2026-10-01', 'unitId=a&unitId=b', 'ignored=true'])('recusa critérios que ampliariam ou alterariam a busca: %s', async criteria => {
    expect((await send('GET', `/audit-logs?${criteria}`)).status).toBe(422);
  });
  it('aceita códigos futuros seguros sem trocar a busca por todos os eventos', async () => {
    const response = await send('GET', `/audit-logs?unitId=${UNIT_A}&action=EVENTO_NOVO`);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ total: 0, items: [] });
  });
  it('exige a permissão de auditoria', async () => {
    await login('trabalhador'); expect((await send('GET', '/audit-logs')).status).toBe(403);
  });
});
