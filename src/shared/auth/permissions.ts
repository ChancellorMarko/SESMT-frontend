// auth/permissions.ts
//
// Catálogo de permissões e roles emitidos pelo backend.
// Fonte da verdade: SESMT.Infrastructure.Persistence.Seeding.DatabaseSeeder
// (SeedRolesAndPermissionsAsync) + AuthController.Me, que concatena
// `Resource + ":" + Action`.
//
// Catálogo conhecido para autocomplete e conferência de contrato. Não filtra a
// identidade nem impede que o servidor envie novos perfis ou permissões.

export const PERMISSIONS = {
  documento: {
    ler: 'documento:ler',
    criar: 'documento:criar',
    editar: 'documento:editar',
    excluir: 'documento:excluir',
    aprovar: 'documento:aprovar',
    assinar: 'documento:assinar',
    exportar: 'documento:exportar',
  },
  empresa: {
    ler: 'empresa:ler',
    criar: 'empresa:criar',
    editar: 'empresa:editar',
    excluir: 'empresa:excluir',
  },
  unidade: {
    ler: 'unidade:ler',
    criar: 'unidade:criar',
    editar: 'unidade:editar',
    excluir: 'unidade:excluir',
  },
  setor: {
    ler: 'setor:ler',
    criar: 'setor:criar',
    editar: 'setor:editar',
    excluir: 'setor:excluir',
  },
  cargo: {
    ler: 'cargo:ler',
    criar: 'cargo:criar',
    editar: 'cargo:editar',
    excluir: 'cargo:excluir',
  },
  trabalhador: {
    ler: 'trabalhador:ler',
    criar: 'trabalhador:criar',
    editar: 'trabalhador:editar',
    excluir: 'trabalhador:excluir',
    importar: 'trabalhador:importar',
  },
  equipe: {
    ler: 'equipe:ler',
    criar: 'equipe:criar',
    editar: 'equipe:editar',
    excluir: 'equipe:excluir',
  },
  alerta: {
    ler: 'alerta:ler',
    tratar: 'alerta:tratar',
  },
  auditoria: {
    ler: 'auditoria:ler',
  },
  parametro: {
    ler: 'parametro:ler',
    editar: 'parametro:editar',
  },
  perfil: {
    ler: 'perfil:ler',
    criar: 'perfil:criar',
    editar: 'perfil:editar',
    excluir: 'perfil:excluir',
  },
  usuario: {
    ler: 'usuario:ler',
    criar: 'usuario:criar',
    editar: 'usuario:editar',
    excluir: 'usuario:excluir',
  },
  aso: {
    ler: 'aso:ler',
    editar: 'aso:editar',
  },
  pt: {
    ler: 'pt:ler',
    criar: 'pt:criar',
    editar: 'pt:editar',
    excluir: 'pt:excluir',
    liberar: 'pt:liberar',
    iniciar: 'pt:iniciar',
    concluir: 'pt:concluir',
  },
} as const satisfies Record<string, Record<string, `${string}:${string}`>>;

type ValuesOf<T> = T[keyof T];

/** União das permissões nativas conhecidas; não limita concessões futuras da API. */
export type Permission = ValuesOf<{
  [K in keyof typeof PERMISSIONS]: ValuesOf<(typeof PERMISSIONS)[K]>;
}>;

/** Lista achatada para o teste de drift e para validação em runtime. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS)
  .flatMap(group => Object.values(group)) as Permission[];

const permissionSet: ReadonlySet<string> = new Set(ALL_PERMISSIONS);
/** Guarda de runtime: útil se algum dia chegar permissão nova do backend. */
export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

// Roles exatamente como no seeder (`SeedRolesAndPermissionsAsync`).
// Nota: TECNICO, e não "TECHNICIAN"; TRABALHADOR, e não "WORKER"; etc.
export const ROLES = [
  'ADMIN',
  'GESTOR',
  'TECNICO',
  'MEDICO',
  'RH',
  'LIDER',
  'TRABALHADOR',
  'AUDITOR',
  'SESMT_PT_SOLICITANTE',
  'SESMT_PT_OPERADOR',
  'SESMT_PT_LIBERADOR',
  'SESMT_PT_CONFIG',
] as const;

export type Role = (typeof ROLES)[number];

const roleSet: ReadonlySet<string> = new Set(ROLES);
export function isRole(value: string): value is Role {
  return roleSet.has(value);
}

/**
 * The API grants access; this module only names explicitly integrated capabilities.
 * Native resources/actions come from the official backend's Permission entity and
 * seeder. No role, token claim, wildcard or naming heuristic grants a capability.
 * Writes/workflows need their own route, DTO and action contracts before mapping.
 */
export const nativePermissionRequirements: Readonly<Record<string, readonly string[]>> = {
  'documents.read': [PERMISSIONS.documento.ler],
  'workers.read': [PERMISSIONS.trabalhador.ler],
  'users.read': [PERMISSIONS.usuario.ler],
  'users.edit': [PERMISSIONS.usuario.editar],
  'users.deactivate': [PERMISSIONS.usuario.excluir],
  'notifications.read': [PERMISSIONS.alerta.ler],
  'audit.read': [PERMISSIONS.auditoria.ler],
  // This screen combines four resources; one resource must not unlock the rest.
  'organization.read': [PERMISSIONS.empresa.ler, PERMISSIONS.unidade.ler, PERMISSIONS.setor.ler, PERMISSIONS.cargo.ler],
};

export function hasPermission(granted: readonly string[], permission: string): boolean {
  if (!permission || !Array.isArray(granted)) return false;
  if (granted.includes(permission)) return true;
  const requirements = Object.hasOwn(nativePermissionRequirements, permission) ? nativePermissionRequirements[permission] : undefined;
  return !!requirements?.length && requirements.every(required => granted.includes(required));
}
