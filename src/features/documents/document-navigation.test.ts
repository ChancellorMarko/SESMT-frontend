import { describe, expect, it } from 'vitest';
import { documentNavigation } from './document-navigation';

const unitId = 'unit-a';
const listSearch = '?unitId=unit-a&q=Relat%C3%B3rio+de+ASO&typeId=type-1&status=ACTIVE&workerId=worker-1&responsibleId=person-1&validUntilFrom=2026-10-01&validUntilTo=2026-10-31&issueDateFrom=2026-09-01&issueDateTo=2026-09-30&page=2';
const dashboardSearch = '?from=2026-10-01&to=2026-10-31';
const list = (search = listSearch) => ({ documentListReturnTo: { unitId, search } });
const dashboard = (search = dashboardSearch) => ({ documentDashboardReturnTo: { unitId, search } });

describe('retorno documental à consulta de origem', () => {
  it('preserva as duas consultas válidas e copia apenas a unidade e a busca', () => {
    const expected = { ...list(), ...dashboard() };
    expect(documentNavigation({ ...expected, next: 'https://external.example', documentListReturnTo: { ...expected.documentListReturnTo, pathname: '/app/documentos', secret: 'discard' }, documentDashboardReturnTo: { ...expected.documentDashboardReturnTo, pathname: '/app/painel-documental', secret: 'discard' } }, unitId)).toEqual(expected);
  });

  it.each(['', '?', '?unitId=unit-a', '?q=ASO', '?status=&workerId=&responsibleId=&typeId=&validUntilFrom=&validUntilTo=&issueDateFrom=&issueDateTo=', '?q=ASO%20ocupacional&page=1', '?validUntilFrom=2028-02-29', '?issueDateTo=2026-09-30'])('aceita consulta documental válida: %s', search => {
    expect(documentNavigation(list(search), unitId)).toEqual(list(search));
  });

  it.each(['', '?', '?from=2026-10-01', '?to=2026-10-31', '?from=&to=', '?from=2026-10-01&to=2026-10-01'])('aceita consulta de painel válida: %s', search => {
    expect(documentNavigation(dashboard(search), unitId)).toEqual(dashboard(search));
  });

  it.each([null, [], 'documentos', {}, { documentListReturnTo: null }, { documentListReturnTo: [] }, { documentListReturnTo: { unitId: 'other', search: '' } }, { documentListReturnTo: { unitId, search: 1 } }, { documentDashboardReturnTo: { unitId: 'other', search: dashboardSearch } }])('descarta contexto incompatível: %j', state => {
    expect(documentNavigation(state, unitId)).toBeUndefined();
  });

  it.each([undefined, '', '.', '..', 'unit/a', 'unit%2Fa', 'unit a', 'unit\na'])('exige uma unidade atual segura: %s', current => {
    expect(documentNavigation(list(), current)).toBeUndefined();
  });

  it.each(['https://external.example', '//external.example', '/app/notificacoes', undefined])('descarta pathname incompatível declarado: %s', pathname => {
    expect(documentNavigation({ documentListReturnTo: { ...list().documentListReturnTo, pathname } }, unitId)).toBeUndefined();
    expect(documentNavigation({ documentDashboardReturnTo: { ...dashboard().documentDashboardReturnTo, pathname } }, unitId)).toBeUndefined();
  });

  it('recusa caminhos internos de outra origem', () => {
    expect(documentNavigation({ documentListReturnTo: { ...list().documentListReturnTo, pathname: '/app/painel-documental' } }, unitId)).toBeUndefined();
    expect(documentNavigation({ documentDashboardReturnTo: { ...dashboard().documentDashboardReturnTo, pathname: '/app/documentos' } }, unitId)).toBeUndefined();
  });

  it.each([
    '//external.example', 'https://external.example', '/app/documentos?q=ASO', '?q=with space', '?q=with\tcontrol', '?q=with\ncontrol', '?q=raw\u00a0space', '?q=\\test', '?q=ASO#fragment',
    '?companyId=company-1', '?sectorId=sector-1', '?from=2026-10-01', '?unitId=other', '?unitId=', '?unitId=unit-a&unitId=unit-a', '?q=one&q=two', '?status=ACTIVE&status=ACTIVE',
    '?status=UNKNOWN', '?status=active', '?q=%00test', '?q=%0Atest', '?q=%7Ftest', `?q=${'a'.repeat(201)}`, `?q=${'a'.repeat(2001)}`,
    '?typeId=.', '?workerId=..', '?responsibleId=worker%2Fa', '?typeId=a%252Fb', '?typeId=a%3Fb', '?workerId=a%23b', '?workerId=a%5Cb', '?responsibleId=with%20space', '?typeId=%0Aid', `?workerId=${'a'.repeat(201)}`,
    '?validUntilFrom=2026-02-29', '?validUntilTo=2026-13-01', '?issueDateFrom=2026-2-01', '?issueDateTo=invalid', '?validUntilFrom=2026-10-31&validUntilTo=2026-10-01', '?issueDateFrom=2026-09-30&issueDateTo=2026-09-01', '?issueDateFrom=2026-10-01&issueDateFrom=2026-10-01',
    '?page=', '?page=0', '?page=-1', '?page=1.5', '?page=01', '?page=1e2', '?page=900719925474100', '?page=1&page=2',
  ])('recusa consulta documental inválida: %s', search => {
    expect(documentNavigation(list(search), unitId)).toBeUndefined();
  });

  it.each(['?unitId=unit-a', '?q=ASO', '?status=ACTIVE', '?page=1', '?from=2026-10-01&from=2026-10-01', '?to=2026-10-31&to=2026-10-31', '?from=2026-02-29', '?to=2026-13-01', '?from=2026-10-31&to=2026-10-01', '?from=2026-10-01#fragment', '?from=2026-10-01 ', '?from=%0A2026-10-01'])('recusa consulta de painel inválida: %s', search => {
    expect(documentNavigation(dashboard(search), unitId)).toBeUndefined();
  });

  it('mantém o painel válido como alternativa quando a origem da lista foi invalidada', () => {
    expect(documentNavigation({ ...list('?q=one&q=two'), ...dashboard() }, unitId)).toEqual(dashboard());
  });

  it('mantém a lista válida quando apenas o painel foi invalidado', () => {
    expect(documentNavigation({ ...list(), ...dashboard('?from=2026-10-31&to=2026-10-01') }, unitId)).toEqual(list());
  });

  it('remove a origem de painel quando o acesso foi revogado e preserva a lista autorizada', () => {
    expect(documentNavigation({ ...list(), ...dashboard() }, unitId, false)).toEqual(list());
    expect(documentNavigation(dashboard(), unitId, false)).toBeUndefined();
  });

  it('aceita o limite seguro da paginação sem permitir overflow de deslocamento', () => {
    const search = `?page=${Math.floor(Number.MAX_SAFE_INTEGER / 10)}`;
    expect(documentNavigation(list(search), unitId)).toEqual(list(search));
  });
});
