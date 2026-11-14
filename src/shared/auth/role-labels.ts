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
/** Short form for tight spaces (header): the first labels and how many more. The full list goes in a title or tooltip. */
export function roleSummary(roles: readonly string[], max = 2) {
  const all = roleLabels(roles).split(' · ');
  return all.length <= max ? all.join(' · ') : `${all.slice(0, max).join(' · ')} e mais ${all.length - max}`;
}
