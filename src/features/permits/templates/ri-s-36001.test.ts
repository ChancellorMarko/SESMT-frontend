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
  it('vincula as categorias dos serviços sem permitir remoção ou mudança da identidade obrigatória', () => {
    const required = ['height', 'electrical'];
    const prep = createPermitPreparation({ location: 'Local Demo', responsibleName: 'Emitente Demo' } as AppointmentDto, required);
    required.pop();
    expect(prep.activities).toEqual(['height', 'electrical']);
    expect(prep.requiredActivities).toEqual(['height', 'electrical']);
    expect(() => canonicalPreparation({ ...prep, activities: ['height'] }, prep)).toThrow(/categorias vinculadas/);
    expect(() => canonicalPreparation({ ...prep, activities: [], requiredActivities: [] }, prep)).toThrow(/Não altere/);
    expect(() => canonicalPreparation({ ...prep, requiredActivities: ['height', 'height'] }, prep)).toThrow(/Não altere/);
    expect(() => canonicalPreparation({ ...prep, activities: [...prep.activities, 'hot-work'] }, prep)).toThrow(/sem adicionar serviços/);
    const result = canonicalPreparation({ ...prep, activities: [...prep.activities, 'pressurized'], requiredActivities: undefined }, prep);
    expect(result.requiredActivities).toEqual(['height', 'electrical']);
    expect(result.activities).toContain('pressurized');
    expect(result.requiredActivities).not.toBe(prep.requiredActivities);
    expect(validatePreparation({ ...prep, activities: ['height'] }, true)).toMatch(/categorias vinculadas/);
  });
  it('aceita serviço a frio sem inventar categoria e preserva a regra anterior para PT legada', () => {
    const prep = createPermitPreparation({ location: 'Local Demo', responsibleName: 'Emitente Demo' } as AppointmentDto, []);
    prep.identification = { ...prep.identification, serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', activityDescription: 'Manutenção manual a frio de equipamento fictício.', riskAnalysisReference: 'AR-DEMO' };
    expect(validatePreparation(prep, true)).toBeUndefined();
    expect(() => canonicalPreparation({ ...prep, activities: ['height'] }, prep)).toThrow(/sem adicionar serviços/);
    const legacy = { ...prep, requiredActivities: undefined };
    expect(validatePreparation(legacy, true)).toMatch(/Selecione pelo menos/);
    expect(() => canonicalPreparation({ ...legacy, requiredActivities: [] }, legacy)).toThrow(/Não altere/);
  });
});
