import { describe, expect, it } from 'vitest';
import { expiryCriteriaError } from './expiry';
import { expirationNavigation } from './expiry-navigation';

const search = '?unitId=unit-a&view=upcoming&days=7&q=Relat%C3%B3rio%20t%C3%A9cnico&page=2';
const origin = { expirationReturnTo: { unitId: 'unit-a', search } };

describe('origem da consulta de vencimentos', () => {
  it('preserva os critérios codificados e remove propriedades que não pertencem à origem', () => {
    expect(expirationNavigation({ ...origin, fromSearch: '//external.example', expirationReturnTo: { ...origin.expirationReturnTo, pathname: '/app/vencimentos', secret: 'ignorar' } }, 'unit-a')).toEqual(origin);
  });
  it.each(['?unitId=unit-a', '?unitId=unit-a&view=expired&days=90&q=ASO&page=9'])('aceita consulta válida: %s', search => {
    expect(expirationNavigation({ expirationReturnTo: { unitId: 'unit-a', search } }, 'unit-a')).toEqual({ expirationReturnTo: { unitId: 'unit-a', search } });
  });
  it.each([
    null, [], 'vencimentos', {}, { expirationReturnTo: null }, { expirationReturnTo: [] },
    { expirationReturnTo: { unitId: 'other', search } },
    { expirationReturnTo: { unitId: 'unit-a', search: 5 } },
    { expirationReturnTo: { unitId: 'unit-a', search, pathname: 'https://external.example' } },
    { expirationReturnTo: { unitId: 'unit-a', search, pathname: '/app/documentos' } },
  ])('descarta contexto incompatível: %j', state => expect(expirationNavigation(state, 'unit-a')).toBeUndefined());
  it.each([
    '', '?', '//external.example', 'https://external.example', '/app/vencimentos?unitId=unit-a',
    '?unitId=other', '?unitId=unit-a&unitId=unit-a', '?unitId=unit-a#section',
    '?unitId=unit-a&q=with space', '?unitId=unit-a&q=\\test', '?unitId=unit-a&q=\ntest',
    '?unitId=unit-a&q=%0Atest', '?unitId=unit-a&q=one&q=two', '?unitId=unit-a&view=unknown',
    '?unitId=unit-a&days=365', '?unitId=unit-a&days=', '?unitId=unit-a&page=0',
    '?unitId=unit-a&page=2&page=3', '?unitId=unit-a&status=ACTIVE', '?unitId=unit-a&tab=documents',
    `?unitId=unit-a&q=${'a'.repeat(201)}`, `?unitId=unit-a&q=${'a'.repeat(4096)}`,
  ])('não transforma query incompatível em retorno: %s', search => {
    expect(expirationNavigation({ expirationReturnTo: { unitId: 'unit-a', search } }, 'unit-a')).toBeUndefined();
  });
  it('exige unidade selecionada', () => expect(expirationNavigation(origin, undefined)).toBeUndefined());
});

describe('critérios compartilhados de vencimentos', () => {
  it.each(['view=', 'days=7&days=90', 'q=one&q=two', 'page=', 'page=1.5', 'status=ACTIVE'])('recusa %s na consulta e no retorno', query => {
    expect(expiryCriteriaError(new URLSearchParams(query))).not.toBe('');
    expect(expirationNavigation({ expirationReturnTo: { unitId: 'unit-a', search: `?unitId=unit-a&${query}` } }, 'unit-a')).toBeUndefined();
  });
});
