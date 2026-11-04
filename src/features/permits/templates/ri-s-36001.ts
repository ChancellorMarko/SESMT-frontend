import type { AppointmentDto, PermitPreparationDto, PermitSourceCheckDto } from '../../../shared/contracts/work-permits';
import source from './ri-s-36001.source.json';
import type { PermitValidationIssue } from '../validation-issues';

export const PT_SOURCE = source;
export const PT_ACTIVITIES = source.activities;
export const PT_EQUIPMENT = source.equipment;
export const PT_CONTROLS = source.controls;
/** These categories are determined by the services retained when the PT is opened. */
export const PT_SERVICE_ACTIVITY_IDS = ['height', 'hot-work', 'confined-space', 'electrical'];
const adaptedLabel = (label: string) => /pressão arterial|perfeitas condições físicas/i.test(label)
  ? 'A conferência ocupacional administrativa aplicável foi realizada por profissional competente, sem registro clínico neste formulário?'
  : label;
export const PT_CHECKS = source.checks.map(item => ({ ...item, label: adaptedLabel(item.label) }));
export const PT_CLOSING_CHECKS = source.closingChecks;
export const answerLabel = (answer: PermitSourceCheckDto['answer']) => answer === 'YES' ? 'Sim' : answer === 'NO' ? 'Não' : answer === 'NA' ? 'Não aplicável' : 'Não respondido';
const blankChecks = (items: typeof PT_CHECKS): PermitSourceCheckDto[] => items.map(item => ({ ...item, answer: null }));

export function createPermitPreparation(appointment: AppointmentDto, requiredActivities?: string[]): PermitPreparationDto {
  const activities = [...new Set(requiredActivities || [])];
  if (activities.some(id => !PT_ACTIVITIES.some(item => item.id === id))) throw new Error('Os serviços devem vincular categorias do catálogo desta versão.');
  return {
    sourceId: source.sourceId, sourceRevision: source.sourceRevision,
    identification: { serviceProvider: '', subcontractor: '', group: '', workFront: '', location: appointment.location, activityDescription: '', riskAnalysisReference: '', executorName: '', issuerName: appointment.responsibleName, atmosphereNotes: '', watchers: '', supervisors: '' },
    activities: [...activities], ...(requiredActivities !== undefined ? { requiredActivities: [...activities] } : {}), equipment: [], controls: [], additionalControls: '', checks: blankChecks(PT_CHECKS), closingChecks: blankChecks(PT_CLOSING_CHECKS), measurements: [],
  };
}

function appendSourceCheckIssues(issues: PermitValidationIssue[], checks: PermitSourceCheckDto[], complete: boolean, basePath: string) {
  if (complete) for (const item of checks) if (item.answer === null) issues.push({ path: `${basePath}.${item.id}.answer`, message: 'Responda todos os itens aplicáveis do modelo.' });
  for (const item of checks) if (item.answer !== null && !['YES', 'NO', 'NA'].includes(item.answer)) issues.push({ path: `${basePath}.${item.id}.answer`, message: 'Selecione Sim, Não ou Não aplicável.' });
  for (const item of checks) {
    if (item.answer !== 'NO' && item.answer !== 'NA') continue;
    // Preserve the original early-return protection without coercing invalid data.
    if (issues.length && item.note != null && typeof item.note !== 'string') continue;
    if (!item.note?.trim()) issues.push({ path: `${basePath}.${item.id}.note`, message: 'Justifique as respostas Não e Não aplicável em cada item.' });
  }
  for (const item of checks) if ((item.note?.length ?? 0) > 1000) issues.push({ path: `${basePath}.${item.id}.note`, message: 'Cada justificativa deve ter até 1.000 caracteres.' });
}

/** Checks only completeness and justification, never interprets YES as universally safe. */
export function sourceCheckIssues(checks: PermitSourceCheckDto[], complete = false, basePath = 'checks'): PermitValidationIssue[] {
  const issues: PermitValidationIssue[] = [];
  appendSourceCheckIssues(issues, checks, complete, basePath);
  return issues;
}

export function validateSourceChecks(checks: PermitSourceCheckDto[], complete = false): string | undefined {
  return sourceCheckIssues(checks, complete)[0]?.message;
}

