import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '../../../shared/contracts/work-permits';
import { PT_SOURCE, canonicalPreparation, createPermitPreparation, validatePreparation, validateSourceChecks } from './ri-s-36001';

const example = () => createPermitPreparation({ location: 'Local Demo', responsibleName: 'Emitente Demo' } as AppointmentDto);
describe('digitalização rastreável do modelo RI-S-36001', () => {
  it('preserva identidade, células e quantidade do catálogo recebido', () => {
    expect(PT_SOURCE.checks).toHaveLength(155);
    expect(PT_SOURCE.closingChecks).toHaveLength(12);
    expect(PT_SOURCE.sourceRevision).toBe('A');
    expect(PT_SOURCE.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(PT_SOURCE.checks.every(item => /^Plan1![A-Z]+\d+$/.test(item.sourceCell))).toBe(true);
  });
  it('adapta conteúdo clínico para situação administrativa sem apagar a origem', () => {
    expect(PT_SOURCE.checks.find(item => item.id === 'height-60')!.label).toMatch(/pressão arterial/);
    expect(example().checks.find(item => item.id === 'height-60')!.label).toMatch(/sem registro clínico/);
  });
  it('exige justificativa para Não / Não aplicável e não interpreta Sim como resposta universal segura', () => {
    const check = example().checks[0];
    expect(validateSourceChecks([{ ...check, answer: 'NA' }], true)).toMatch(/Justifique/);
    expect(validateSourceChecks([{ ...check, answer: 'NO', note: 'Pergunta invertida, condição e medidas registradas na análise.' }], true)).toBeUndefined();
    expect(validateSourceChecks([{ ...check, answer: 'NA', note: 'Item não se aplica ao equipamento desta atividade.' }], true)).toBeUndefined();
  });
  it('seleciona perguntas pela atividade e exige controle complementar para sistemas pressurizados', () => {
    const prep = example();
    prep.identification = { ...prep.identification, serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', activityDescription: 'Despressurização do sistema fictício.', riskAnalysisReference: 'AR-DEMO' };
    prep.activities = ['pressurized'];
    expect(validatePreparation(prep, true)).toMatch(/controles complementares/);
    prep.additionalControls = 'Procedimento fictício de bloqueio e despressurização registrado.';
    expect(validatePreparation(prep, true)).toBeUndefined();
    prep.activities = ['electrical'];
    expect(validatePreparation(prep, true)).toMatch(/todos os itens/);
  });
  it('rejeita troca de versão, itens ausentes, medições nulas e seletores desconhecidos', () => {
    const prep = example();
    expect(() => canonicalPreparation({ ...prep, sourceRevision: 'B' }, prep)).toThrow(/identidade/);
    expect(() => canonicalPreparation({ ...prep, checks: prep.checks.slice(1) }, prep)).toThrow(/todos os itens/);
    expect(() => canonicalPreparation({ ...prep, activities: ['inventada'] }, prep)).toThrow(/catálogo/);
    expect(() => canonicalPreparation({ ...prep, measurements: [null] } as never, prep)).toThrow(/medições/);
  });
  it('rótulos e células canônicos não são sobrescritos por texto do cliente e fechamento fica separado', () => {
    const prep = example();
    const input = structuredClone(prep);
    input.checks[0] = { ...input.checks[0], label: 'Texto substituído', sourceCell: 'Outra!Z999', answer: 'YES' };
    input.closingChecks = input.closingChecks.map(item => ({ ...item, answer: 'YES' }));
    const updated = canonicalPreparation(input, prep);
    expect(updated.checks[0].label).toBe(prep.checks[0].label);
    expect(updated.checks[0].sourceCell).toBe(prep.checks[0].sourceCell);
    expect(updated.closingChecks[0].answer).toBeNull();
  });
});
