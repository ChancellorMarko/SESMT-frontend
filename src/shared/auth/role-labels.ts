const labels: Record<string, string> = {
  ADMIN: 'Administração', AUDITOR: 'Auditoria', GESTOR: 'Gestão', RH: 'Recursos Humanos', HR: 'Recursos Humanos',
  TRABALHADOR: 'Trabalhador', WORKER: 'Trabalhador', TECNICO: 'Técnico de segurança', TECHNICIAN: 'Técnico de segurança',
  MEDICO: 'Medicina do trabalho', LIDER: 'Liderança', ENGINEER: 'Engenheiro / SESMT', FIREFIGHTER: 'Bombeiro',
  SESMT_PT_SOLICITANTE: 'Solicitante de PT', SESMT_PT_OPERADOR: 'Operador de PT', SESMT_PT_LIBERADOR: 'Liberador de PT', SESMT_PT_CONFIG: 'Configuração de PT',
};
/** Display only: unknown server roles keep their actual name, never a guessed profession. */
export function roleLabels(roles: readonly string[]) {
  return [...new Set(roles.map(role => Object.hasOwn(labels, role) ? labels[role] : role))].join(' · ') || 'Sem perfil informado';
}
