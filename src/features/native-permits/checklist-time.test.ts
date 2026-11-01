import { expect, it } from 'vitest';
import { checklistEndInstant } from './checklist-time';

it('converte Brasília para UTC preservando os segundos do término efetivo', () => {
  expect(checklistEndInstant('2026-10-31T08:59:45')).toBe('2026-10-31T11:59:45.000Z');
  expect(checklistEndInstant('2026-10-31T08:30')).toBe('2026-10-31T11:30:00.000Z');
});
it.each(['', '0000-10-31T08:30:45', '2026-02-30T08:30:45', '2026-10-31T08:30:60', '2026-10-31T24:00:00', '2026-10-31T08:30:45Z', '2026-10-31T08:30:45.5'])('recusa horário local inválido ou ambíguo: %s', value => {
  expect(checklistEndInstant(value)).toBeUndefined();
});
