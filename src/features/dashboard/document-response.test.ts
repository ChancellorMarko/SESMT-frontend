import { describe, expect, it } from 'vitest';
import { ScopedPageError } from '../../shared/lib/scoped-page';
import { checkedDocumentDashboard, documentDashboardLink, DocumentDashboardResponseError } from './document-response';

const criteria = { unitId: 'unit-a', from: '', to: '' };
const indicator = () => ({ code: 'DOCUMENTS_ACTIVE', label: 'Documentos vigentes', value: 1, formula: 'Quantidade de documentos vigentes', period: 'Todo o período', source: 'Demonstração', updatedAt: '2026-10-18T12:00:00Z' });
const pending = () => ({ id: 'pending-a', title: 'Laudo da unidade', resourceType: 'DOCUMENT', resourceId: 'document-a', status: 'IN_REVIEW', dueDate: '2026-10-31' });
const dashboard = () => ({ generatedAt: '2026-10-18T12:00:00-03:00', filters: { unitId: 'unit-a' }, indicators: [indicator()], pendingItems: [pending()] });
const linkParams = (value: string | undefined) => new URL(value!, 'https://ampara.test').searchParams;

describe('resposta do painel documental', () => {
  it('aceita os dados consumidos, preserva a resposta e permite listas vazias', () => {
    const response = dashboard();
    expect(checkedDocumentDashboard(response, criteria)).toBe(response);
    expect(checkedDocumentDashboard({ ...response, indicators: [], pendingItems: [] }, criteria).indicators).toEqual([]);
  });

  it('aceita limite parcial e bissexto, normalizando os limites opcionais vazios no envelope', () => {
    const response = { ...dashboard(), filters: { unitId: 'unit-a', from: '2024-02-29', to: '' } };
    expect(checkedDocumentDashboard(response, { ...criteria, from: '2024-02-29' })).toBe(response);
  });

  it.each([
    undefined, null, [], {}, { unitId: 'unit-b' }, { unitId: 'unit-a', from: '2026-10-01' }, { unitId: 'unit-a', to: null },
  ])('recusa envelope de filtros ausente, inválido ou divergente: %j', filters => {
    expect(() => checkedDocumentDashboard({ ...dashboard(), filters }, criteria)).toThrow(ScopedPageError);
  });

  it('exige exatamente o período aplicado mesmo se a resposta estiver vazia', () => {
    expect(() => checkedDocumentDashboard({ ...dashboard(), indicators: [], pendingItems: [] }, { ...criteria, from: '2026-10-01' })).toThrow(DocumentDashboardResponseError);
    expect(() => checkedDocumentDashboard({ ...dashboard(), filters: { unitId: 'unit-a', from: '2026-10-01', to: '2026-10-19' } }, { ...criteria, from: '2026-10-01', to: '2026-10-18' })).toThrow(DocumentDashboardResponseError);
  });

  it.each([
    { unitId: '' }, { unitId: '../unit-a' }, { from: '2026-02-30' }, { to: 'amanhã' }, { from: '2026-10-31', to: '2026-10-01' },
  ])('recusa critérios inseguros ou período inválido %j', invalid => {
    expect(() => checkedDocumentDashboard(dashboard(), { ...criteria, ...invalid })).toThrow(ScopedPageError);
  });

  it.each(['generatedAt', 'updatedAt'])('exige instante explícito e válido em %s', key => {
    for (const invalid of ['', 'amanhã', '2026-02-30T12:00:00Z', '2026-10-18T12:00:00', '2026-10-18T24:00:00Z', '2026-10-18T12:60:00Z']) {
      const response = dashboard();
      if (key === 'generatedAt') response.generatedAt = invalid; else response.indicators[0].updatedAt = invalid;
      expect(() => checkedDocumentDashboard(response, criteria)).toThrow(DocumentDashboardResponseError);
    }
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity, '1', null])('recusa contagem documental inválida %s', value => {
    expect(() => checkedDocumentDashboard({ ...dashboard(), indicators: [{ ...indicator(), value }] }, criteria)).toThrow(ScopedPageError);
  });

  it('recusa códigos repetidos, inválidos ou textos exibidos vazios', () => {
    expect(() => checkedDocumentDashboard({ ...dashboard(), indicators: [indicator(), indicator()] }, criteria)).toThrow(ScopedPageError);
    for (const invalid of [{ code: '../CODE' }, { label: ' ' }, { label: 'a'.repeat(241) }, { formula: '' }, { source: ' ' }, { period: '' }]) {
      expect(() => checkedDocumentDashboard({ ...dashboard(), indicators: [{ ...indicator(), ...invalid }] }, criteria)).toThrow(ScopedPageError);
    }
  });

  it.each([null, [], {}, { ...dashboard(), indicators: null }, { ...dashboard(), pendingItems: {} }])('recusa payload incompleto ou listas inválidas', value => {
    expect(() => checkedDocumentDashboard(value, criteria)).toThrow(ScopedPageError);
  });

  it('recusa pendências duplicadas por identidade ou recurso', () => {
    for (const second of [pending(), { ...pending(), id: 'pending-b' }, { ...pending(), id: 'pending-b', resourceType: 'document' }]) {
      expect(() => checkedDocumentDashboard({ ...dashboard(), pendingItems: [pending(), second] }, criteria)).toThrow(ScopedPageError);
    }
  });

  it.each([
    { id: '../pending' }, { id: '..' }, { resourceId: 'document?q=1' }, { resourceId: 'document / a' }, { resourceId: '%2e%2e%2fdocument' }, { resourceId: 'document%252Fchild' }, { resourceType: '' }, { resourceType: null },
    { status: 1 }, { status: 'a'.repeat(101) }, { title: ' ' }, { title: 'a'.repeat(241) }, { dueDate: '2026-02-30' }, { dueDate: null },
  ])('recusa identificação, metadados ou prazo inválidos na pendência %j', invalid => {
    expect(() => checkedDocumentDashboard({ ...dashboard(), pendingItems: [{ ...pending(), ...invalid }] }, criteria)).toThrow(ScopedPageError);
  });

  it('aceita outros tipos de recurso, status desconhecidos seguros e prazo não definido', () => {
    const item = { ...pending(), resourceType: 'TRAINING', status: undefined, dueDate: undefined };
    expect(checkedDocumentDashboard({ ...dashboard(), pendingItems: [item] }, criteria).pendingItems[0]).toBe(item);
    expect(checkedDocumentDashboard({ ...dashboard(), pendingItems: [{ ...item, status: 'FUTURE_STATUS', dueDate: '' }] }, criteria).pendingItems).toHaveLength(1);
  });
});

