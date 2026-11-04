import { describe, expect, it } from 'vitest';
import { isCivilDate, metadataSchema, validateUpload, zonedDateTimeToIso } from './validation';

const id = '10000000-0000-4000-8000-000000000001';
const metadata = { code: 'DOC-1', title: 'Documento', typeId: id, companyId: id, unitId: id, sectorId: '', ownerId: id, responsibleIds: [], workerIds: [], accessClass: 'INTERNAL' as const, issueDate: '2026-10-05', validFrom: '2026-10-01', validUntil: '2026-12-31', keywords: '' };

describe('validações de documentos', () => {
  it('rejeita datas civis impossíveis e preserva o dia em ano bissexto', () => {
    expect(isCivilDate('2026-02-29')).toBe(false);
    expect(isCivilDate('2028-02-29')).toBe(true);
    expect(isCivilDate('2026-13-01')).toBe(false);
  });
  it('rejeita validade invertida e aponta o campo final', () => {
    const result = metadataSchema().safeParse({ ...metadata, validFrom: '2027-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === 'validUntil')).toBe(true);
  });
  it('exige os campos configurados pelo tipo, incluindo relações', () => {
    expect(metadataSchema(['validUntil', 'responsibleIds']).safeParse({ ...metadata, validUntil: '' }).success).toBe(false);
    expect(metadataSchema(['validUntil', 'responsibleIds']).safeParse({ ...metadata, responsibleIds: [id] }).success).toBe(true);
  });
  it('impede anexo vazio, acima do limite e extensão disfarçada', () => {
    const policy = { allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 5 };
    expect(validateUpload(new File([], 'vazio.pdf', { type: 'application/pdf' }), policy)).toBeTruthy();
    expect(validateUpload(new File(['123456'], 'grande.pdf', { type: 'application/pdf' }), policy)).toBeTruthy();
    expect(validateUpload(new File(['123'], 'arquivo.exe', { type: 'application/pdf' }), policy)).toBeTruthy();
    expect(validateUpload(new File(['12345'], 'arquivo.pdf', { type: 'application/pdf' }), policy)).toBeUndefined();
  });
  it('converte horário de Brasília para UTC sem depender do fuso do dispositivo', () => {
    expect(zonedDateTimeToIso('2026-10-05T00:10')).toBe('2026-10-05T03:10:00.000Z');
    expect(zonedDateTimeToIso('2026-10-05T23:50')).toBe('2026-10-06T02:50:00.000Z');
    expect(() => zonedDateTimeToIso('2026-10-05T25:10')).toThrow();
  });
});
