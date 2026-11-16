import { describe, expect, it } from 'vitest';
import { checkedNativeDeadlines, readableDeadlineKinds } from './native-deadlines';
import { deadlinesFixture } from '../../../tests/connection-ui/fixtures/native-deadlines';

describe('contrato de vencimentos', () => {
  it('aceita uma resposta coerente e normaliza os identificadores', () => {
    const data = checkedNativeDeadlines(deadlinesFixture(), 30);
    expect(data.items[0].id).toBe('a1b2c3d4-0000-4000-8000-000000000001');
    expect(data.items.map(item => item.status)).toEqual(['OVERDUE', 'DUE_SOON']);
  });

  it.each([
    ['janela diferente da pedida', (v: ReturnType<typeof deadlinesFixture>) => { v.days = 60; }],
    ['situação que não confere com a data', (v: ReturnType<typeof deadlinesFixture>) => { v.items[1].status = 'OVERDUE'; v.summary = { overdue: 2, dueSoon: 0 }; }],
    ['data além da janela', (v: ReturnType<typeof deadlinesFixture>) => { v.items[1].dueOn = '2026-12-15'; }],
    ['origem não informada em kinds', (v: ReturnType<typeof deadlinesFixture>) => { v.items[1].kind = 'ASO'; }],
    ['totais incoerentes', (v: ReturnType<typeof deadlinesFixture>) => { v.total = 3; }],
    ['lista fora de ordem', (v: ReturnType<typeof deadlinesFixture>) => { v.items.reverse(); }],
    ['item duplicado', (v: ReturnType<typeof deadlinesFixture>) => { v.items[1] = { ...v.items[0] }; }],
    ['campo extra com dado sensível', (v: ReturnType<typeof deadlinesFixture>) => { Object.assign(v.items[0], { examKind: 'PERIODIC' }); }],
    ['truncamento sem total maior que o limite', (v: ReturnType<typeof deadlinesFixture>) => { v.truncated = true; }],
    ['data inexistente', (v: ReturnType<typeof deadlinesFixture>) => { v.referenceDate = '2026-02-30'; }],
  ])('recusa %s', (_, mutate) => {
    const value = deadlinesFixture(); mutate(value);
    expect(() => checkedNativeDeadlines(value, 30)).toThrow();
  });

  it('só considera as fontes que a conta pode ler', () => {
    expect(readableDeadlineKinds(permission => permission === 'epi:ler')).toEqual(['EPI']);
    expect(readableDeadlineKinds(() => false)).toEqual([]);
  });
});
