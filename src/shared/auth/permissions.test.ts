import { describe, expect, it } from 'vitest';
import { hasPermission } from './permissions';

describe('permissões recebidas da API', () => {
  it.each([
    ['documento:ler', 'documents.read'], ['trabalhador:ler', 'workers.read'],
    ['usuario:ler', 'users.read'],
    ['alerta:ler', 'notifications.read'], ['auditoria:ler', 'audit.read'],
    ['usuario:editar', 'users.edit'], ['usuario:excluir', 'users.deactivate'],
  ])('reconhece %s como a consulta %s sem depender do nome do perfil', (native, capability) => {
    expect(hasPermission([native], capability)).toBe(true);
    expect(hasPermission([native], native)).toBe(true);
    expect(hasPermission([], capability)).toBe(false);
  });

  it('mantém permissões novas intactas sem exigir cadastro de um perfil no frontend', () => {
    expect(hasPermission(['recurso_novo:consultar'], 'recurso_novo:consultar')).toBe(true);
    expect(hasPermission(['recurso_novo:consultar'], 'documents.read')).toBe(false);
    expect(hasPermission(['documents.read'], 'documents.read')).toBe(true);
  });

  it('exige todos os recursos consumidos pela consulta organizacional', () => {
    const reads = ['empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler'];
    expect(hasPermission(reads, 'organization.read')).toBe(true);
    for (const removed of reads) expect(hasPermission(reads.filter(value => value !== removed), 'organization.read')).toBe(false);
    expect(hasPermission(['organization.read'], 'organization.read')).toBe(true);
  });

  it.each(['ADMIN', 'admin.read', '*', 'documento:*', 'documento:criar', 'documento:editar', 'DocumentO:ler'])('não transforma %s em leitura, escrita ou privilégio administrativo', grant => {
    for (const capability of ['documents.read', 'documents.write', 'documents.approve', 'documents.medical.read', 'users.manage']) expect(hasPermission([grant], capability)).toBe(false);
  });

  it('não deduz equivalência de ações distintas e não reutiliza concessões revogadas', () => {
    expect(hasPermission(['alerta:tratar'], 'notifications.read')).toBe(false);
    expect(hasPermission(['usuario:ler'], 'users.edit')).toBe(false);
    expect(hasPermission(['usuario:editar'], 'users.deactivate')).toBe(false);
    expect(hasPermission(['usuario:ler', 'usuario:criar', 'usuario:editar'], 'users.manage')).toBe(false);
    const permissions = ['documento:ler'];
    expect(hasPermission(permissions, 'documents.read')).toBe(true);
    permissions.length = 0;
    expect(hasPermission(permissions, 'documents.read')).toBe(false);
    expect(hasPermission([], 'constructor')).toBe(false);
  });
});
