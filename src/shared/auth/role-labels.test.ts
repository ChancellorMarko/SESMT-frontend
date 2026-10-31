import { expect, it } from 'vitest';
import { roleLabels } from './role-labels';

it('mostra perfis nativos ou novos sem atribuir uma profissão por padrão', () => {
  expect(roleLabels(['RH', 'TECNICO', 'PERFIL_CRIADO_NA_API'])).toBe('Recursos Humanos · Técnico de segurança · PERFIL_CRIADO_NA_API');
  expect(roleLabels(['constructor'])).toBe('constructor');
  expect(roleLabels([])).toBe('Sem perfil informado');
});
