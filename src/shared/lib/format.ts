export const formatDate = (date?: string | null) => {
  if (!date) return 'Não informado';
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (civil) return `${civil[3]}/${civil[2]}/${civil[1]}`;
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'Data inválida' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(value);
};
export const dateOnly = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const statusLabels: Record<string, string> = { DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão', APPROVED: 'Aprovado', ACTIVE: 'Vigente', EXPIRED: 'Vencido', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado', ON_LEAVE: 'Afastado', TERMINATED: 'Desligado', CLEAN: 'Liberado', PENDING: 'Em verificação', REJECTED: 'Rejeitado', INTERNAL: 'Interno', RESTRICTED: 'Restrito', MEDICAL: 'Médico' };
/** "1 registro", "3 registros": counts read as written Portuguese instead of "registro(s)". */
export const plural = (count: number, one: string, many: string) => `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`;
/** Calendar days are Brasília days (UTC−3, no daylight saving since 2019). Instants still travel as UTC ISO strings. */
const BRASILIA_OFFSET = '-03:00';
export const brasiliaDayStart = (day: string) => new Date(`${day}T00:00:00${BRASILIA_OFFSET}`).toISOString();
/** First instant of the following Brasília day: the exclusive end of a half-open interval. */
export const brasiliaNextDayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00${BRASILIA_OFFSET}`) + 86_400_000).toISOString();
/** Last millisecond of the Brasília day, for APIs that take an inclusive end. */
export const brasiliaDayEnd = (day: string) => new Date(Date.parse(`${day}T00:00:00${BRASILIA_OFFSET}`) + 86_399_999).toISOString();
