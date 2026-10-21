import { describe, expect, it } from 'vitest';
import { restoredWorkerDocumentPage, workerDocumentDestination, workerDocumentNavigation } from './worker-document-navigation';

const list = { workerListReturnTo: { unitId: 'unit-a', sessionKey: 'session-a', search: '?unitId=unit-a&q=Camila&page=2', draftSearch: 'Texto não enviado', advancedOpen: true } };
const value = { workerId: 'worker-a', unitId: 'unit-a', sessionKey: 'session-a', documentPage: 2, ...list };
const origin = { workerDocumentReturnTo: value };
const read = (state: unknown) => workerDocumentNavigation(state, 'session-a', 'unit-a');

describe('retorno do documento ao trabalhador', () => {
  it('preserva a página e a consulta da pessoa sem aceitar uma rota do estado', () => {
    expect(read({ workerDocumentReturnTo: { ...value, pathname: 'https://example.test', ignored: true }, ignored: true })).toEqual(origin);
    expect(workerDocumentDestination(read(origin)!)).toEqual({ to: '/app/trabalhadores/worker-a#documentos', state: { ...list, workerDocumentPageReturnTo: { workerId: 'worker-a', unitId: 'unit-a', sessionKey: 'session-a', page: 2 } } });
  });
  it.each([
    null, [], {}, { workerDocumentReturnTo: [] },
    ...[{ unitId: 'unit-b' }, { sessionKey: 'session-b' }, { workerId: '..' }, { workerId: 'worker/a' }, { workerId: '%2f' }, { workerId: 'https://example.test' }, { documentPage: 0 }, { documentPage: Infinity }, { documentPage: 1.5 }, { documentPage: '2' }, { documentPage: Number.MAX_SAFE_INTEGER }].map(change => ({ workerDocumentReturnTo: { ...value, ...change } })),
  ])('descarta origem incompatível: %j', state => { expect(read(state)).toBeUndefined(); });
  it('revalida leitura, unidade e sessão em cada passagem', () => {
    expect(workerDocumentNavigation(origin, 'session-a', 'unit-a', false)).toBeUndefined();
    expect(workerDocumentNavigation(origin, 'session-b', 'unit-a')).toBeUndefined();
    expect(workerDocumentNavigation(origin, 'session-a', 'unit-b')).toBeUndefined();
    expect(workerDocumentNavigation(origin, 'session-a', undefined)).toBeUndefined();
  });
  it('descarta a consulta inválida sem impedir o retorno à pessoa autorizada', () => {
    const result = read({ workerDocumentReturnTo: { ...value, workerListReturnTo: { ...list.workerListReturnTo, sessionKey: 'session-b' } } });
    expect(result?.workerDocumentReturnTo).not.toHaveProperty('workerListReturnTo');
    expect(workerDocumentDestination(result!).to).toBe('/app/trabalhadores/worker-a#documentos');
  });
  it('preserva o atendimento de origem e remove destinos incompatíveis', () => {
    const integrationReturnTo = { pathname: '/app/agenda/appointment-a', unitId: 'unit-a', search: '?tab=equipe', hash: '#participantes' };
    expect(read({ workerDocumentReturnTo: { ...value, integrationReturnTo } })?.workerDocumentReturnTo.integrationReturnTo).toEqual(integrationReturnTo);
    expect(read({ workerDocumentReturnTo: { ...value, integrationReturnTo: { ...integrationReturnTo, pathname: '//external.test' } } })?.workerDocumentReturnTo).not.toHaveProperty('integrationReturnTo');
  });
  it('restaura a página somente no mesmo trabalhador e contexto', () => {
    const state = workerDocumentDestination(origin).state;
    expect(restoredWorkerDocumentPage(state, 'session-a', 'unit-a', 'worker-a')).toBe(2);
    expect(restoredWorkerDocumentPage(state, 'session-a', 'unit-a', 'worker-b')).toBe(1);
    expect(restoredWorkerDocumentPage(state, 'session-b', 'unit-a', 'worker-a')).toBe(1);
    expect(restoredWorkerDocumentPage(state, 'session-a', 'unit-b', 'worker-a')).toBe(1);
    expect(restoredWorkerDocumentPage({ workerDocumentPageReturnTo: { ...state.workerDocumentPageReturnTo, page: 0 } }, 'session-a', 'unit-a', 'worker-a')).toBe(1);
  });
});
