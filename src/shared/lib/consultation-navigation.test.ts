import { describe, expect, it } from 'vitest';
import { consultationNavigation } from './consultation-navigation';

describe('origem da consulta', () => {
  it('preserva busca codificada e vincula o retorno à unidade atual', () => {
    const fromSearch = '?tab=documents&q=Relat%C3%B3rio%20t%C3%A9cnico&status=ACTIVE&page=2';
    expect(consultationNavigation({ fromConsulta: true, fromSearch }, 'unit')).toEqual({ fromConsulta: true, fromSearch, fromUnitId: 'unit' });
  });
  it('aceita a consulta sem critérios', () => {
    expect(consultationNavigation({ fromConsulta: true, fromUnitId: 'unit' }, 'unit')).toEqual({ fromConsulta: true, fromSearch: '', fromUnitId: 'unit' });
  });
  it.each([
    null, [], 'consulta', { fromConsulta: false }, { fromConsulta: true, fromUnitId: 'other' },
    { fromConsulta: true, fromSearch: 5 }, { fromConsulta: true, fromSearch: '//external.example' },
    { fromConsulta: true, fromSearch: 'https://external.example' }, { fromConsulta: true, fromSearch: '?q=test#section' },
    { fromConsulta: true, fromSearch: '?q=with space' }, { fromConsulta: true, fromSearch: '?q=\ntest' },
    { fromConsulta: true, fromSearch: '?q=\\test' }, { fromConsulta: true, fromSearch: '?tab=other' },
    { fromConsulta: true, fromSearch: '?tab=ats&tab=pets' },
    { fromConsulta: true, fromSearch: '?unitId=other' },
    { fromConsulta: true, fromSearch: '?unitId=unit&unitId=other' },
    { fromConsulta: true, fromSearch: `?q=${'a'.repeat(2000)}` },
  ])('rejeita estado incompatível: %j', state => {
    expect(consultationNavigation(state, 'unit')).toBeUndefined();
  });
  it('não cria retorno enquanto a unidade não está selecionada', () => {
    expect(consultationNavigation({ fromConsulta: true, fromSearch: '?tab=permits' }, undefined)).toBeUndefined();
  });
  it.each(['ats', 'pets'])('aceita a aba %s dentro da unidade atual', tab => {
    const state = { fromConsulta: true as const, fromSearch: `?tab=${tab}&unitId=unit`, fromUnitId: 'unit' };
    expect(consultationNavigation(state, 'unit')).toEqual(state);
  });
});
