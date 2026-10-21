import { describe, expect, it } from 'vitest';
import { notificationNavigation } from './notification-navigation';

const unitId = 'unit-a';
const search = '?read=false&page=2&unitId=unit-a';
const origin = { notificationReturnTo: { unitId, search } };

describe('origem de notificações', () => {
  it('preserva a consulta literal válida e remove campos alheios à navegação', () => {
    expect(notificationNavigation({ ...origin, secret: 'descartar', notificationReturnTo: { ...origin.notificationReturnTo, pathname: '/app/notificacoes', ignored: true } }, unitId)).toEqual(origin);
  });

  it.each(['?unitId=unit-a', '?unitId=unit-a&read=true', '?unitId=unit-a&read=&page=1'])('aceita os critérios de leitura suportados: %s', validSearch => {
    expect(notificationNavigation({ notificationReturnTo: { unitId, search: validSearch } }, unitId)).toEqual({ notificationReturnTo: { unitId, search: validSearch } });
  });

  it.each([
    undefined, null, [], {}, { notificationReturnTo: null },
    { notificationReturnTo: { unitId: 'other', search } },
    { notificationReturnTo: { unitId, search, pathname: 'https://external.example' } },
    { notificationReturnTo: { unitId, search, pathname: '/app/documentos' } },
    { notificationReturnTo: { unitId, search: 'https://external.example?unitId=unit-a' } },
    { notificationReturnTo: { unitId, search: '//external.example?unitId=unit-a' } },
    { notificationReturnTo: { unitId, search: '?read=false' } },
    { notificationReturnTo: { unitId, search: '?unitId=other&read=false' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&unitId=unit-a' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&read=false&read=true' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&page=01' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&page=Infinity' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&read=invalid' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&q=ignored' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a#fragment' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a\n' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a\\other' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a ' } },
    { notificationReturnTo: { unitId, search: '?unitId=unit-a&read=%00' } },
    { notificationReturnTo: { unitId, search: `?unitId=unit-a&${'x'.repeat(4096)}` } },
  ])('rejeita origem inválida sem criar outro destino: %j', invalid => {
    expect(notificationNavigation(invalid, unitId)).toBeUndefined();
  });

  it('descarta a origem se a unidade atual não está definida ou mudou', () => {
    expect(notificationNavigation(origin, undefined)).toBeUndefined();
    expect(notificationNavigation(origin, 'unit-b')).toBeUndefined();
  });
});
