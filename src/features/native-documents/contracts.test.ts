import { expect, it } from 'vitest';
import { checkedDocument, checkedDocumentDirectory, checkedDocumentType, checkedFilePolicy, checkedVersion, checkedVersions, nativeDocumentReturn } from './contracts';
import { documentIds as ids, documentScope, nativeDocumentFixture, nativeVersionFixture, nativeTypeFixture, documentFilePolicy, documentDirectory } from '../../../tests/connection-ui/fixtures/native-documents';
const item = nativeDocumentFixture(), version = nativeVersionFixture();
it('preserva revisão e contexto nativos sem inventar DTO de demonstração', () => { expect(checkedDocument(item, item.id, documentScope)).toEqual(item); });
it.each([{ id: ids.foreign }, { companyId: ids.foreign, unitId: null }, { revision: 0 }, { currentVersionNumber: -1 }, { metadata: '[]' },
  { issueDate: '2026-02-30' }, { active: false }, { validFromDate: '2028-01-01' }])('recusa metadados incompatíveis: %j', change => {
  expect(() => checkedDocument({ ...item, ...change }, item.id, documentScope)).toThrow();
});
it('respeita contexto de unidade/setor sem assumir que empresa está explícita no Me', () => {
  expect(checkedDocument(item, item.id, { companyIds: [], unitIds: [ids.unit], sectorIds: [] })).toEqual(item);
  expect(() => checkedDocument(item, item.id, documentScope, ids.foreign)).toThrow();
  expect(() => checkedDocument(item, item.id, { companyIds: [], unitIds: [], sectorIds: [] })).toThrow();
});
it.each([{ documentId: ids.foreign }, { fileHash: 'x' }, { state: 'APPROVED' }, { state: 'VIGENTE', isCurrent: false }, { versionNumber: 0 }])('recusa outra versão, hash ou estado incompatível: %j', change => {
  expect(() => checkedVersion({ ...version, ...change }, ids.document)).toThrow();
});
it('não apresenta versão inexistente, duplicada ou acima da última versão do documento', () => {
  const withFile = checkedDocument({ ...item, currentVersionNumber: 1 }, item.id, documentScope);
  expect(checkedVersions([version], withFile)).toHaveLength(1);
  expect(() => checkedVersions([], withFile)).toThrow();
  expect(() => checkedVersions([version, version], withFile)).toThrow();
  expect(() => checkedVersions([version], checkedDocument(item, item.id, documentScope))).toThrow();
});
it('valida política efetiva, tipo e hierarquia dos catálogos', () => {
  expect(checkedFilePolicy(documentFilePolicy).maxSizeBytes).toBe(1024 * 1024);
  expect(() => checkedFilePolicy({ ...documentFilePolicy, allowedMimeTypes: ['text/html'] })).toThrow();
  expect(() => checkedFilePolicy({ ...documentFilePolicy, maxSizeBytes: 100 * 1024 * 1024 })).toThrow();
  expect(checkedDocumentType(nativeTypeFixture(), ids.type).name).toBe('Treinamento');
  expect(() => checkedDocumentType(nativeTypeFixture(), ids.foreign)).toThrow();
  expect(checkedDocumentDirectory(documentDirectory).sectors).toHaveLength(1);
  expect(() => checkedDocumentDirectory({ ...documentDirectory, sectors: [{ ...documentDirectory.sectors[0], unitId: ids.foreign }] })).toThrow();
});
it('mantém somente retornos de busca locais e sem parâmetros repetidos', () => {
  expect(nativeDocumentReturn('?q=NR&workerId=' + ids.worker)).toContain('workerId');
  expect(nativeDocumentReturn('https://example.invalid')).toBe('');
  expect(nativeDocumentReturn('?q=a&q=b')).toBe('');
  expect(nativeDocumentReturn('?q=a#fragment')).toBe('');
});
