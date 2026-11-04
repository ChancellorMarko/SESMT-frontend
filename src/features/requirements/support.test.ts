import { describe, expect, it } from 'vitest';
import { emptyRule, matrixFormSchema, publishMatrixSchema } from './support';

const rule = () => ({ ...emptyRule('service'), label: 'Capacitação', description: 'Documento administrativo demonstrativo.' });
describe('validação do rascunho da matriz', () => {
  it('exige serviço, função e conteúdo, sem impor prazo legal ou local obrigatório', () => {
    expect(matrixFormSchema.parse({ rules: [rule()] }).rules[0]).toMatchObject({ serviceFunction: '*', locationContains: '', validFromRequired: false, validUntilRequired: false });
    expect(matrixFormSchema.safeParse({ rules: [{ ...rule(), serviceTypeId: '' }] }).success).toBe(false);
    expect(matrixFormSchema.safeParse({ rules: [{ ...rule(), serviceFunction: '' }] }).success).toBe(false);
    expect(matrixFormSchema.safeParse({ rules: [] }).success).toBe(false);
  });
  it('impede flags de datas em regra restrita e limita motivos de publicação', () => {
    expect(matrixFormSchema.safeParse({ rules: [{ ...rule(), restricted: true, validUntilRequired: true }] }).success).toBe(false);
    expect(publishMatrixSchema.safeParse({ reason: 'curto', confirmed: true }).success).toBe(false);
    expect(publishMatrixSchema.safeParse({ reason: 'Motivo administrativo suficiente.', confirmed: false }).success).toBe(false);
    expect(publishMatrixSchema.safeParse({ reason: 'A'.repeat(2001), confirmed: true }).success).toBe(false);
  });
});
