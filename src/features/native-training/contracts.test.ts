import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedContext, checkedHistory, checkedPage, checkedTraining, duration, localDay, trainingFields, trainingStatus } from './contracts';

const company = '11000000-0000-4000-8000-000000000001', unit = '12000000-0000-4000-8000-000000000001', worker = '13000000-0000-4000-8000-000000000001';
const scope = { unitId: unit, companyIds: [company], ownOnly: false, workerId: worker };
const item = { id: '14000000-0000-4000-8000-000000000001', companyId: company, unitId: unit, workerId: worker, workerName: 'Hugo Almeida',
  title: 'Integração de segurança', reference: null, kind: 'INITIAL' as const, completedOn: '2026-01-05', renewalOn: null, durationMinutes: 90,
  provider: null, instructor: null, venue: null, content: null, notes: null, revokedAt: null, revocationReason: null, revision: 1 };
afterEach(() => vi.useRealTimers());
describe('contrato de treinamentos', () => {
  it('recusa registros de outra empresa, unidade e trabalhador em acesso próprio', () => {
    expect(() => checkedTraining({ ...item, companyId: worker }, scope)).toThrow();
    expect(() => checkedTraining({ ...item, unitId: worker }, scope)).toThrow();
    expect(() => checkedTraining({ ...item, workerId: company }, { ...scope, ownOnly: true })).toThrow();
    expect(checkedTraining(item, { ...scope, ownOnly: true })).toEqual(item);
  });
  it('recusa IDs trocados e datas civis inválidas', () => {
    expect(() => checkedTraining(item, scope, worker)).toThrow();
    for (const completedOn of ['2026-02-30', '0000-01-01', '2026-13-01']) expect(() => checkedTraining({ ...item, completedOn }, scope)).toThrow();
    expect(() => checkedTraining({ ...item, renewalOn: '2025-01-01' }, scope)).toThrow();
  });
  it('não aceita capacidades de gestão nem catálogo de pessoas no contexto próprio', () => {
    const own = { unitId: unit, companyId: company, ownOnly: true, canCreate: false, canEdit: false, workers: [] };
    expect(checkedContext(own, { ...scope, ownOnly: true })).toEqual(own);
    expect(() => checkedContext({ ...own, canCreate: true }, { ...scope, ownOnly: true })).toThrow();
    expect(() => checkedContext({ ...own, workers: [{ id: worker, name: 'Hugo', enrollment: 'MAT-1' }] }, { ...scope, ownOnly: true })).toThrow();
  });
  it('confere total, página, duplicidade e correspondência dos filtros', () => {
    const page = { items: [item], total: 1, page: 1, pageSize: 20 };
    expect(checkedPage(page, scope, 1, 'Hugo', 'NO_DATE').items).toHaveLength(1);
    expect(() => checkedPage({ ...page, total: 2 }, scope, 1)).toThrow();
    expect(() => checkedPage({ ...page, items: [item, item], total: 2 }, scope, 1)).toThrow();
    expect(() => checkedPage(page, scope, 1, 'Outro curso')).toThrow();
    expect(() => checkedPage(page, scope, 1, '', 'REVOKED')).toThrow();
  });
  it('distingue renovação atrasada, próximos 30 dias, prazo e ausência de data', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    expect(trainingStatus(item)).toBe('NO_DATE');
    expect(trainingStatus({ ...item, renewalOn: '2026-11-02' })).toBe('EXPIRED');
    expect(trainingStatus({ ...item, renewalOn: '2026-11-03' })).toBe('EXPIRING');
    expect(trainingStatus({ ...item, renewalOn: '2026-12-03' })).toBe('EXPIRING');
    expect(trainingStatus({ ...item, renewalOn: '2026-12-04' })).toBe('CURRENT');
    expect(trainingStatus({ ...item, revokedAt: '2026-11-03T12:00:00Z', revocationReason: 'Erro no registro' })).toBe('REVOKED');
  });
  it('usa Brasília na virada da data e mantém a duração em minutos inteiros', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T01:30:00Z')); expect(localDay()).toBe('2026-11-03');
    expect(duration(90)).toBe('1 h 30 min'); expect(duration(480)).toBe('8 h');
  });
  it('recusa invalidação sem motivo e histórico de revisão futura ou repetido', () => {
    expect(() => checkedTraining({ ...item, revokedAt: '2026-11-03T12:00:00Z' }, scope)).toThrow();
    const event = { id: item.id, action: 'TRAINING_CREATED', revision: 1, actorName: null, occurredAt: '2026-11-03T12:00:00Z', reason: null };
    expect(checkedHistory([event], 1)).toHaveLength(1);
    expect(() => checkedHistory([{ ...event, revision: 2 }], 1)).toThrow();
    expect(() => checkedHistory([event, event], 1)).toThrow();
  });
  it('valida carga horária e calendário sem impor uma duração legal por NR', () => {
    const fields = { workerId: worker, title: item.title, reference: 'NR informada pela equipe', kind: 'INITIAL', completedOn: '2026-01-05', renewalOn: '', hours: '1', minutes: '30', provider: '', instructor: '', venue: '', content: '', notes: '', changeReason: '' };
    expect(trainingFields.safeParse(fields).success).toBe(true);
    for (const patch of [{ hours: '0', minutes: '0' }, { minutes: '60' }, { hours: '1.5' }, { completedOn: '2026-02-30' }, { renewalOn: '2025-01-01' }]) expect(trainingFields.safeParse({ ...fields, ...patch }).success).toBe(false);
  });
});
