import type { DocumentaryReadinessRowDto } from '../../shared/contracts/requirements';
import type { ParticipantEligibilityDto } from '../../shared/contracts/work-permits';

export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
export interface ReadinessFilters { query: string; teamId: string; serviceTypeId: string; status: string }
export interface ReadinessGroup { row: DocumentaryReadinessRowDto; people: ParticipantEligibilityDto[] }
export function filterReadiness(rows: DocumentaryReadinessRowDto[], filters: ReadinessFilters): ReadinessGroup[] {
  const terms = normalizeSearch(filters.query).split(/\s+/).filter(Boolean);
  return rows.flatMap(row => {
    if (filters.teamId && row.teamId !== filters.teamId || filters.serviceTypeId && !(row.serviceTypeIds ?? [row.serviceTypeId]).includes(filters.serviceTypeId)) return [];
    const people = row.eligibility.participants.filter(person => {
      if (filters.status === 'pending' && person.eligible || filters.status === 'ready' && !person.eligible) return false;
      const haystack = normalizeSearch([row.appointmentCode, row.teamName, row.serviceLabel, row.location, person.name, person.serviceFunction, ...person.items.map(item => item.label)].join(' '));
      return terms.every(term => haystack.includes(term));
    });
    return people.length ? [{ row, people }] : [];
  });
}
export function readinessCounts(groups: ReadinessGroup[]) {
  return {
    appointments: groups.length,
    people: new Set(groups.flatMap(group => group.people.map(person => person.workerId))).size,
    pending: groups.reduce((total, group) => total + group.people.reduce((count, person) => count + person.items.filter(item => item.status !== 'APPROVED').length, 0), 0),
  };
}
export const statusLabels = { MISSING: 'Ausente', PENDING: 'Aguardando conferência', APPROVED: 'Conferido', REJECTED: 'Reprovado', EXPIRED: 'Vencido' };
function csvCell(value: string) {
  // Preserve literal text when a spreadsheet would interpret the value as a formula.
  const safe = /^[\s\uFEFF]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function readinessCsv(groups: ReadinessGroup[]) {
  const records = [['Agendamento', 'Equipe', 'Serviço', 'Local', 'Início', 'Fim', 'Pessoa', 'Função no serviço', 'Matriz', 'Requisito', 'Situação', 'Observação administrativa', 'Consulta em']];
  groups.forEach(({ row, people }) => people.forEach(person => person.items.forEach(item => {
    records.push([row.appointmentCode, row.teamName, row.serviceLabel, row.location, row.startsAt, row.endsAt, person.name, person.serviceFunction, row.eligibility.requirementVersion, item.label, statusLabels[item.status], item.restricted ? 'Conferência restrita por profissional autorizado.' : item.reason || '', row.eligibility.checkedAt]);
  })));
  return '\uFEFF' + records.map(record => record.map(csvCell).join(';')).join('\r\n');
}
