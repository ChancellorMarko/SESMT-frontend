import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from './handlers';
import { COMPANY, UNIT_A, UNIT_B, id } from './fixtures';
import { PET_SOURCE, createPetPreparation } from '../features/confined-space/model';
import type { ErrorDto, PageDto, SessionDto } from '../shared/contracts';
import type { AppointmentDto } from '../shared/contracts/work-permits';
import type { ConfinedSpacePermitDto, PetOptionsDto } from '../shared/contracts/confined-space-permits';
import { dateOnly } from '../shared/lib/format';

const server = setupServer(...handlers);
let token = '';
interface RequestOptions { revision?: number; csrf?: string | null; token?: string | null; key?: string }
function send(method: string, path: string, body?: unknown, options: RequestOptions = {}) {
  const requestToken = options.token === undefined ? token : options.token;
  const csrf = options.csrf === undefined ? 'demo-csrf' : options.csrf;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (requestToken) headers.set('Authorization', `Bearer ${requestToken}`);
  if (csrf) headers.set('X-CSRF-Token', csrf);
  if (options.revision !== undefined) headers.set('If-Match', `"${options.revision}"`);
  if (options.key) headers.set('Idempotency-Key', options.key);
  return fetch(`http://localhost/api/v1${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function login(role = 'tecnico') {
  token = '';
  const response = await send('POST', '/auth/login', { email: `${role}@demo.sesmt.local`, password: 'Demo123!' });
  expect(response.status).toBe(200);
  const result = await response.json();
  const session = role === 'admin' ? await (await send('POST', '/auth/mfa/verify', { challengeId: result.challengeId, code: '123456' })).json() as SessionDto : result as SessionDto;
  token = session.accessToken;
}
const listPath = `/confined-space-permits?unitId=${UNIT_A}`;
const optionsPath = `/confined-space-permit-options?unitId=${UNIT_A}`;
async function appointment() {
  const response = await send('GET', `/appointments/${id(221)}`); expect(response.status).toBe(200);
  return response.json() as Promise<AppointmentDto>;
}
async function input() {
  const value = await appointment();
  const preparation = createPetPreparation(value);
  preparation.identification.spaceCode = 'EC-DEMO-001';
  preparation.identification.spaceDescription = 'Tanque fictício para preparação documental';
  return { appointmentId: value.id, ...preparation };
}
async function create(options?: RequestOptions) {
  const payload = await input();
  const response = await send('POST', listPath, payload, options);
  expect(response.status).toBe(201);
  return { response, payload, value: await response.json() as ConfinedSpacePermitDto };
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); resetDemo(); });
beforeEach(async () => { resetDemo(); await login(); });

describe('PET atravessa os handlers HTTP reais da demonstração', () => {
  it('exige autenticação e CSRF para criar ou editar, retornando erros estruturados', async () => {
    const payload = await input();
    for (const path of [optionsPath, listPath]) {
      const response = await send('GET', path, undefined, { token: null });
      expect(response.status).toBe(401); expect(await response.json() as ErrorDto).toMatchObject({ code: 'TOKEN_EXPIRED', requestId: expect.any(String) });
    }
    for (const csrf of [null, 'csrf-invalido']) {
      const response = await send('POST', listPath, payload, { csrf });
      expect(response.status).toBe(403); expect(await response.json() as ErrorDto).toMatchObject({ code: 'CSRF_INVALID' });
    }
    const created = await send('POST', listPath, payload); expect(created.status).toBe(201);
    const value = await created.json() as ConfinedSpacePermitDto;
    const response = await send('PATCH', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`, value.preparation, { revision: 1, csrf: null });
    expect(response.status).toBe(403); expect((await response.json() as ErrorDto).code).toBe('CSRF_INVALID');
  });
  it('opções respeitam responsável e unidade da agenda existente sem modificar atendimento', async () => {
    const before = await appointment();
    const response = await send('GET', optionsPath); expect(response.status).toBe(200);
    const options = await response.json() as PetOptionsDto;
    expect(options.appointments.map(value => value.id)).toEqual(expect.arrayContaining([id(220), id(221)]));
    expect(options.appointments.every(value => value.unitId === UNIT_A && value.responsibleId === id(25) && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(value.status))).toBe(true);
    expect(options.appointments.map(value => value.id)).not.toContain(id(222));
    expect(options.appointments.map(value => value.id)).not.toContain(id(223));
    const unavailable = await send('GET', `/confined-space-permit-options?unitId=${UNIT_B}`); expect(unavailable.status).toBe(200);
    expect((await unavailable.json() as PetOptionsDto).appointments).toEqual([]);
    expect(await appointment()).toEqual(before);
  });
  it('cria com 201/ETag, restaura fonte e perguntas canônicas e permite consultar a revisão', async () => {
    const before = await appointment(); const payload = await input();
    payload.checks[0] = { ...payload.checks[0], label: 'Texto adulterado', section: 'Outra seção', sourceCell: 'A1' };
    const response = await send('POST', listPath, { ...payload, status: 'AUTHORIZED', sourceId: 'FAKE' });
    expect(response.status).toBe(201); expect(response.headers.get('ETag')).toBe('"1"');
    const value = await response.json() as ConfinedSpacePermitDto;
    expect(value).toMatchObject({ status: 'DRAFT', revision: 1, companyId: COMPANY, unitId: UNIT_A, sourceId: PET_SOURCE.sourceId, sourceSha256: PET_SOURCE.sourceSha256 });
    expect(value.preparation.checks[0]).toMatchObject({ label: PET_SOURCE.checks[0].label, section: PET_SOURCE.checks[0].section, sourceCell: PET_SOURCE.checks[0].sourceCell });
    const detail = await send('GET', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`);
    expect(detail.status).toBe(200); expect(detail.headers.get('ETag')).toBe('"1"'); expect(await detail.json()).toEqual(value);
    const list = await send('GET', listPath); expect(list.status).toBe(200);
    expect((await list.json() as PageDto<ConfinedSpacePermitDto>).items.map(item => item.id)).toEqual([value.id]);
    expect(await appointment()).toEqual(before);
  });
  it('PATCH exige revisão, rejeita conflito e mantém snapshots anteriores', async () => {
    const { value } = await create(); const path = `/confined-space-permits/${value.id}?unitId=${UNIT_A}`;
    const payload = { ...value.preparation, identification: { ...value.preparation.identification, notes: 'Planejamento documental revisado.' } };
    const missing = await send('PATCH', path, payload); expect(missing.status).toBe(428);
    const saved = await send('PATCH', path, payload, { revision: 1 }); expect(saved.status).toBe(200); expect(saved.headers.get('ETag')).toBe('"2"');
    const current = await saved.json() as ConfinedSpacePermitDto;
    expect(current.snapshots.map(item => item.revision)).toEqual([1, 2]); expect(current.snapshots[0].preparation.identification.notes).toBe(value.preparation.identification.notes);
    const stale = await send('PATCH', path, value.preparation, { revision: 1 }); expect(stale.status).toBe(412);
    expect((await stale.json() as ErrorDto).code).toBe('REVISION_CONFLICT');
    const detail = await send('GET', path); expect((await detail.json() as ConfinedSpacePermitDto).preparation.identification.notes).toBe(payload.identification.notes);
  });
  it('isola unidades e mantém o auditor com acesso somente de leitura', async () => {
    const { value, payload } = await create(); await login('auditor');
    const read = await send('GET', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`); expect(read.status).toBe(200);
    expect((await read.json() as ConfinedSpacePermitDto).availableActions).toEqual(['PRINT']);
    for (const [method, path, body] of [['GET', optionsPath, undefined], ['POST', listPath, payload], ['PATCH', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`, value.preparation]] as const) {
      expect((await send(method, path, body, { revision: 1 })).status).toBe(403);
    }
    const otherUnit = await send('GET', `/confined-space-permits?unitId=${UNIT_B}`); expect(otherUnit.status).toBe(200);
    expect((await otherUnit.json() as PageDto<ConfinedSpacePermitDto>).total).toBe(0);
    expect((await send('GET', `/confined-space-permits/${value.id}?unitId=${UNIT_B}`)).status).toBe(404);
  });
  it('trabalhador não acessa PET mesmo quando participa do atendimento', async () => {
    const { value, payload } = await create(); await login('trabalhador');
    for (const [method, path, body] of [['GET', listPath, undefined], ['GET', optionsPath, undefined], ['GET', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`, undefined], ['POST', listPath, payload], ['PATCH', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`, value.preparation]] as const) {
      expect((await send(method, path, body, { revision: 1 })).status).toBe(403);
    }
  });
  it('auditor com unidade restrita não consulta registros fora do alcance concedido', async () => {
    const { value } = await create(); await login('admin');
    const response = await send('PATCH', `/users/${id(22)}/access`, { roles: ['AUDITOR'], scope: { companyIds: [COMPANY], unitIds: [UNIT_B], sectorIds: [id(7)], teamIds: [], ownOnly: false, expiresAt: new Date(Date.now() + 86400000).toISOString() } }, { revision: 1 });
    expect(response.status).toBe(200); await login('auditor');
    for (const path of [listPath, `/confined-space-permits/${value.id}?unitId=${UNIT_A}`]) expect([403, 404]).toContain((await send('GET', path)).status);
    const permitted = await send('GET', `/confined-space-permits?unitId=${UNIT_B}`); expect(permitted.status).toBe(200);
    expect((await permitted.json() as PageDto<ConfinedSpacePermitDto>).total).toBe(0);
  });
  it('idempotência mantém id/ETag e não permite replay sem autenticação ou CSRF', async () => {
    const key = 'pet-create-integration'; const { response, payload, value } = await create({ key });
    const repeated = await send('POST', listPath, payload, { key }); expect(repeated.status).toBe(201);
    expect((await repeated.json() as ConfinedSpacePermitDto).id).toBe(value.id); expect(repeated.headers.get('ETag')).toBe(response.headers.get('ETag'));
    const unauthenticated = await send('POST', listPath, payload, { key, token: null }); expect(unauthenticated.status).toBe(401);
    const missingCsrf = await send('POST', listPath, payload, { key, csrf: null }); expect(missingCsrf.status).toBe(403);
    const list = await send('GET', listPath); expect((await list.json() as PageDto<ConfinedSpacePermitDto>).total).toBe(1);
  });
  it('replay de criação não revela PET depois da transferência cadastral de participante', async () => {
    await login('gestor');
    const key = 'pet-create-before-worker-transfer'; const { value, payload } = await create({ key });
    const movement = await send('POST', `/workers/${id(40)}/movements`, { type: 'TRANSFER', effectiveDate: dateOnly(), reason: 'Transferência de demonstração para conferir o alcance atual.', newAssignment: { companyId: COMPANY, unitId: UNIT_B, sectorId: id(7) } }, { revision: 1 });
    expect(movement.status).toBe(200);
    const detail = await send('GET', `/confined-space-permits/${value.id}?unitId=${UNIT_A}`); expect(detail.status).toBe(404);
    const repeated = await send('POST', listPath, payload, { key });
    expect(repeated.status).toBe(404); expect((await repeated.json() as ErrorDto).code).toBe('NOT_FOUND');
  });
});
