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

  it('oferece o dashboard autenticado somente no contrato nativo, sem inventar uma permissão', () => {
    const permissions = ['recurso_novo:consultar'];
    const can = (permission: string) => hasPermission(permissions, permission);
    expect(homePath(can, true)).toBe('/app/dashboard');
    expect(homePath(can, false)).toBe('/app/conexao');
    expect(can('dashboard.read')).toBe(false);
    expect(permissions).toEqual(['recurso_novo:consultar']);
  });
  it.each([
    [['usuario:ler', 'usuario:criar', 'pt:editar'], '/app/configuracoes/usuarios'],
    [['pt:criar', 'documento:ler'], '/app/dashboard'],
    [['pt:iniciar', 'trabalhador:editar'], '/app/dashboard'],
    [['trabalhador:ler', 'trabalhador:editar', 'documento:ler'], '/app/trabalhadores'],
    [['usuario:ler', 'auditoria:ler', 'documento:ler'], '/app/auditoria'],
    [['documento:ler', 'trabalhador:ler'], '/app/documentos'],
    [['usuario:ler'], '/app/configuracoes/usuarios'],
  ] as const)('prioriza a atividade autorizada na API real: %j', (permissions, destination) => {
    expect(homePath(permission => hasPermission(permissions, permission), true)).toBe(destination);
  });
});
