import { describe, expect, it } from 'vitest';
import { workerNavigation } from './worker-navigation';

const search = '?unitId=unit-a&q=Jo%C3%A3o&status=ACTIVE&integrationStatus=PENDING&companyId=company-a&teamId=team-a&page=2';
const origin = { unitId: 'unit-a', sessionKey: 'session-a', search, draftSearch: 'Busca ainda não enviada', advancedOpen: true };
const read = (value: unknown) => workerNavigation({ workerListReturnTo: value }, 'session-a', 'unit-a');

describe('retorno à consulta de trabalhadores', () => {
  it('conserva critérios, rascunho e expansão e descarta estado alheio ao retorno', () => {
    expect(read({ ...origin, pathname: 'https://example.test', token: 'descartar' })).toEqual({ workerListReturnTo: origin });
    expect(workerNavigation({ workerListReturnTo: origin, success: 'descartar' }, 'session-a', 'unit-a')).toEqual({ workerListReturnTo: origin });
  });
  it.each([
    null, [], 'https://example.test',
    { ...origin, unitId: 'unit-b' }, { ...origin, sessionKey: 'old-session' },
    { ...origin, search: '?unitId=unit-b' }, { ...origin, search: '?q=Ana' },
    { ...origin, search: 'https://example.test/?unitId=unit-a' },
    { ...origin, search: '?unitId=unit-a#outro' }, { ...origin, search: '?unitId=unit-a\\outro' },
    { ...origin, search: '?unitId=unit-a&q=texto literal' },
    ...['page=Infinity', 'page=0', 'page=01', 'page=2&page=3', 'q=a&q=b', 'unitId=unit-a', 'unknown=value', 'status=__proto__', 'integrationStatus=LIBERADO', 'teamId=..%2Foutro', 'companyId=%0Aoutro', 'q=%00', `q=${'a'.repeat(201)}`].map(criteria => ({ ...origin, search: `?unitId=unit-a&${criteria}` })),
  ])('descarta origem inválida sem gerar outro destino: %j', value => {
    expect(read(value)).toBeUndefined();
  });
  it('conserva a consulta válida ao descartar apenas um rascunho ou expansão incompatível', () => {
    expect(read({ ...origin, draftSearch: 'a'.repeat(201), advancedOpen: 'true' })).toEqual({ workerListReturnTo: { unitId: origin.unitId, sessionKey: origin.sessionKey, search } });
  });
  it('exige unidade e sessão vigentes na ida e na volta', () => {
    expect(workerNavigation({ workerListReturnTo: origin }, 'session-b', 'unit-a')).toBeUndefined();
    expect(workerNavigation({ workerListReturnTo: origin }, 'session-a', 'unit-b')).toBeUndefined();
    expect(workerNavigation({ workerListReturnTo: origin }, 'session-a', undefined)).toBeUndefined();
  });
});
