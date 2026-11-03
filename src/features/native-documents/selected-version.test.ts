import { expect, it } from 'vitest';
import { selectDocumentVersions } from './selected-version';
import type { NativeDocumentVersion } from './contracts';
const oldId='77000000-0000-4000-8000-000000000001',newId='77000000-0000-4000-8000-000000000002';
const versions=[{id:oldId,versionNumber:1,fileHash:'a'.repeat(64)},{id:newId,versionNumber:2,fileHash:'b'.repeat(64)}] as NativeDocumentVersion[];
it('mantém a versão fixada mesmo havendo um arquivo mais recente',()=>{
  expect(selectDocumentVersions(versions,`?versao=${oldId}&sha256=${'a'.repeat(64)}`).items).toEqual([versions[0]]);
});
it('sem seleção mantém a listagem autorizada normal',()=>{expect(selectDocumentVersions(versions,'').items).toBe(versions);});
it('versão inexistente não seleciona a versão atual como alternativa',()=>{
  const result=selectDocumentVersions(versions,'?versao=77000000-0000-4000-8000-000000000003');expect(result.error).toBe(true);expect(result.items).toBeUndefined();
});
it('hash trocado, valores ambíguos e identificadores inválidos bloqueiam o arquivo',()=>{
  for(const search of [`?versao=${oldId}&sha256=${'b'.repeat(64)}`,`?versao=${oldId}&versao=${newId}`,'?versao=../../users','?sha256=invalid',`?versao=${oldId}&sha256=`]){
    const result=selectDocumentVersions(versions,search);expect(result.error).toBe(true);expect(result.items).toBeUndefined();
  }
});
it('aguarda a leitura das versões antes de declarar inexistência',()=>{expect(selectDocumentVersions(undefined,`?versao=${oldId}`).error).toBe(false);});
