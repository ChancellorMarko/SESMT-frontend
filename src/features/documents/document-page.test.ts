import { describe, expect, it } from 'vitest';
import { checkedDocumentPage } from './document-page';

const document = { id: 'doc-a', code: 'DOC-001', title: 'Documento autorizado', typeId: 'type-a', unitId: 'unit-a', status: 'ACTIVE', revision: 1, issueDate: '2026-10-01', activeVersionIds: [] };
const page = (items: unknown[] = [document]) => ({ items, page: 1, pageSize: 10, total: items.length });

describe('resposta da lista de documentos', () => {
  it('aceita documentos da unidade e metadados empresariais somente de leitura', () => {
    expect(checkedDocumentPage(page(), 1, 'unit-a').items[0].id).toBe('doc-a');
    const readonly = { ...document, sourceReadOnly: true, unitId: null, revision: null, validUntil: null };
    expect(checkedDocumentPage(page([readonly]), 1, 'unit-a').items[0].sourceReadOnly).toBe(true);
  });
  it.each([
    { ...page(), items: null }, { ...page(), page: 2 }, { ...page(), pageSize: 100 },
    { ...page(), total: -1 }, page([document, document]),
    page([{ ...document, unitId: 'unit-b' }]), page([{ ...document, unitId: null }]),
    page([{ ...document, title: null }]), page([{ ...document, status: 'UNKNOWN' }]),
    page([{ ...document, revision: 0 }]), page([{ ...document, issueDate: '2026-02-30' }]),
    page([{ ...document, validUntil: '2026-13-01' }]), page([{ ...document, activeVersionIds: 'version-a' }]),
  ])('recusa página inválida antes de exibir registros: %j', response => {
    expect(() => checkedDocumentPage(response, 1, 'unit-a')).toThrow('página inválida');
  });
});
