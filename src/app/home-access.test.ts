import { describe, expect, it } from 'vitest';
import { homePath } from './navigation';
import { hasPermission } from '../shared/auth/permissions';

describe('destino inicial sem concessão presumida', () => {
  it.each([[], ['recurso_novo:consultar'], ['admin.read'], ['ADMIN'], ['documento:criar']].map(permissions => ({ permissions })))('informa a conta conectada sem enviar $permissions a uma área proibida', ({ permissions }) => {
    expect(homePath(permission => hasPermission(permissions, permission))).toBe('/app/conexao');
  });
  it.each([
    [['documento:ler'], '/app/documentos'], [['trabalhador:ler'], '/app/trabalhadores'],
    [['empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler'], '/app/organizacao'],
    [['notifications.read'], '/app/notificacoes'], [['documents.read'], '/app/documentos'],
    [['usuario:ler', 'documento:ler'], '/app/configuracoes/usuarios'],
  ] as const)('escolhe uma tela correspondente a %j', (permissions, destination) => {
    expect(homePath(permission => hasPermission(permissions, permission))).toBe(destination);
  });
});
