import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedAso, checkedContext, checkedHistory, checkedPage, dueStatus, fieldsSchema } from './contracts';
const company = '11000000-0000-4000-8000-000000000001', unit = '12000000-0000-4000-8000-000000000001', worker = '13000000-0000-4000-8000-000000000001';
const scope = { unitId: unit, companyIds: [company], ownOnly: false, workerId: worker, canDetail: false };
const item = { id: '14000000-0000-4000-8000-000000000001', companyId: company, unitId: unit, workerId: worker, workerName: 'Pessoa QA', examKind: 'PERIODIC' as const,
  examOn: '2026-01-05', issuedOn: '2026-01-05', nextEvaluationOn: null, fitness: 'UNFIT' as const, evaluatedFunction: 'Operador', medical: null, revision: 1, revokedAt: null, revocationCode: null, isLatest: true };
const issuer = { physicianName: 'Emitente QA', physicianCrm: '12345', physicianState: 'PR', reference: null };
afterEach(() => vi.useRealTimers());
describe('ASO administrativo', () => {
  it('bloqueia dados de outra empresa, unidade, pessoa ou ID', () => {
    for (const patch of [{ companyId: worker }, { unitId: worker }]) expect(() => checkedAso({ ...item, ...patch }, scope)).toThrow();
    expect(() => checkedAso({ ...item, workerId: company }, { ...scope, ownOnly: true })).toThrow();
    expect(() => checkedAso(item, scope, worker)).toThrow(); expect(checkedAso(item, scope)).toEqual(item);
  });
  it('exige que a resposta respeite o nível de detalhe autorizado', () => {
    expect(() => checkedAso({ ...item, medical: issuer }, scope)).toThrow();
    expect(() => checkedAso(item, { ...scope, canDetail: true })).toThrow();
    expect(checkedAso({ ...item, medical: issuer }, { ...scope, canDetail: true }).medical).toEqual(issuer);
    expect(() => checkedAso({ ...item, diagnosis: 'Não coletado' }, scope)).toThrow();
  });
  it('recusa contexto próprio com escrita e catálogo de terceiros', () => {
    const c = { unitId: unit, companyId: company, ownOnly: true, canEdit: false, canDetail: true, workers: [] };
    expect(checkedContext(c, { ...scope, ownOnly: true })).toEqual(c);
    expect(() => checkedContext({ ...c, canEdit: true }, { ...scope, ownOnly: true })).toThrow();
    expect(() => checkedContext({ ...c, workers: [{ id: worker, name: 'Pessoa', enrollment: 'MAT' }] }, { ...scope, ownOnly: true })).toThrow();
  });
  it('não aceita anterior, duplicado ou invalidado na visão mais recente', () => {
    const page = { items: [item], total: 1, page: 1, pageSize: 20 };
    expect(checkedPage(page, scope, 1, 'LATEST', '').items).toHaveLength(1);
    expect(() => checkedPage({ ...page, items: [{ ...item, isLatest: false }] }, scope, 1, 'LATEST', '')).toThrow();
    expect(() => checkedPage({ ...page, items: [item, { ...item, id: worker }], total: 2 }, scope, 1, 'LATEST', '')).toThrow();
    expect(() => checkedAso({ ...item, revokedAt: '2026-11-03T12:00:00Z', revocationCode: 'DUPLICATE' }, scope)).toThrow();
    expect(() => checkedPage({ ...page, total: 2 }, scope, 1, 'ALL', '')).toThrow();
  });
  it('confere limites das datas sem inventar renovação anual ou aptidão', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const f = { workerId: worker, examKind: 'PERIODIC', examOn: '2026-01-05', issuedOn: '2026-01-05', nextEvaluationOn: '', fitness: 'UNFIT', evaluatedFunction: 'Operador', ...issuer, reference: '', changeCode: '' };
    expect(fieldsSchema.safeParse(f).success).toBe(true);
    for (const patch of [{ fitness: '' }, { examOn: '2026-02-30' }, { issuedOn: '2025-01-01' }, { nextEvaluationOn: '2025-01-01' }, { examOn: '2026-11-04', issuedOn: '2026-11-04' }, { physicianState: 'XX' }, { physicianCrm: 'ABC' }]) expect(fieldsSchema.safeParse({ ...f, ...patch }).success).toBe(false);
    expect(dueStatus(item)).toBe('NO_DATE'); expect(dueStatus({ ...item, nextEvaluationOn: '2026-11-02' })).toBe('DUE');
    expect(dueStatus({ ...item, nextEvaluationOn: '2026-12-03' })).toBe('SOON'); expect(dueStatus({ ...item, nextEvaluationOn: '2026-12-04' })).toBe('SCHEDULED');
  });
  it('recusa histórico com campos clínicos ou revisão futura', () => {
    const event = { id: item.id, action: 'ASO_REGISTERED', revision: 1, actorName: null, occurredAt: '2026-11-03T12:00:00Z', reasonCode: null };
    expect(checkedHistory([event], 1)).toHaveLength(1);
    for (const patch of [{ revision: 2 }, { diagnosis: 'Não coletado' }, { reasonCode: 'Texto livre clínico' }]) expect(() => checkedHistory([{ ...event, ...patch }], 1)).toThrow();
  });
});
