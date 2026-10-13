import { describe, expect, it } from 'vitest';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { isDrawingRepresentation, releaseBlockers, validateChecklist, validateScience, validateText } from './validation';

describe('regras apresentadas pela PT em campo', () => {
  it('separa declarante de participante e exige confirmação explícita', () => {
    expect(validateScience('José da Silva', '  jose da  silva ', true, 'TYPED', 'José da Silva')).toBeUndefined();
    expect(validateScience('José da Silva', 'Técnico Coletor', true, 'TYPED', 'Técnico Coletor')).toMatch(/participante/);
    expect(validateScience('José da Silva', 'José da Silva', false, 'TYPED', 'José da Silva')).toMatch(/explicitamente/);
  });
  it('não aceita imagem remota, SVG ou desenho vazio como manifestação', () => {
    expect(isDrawingRepresentation('https://site.local/foto.png')).toBe(false);
    expect(isDrawingRepresentation('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(validateScience('José da Silva', 'José da Silva', true, 'DRAWN', '')).toMatch(/Desenhe/);
    expect(isDrawingRepresentation('data:image/png;base64,aGVsbG8=')).toBe(true);
  });
  it('permite salvar a pendência justificada e exige resposta nos itens obrigatórios', () => {
    const item = { id: 'item', label: 'Conferência ilustrativa', required: true, answer: null } as const;
    expect(validateChecklist([item])).toMatch(/obrigatórios/);
    expect(validateChecklist([{ ...item, answer: 'NO' }])).toMatch(/Explique/);
    expect(validateChecklist([{ ...item, answer: 'NO', note: 'Requisito ainda pendente.' }])).toBeUndefined();
  });
  it('ciência de uma versão anterior não libera a versão atual', () => {
    const permit = {
      version: 2,
      eligibility: { eligible: false },
      checklist: [{ id: 'item', label: 'Exemplo', required: true, answer: 'NO' }],
      appointment: { participants: [{ workerId: 'worker', name: 'José da Silva' }] },
      sciences: [{ workerId: 'worker', version: 1 }],
    } as unknown as WorkPermitDto;
    expect(releaseBlockers(permit)).toHaveLength(3);
    expect(releaseBlockers(permit).join(' ')).toMatch(/José da Silva/);
    permit.eligibility.eligible = true;
    permit.checklist[0].answer = 'YES';
    permit.sciences[0].version = 2;
    expect(releaseBlockers(permit)).toEqual([]);
  });
  it('evita resumo vazio e motivo insuficiente ao enviar decisões', () => {
    expect(validateText('   ', 'Motivo')).toMatch(/5 caracteres/);
    expect(validateText('Concluído', 'Resumo', 10)).toMatch(/10 caracteres/);
    expect(validateText('Atendimento concluído, sem pendências do registro.', 'Resumo', 10)).toBeUndefined();
  });
  it('interpreta respostas impeditivas pela versão do template, inclusive perguntas invertidas e observacionais', () => {
    const permit = { version: 1, eligibility: { eligible: true }, checklist: [], appointment: { participants: [] }, sciences: [] } as unknown as WorkPermitDto;
    permit.checklist = [{ id: 'risk', label: 'Existe condição impeditiva?', required: true, answer: 'YES', blockingAnswers: ['YES'] }];
    expect(releaseBlockers(permit).join(' ')).toMatch(/respostas impeditivas/);
    permit.checklist[0].answer = 'NO';
    expect(releaseBlockers(permit)).toEqual([]);
    permit.checklist[0].answer = null;
    expect(releaseBlockers(permit).join(' ')).toMatch(/não respondidos/);
    permit.checklist[0] = { ...permit.checklist[0], answer: 'NO', blockingAnswers: [] };
    expect(releaseBlockers(permit)).toEqual([]);
    permit.checklist[0] = { ...permit.checklist[0], required: false, answer: 'YES', blockingAnswers: ['YES'] };
    expect(releaseBlockers(permit)).toHaveLength(1);
    permit.checklist[0] = { ...permit.checklist[0], required: true, answer: 'NO', blockingAnswers: undefined };
    expect(releaseBlockers(permit)).toHaveLength(1);
  });
});
