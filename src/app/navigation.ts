type PermissionCheck = (permission: string) => boolean;

export function canReadOperationsDashboard(can: PermissionCheck, native = false) {
  // Native DashboardController is [Authorize]; the server filters actor visibility.
  return native || can('dashboard.read') && can('appointments.read');
}

export function dashboardPath(can: PermissionCheck, native = false) {
  return canReadOperationsDashboard(can, native) ? '/app/dashboard' : '/app/painel-documental';
}

export function homePath(can: PermissionCheck, native = false) {
  if (can('users.read')) return '/app/configuracoes/usuarios';
  if (can('dashboard.read')) return dashboardPath(can, native);
  if (can('documents.read')) return '/app/documentos';
  if (can('appointments.read')) return '/app/agenda';
  const destinations = [
    ['users.manage', '/app/configuracoes/usuarios'],
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
