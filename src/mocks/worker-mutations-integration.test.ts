import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import type { PageDto, SessionDto, WorkerDto, WorkerMovementDto } from '../shared/contracts';
import { handlers, resetDemo } from './handlers';
import { COMPANY, UNIT_A, id } from './fixtures';
import * as fixtures from './fixtures';

const server = setupServer(...handlers);
const originalFixtures = fixtures.makeFixtures;
let token = '';
function send(method: string, path: string, body?: unknown, revision?: number) {
  return fetch(`http://localhost/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'demo-csrf', Authorization: `Bearer ${token}`, ...(revision ? { 'If-Match': `"${revision}"` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const path = `/workers/${id(40)}`;
const readWorker = async () => (await (await send('GET', path)).json()) as WorkerDto;
const destination = { companyId: COMPANY, unitId: UNIT_A, sectorId: id(5), jobId: null, jobFunctionId: null, workCenterId: null, managerId: null };
const transfer = { type: 'TRANSFER', effectiveDate: '2025-03-12', reason: 'Atualizar o vínculo de demonstração.', newAssignment: destination };
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { vi.restoreAllMocks(); server.resetHandlers(); resetDemo(); });
beforeEach(async () => {
  resetDemo(); token = '';
  const response = await send('POST', '/auth/login', { email: 'rh@demo.sesmt.local', password: 'Demo123!' });
  expect(response.status).toBe(200); token = (await response.json() as SessionDto).accessToken;
});

describe('mutação dos cadastros de trabalhadores na demonstração', () => {
  it('valida também os vínculos retidos quando um pedido omite campos opcionais do destino', async () => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); data.workers.find(worker => worker.id === id(40))!.workCenterId = id(12); return data;
    });
    resetDemo();
    token = (await (await send('POST', '/auth/login', { email: 'rh@demo.sesmt.local', password: 'Demo123!' })).json() as SessionDto).accessToken;
    const previous = await readWorker();
    const result = await send('POST', `${path}/movements`, { ...transfer, newAssignment: { unitId: fixtures.UNIT_B, sectorId: id(7) } }, 1);
    expect(result.status).toBe(422);
    expect(await result.json()).toMatchObject({ code: 'INVALID_ASSIGNMENT', fieldErrors: [{ field: 'workCenterId' }] });
    expect(await readWorker()).toEqual(previous);
  });
  it('limpa campos opcionais explicitamente e preserva o vínculo anterior no histórico', async () => {
    const previous = await readWorker();
    const result = await send('POST', `${path}/movements`, transfer, previous.revision);
    expect(result.status).toBe(200);
    const receipt = await result.json() as { worker: WorkerDto; movement: WorkerMovementDto };
    expect(receipt.worker).toMatchObject({ unitId: UNIT_A, sectorId: id(5), revision: 2 });
    for (const field of ['jobId', 'jobFunctionId', 'workCenterId', 'managerId']) expect(receipt.worker).not.toHaveProperty(field);
    expect(receipt.movement.previousAssignment).toMatchObject({ jobId: previous.jobId, jobFunctionId: previous.jobFunctionId, managerId: previous.managerId });
    expect(receipt.movement.newAssignment).toMatchObject(destination);
    expect(await readWorker()).toMatchObject(receipt.worker);
  });

  it('não altera trabalhador ou histórico quando o destino é incompatível', async () => {
    const previous = await readWorker();
    const history = await (await send('GET', `${path}/movements`)).json();
    const result = await send('POST', `${path}/movements`, { ...transfer, newAssignment: { ...destination, sectorId: id(7) } }, 1);
    expect(result.status).toBe(422);
    expect(await readWorker()).toEqual(previous);
    expect(await (await send('GET', `${path}/movements`)).json()).toEqual(history);
  });

  it('reconfirma a revisão e aceita apenas uma movimentação concorrente', async () => {
    const responses = await Promise.all([
      send('POST', `${path}/movements`, { type: 'LEAVE', effectiveDate: '2025-03-12', reason: 'Primeiro pedido de afastamento.' }, 1),
      send('POST', `${path}/movements`, { type: 'TERMINATION', effectiveDate: '2025-03-12', reason: 'Segundo pedido simultâneo.' }, 1),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    expect((await readWorker()).revision).toBe(2);
    const history = await (await send('GET', `${path}/movements`)).json() as PageDto<WorkerMovementDto>;
    expect(history.items.filter(item => item.reason.includes('pedido'))).toHaveLength(1);
  });

  it('bloqueia alterações de vínculo, situação e campos controlados fora da movimentação', async () => {
    const previous = await readWorker();
    for (const body of [{ fullName: 'Não aplicar', companyId: id(999) }, { id: id(999) }, { status: 'TERMINATED' }, { admissionDate: '2026-02-30' }, { integrationStatus: 'INTEGRATED' }, { fullName: '' }, null, []]) {
      expect((await send('PATCH', path, body, 1)).status).toBe(422);
    }
    expect(await readWorker()).toEqual(previous);
  });

  it('preserva metadados quando outra edição usa a mesma revisão', async () => {
    const responses = await Promise.all([
      send('PATCH', path, { fullName: 'Primeira edição concorrente' }, 1),
      send('PATCH', path, { fullName: 'Segunda edição concorrente' }, 1),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    expect((await readWorker()).revision).toBe(2);
  });

  it('recusa gestor sem elegibilidade e permite removê-lo explicitamente', async () => {
    expect((await send('PATCH', path, { managerId: id(999) }, 1)).status).toBe(422);
    expect((await readWorker()).revision).toBe(1);
    expect((await send('PATCH', path, { managerId: null }, 1)).status).toBe(200);
    expect(await readWorker()).not.toHaveProperty('managerId');
  });

  it('valida datas, papéis e campos da integração antes de registrar histórico', async () => {
    const previous = await readWorker();
    for (const body of [
      { status: 'INVALID', integratedAt: '2025-03-12' },
      { status: 'INTEGRATED', integratedAt: '2026-02-30' },
      { status: 'INTEGRATED', integratedAt: '2025-03-12', validUntil: '2025-03-11' },
      { status: 'INTEGRATED', integratedAt: '2025-03-12', responsibleId: id(999) },
      { status: 'INTEGRATED', integratedAt: '2025-03-12', revision: 100 },
    ]) expect((await send('POST', `${path}/integration`, body, 1)).status).toBe(422);
    expect(await readWorker()).toEqual(previous);
  });

  it('recusa admissão com data inexistente ou cargo/função incompatíveis, sem criar cadastros', async () => {
    const payload = { fullName: 'Pessoa sintética', registration: 'TEST-NEW', employmentType: 'CLT', admissionDate: '2025-03-12', companyId: COMPANY, unitId: UNIT_A, sectorId: id(5) };
    const before = await (await send('GET', '/workers')).json();
    for (const body of [{ ...payload, admissionDate: '2026-02-30' }, { ...payload, jobId: id(999) }, { ...payload, jobFunctionId: id(10) }, { ...payload, revision: 9 }]) {
      expect((await send('POST', '/workers', body)).status).toBe(422);
    }
    expect(await (await send('GET', '/workers')).json()).toEqual(before);
  });

  it('responde com erro de validação a JSON malformado e recusa métodos indisponíveis', async () => {
    const result = await fetch(`http://localhost/api/v1${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-CSRF-Token': 'demo-csrf', 'If-Match': '"1"' }, body: '{' });
    expect(result.status).toBe(422); expect(await result.json()).toMatchObject({ code: 'INVALID_JSON' });
    expect((await send('DELETE', path)).status).toBe(405);
    expect((await readWorker()).revision).toBe(1);
  });
});
