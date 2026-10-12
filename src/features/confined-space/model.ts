import type { AppointmentDto, PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import type { PetAtmosphericReadingDto, PetPersonDto, PetPlannedRole, PetPreparationDto } from '../../shared/contracts/confined-space-permits';
import source from './ri-s-36003.source.json';

export const PET_SOURCE = source;
export const PET_CHECKS = source.checks;
export const PET_EQUIPMENT = source.equipment;
export const PET_CONTROLS = source.controls;

export const petRoleLabels: Record<PetPlannedRole, string> = {
  ENTRANT: 'Trabalhador previsto para entrada', WATCHER: 'Vigia previsto',
  ENTRY_SUPERVISOR: 'Supervisor de entrada previsto', RESCUE: 'Equipe de resgate prevista',
};
export const petIdentificationLabels: Record<keyof PetPreparationDto['identification'], string> = {
  serviceProvider: 'Empresa / prestador do serviço', subcontractor: 'Fornecedor quarteirizado',
  workFront: 'Frente de serviço', spaceCode: 'Identificação do espaço confinado',
  spaceDescription: 'Descrição do espaço e dos acessos', task: 'Objetivo da entrada / tarefa prevista',
  riskAssessmentReference: 'Referência da avaliação de riscos / ART', hazards: 'Perigos identificados na avaliação de riscos',
  entryHazards: 'Perigos e medidas previstos para a entrada', energyIsolation: 'Controle de energias perigosas',
  emergencyPlanReference: 'Referência do plano de resgate / emergência', communication: 'Meios e contatos de comunicação',
  plannedStartAt: 'Início previsto', plannedEndAt: 'Conclusão prevista', notes: 'Observações administrativas',
};
const identificationKeys = Object.keys(petIdentificationLabels) as (keyof PetPreparationDto['identification'])[];
const personKeys = ['name', 'registration', 'serviceFunction'] as const;
const personLimits = { name: 200, registration: 100, serviceFunction: 200 };
const readingKeys = ['measuredAt', 'instrument', 'responsibleName', 'oxygenPercent', 'carbonMonoxidePpm', 'flammabilityPercentLel', 'otherAgent', 'otherValue', 'otherUnit', 'notes'] as const;
const numericKeys = ['oxygenPercent', 'carbonMonoxidePpm', 'flammabilityPercentLel', 'otherValue'] as const;
const readingLimits: Record<typeof readingKeys[number], number> = {
  measuredAt: 40, instrument: 200, responsibleName: 200, oxygenPercent: 80, carbonMonoxidePpm: 80,
  flammabilityPercentLel: 80, otherAgent: 200, otherValue: 80, otherUnit: 80, notes: 1000,
};
const objectValue = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textValue = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const identifier = (value: unknown): value is string => textValue(value, 200) && !!value.trim() && value === value.trim();

/** Data/hora com fuso explícito. Valida a estrutura, sem limitar uma jornada operacional. */
function validInstant(value: string) {
  if (!value.trim()) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second = '0', , zone] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

/** Campos numéricos são registros de leitura; nenhum valor torna a atmosfera segura. */
function validReading(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return false;
  const number = Number(trimmed.replace(',', '.'));
  return Number.isFinite(number) && number >= 0;
}

export function createPetPreparation(appointment?: AppointmentDto): PetPreparationDto {
  return {
    identification: {
      serviceProvider: '', subcontractor: '', workFront: appointment?.location || '', spaceCode: '', spaceDescription: '',
      task: appointment?.serviceLabel || '', riskAssessmentReference: '', hazards: '', entryHazards: '', energyIsolation: '',
      emergencyPlanReference: '', communication: '', plannedStartAt: appointment?.startsAt || '', plannedEndAt: appointment?.endsAt || '', notes: '',
    },
    // Participar de um agendamento não designa automaticamente uma função de entrada, vigia ou supervisão.
    people: [], equipment: [], controls: [], additionalControls: '',
    checks: PET_CHECKS.map(({ id, label, section, sourceCell }) => ({ id, label, section, sourceCell, answer: null })),
    atmosphere: [],
  };
}

/** Rascunhos admitem campos vazios. Somente integridade e formato são conferidos aqui. */
export function validatePetPreparation(input: unknown): string | undefined {
  if (!objectValue(input) || !objectValue(input.identification) || identificationKeys.some(key => !textValue((input.identification as Record<string, unknown>)[key]))) {
    return 'Envie todos os campos de identificação como texto de até 2.000 caracteres.';
  }
  const identification = input.identification as unknown as PetPreparationDto['identification'];
  if (!validInstant(identification.plannedStartAt) || !validInstant(identification.plannedEndAt)) return 'Informe datas e horários previstos válidos com fuso horário.';
  if (identification.plannedStartAt.trim() && identification.plannedEndAt.trim() && Date.parse(identification.plannedEndAt) <= Date.parse(identification.plannedStartAt)) return 'A conclusão prevista deve ocorrer depois do início previsto.';
  if (!textValue(input.additionalControls, 4000)) return 'As medidas complementares devem ter até 4.000 caracteres.';
  for (const [key, catalog] of [['equipment', PET_EQUIPMENT], ['controls', PET_CONTROLS]] as const) {
    const values = input[key];
    if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(id => typeof id !== 'string' || !catalog.some(item => item.id === id))) return 'Selecione equipamentos e medidas do catálogo sem duplicação.';
  }
  if (!Array.isArray(input.checks) || input.checks.length !== PET_CHECKS.length || input.checks.some(item => !objectValue(item) || !PET_CHECKS.some(original => original.id === item.id))
    || new Set(input.checks.map(item => (item as Record<string, unknown>).id)).size !== PET_CHECKS.length) return 'Envie as 23 perguntas do modelo sem duplicação ou substituição.';
  for (const item of input.checks as PermitSourceCheckDto[]) {
    if (![null, 'YES', 'NO', 'NA'].includes(item.answer)) return 'Selecione Sim, Não ou Não aplicável nas perguntas.';
    if (item.note !== undefined && !textValue(item.note, 1000)) return 'Cada registro ou justificativa deve ter até 1.000 caracteres.';
    if ((item.answer === 'NO' || item.answer === 'NA') && !item.note?.trim()) return 'Justifique as respostas Não e Não aplicável em cada pergunta.';
  }
  if (!Array.isArray(input.people) || input.people.length > 100 || input.people.some(item => !objectValue(item) || !identifier(item.id)
    || item.workerId !== undefined && !identifier(item.workerId) || personKeys.some(key => !textValue(item[key], personLimits[key]))
    || typeof item.role !== 'string' || !Object.hasOwn(petRoleLabels, item.role))
    || new Set(input.people.map(item => (item as Record<string, unknown>).id)).size !== input.people.length) return 'Confira os integrantes, as funções previstas e os identificadores únicos; use até 100 integrantes.';
  if (!Array.isArray(input.atmosphere) || input.atmosphere.length > 100 || input.atmosphere.some(item => !objectValue(item) || !identifier(item.id)
    || !['INITIAL', 'FOLLOW_UP'].includes(item.phase as string) || readingKeys.some(key => !textValue(item[key], readingLimits[key])) )
    || new Set(input.atmosphere.map(item => (item as Record<string, unknown>).id)).size !== input.atmosphere.length) return 'Confira os registros atmosféricos e seus identificadores únicos; use até 100 registros.';
  for (const item of input.atmosphere as PetAtmosphericReadingDto[]) {
    if (!validInstant(item.measuredAt)) return 'Informe a data e hora da medição com fuso horário.';
    if (numericKeys.some(key => !validReading(item[key]))) return 'As leituras devem ser números finitos, não negativos, com vírgula ou ponto decimal.';
  }
  return undefined;
}

