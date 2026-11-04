import { describe, expect, it } from 'vitest';
import { appointmentServiceIds, checklistItemBlocked } from './appointment-services';

describe('serviços e respostas impeditivas', () => {
  it('usa o conjunto completo sem substituir uma seleção explicitamente vazia pelo legado', () => {
    expect(appointmentServiceIds({ serviceTypeId: 'hot' })).toEqual(['hot']);
    expect(appointmentServiceIds({ serviceTypeId: 'hot', serviceTypeIds: ['hot', 'confined'] })).toEqual(['hot', 'confined']);
    expect(appointmentServiceIds({ serviceTypeId: 'hot', serviceTypeIds: [] })).toEqual([]);
  });
  it('respeita perguntas invertidas, bloqueadores opcionais e obrigatoriedade sem bloqueador', () => {
    const item = { id: 'q', label: 'Condição', required: true, answer: null } as const;
    expect(checklistItemBlocked(item)).toBe(true);
    expect(checklistItemBlocked({ ...item, answer: 'NO' })).toBe(true);
    expect(checklistItemBlocked({ ...item, answer: 'NO', blockingAnswers: ['YES'] })).toBe(false);
    expect(checklistItemBlocked({ ...item, required: false, answer: 'YES', blockingAnswers: ['YES'] })).toBe(true);
    expect(checklistItemBlocked({ ...item, required: false, blockingAnswers: ['YES'] })).toBe(false);
    expect(checklistItemBlocked({ ...item, answer: 'NO', blockingAnswers: [] })).toBe(false);
  });
});
