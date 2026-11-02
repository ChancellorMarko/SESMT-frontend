import { describe, expect, it } from 'vitest';
import { preparationListPath, preparationNavigation, preparationOrigin } from './preparation-navigation';

describe('retorno às listas de preparação', () => {
  it.each(['ats', 'pets'] as const)('preserva critérios de %s somente na unidade de origem', list => {
    const state = { fromPreparationList: list, fromUnitId: 'unit-a', fromSearch: '?q=Inspe%C3%A7%C3%A3o%20do%20tanque&page=2&unitId=unit-a' };
    expect(preparationNavigation(state, 'unit-a', list)).toEqual(state);
    expect(preparationNavigation(state, 'unit-b', list)).toBeUndefined();
    expect(preparationNavigation(state, undefined, list)).toBeUndefined();
  });
  it.each([
    null, [], 'list', {},
    { fromPreparationList: 'pets', fromUnitId: 'unit-a', fromSearch: '' },
    ...[undefined, 5, '//example.com', 'https://example.com', '?q=with space', '?q=\ntest', '?q=test#fragment', '?q=\\test', '?unitId=unit-b', '?unitId=unit-a&unitId=unit-b', `?q=${'a'.repeat(2000)}`].map(fromSearch => ({ fromPreparationList: 'ats', fromUnitId: 'unit-a', fromSearch })),
  ])('descarta origem inválida ou de outra lista: %j', state => {
    expect(preparationNavigation(state, 'unit-a', 'ats')).toBeUndefined();
  });
  it('aceita uma lista sem filtros', () => {
    const state = { fromPreparationList: 'ats', fromUnitId: 'unit-a', fromSearch: '' };
    expect(preparationNavigation(state, 'unit-a', 'ats')).toEqual(state);
  });
  it.each(['ats', 'pets'] as const)('preserva a origem da Central de %s com unidade explícita', list => {
    const state = { fromConsulta: true as const, fromUnitId: 'unit-a', fromSearch: `?tab=${list}&q=Tanque&page=2&unitId=unit-a` };
    const origin = preparationOrigin(state, 'unit-a', list);
    expect(origin).toEqual(state);
    expect(preparationListPath(origin, list)).toBe(`/app/consulta${state.fromSearch}`);
    expect(preparationOrigin(state, 'unit-b', list)).toBeUndefined();
    expect(preparationOrigin({ ...state, fromUnitId: undefined }, 'unit-a', list)).toBeUndefined();
    expect(preparationOrigin({ ...state, fromSearch: '?tab=documents' }, 'unit-a', list)).toBeUndefined();
    expect(preparationListPath(undefined, list)).toBe(`/app/${list}`);
  });
  it('mantém a lista própria sem transformá-la em consulta central', () => {
    const state = { fromPreparationList: 'ats' as const, fromUnitId: 'unit-a', fromSearch: '?status=DRAFT&page=2' };
    expect(preparationListPath(preparationOrigin(state, 'unit-a', 'ats'), 'ats')).toBe('/app/ats?status=DRAFT&page=2');
  });
});
