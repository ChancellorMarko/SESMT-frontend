import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { AT_CHECKS, AT_CLOSING_CHECKS, AT_CONTROLS, AT_REVALIDATION_CAPACITY, AT_SOURCE, canonicalAuthorizationChecks, canonicalAuthorizationPreparation, createAuthorizationClosingChecks, createAuthorizationPreparation, validateAuthorizationChecks, validateAuthorizationPreparation } from './model';

const appointment = { participants: [{ workerId: 'worker-demo', name: 'Participante Demo', serviceFunction: 'Executante' }] } as AppointmentDto;
function complete() {
  const value = createAuthorizationPreparation(appointment);
  value.identification = { serviceManagement: 'Gerência Demo', serviceProvider: 'Fornecedor Demo', activityDescription: 'Inspeção fictícia de área compartilhada.', workFront: 'Frente Demo', areaManagement: 'Área Demo', riskAnalysisReference: 'AR-DEMO-AT-1', notes: '' };
  value.controls = [AT_CONTROLS[0].id];
  value.checks = value.checks.map(item => ({ ...item, answer: 'YES', note: item.id === 'at-check-b24' ? 'Rádio fictício da equipe e canal de emergência conferidos.' : undefined }));
  return value;
}
describe('modelo digital da autorização de trabalho recebida', () => {
  it('preserva a identidade e a proveniência sem aplicar vinte pessoas como limite normativo', () => {
    expect(AT_SOURCE.sourceId).toBe('RI-S-36002');
    expect(AT_SOURCE.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(AT_CHECKS).toHaveLength(11); expect(AT_CONTROLS).toHaveLength(15); expect(AT_CLOSING_CHECKS).toHaveLength(12); expect(AT_REVALIDATION_CAPACITY).toBe(6);
    const criterion = AT_CHECKS.find(item => item.id === 'at-check-b29')!;
    expect(criterion.sourceCell).toBe('Aut. Trabalho!B29'); expect(criterion.label).not.toContain('20'); expect(criterion.originalLabel).toContain('20');
    expect(createAuthorizationPreparation(appointment).foremanId).toBe('worker-demo');
  });
  it('exige descrição dos meios de emergência mesmo com Sim e justifica Não/NA', () => {
    const value = complete();
    expect(validateAuthorizationPreparation(value, true)).toBeUndefined();
    value.checks.find(item => item.id === 'at-check-b24')!.note = '';
    expect(validateAuthorizationPreparation(value, true)).toContain('emergência');
    value.checks.find(item => item.id === 'at-check-b24')!.note = 'Rádio Demo';
    value.checks[0].answer = 'NO'; expect(validateAuthorizationPreparation(value, true)).toContain('Justifique');
    value.checks[0].note = 'A comunicação está descrita no procedimento fictício alternativo.';
    expect(validateAuthorizationPreparation(value, true)).toBeUndefined();
    value.checks[0].answer = 'NA'; expect(validateAuthorizationPreparation(value, true)).toBeUndefined();
  });
  it('canonicaliza rótulos, células e seções de todos os itens em vez de confiar no cliente', () => {
    const current = complete();
    const input = { ...current, checks: current.checks.map(item => ({ ...item, label: 'Rótulo adulterado', sourceCell: 'A1', section: 'outra', note: item.note ? `  ${item.note}  ` : undefined })) };
    const result = canonicalAuthorizationPreparation(input, createAuthorizationPreparation(appointment));
    expect(result.checks[0].label).toBe(AT_CHECKS[0].label);
    expect(result.checks[0].sourceCell).toBe(AT_CHECKS[0].sourceCell);
    expect(result.checks.every(item => item.section === 'authorization')).toBe(true);
    expect(result.checks.find(item => item.id === 'at-check-b24')!.note).toBe(current.checks.find(item => item.id === 'at-check-b24')!.note);
  });
  it('rejeita catálogo incompleto, valores nulos e medidas desconhecidas de forma controlada', () => {
    const current = complete();
    expect(() => canonicalAuthorizationChecks([null] as never, current.checks)).toThrow();
    expect(() => canonicalAuthorizationPreparation({ ...current, controls: ['controle-inventado'] }, current)).toThrow();
    expect(() => canonicalAuthorizationPreparation({ ...current, checks: current.checks.slice(1) }, current)).toThrow();
    expect(validateAuthorizationPreparation({ ...current, controls: [] }, true)).toContain('ao menos');
    expect(validateAuthorizationPreparation({ ...current, identification: { ...current.identification, notes: 'x'.repeat(2001) } })).toContain('2.000');
  });
  it('o encerramento exige respostas e justificativas sem exigir cada item como aplicável', () => {
    const closing = createAuthorizationClosingChecks();
    expect(validateAuthorizationChecks(closing, true)).toContain('Responda');
    closing.forEach(item => { item.answer = 'NA'; item.note = 'Não aplicável à atividade fictícia desta autorização.'; });
    expect(validateAuthorizationChecks(closing, true)).toBeUndefined();
    closing[0].note = ''; expect(validateAuthorizationChecks(closing, true)).toContain('Justifique');
  });
});
