import { describe, expect, it } from 'vitest';
import type { AppointmentDto, ChecklistItemDto, PermitPreparationDto, PermitSourceCheckDto } from '../../shared/contracts/work-permits';
import { checklistIssues, validateChecklist } from './validation';
import { createPermitPreparation, preparationIssues, sourceCheckIssues, validatePreparation, validateSourceChecks } from './templates/ri-s-36001';

const checklistItem = (id: string, changes: Partial<ChecklistItemDto> = {}): ChecklistItemDto => ({ id, label: `Item ${id}`, required: true, answer: 'YES', ...changes });
const sourceCheck = (id: string, changes: Partial<PermitSourceCheckDto> = {}): PermitSourceCheckDto => ({ id, label: `Pergunta ${id}`, section: 'height', answer: 'YES', ...changes });
const draftPreparation = () => createPermitPreparation({ location: 'Local demonstrativo', responsibleName: 'Emitente Demo' } as AppointmentDto);
const completePreparation = (activities: string[] = []): PermitPreparationDto => {
  const value = createPermitPreparation({ location: 'Local demonstrativo', responsibleName: 'Emitente Demo' } as AppointmentDto, activities);
  value.identification = { ...value.identification, serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', activityDescription: 'Atividade fictícia descrita para esta conferência.', riskAnalysisReference: 'APT-DEMO' };
  value.checks = value.checks.map(item => ({ ...item, answer: 'YES' }));
  return value;
};

describe('issues locais do checklist da PT', () => {
  it('prioriza grupos de regras globalmente e aponta todos os itens afetados', () => {
    const items = [checklistItem('long', { note: 'x'.repeat(1001) }), checklistItem('why', { answer: 'NO', note: '  ' }), checklistItem('missing', { answer: null }), checklistItem('optional', { required: false, answer: null })];
    expect(checklistIssues(items)).toEqual([
      { path: 'checklist.missing.answer', message: 'Responda todos os itens obrigatórios antes de salvar.' },
      { path: 'checklist.why.note', message: 'Explique as respostas “Não” no campo de observação do item.' },
      { path: 'checklist.long.note', message: 'Cada observação deve ter até 1.000 caracteres.' },
    ]);
    expect(validateChecklist(items)).toBe('Responda todos os itens obrigatórios antes de salvar.');
  });

  it.each([
    { items: [checklistItem('a', { answer: 'NO' })], expected: 'Explique as respostas “Não” no campo de observação do item.' },
    { items: [checklistItem('a', { note: ' '.repeat(1001) })], expected: 'Cada observação deve ter até 1.000 caracteres.' },
    { items: [checklistItem('a', { answer: 'NO', note: 'x'.repeat(1000), blockingAnswers: ['NO'] })], expected: undefined },
    { items: [], expected: undefined },
  ])('mantém a primeira mensagem legada sem interpretar impedimentos: $expected', ({ items, expected }) => {
    expect(validateChecklist(items)).toBe(expected);
    expect(checklistIssues(items)[0]?.message).toBe(expected);
  });

  it('preserva a mensagem prioritária antes de observar nota malformada de outro item', () => {
    const items = [checklistItem('bad-note', { answer: 'NO', note: 42 as never }), checklistItem('missing', { answer: null })];
    expect(checklistIssues(items)).toEqual([{ path: 'checklist.missing.answer', message: 'Responda todos os itens obrigatórios antes de salvar.' }]);
    expect(validateChecklist(items)).toBe('Responda todos os itens obrigatórios antes de salvar.');
    // Malformed data with no earlier failure retains the old validation contract.
    expect(() => validateChecklist(items.slice(0, 1))).toThrow(TypeError);
  });
});

describe('issues das respostas documentais do modelo', () => {
  it('permite respostas nulas em rascunho e exige todas apenas na conferência completa', () => {
    const checks = [sourceCheck('missing', { answer: null })];
    expect(sourceCheckIssues(checks)).toEqual([]);
    expect(validateSourceChecks(checks)).toBeUndefined();
    expect(sourceCheckIssues(checks, true, 'closingChecks')).toEqual([{ path: 'closingChecks.missing.answer', message: 'Responda todos os itens aplicáveis do modelo.' }]);
    expect(validateSourceChecks(checks, true)).toBe('Responda todos os itens aplicáveis do modelo.');
  });

  it('mantém prioridade de ausentes, inválidas, justificativas e tamanho entre itens distintos', () => {
    const checks = [sourceCheck('long', { note: 'x'.repeat(1001) }), sourceCheck('why', { answer: 'NA' }), sourceCheck('invalid', { answer: 'UNKNOWN' as never }), sourceCheck('missing', { answer: null })];
    expect(sourceCheckIssues(checks, true)).toEqual([
      { path: 'checks.missing.answer', message: 'Responda todos os itens aplicáveis do modelo.' },
      { path: 'checks.invalid.answer', message: 'Selecione Sim, Não ou Não aplicável.' },
      { path: 'checks.why.note', message: 'Justifique as respostas Não e Não aplicável em cada item.' },
      { path: 'checks.long.note', message: 'Cada justificativa deve ter até 1.000 caracteres.' },
    ]);
    expect(validateSourceChecks(checks)).toBe('Selecione Sim, Não ou Não aplicável.');
  });

  it.each(['NO', 'NA'] as const)('exige justificativa para %s mesmo ao salvar rascunho', answer => {
    expect(validateSourceChecks([sourceCheck('a', { answer, note: '  ' })])).toBe('Justifique as respostas Não e Não aplicável em cada item.');
    expect(sourceCheckIssues([sourceCheck('a', { answer, note: 'x'.repeat(1000) })], true)).toEqual([]);
    expect(validateSourceChecks([sourceCheck('a', { answer, note: 'x'.repeat(1001) })])).toBe('Cada justificativa deve ter até 1.000 caracteres.');
  });

  it('não acessa trim de nota malformada após uma falha de maior prioridade', () => {
    const badNote = sourceCheck('bad-note', { answer: 'NO', note: 42 as never });
    const checks = [badNote, sourceCheck('missing', { answer: null })];
    expect(sourceCheckIssues(checks, true)).toEqual([{ path: 'checks.missing.answer', message: 'Responda todos os itens aplicáveis do modelo.' }]);
    expect(validateSourceChecks(checks, true)).toBe('Responda todos os itens aplicáveis do modelo.');
    expect(validateSourceChecks([badNote, sourceCheck('invalid', { answer: 'UNKNOWN' as never })])).toBe('Selecione Sim, Não ou Não aplicável.');
    expect(() => validateSourceChecks([badNote])).toThrow(TypeError);
  });
});

describe('issues de preparação sem mudar as regras de rascunho', () => {
  it('mantém preparação incompleta salvável e informa cada identificação exigida na conferência completa', () => {
    const value = draftPreparation();
    value.identification.location = '';
    expect(preparationIssues(value)).toEqual([]);
    expect(validatePreparation(value)).toBeUndefined();
    expect(preparationIssues(value, true)).toEqual([
      { path: 'preparation.identification.activityDescription', message: 'Descreva a atividade com pelo menos 10 caracteres.' },
      ...['location', 'workFront', 'serviceProvider', 'riskAnalysisReference'].map(key => ({ path: `preparation.identification.${key}`, message: 'Informe fornecedor, frente, local e referência da análise de risco.' })),
      { path: 'preparation.activities', message: 'Selecione pelo menos uma categoria de atividade do modelo.' },
    ]);
    expect(validatePreparation(value, true)).toBe('Descreva a atividade com pelo menos 10 caracteres.');
  });

  it('aponta tamanho por campo e conserva identidade do modelo como primeira mensagem', () => {
    const value = completePreparation();
    value.sourceRevision = 'OUTRA';
    value.identification.serviceProvider = 'x'.repeat(2001);
    value.identification.location = 'x'.repeat(2001);
    value.additionalControls = 'x'.repeat(4001);
    expect(preparationIssues(value)).toEqual([{ path: 'preparation.model', message: 'A identificação do modelo não corresponde à versão desta PT.' }]);
    expect(validatePreparation(value, true)).toBe('A identificação do modelo não corresponde à versão desta PT.');
    value.sourceRevision = draftPreparation().sourceRevision;
    expect(preparationIssues(value)).toEqual([
      { path: 'preparation.identification.serviceProvider', message: 'Confira o tamanho dos textos da preparação.' },
      { path: 'preparation.identification.location', message: 'Confira o tamanho dos textos da preparação.' },
      { path: 'preparation.additionalControls', message: 'Confira o tamanho dos textos da preparação.' },
    ]);
    expect(validatePreparation(value, true)).toBe('Confira o tamanho dos textos da preparação.');
  });

  it('encerra na identidade divergente antes de acessar identificação estrutural inválida', () => {
    const value = { ...completePreparation(), sourceId: 'OUTRO', identification: null as never };
    expect(preparationIssues(value, true)).toEqual([{ path: 'preparation.model', message: 'A identificação do modelo não corresponde à versão desta PT.' }]);
    expect(validatePreparation(value, true)).toBe('A identificação do modelo não corresponde à versão desta PT.');
    value.sourceId = draftPreparation().sourceId;
    expect(() => validatePreparation(value, true)).toThrow(TypeError);
  });

  it('preserva erro anterior da preparação quando uma justificativa ativa tem tipo malformado', () => {
    const value = completePreparation(['height']);
    value.identification.serviceProvider = 'x'.repeat(2001);
    value.checks = [sourceCheck('bad-note', { answer: 'NO', note: 42 as never })];
    expect(preparationIssues(value, true)).toEqual([{ path: 'preparation.identification.serviceProvider', message: 'Confira o tamanho dos textos da preparação.' }]);
    expect(validatePreparation(value, true)).toBe('Confira o tamanho dos textos da preparação.');
    value.identification.serviceProvider = 'Fornecedor Demo';
    expect(() => validatePreparation(value, true)).toThrow(TypeError);
  });

  it('preserva limites exatos sem normalizar ou mutar os textos', () => {
    const value = completePreparation();
    value.identification.subcontractor = ' '.repeat(2000);
    value.additionalControls = ' '.repeat(4000);
    const before = structuredClone(value);
    expect(preparationIssues(value, true)).toEqual([]);
    expect(value).toEqual(before);
  });

  it('só exige categorias vinculadas no modo completo e preserva sua prioridade sobre a descrição', () => {
    const value = completePreparation(['height']);
    value.activities = [];
    value.identification.activityDescription = '';
    expect(preparationIssues(value)).toEqual([]);
    expect(validatePreparation(value, true)).toBe('Mantenha as categorias vinculadas aos serviços agendados nesta PT, sem adicionar serviços ao registro.');
    expect(preparationIssues(value, true)[0]?.path).toBe('preparation.activities');
  });

  it('distingue serviço a frio sem categoria de uma preparação legada sem seleção', () => {
    const value = completePreparation([]);
    expect(preparationIssues(value, true)).toEqual([]);
    value.requiredActivities = undefined;
    expect(validatePreparation(value, true)).toBe('Selecione pelo menos uma categoria de atividade do modelo.');
  });

  it('exige controles de pressurizados apenas na conferência completa', () => {
    const value = completePreparation();
    value.activities = ['pressurized'];
    expect(preparationIssues(value)).toEqual([]);
    expect(preparationIssues(value, true)).toEqual([{ path: 'preparation.additionalControls', message: 'Sistemas pressurizados: descreva os controles complementares com pelo menos 10 caracteres.' }]);
    value.additionalControls = ' Dez letras ';
    expect(validatePreparation(value, true)).toBeUndefined();
  });

  it('considera exclusivamente perguntas de atividades ativas e separa encerramento', () => {
    const value = completePreparation(['height']);
    value.checks = [sourceCheck('active', { answer: 'NO' }), sourceCheck('inactive', { section: 'electrical', answer: 'NA' })];
    value.closingChecks = [sourceCheck('closing', { answer: null })];
    const before = structuredClone(value);
    expect(preparationIssues(value, true)).toEqual([{ path: 'preparation.checks.active.note', message: 'Justifique as respostas Não e Não aplicável em cada item.' }]);
    expect(value).toEqual(before);
    value.checks[0].note = 'Condição e medidas registradas na análise.';
    expect(validatePreparation(value, true)).toBeUndefined();
  });

  it('aponta tipo inválido da identificação sem lançar ao coletar demais pendências', () => {
    const value = completePreparation();
    value.identification.activityDescription = null as never;
    expect(preparationIssues(value, true)).toEqual([{ path: 'preparation.identification.activityDescription', message: 'Confira o tamanho dos textos da preparação.' }]);
    expect(validatePreparation(value, true)).toBe('Confira o tamanho dos textos da preparação.');
  });
});
