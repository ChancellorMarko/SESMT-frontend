export const formatDate = (date?: string | null) => {
  if (!date) return 'Não informado';
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (civil) return `${civil[3]}/${civil[2]}/${civil[1]}`;
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'Data inválida' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(value);
};
export const dateOnly = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const statusLabels: Record<string, string> = { DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão', APPROVED: 'Aprovado', ACTIVE: 'Vigente', EXPIRED: 'Vencido', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado', ON_LEAVE: 'Afastado', TERMINATED: 'Desligado', CLEAN: 'Liberado', PENDING: 'Em verificação', REJECTED: 'Rejeitado', INTERNAL: 'Interno', RESTRICTED: 'Restrito', MEDICAL: 'Médico' };
