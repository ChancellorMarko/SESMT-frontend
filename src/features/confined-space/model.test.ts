import { describe, expect, it } from 'vitest';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import type { PetAtmosphericReadingDto, PetPlannedRole, PetPreparationDto } from '../../shared/contracts/confined-space-permits';
import { PET_CHECKS, PET_CONTROLS, PET_EQUIPMENT, PET_SOURCE, canonicalPetPreparation, createPetPreparation, petIdentificationLabels, petRoleLabels, preparationPending, validatePetPreparation } from './model';

const appointment = {
  location: 'Tanque fictício', serviceLabel: 'Inspeção Demo', startsAt: '2026-10-11T09:00:00-03:00', endsAt: '2026-10-11T10:00:00-03:00',
  participants: [{ workerId: 'worker-demo', name: 'Pessoa Demo', serviceFunction: 'Executante' }],
} as AppointmentDto;
const reading = (overrides: Partial<PetAtmosphericReadingDto> = {}): PetAtmosphericReadingDto => ({
  id: 'reading-demo', phase: 'INITIAL', measuredAt: '2026-10-11T08:55:00-03:00', instrument: 'Instrumento fictício', responsibleName: 'Operador Demo',
  oxygenPercent: '20,9', carbonMonoxidePpm: '0', flammabilityPercentLel: '0', otherAgent: '', otherValue: '', otherUnit: '', notes: '', ...overrides,
});
function completeFields(): PetPreparationDto {
  const result = createPetPreparation(appointment);
  Object.keys(result.identification).forEach(key => {
    if (!['plannedStartAt', 'plannedEndAt'].includes(key)) result.identification[key as keyof typeof result.identification] = 'Informação fictícia registrada';
  });
  result.people = Object.keys(petRoleLabels).map((role, index) => ({ id: `person-${index}`, workerId: `worker-${index}`, name: `Pessoa Demo ${index}`, registration: 'DEMO', serviceFunction: 'Função prevista', role: role as PetPlannedRole }));
  result.equipment = [PET_EQUIPMENT[0].id]; result.controls = [PET_CONTROLS[0].id];
  result.checks = result.checks.map(item => ({ ...item, answer: 'NA', note: 'Hipótese fictícia para preenchimento, sem avaliação operacional.' }));
  result.atmosphere = [reading()];
  return result;
}

