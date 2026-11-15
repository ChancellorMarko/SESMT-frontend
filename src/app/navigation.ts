type PermissionCheck = (permission: string) => boolean;

export function canReadOperationsDashboard(can: PermissionCheck, native = false) {
  // Native DashboardController is [Authorize]; the server filters actor visibility.
  return native || can('dashboard.read') && can('appointments.read');
}

export function dashboardPath(can: PermissionCheck, native = false) {
  return canReadOperationsDashboard(can, native) ? '/app/dashboard' : '/app/painel-documental';
}

export function homePath(can: PermissionCheck, native = false) {
  // Whoever operates work permits starts on the overview, even when also managing accounts.
  if (native && ['pt:criar', 'pt:editar', 'pt:liberar', 'pt:iniciar', 'pt:concluir'].some(can)) return '/app/dashboard';
  if (can('users.read') && (!native || can('users.edit') || can('usuario:criar') || can('users.deactivate'))) return '/app/configuracoes/usuarios';
  if (native) {
    if (can('trabalhador:criar') || can('trabalhador:editar')) return '/app/trabalhadores';
    if (can('audit.read')) return '/app/auditoria';
  }
  if (can('dashboard.read')) return dashboardPath(can, native);
  if (can('documents.read')) return '/app/documentos';
  if (can('appointments.read')) return '/app/agenda';
  if (native) {
    if (can('aso:acompanhar')) return '/app/asos';
    if (can('treinamento:ler')) return '/app/treinamentos';
    if (can('epi:ler')) return '/app/epis';
    if (can('parametro:ler') || can('parametro:editar')) return '/app/configuracoes/tipos-documentais';
  }
  const destinations = [
    ['users.manage', '/app/configuracoes/usuarios'],
    ['users.read', '/app/configuracoes/usuarios'],
    ['workers.read', '/app/trabalhadores'],
    ['teams.read', '/app/equipes'],
    ['organization.read', '/app/organizacao'],
    ['permits.read', '/app/pts'],
    ['at.read', '/app/ats'],
    ['pet.read', '/app/pets'],
    ['eligibility.read', '/app/pendencias'],
    ['requirements.read', '/app/configuracoes/requisitos'],
    ['documentTypes.write', '/app/configuracoes/tipos-documentais'],
    ['audit.read', '/app/auditoria'],
    ['permits.review', '/app/minha-representacao'],
    ['notifications.read', '/app/notificacoes'],
  ];
  for (const [permission, path] of destinations) if (can(permission)) return path;
  return native ? '/app/dashboard' : '/app/conexao';
}
