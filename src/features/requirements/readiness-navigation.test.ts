import { describe, expect, it } from 'vitest';
import { readinessReturnPath } from './readiness-navigation';

const unitId = 'unit-a';
const origin = (search: string, sourceUnit = unitId) => ({ readinessReturnTo: { search, unitId: sourceUnit } });

describe('retorno à consulta documental', () => {
  it('preserva literalmente os filtros e sua ordem em uma origem válida da unidade atual', () => {
    const search = '?q=Jo%C3%A3o+Silva&status=all&teamId=team-a&serviceTypeId=service-a&unitId=unit-a';
    expect(readinessReturnPath(origin(search), unitId)).toBe(`/app/pendencias${search}`);
  });
  it('aceita somente a unidade no query, mantendo a situação padrão implícita', () => {
    expect(readinessReturnPath(origin('?unitId=unit-a'), unitId)).toBe('/app/pendencias?unitId=unit-a');
  });
  it.each([undefined, null, 'invalid', [], {}, { readinessReturnTo: [] }, { readinessReturnTo: null }, { readinessReturnTo: { unitId } }, { readinessReturnTo: { unitId, search: 1 } }])('ignora uma origem sem formato confiável: %j', state => {
    expect(readinessReturnPath(state, unitId)).toBeUndefined();
  });
  it('recusa a origem após troca de unidade ou quando nenhuma unidade está selecionada', () => {
    expect(readinessReturnPath(origin('?unitId=unit-a'), 'unit-b')).toBeUndefined();
    expect(readinessReturnPath(origin('?unitId=unit-a'), undefined)).toBeUndefined();
    expect(readinessReturnPath(origin('?unitId=unit-a', 'unit-b'), unitId)).toBeUndefined();
  });
  it.each([
    '', '?q=Pessoa', '?unitId=unit-b', '?unitId=unit-a&unitId=unit-a', '?unitId=unit-a&unitId=unit-b',
    '?unitId=unit-a&status=unknown', '?unitId=unit-a&status=', '?unitId=unit-a&extra=value',
    '?unitId=unit-a&q=Pessoa&q=Outra', '?unitId=unit-a&teamId=', '?unitId=unit-a&serviceTypeId=a%2Fb',
    '?unitId=unit-a&q=%00', '?unitId=unit-a#fragment', 'https://example.test/?unitId=unit-a',
    '/app/pendencias?unitId=unit-a', '?unitId=unit-a&q=Pessoa Outra', '?unitId=unit-a&q=Pessoa\\Outra',
  ])('ignora unidade, rota ou critérios inválidos: %s', search => {
    expect(readinessReturnPath(origin(search), unitId)).toBeUndefined();
  });
  it('não usa um pathname externo mesmo quando os filtros são válidos', () => {
    expect(readinessReturnPath({ readinessReturnTo: { unitId, search: '?unitId=unit-a', pathname: 'https://example.test' } }, unitId)).toBeUndefined();
    expect(readinessReturnPath({ readinessReturnTo: { unitId, search: '?unitId=unit-a', pathname: '/app/pendencias' } }, unitId)).toBe('/app/pendencias?unitId=unit-a');
  });
  it('recusa queries excessivas antes de criar o destino de retorno', () => {
    const search = '?unitId=unit-a&q=' + '%41'.repeat(1400);
    expect(search.length).toBeGreaterThan(4096);
    expect(readinessReturnPath(origin(search), unitId)).toBeUndefined();
  });
});