describe('preparação de rascunho PET a partir da fonte recebida', () => {
  it('preserva origem, 23 perguntas e catálogos extraídos sem transformar limites antigos em regras', () => {
    expect(PET_SOURCE.sourceId).toBe('RI-S-36003'); expect(PET_SOURCE.sourceRevision).toBe('0');
    expect(PET_SOURCE.sourceSha256).toBe('9550a5e6f715ebc87fb09e70f52dc9009d18162fb4bd683ec776f520eaafe78b');
    expect(PET_SOURCE.sizeBytes).toBe(52284); expect(PET_CHECKS).toHaveLength(23); expect(PET_EQUIPMENT).toHaveLength(17); expect(PET_CONTROLS).toHaveLength(15);
    expect(PET_CHECKS.map(item => item.sourceCell)).toEqual(Array.from({ length: 23 }, (_, index) => `PET!B${index + 20}`));
    const adapted = PET_CHECKS.find(item => item.sourceCell === 'PET!B38')!;
    expect(adapted.label).toContain('evidência administrativa'); expect(adapted.label).not.toContain('pressão'); expect(adapted.originalLabel).toContain('pressão arterial');
    expect(PET_SOURCE.historicalAtmosphereLabels).toHaveLength(6);
  });
  it('inicia campos e perguntas sem declarar participantes aptos ou designar funções automaticamente', () => {
    const result = createPetPreparation(appointment);
    expect(Object.keys(result.identification)).toEqual(Object.keys(petIdentificationLabels)); expect(result.people).toEqual([]);
    expect(result.identification.workFront).toBe(appointment.location); expect(result.identification.plannedStartAt).toBe(appointment.startsAt);
    expect(result.checks.every(item => item.answer === null)).toBe(true); expect(validatePetPreparation(result)).toBeUndefined();
    expect(preparationPending(result)).toContain('Identificação do espaço confinado não informado.');
    expect(preparationPending(result)).toContain('23 perguntas sem resposta.');
  });
  it('permite salvar identificação, pessoas e leituras parcialmente preenchidas', () => {
    const result = createPetPreparation({ ...appointment, startsAt: '', endsAt: '' });
    result.people = [{ id: 'planned-person', name: '', registration: '', serviceFunction: '', role: 'WATCHER' }];
    result.atmosphere = [reading({ measuredAt: '', instrument: '', responsibleName: '', oxygenPercent: '', carbonMonoxidePpm: '', flammabilityPercentLel: '' })];
    expect(validatePetPreparation(result)).toBeUndefined();
    expect(preparationPending(result)).toContain('Há integrantes sem nome completo ou função no serviço.');
    expect(preparationPending(result)).toContain('Há registros atmosféricos sem momento, instrumento, responsável ou leituras principais.');
  });
  it.each(['NO', 'NA'] as const)('exige justificativa para %s, inclusive no rascunho', answer => {
    const result = createPetPreparation(appointment); result.checks[0].answer = answer;
    expect(validatePetPreparation(result)).toContain('Justifique'); result.checks[0].note = '   '; expect(validatePetPreparation(result)).toContain('Justifique');
    result.checks[0].note = 'Registro fictício da justificativa'; expect(validatePetPreparation(result)).toBeUndefined();
  });
  it('restaura perguntas e células canônicas e descarta atributos alheios ao contrato', () => {
    const result = completeFields(); result.identification.spaceCode = '  EC-DEMO  ';
    const incoming = { ...result, issueAllowed: true, checks: [...result.checks].reverse().map(item => ({ ...item, label: 'Adulterado', sourceCell: 'A1', section: 'authorization', note: ` ${item.note} ` })), people: result.people.map(item => ({ ...item, authorized: true })), atmosphere: result.atmosphere.map(item => ({ ...item, safe: true })) };
    const canonical = canonicalPetPreparation(incoming, createPetPreparation(appointment));
    expect(canonical.identification.spaceCode).toBe('EC-DEMO'); expect(canonical.checks.map(item => item.label)).toEqual(PET_CHECKS.map(item => item.label));
    expect(canonical.checks.every(item => item.section === 'confined-space')).toBe(true); expect(canonical.checks.map(item => item.sourceCell)).toEqual(PET_CHECKS.map(item => item.sourceCell));
    expect(canonical).not.toHaveProperty('issueAllowed'); expect(canonical.people[0]).not.toHaveProperty('authorized'); expect(canonical.atmosphere[0]).not.toHaveProperty('safe');
    canonical.equipment.push(PET_EQUIPMENT[1].id); expect(result.equipment).toHaveLength(1);
  });
  it.each([null, {}, [], { identification: null }])('rejeita payload inválido sem falhar com exceção acidental: %s', value => {
    expect(validatePetPreparation(value)).toContain('identificação'); expect(() => canonicalPetPreparation(value)).toThrow('identificação');
  });
  it('rejeita perguntas faltantes, repetidas, desconhecidas e respostas inválidas', () => {
    const result = createPetPreparation(appointment);
    expect(validatePetPreparation({ ...result, checks: result.checks.slice(1) })).toContain('23 perguntas');
    expect(validatePetPreparation({ ...result, checks: [result.checks[0], ...result.checks.slice(0, -1)] })).toContain('23 perguntas');
    expect(validatePetPreparation({ ...result, checks: [{ ...result.checks[0], id: 'foreign' }, ...result.checks.slice(1)] })).toContain('23 perguntas');
    expect(validatePetPreparation({ ...result, checks: [null, ...result.checks.slice(1)] })).toContain('23 perguntas');
    result.checks[0].answer = 'READY' as never; expect(validatePetPreparation(result)).toContain('Selecione');
  });
  it('rejeita medidas inventadas, duplicadas e textos além dos limites', () => {
    const result = createPetPreparation(appointment);
    expect(validatePetPreparation({ ...result, controls: ['foreign'] })).toContain('catálogo');
    expect(validatePetPreparation({ ...result, equipment: [PET_EQUIPMENT[0].id, PET_EQUIPMENT[0].id] })).toContain('duplicação');
    expect(validatePetPreparation({ ...result, identification: { ...result.identification, notes: 'x'.repeat(2001) } })).toContain('2.000');
    expect(validatePetPreparation({ ...result, identification: { ...result.identification, task: undefined } })).toContain('identificação');
    expect(validatePetPreparation({ ...result, additionalControls: 'x'.repeat(4001) })).toContain('4.000');
    result.checks[0].note = 'x'.repeat(1001); expect(validatePetPreparation(result)).toContain('1.000');
  });
  it('rejeita pessoas sem identificador, funções inválidas e identificadores duplicados', () => {
    const result = completeFields();
    result.people[0].id = ' '; expect(validatePetPreparation(result)).toContain('integrantes');
    result.people[0].id = result.people[1].id; expect(validatePetPreparation(result)).toContain('identificadores');
    result.people[0].id = 'unique'; result.people[0].role = 'AUTHORIZED' as never; expect(validatePetPreparation(result)).toContain('funções');
    result.people[0].role = 'WATCHER'; result.people[0].workerId = ''; expect(validatePetPreparation(result)).toContain('integrantes');
    result.people[0].workerId = 'worker-demo'; result.people[0].name = 'x'.repeat(201); expect(validatePetPreparation(result)).toContain('integrantes');
  });
  it.each(['-1', 'Infinity', 'NaN', '1e999', '0x10', '1,2.3', '1.2.3'])('rejeita leitura inválida %s', value => {
    const result = createPetPreparation(appointment); result.atmosphere = [reading({ oxygenPercent: value })]; expect(validatePetPreparation(result)).toContain('leituras');
  });
  it('aceita números finitos e registra números fora de limites históricos sem calcular segurança', () => {
    const result = completeFields(); result.atmosphere = [reading({ oxygenPercent: '99,9', carbonMonoxidePpm: '999', flammabilityPercentLel: '100', otherAgent: 'Agente fictício', otherValue: '0.002', otherUnit: 'ppm' })];
    expect(validatePetPreparation(result)).toBeUndefined(); expect(preparationPending(result)).toEqual([]);
    expect(canonicalPetPreparation(result).atmosphere[0].oxygenPercent).toBe('99,9');
    expect(canonicalPetPreparation(result)).not.toHaveProperty('eligible'); expect(canonicalPetPreparation(result)).not.toHaveProperty('released');
  });
  it.each(['2026-02-30T10:00:00Z', '2026-10-11T24:00:00Z', '2026-10-11T10:00:00', '2026-10-11T10:00:00+25:00'])('rejeita data/hora impossível ou sem fuso: %s', value => {
    const result = createPetPreparation(appointment); result.identification.plannedStartAt = value; expect(validatePetPreparation(result)).toContain('datas');
    result.identification.plannedStartAt = ''; result.atmosphere = [reading({ measuredAt: value })]; expect(validatePetPreparation(result)).toContain('data e hora da medição');
  });
  it('compara momentos previstos pelo instante, sem usar a duração para emitir permissão', () => {
    const result = createPetPreparation(appointment);
    result.identification.plannedStartAt = '2026-10-11T09:00:00-03:00'; result.identification.plannedEndAt = '2026-10-11T11:00:00Z';
    expect(validatePetPreparation(result)).toContain('depois'); result.identification.plannedEndAt = '2026-10-20T13:00:00Z'; expect(validatePetPreparation(result)).toBeUndefined();
  });
  it('sinaliza somente lacunas de preenchimento, sem declarar prontidão quando todas são registradas', () => {
    const result = completeFields(); expect(preparationPending(result)).toEqual([]);
    result.atmosphere[0].otherValue = '1'; expect(preparationPending(result)).toContain('Há leitura de outro agente sem identificação ou unidade.');
    result.atmosphere[0].otherAgent = 'Agente Demo'; result.atmosphere[0].otherUnit = 'ppm'; result.people = result.people.filter(item => item.role !== 'ENTRY_SUPERVISOR');
    expect(preparationPending(result)).toContain('Supervisor de entrada previsto não relacionado.');
  });
  it('aplica limite técnico de transporte sem atribuir esse número à NR-33', () => {
    const result = createPetPreparation(appointment);
    result.atmosphere = Array.from({ length: 101 }, (_, index) => reading({ id: `reading-${index}` })); expect(validatePetPreparation(result)).toContain('100 registros');
    result.atmosphere = [reading(), reading()]; expect(validatePetPreparation(result)).toContain('identificadores');
    result.atmosphere = [reading({ id: ' spaced ' })]; expect(validatePetPreparation(result)).toContain('identificadores');
  });
});
