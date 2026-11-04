import { describe, expect, it } from 'vitest';
import { checkedPinnedTemplates, checklistAnswers, checklistDraft, decimalValue } from './checklists';
import { permitFixture } from '../../../tests/connection-ui/fixtures/native-permits';
import { checklistIds as ids, templateFixture, laterTemplateFixture } from '../../../tests/connection-ui/fixtures/native-checklists';

describe('modelos e respostas nativas de checklist', () => {
  it('seleciona a versão fixada, sem substituir pela mais recente do catálogo', () => {
    const models = checkedPinnedTemplates([laterTemplateFixture(), templateFixture()], permitFixture());
    expect(models).toHaveLength(1); expect(models[0].versao).toBe(2); expect(models[0].perguntas[0].texto).toBe('Isolamento realizado?');
    expect(() => checkedPinnedTemplates([laterTemplateFixture()], permitFixture())).toThrow();
  });
  it.each([
    { companyId: ids.otherCompany }, { versao: 0 }, { perguntas: [] }, { serviceCodes: ['OUTRO'] },
    { perguntas: [{ ...templateFixture().perguntas[0], impeditiva: true, obrigatoria: false }] },
    { perguntas: [{ ...templateFixture().perguntas[0], tipo: 'SIM_NAO_NA' }] },
  ])('recusa um modelo incompatível: %j', patch => expect(() => checkedPinnedTemplates([{ ...templateFixture(), ...patch }], permitFixture())).toThrow());
  it('não aceita duplicação de versões nem perguntas duplicadas entre modelos fixados', () => {
    expect(() => checkedPinnedTemplates([templateFixture(), templateFixture()], permitFixture())).toThrow();
    const other = { ...templateFixture(), id: ids.laterVersion, templateId: ids.event };
    expect(() => checkedPinnedTemplates([templateFixture(), other], { ...permitFixture(), templateVersionIds: [ids.templateVersion, ids.laterVersion] })).toThrow();
  });
  it.each([
    ['1,25', '1.25'], ['0', '0'], ['-0,000', '0'], ['+0012.5000', '12.5'], ['9007199254740993', '9007199254740993'],
    ['79228162514264337593543950335', '79228162514264337593543950335'], ['0.0000000000000000000000000001', '0.0000000000000000000000000001'],
  ])('preserva decimal sem arredondamento: %s', (raw, expected) => expect(decimalValue(raw)).toBe(expected));
  it.each(['1.234,56', '1,234.56', '1e3', 'NaN', 'Infinity', '79228162514264337593543950336', '0.00000000000000000000000000001'])('recusa número ambíguo ou fora do decimal: %s', raw => expect(decimalValue(raw)).toBeUndefined());
  it('interpreta a vírgula armazenada com cultura invariável e preserva números além de MAX_SAFE_INTEGER', () => {
    const draft = checklistDraft(templateFixture().perguntas, [
      { perguntaId: ids.number, valor: '9,007,199,254,740,993', justificativa: null },
      { perguntaId: ids.boolean, valor: 'FALSE', justificativa: 'Resposta da conferência' },
    ]);
    expect(draft[ids.number].value).toBe('9007199254740993'); expect(draft[ids.boolean].value).toBe('false');
    expect(decimalValue('1,5', 'api')).toBe('15');
  });
  it('salva abertura parcial sem inventar valor para campos vazios; zero e false são respostas', () => {
    const questions = templateFixture().perguntas, draft = checklistDraft(questions, []);
    expect(checklistAnswers(questions, draft, false)).toEqual([]);
    draft[ids.boolean].value = 'false'; draft[ids.number].value = '0';
    expect(checklistAnswers(questions, draft, false)).toEqual([{ perguntaId: ids.boolean, valor: 'false', justificativa: null }, { perguntaId: ids.number, valor: '0', justificativa: null }]);
    draft[ids.boolean].value = 'NA'; expect(() => checklistAnswers(questions, draft, false)).toThrow();
  });
  it('mantém justificativa sem resposta somente para pergunta opcional', () => {
    const questions = templateFixture().perguntas, draft = checklistDraft(questions, []);
    draft[ids.text].justification = 'Sem observação aplicável';
    expect(checklistAnswers(questions, draft, false)).toEqual([{ perguntaId: ids.text, valor: null, justificativa: 'Sem observação aplicável' }]);
    draft[ids.boolean].justification = 'Ainda conferindo'; expect(() => checklistAnswers(questions, draft, false)).toThrow();
  });
  it('não descarta resposta órfã ou duplicada silenciosamente', () => {
    const questions = templateFixture().perguntas;
    expect(() => checklistDraft(questions, [{ perguntaId: ids.user, valor: 'true', justificativa: null }])).toThrow();
    const answer = { perguntaId: ids.boolean, valor: 'true', justificativa: null };
    expect(() => checklistDraft(questions, [answer, answer])).toThrow();
  });
  it('exige as verificações obrigatórias e recusa resposta impeditiva ao encerrar', () => {
    const questions = templateFixture().closingQuestions, draft = checklistDraft(questions, []);
    expect(() => checklistAnswers(questions, draft, true)).toThrow('obrigatória');
    draft[ids.closingBoolean].value = 'false'; draft[ids.closingNumber].value = '0'; draft[ids.closingText].value = 'Área conferida';
    expect(() => checklistAnswers(questions, draft, true)).toThrow('impede');
    draft[ids.closingBoolean].value = 'true'; expect(checklistAnswers(questions, draft, true)).toHaveLength(3);
    const blockingNumber = questions.map(item => item.id === ids.closingNumber ? { ...item, impeditiva: true } : item);
    expect(() => checklistAnswers(blockingNumber, draft, true)).toThrow('impede');
  });
});