describe('atalhos do painel documental', () => {
  it.each([
    ['DOCUMENTS_ACTIVE', 'ACTIVE'], ['DOCUMENTS_EXPIRED', 'EXPIRED'], ['DOCUMENTS_IN_REVIEW', 'IN_REVIEW'],
  ])('reconstrói somente o código conhecido %s e preserva período e unidade', (code, status) => {
    const result = documentDashboardLink({ ...indicator(), code }, { ...criteria, from: '2026-10-01', to: '2026-10-18' });
    expect(result?.startsWith('/app/documentos?')).toBe(true);
    expect(Object.fromEntries(linkParams(result))).toEqual({ status, unitId: 'unit-a', issueDateFrom: '2026-10-01', issueDateTo: '2026-10-18' });
  });

  it('preserva filtros reconhecidos e ignora chaves futuras sem incorporá-las à URL', () => {
    const targetFilter = { unitId: 'unit-a', q: 'Laudo & inspeção', typeId: 'type-a', workerId: 'worker-a', responsibleId: 'user-a', status: 'ACTIVE', unknown: 'ignored' };
    const result = documentDashboardLink({ ...indicator(), targetFilter }, { ...criteria, from: '2026-10-01' });
    expect(Object.fromEntries(linkParams(result))).toEqual({ ...Object.fromEntries(Object.entries(targetFilter).filter(([key]) => key !== 'unknown')), issueDateFrom: '2026-10-01' });
  });

  it.each(['companyId', 'sectorId'])('preserva o card, mas impede atalho cujo %s não seria aplicado na lista', key => {
    const current = { ...indicator(), targetFilter: { [key]: 'scope-a', status: 'ACTIVE' } };
    expect(checkedDocumentDashboard({ ...dashboard(), indicators: [current] }, criteria).indicators[0]).toBe(current);
    expect(documentDashboardLink(current, criteria)).toBeUndefined();
    const empty = { ...indicator(), targetFilter: { [key]: '', status: 'ACTIVE' } };
    const params = linkParams(documentDashboardLink(empty, criteria));
    expect(params.has(key)).toBe(false);
    expect(params.get('unitId')).toBe('unit-a');
  });

  it('mantém o indicador a vencer sem link quando o serviço não informa janela completa', () => {
    for (const targetFilter of [undefined, {}, { status: 'ACTIVE' }, { validUntilFrom: '2026-10-18' }, { validUntilTo: '2026-11-17' }]) {
      const current = { ...indicator(), code: 'DOCUMENTS_EXPIRING', targetFilter };
      expect(checkedDocumentDashboard({ ...dashboard(), indicators: [current] }, criteria).indicators).toHaveLength(1);
      expect(documentDashboardLink(current, criteria)).toBeUndefined();
    }
  });

  it('usa a janela exata fornecida pelo serviço para os documentos a vencer', () => {
    const current = { ...indicator(), code: 'DOCUMENTS_EXPIRING', targetFilter: { status: 'ACTIVE', validUntilFrom: '2026-10-18', validUntilTo: '2026-11-17' } };
    const result = documentDashboardLink(current, { ...criteria, from: '2026-10-01', to: '2026-10-18' });
    expect(Object.fromEntries(linkParams(result))).toEqual({ status: 'ACTIVE', validUntilFrom: '2026-10-18', validUntilTo: '2026-11-17', unitId: 'unit-a', issueDateFrom: '2026-10-01', issueDateTo: '2026-10-18' });
  });

  it.each([
    null, [], 'status=ACTIVE', { unitId: 'unit-b' }, { unitId: 2 }, { typeId: '../type' }, { companyId: {} }, { sectorId: null },
    { q: 'a'.repeat(201) }, { q: 'Laudo\u0000' }, { status: 'UNKNOWN' }, { status: 'EXPIRED' }, { validUntilFrom: '2026-02-30' },
    { validUntilFrom: '2026-10-20', validUntilTo: '2026-10-18' }, { issueDateFrom: '2026-10-01' }, { issueDateTo: '2026-10-31' },
  ])('rejeita targetFilter inválido ou incoerente antes de exibir indicadores %j', targetFilter => {
    expect(() => checkedDocumentDashboard({ ...dashboard(), indicators: [{ ...indicator(), targetFilter }] }, criteria)).toThrow(DocumentDashboardResponseError);
  });

  it('recusa perda ou mudança explícita do período em qualquer extremo', () => {
    const expected = { ...criteria, from: '2026-10-01', to: '2026-10-18' };
    for (const targetFilter of [{ issueDateFrom: '2026-10-02' }, { issueDateTo: '2026-10-17' }]) {
      expect(() => checkedDocumentDashboard({ ...dashboard(), filters: expected, indicators: [{ ...indicator(), targetFilter }] }, expected)).toThrow(ScopedPageError);
    }
  });

  it('não cria busca genérica para códigos desconhecidos sem filtros reconhecidos', () => {
    expect(documentDashboardLink({ ...indicator(), code: 'FUTURE_METRIC' }, criteria)).toBeUndefined();
    expect(documentDashboardLink({ ...indicator(), code: 'FUTURE_METRIC', targetFilter: { future: 'criteria' } }, criteria)).toBeUndefined();
    expect(linkParams(documentDashboardLink({ ...indicator(), code: 'FUTURE_METRIC', targetFilter: { status: 'DRAFT' } }, criteria)).get('status')).toBe('DRAFT');
  });

  it.each(['constructor', 'toString'])('não interpreta o código futuro %s como propriedade de um objeto', code => {
    expect(documentDashboardLink({ ...indicator(), code }, criteria)).toBeUndefined();
    const current = { ...indicator(), code, targetFilter: { status: 'DRAFT' } };
    expect(checkedDocumentDashboard({ ...dashboard(), indicators: [current] }, criteria).indicators[0]).toBe(current);
    expect(Object.fromEntries(linkParams(documentDashboardLink(current, criteria)))).toEqual({ status: 'DRAFT', unitId: 'unit-a' });
  });
});
