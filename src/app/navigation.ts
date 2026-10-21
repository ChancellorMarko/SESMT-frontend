type PermissionCheck = (permission: string) => boolean;

export function canReadOperationsDashboard(can: PermissionCheck) {
  return can('dashboard.read') && can('appointments.read');
}

export function dashboardPath(can: PermissionCheck) {
  return canReadOperationsDashboard(can) ? '/app/dashboard' : '/app/painel-documental';
}

export function homePath(can: PermissionCheck) {
  if (can('dashboard.read')) return dashboardPath(can);
  if (can('documents.read')) return '/app/documentos';
  if (can('appointments.read')) return '/app/agenda';
  return '/app/notificacoes';
}