export function preparationIssues(preparation: PermitPreparationDto, complete = false): PermitValidationIssue[] {
  const issues: PermitValidationIssue[] = [];
  if (preparation.sourceId !== source.sourceId || preparation.sourceRevision !== source.sourceRevision) return [{ path: 'preparation.model', message: 'A identificação do modelo não corresponde à versão desta PT.' }];
  for (const [key, value] of Object.entries(preparation.identification)) if (typeof value !== 'string' || value.length > 2000) issues.push({ path: `preparation.identification.${key}`, message: 'Confira o tamanho dos textos da preparação.' });
  if (preparation.additionalControls.length > 4000) issues.push({ path: 'preparation.additionalControls', message: 'Confira o tamanho dos textos da preparação.' });
  if (complete) {
    if ((preparation.requiredActivities || []).some(id => !preparation.activities.includes(id)) || preparation.requiredActivities !== undefined && preparation.activities.some(id => PT_SERVICE_ACTIVITY_IDS.includes(id) && !preparation.requiredActivities!.includes(id))) issues.push({ path: 'preparation.activities', message: 'Mantenha as categorias vinculadas aos serviços agendados nesta PT, sem adicionar serviços ao registro.' });
    if (typeof preparation.identification.activityDescription === 'string' && preparation.identification.activityDescription.trim().length < 10) issues.push({ path: 'preparation.identification.activityDescription', message: 'Descreva a atividade com pelo menos 10 caracteres.' });
    for (const key of ['location', 'workFront', 'serviceProvider', 'riskAnalysisReference'] as const) {
      const value = preparation.identification[key];
      if (typeof value === 'string' && !value.trim()) issues.push({ path: `preparation.identification.${key}`, message: 'Informe fornecedor, frente, local e referência da análise de risco.' });
    }
    if (!preparation.activities.length && preparation.requiredActivities === undefined) issues.push({ path: 'preparation.activities', message: 'Selecione pelo menos uma categoria de atividade do modelo.' });
    if (preparation.activities.includes('pressurized') && preparation.additionalControls.trim().length < 10) issues.push({ path: 'preparation.additionalControls', message: 'Sistemas pressurizados: descreva os controles complementares com pelo menos 10 caracteres.' });
  }
  appendSourceCheckIssues(issues, preparation.checks.filter(item => preparation.activities.includes(item.section)), complete, 'preparation.checks');
  return issues;
}

export function validatePreparation(preparation: PermitPreparationDto, complete = false): string | undefined {
  return preparationIssues(preparation, complete)[0]?.message;
}

/** Canonicalizes writable values; IDs, sections, source cells and labels come from the source catalog. */
export function canonicalPreparation(input: PermitPreparationDto, current: PermitPreparationDto): PermitPreparationDto {
  if (!input || typeof input !== 'object' || !input.identification || typeof input.additionalControls !== 'string') throw new Error('Envie a preparação completa desta versão.');
  if (input.sourceId !== current.sourceId || input.sourceRevision !== current.sourceRevision) throw new Error('Não substitua a identidade do modelo desta versão.');
  const identification = Object.fromEntries(Object.keys(current.identification).map(key => {
    const value = input.identification[key as keyof typeof input.identification];
    if (typeof value !== 'string' || value.length > 2000) throw new Error('Preencha os campos de identificação com até 2.000 caracteres.');
    return [key, value.trim()];
  })) as PermitPreparationDto['identification'];
  const options = (values: string[], catalog: { id: string }[]) => {
    if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(value => !catalog.some(item => item.id === value))) throw new Error('Selecione opções do catálogo desta versão, sem duplicação.');
    return [...values];
  };
  const checks = canonicalChecks(input.checks, current.checks);
  const requiredActivities = current.requiredActivities === undefined ? undefined : [...current.requiredActivities];
  if (input.requiredActivities !== undefined && (requiredActivities === undefined || !Array.isArray(input.requiredActivities) || input.requiredActivities.length !== requiredActivities.length || new Set(input.requiredActivities).size !== input.requiredActivities.length || input.requiredActivities.some(id => !requiredActivities.includes(id)))) throw new Error('Não altere as categorias obrigatórias vinculadas aos serviços desta versão.');
  const activities = options(input.activities, PT_ACTIVITIES);
  if (requiredActivities !== undefined && (requiredActivities.some(id => !activities.includes(id)) || activities.some(id => PT_SERVICE_ACTIVITY_IDS.includes(id) && !requiredActivities.includes(id)))) throw new Error('Mantenha as categorias vinculadas aos serviços agendados nesta PT, sem adicionar serviços ao registro.');
  const measurements = input.measurements ?? [];
  if (!Array.isArray(measurements) || measurements.length > 50 || measurements.some(item => !item || ['id', 'oxygen', 'carbonMonoxide', 'explosivity', 'other', 'measuredAt', 'responsible', 'instrument'].some(key => typeof item[key as keyof typeof item] !== 'string' || item[key as keyof typeof item].length > 500)) || new Set(measurements.map(item => item.id)).size !== measurements.length) throw new Error('Confira as medições e use no máximo 50 registros de até 500 caracteres por campo.');
  return { sourceId: current.sourceId, sourceRevision: current.sourceRevision, identification, activities, ...(requiredActivities !== undefined ? { requiredActivities } : {}), equipment: options(input.equipment, PT_EQUIPMENT), controls: options(input.controls, PT_CONTROLS), additionalControls: input.additionalControls.trim(), checks, closingChecks: structuredClone(current.closingChecks), measurements: measurements.map(({ id, oxygen, carbonMonoxide, explosivity, other, measuredAt, responsible, instrument }) => ({ id, oxygen, carbonMonoxide, explosivity, other, measuredAt, responsible, instrument })) };
}

export function canonicalChecks(input: PermitSourceCheckDto[], current: PermitSourceCheckDto[]): PermitSourceCheckDto[] {
  if (!Array.isArray(input) || input.length !== current.length || new Set(input.map(item => item?.id)).size !== current.length || input.some(item => !item || !current.some(original => original.id === item.id))) throw new Error('Envie todos os itens do modelo sem substituir perguntas.');
  return current.map(original => {
    const value = input.find(item => item.id === original.id)!;
    if (![null, 'YES', 'NO', 'NA'].includes(value.answer) || value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 1000)) throw new Error('Confira a resposta e a justificativa de cada item.');
    return { ...original, answer: value.answer, note: value.note?.trim() };
  });
}