/** Canonicaliza a fonte documental e limita o payload aos campos do contrato. */
export function canonicalPetPreparation(input: unknown, _current?: PetPreparationDto): PetPreparationDto {
  const error = validatePetPreparation(input);
  if (error) throw new Error(error);
  const value = input as PetPreparationDto;
  const identification = Object.fromEntries(identificationKeys.map(key => [key, value.identification[key].trim()])) as PetPreparationDto['identification'];
  const people: PetPersonDto[] = value.people.map(item => ({ id: item.id.trim(), ...(item.workerId ? { workerId: item.workerId.trim() } : {}), role: item.role,
    name: item.name.trim(), registration: item.registration.trim(), serviceFunction: item.serviceFunction.trim() }));
  const atmosphere: PetAtmosphericReadingDto[] = value.atmosphere.map(item => ({ id: item.id.trim(), phase: item.phase,
    ...Object.fromEntries(readingKeys.map(key => [key, item[key].trim()])) } as PetAtmosphericReadingDto));
  return {
    identification, people, atmosphere, equipment: [...value.equipment], controls: [...value.controls], additionalControls: value.additionalControls.trim(),
    checks: PET_CHECKS.map(({ id, label, section, sourceCell }) => {
      const item = value.checks.find(item => item.id === id)!;
      return { id, label, section, sourceCell, answer: item.answer, ...(item.note !== undefined ? { note: item.note.trim() } : {}) };
    }),
  };
}

/** Lista lacunas de preenchimento, sem decidir aptidão, segurança, designação ou liberação de entrada. */
export function preparationPending(input: PetPreparationDto): string[] {
  const invalid = validatePetPreparation(input);
  if (invalid) return [invalid];
  const pending: string[] = [];
  for (const key of ['serviceProvider', 'workFront', 'spaceCode', 'spaceDescription', 'task', 'riskAssessmentReference', 'hazards', 'entryHazards', 'energyIsolation', 'emergencyPlanReference', 'communication', 'plannedStartAt', 'plannedEndAt'] as const) {
    if (!input.identification[key].trim()) pending.push(`${petIdentificationLabels[key]} não informado.`);
  }
  for (const role of ['ENTRANT', 'WATCHER', 'ENTRY_SUPERVISOR', 'RESCUE'] as const) if (!input.people.some(person => person.role === role)) pending.push(`${petRoleLabels[role]} não relacionado.`);
  if (input.people.some(item => !item.name.trim() || !item.serviceFunction.trim())) pending.push('Há integrantes sem nome completo ou função no serviço.');
  const unanswered = input.checks.filter(item => item.answer === null).length;
  if (unanswered) pending.push(`${unanswered} pergunta${unanswered === 1 ? '' : 's'} sem resposta.`);
  if (!input.equipment.length) pending.push('Nenhum equipamento relacionado.');
  if (!input.controls.length && !input.additionalControls.trim()) pending.push('Nenhuma medida de controle relacionada.');
  if (!input.atmosphere.some(item => item.phase === 'INITIAL')) pending.push('Nenhum registro atmosférico inicial relacionado.');
  if (input.atmosphere.some(item => !item.measuredAt.trim() || !item.instrument.trim() || !item.responsibleName.trim()
    || !item.oxygenPercent.trim() || !item.carbonMonoxidePpm.trim() || !item.flammabilityPercentLel.trim())) pending.push('Há registros atmosféricos sem momento, instrumento, responsável ou leituras principais.');
  if (input.atmosphere.some(item => item.otherValue.trim() && (!item.otherAgent.trim() || !item.otherUnit.trim()))) pending.push('Há leitura de outro agente sem identificação ou unidade.');
  return pending;
}
