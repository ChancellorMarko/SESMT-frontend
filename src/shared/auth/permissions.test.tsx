// auth/permissions.test.ts
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLES } from './permissions';

// Snapshot literal do seeder. Quando o backend mudar, atualize aqui.
const BACKEND_PERMISSIONS = [
  'documento:ler', 'documento:criar', 'documento:editar', 'documento:excluir',
  'documento:aprovar', 'documento:assinar', 'documento:exportar',
  'empresa:ler', 'empresa:criar', 'empresa:editar', 'empresa:excluir',
  'unidade:ler', 'unidade:criar', 'unidade:editar', 'unidade:excluir',
  'setor:ler', 'setor:criar', 'setor:editar', 'setor:excluir',
  'cargo:ler', 'cargo:criar', 'cargo:editar', 'cargo:excluir',
  'trabalhador:ler', 'trabalhador:criar', 'trabalhador:editar',
  'trabalhador:excluir', 'trabalhador:importar',
  'equipe:ler', 'equipe:criar', 'equipe:editar', 'equipe:excluir',
  'alerta:ler', 'alerta:tratar',
  'auditoria:ler',
  'parametro:ler', 'parametro:editar',
  'perfil:ler', 'perfil:criar', 'perfil:editar', 'perfil:excluir',
  'usuario:ler', 'usuario:criar', 'usuario:editar', 'usuario:excluir',
  'aso:ler', 'aso:editar',
  'pt:ler', 'pt:criar', 'pt:editar', 'pt:excluir',
  'pt:liberar', 'pt:iniciar', 'pt:concluir',
];

const BACKEND_ROLES = [
  'ADMIN', 'GESTOR', 'TECNICO', 'MEDICO', 'RH', 'LIDER', 'TRABALHADOR',
  'AUDITOR', 'SESMT_PT_SOLICITANTE', 'SESMT_PT_OPERADOR',
  'SESMT_PT_LIBERADOR', 'SESMT_PT_CONFIG',
];

describe('catálogo espelha o seeder do backend', () => {
  it('permissões', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual([...BACKEND_PERMISSIONS].sort());
  });

  it('roles', () => {
    expect([...ROLES].sort()).toEqual([...BACKEND_ROLES].sort());
  });
});
