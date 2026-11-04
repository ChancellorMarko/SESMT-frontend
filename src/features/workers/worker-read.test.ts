import { describe, expect, it } from 'vitest';
import { checkedWorkerDetail, checkedWorkerMovements } from './worker-read';

const worker = { id: 'worker-a', unitId: 'unit-a', companyId: 'company-a', sectorId: 'sector-a', fullName: 'Pessoa autorizada', registration: 'MAT-1', admissionDate: '2026-01-01', employmentType: 'CLT', status: 'ACTIVE', revision: 1 };
describe('identidade e histórico do trabalhador', () => {
  it('aceita cadastro e vínculo nativo mantendo ausências explícitas', () => {
    expect(checkedWorkerDetail(worker, 'worker-a', 'unit-a')).toBe(worker);
    const native = { ...worker, sourceReadOnly: true, revision: null, employmentType: null, sectorId: null };
    expect(checkedWorkerDetail(native, 'worker-a', 'unit-a')).toBe(native);
  });
  it.each([{ id: 'worker-b' }, { unitId: 'unit-b' }, { fullName: null }, { revision: null }, { admissionDate: '2026-02-30' }, { teams: {} }, { integrationHistory: [{ id: 'history-a', workerId: 'worker-b' }] }])('recusa registro incompatível: %j', change => {
    expect(() => checkedWorkerDetail({ ...worker, ...change }, 'worker-a', 'unit-a')).toThrow();
  });
  it('valida a paginação e o trabalhador de cada movimentação', () => {
    const movement = { id: 'movement-a', workerId: 'worker-a', type: 'ASSIGNMENT', effectiveDate: '2026-01-01', reason: null, previousAssignment: null, newAssignment: { unitId: 'unit-a', sectorId: null } };
    const page = { items: [movement], page: 2, pageSize: 5, total: 6 };
    expect(checkedWorkerMovements(page, 'worker-a', 2).total).toBe(6);
    expect(() => checkedWorkerMovements(page, 'worker-b', 2)).toThrow();
    expect(() => checkedWorkerMovements(page, 'worker-a', 1)).toThrow();
  });
});
