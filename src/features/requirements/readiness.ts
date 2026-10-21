import type { DocumentaryReadinessDto, DocumentaryReadinessRowDto } from '../../shared/contracts/requirements';
import type { ParticipantEligibilityDto } from '../../shared/contracts/work-permits';
import { isRecord, shortText } from '../../shared/lib/scoped-page';

export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
export interface ReadinessFilters { query: string; teamId: string; serviceTypeId: string; status: string }
export interface ReadinessGroup { row: DocumentaryReadinessRowDto; people: ParticipantEligibilityDto[] }
const statuses = ['pending', 'ready', 'all'];
const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value.trim()) && !/[\u0000-\u0020\u007f/?#\\]/.test(value);
const text = (value: unknown): value is string => shortText(value) && Boolean(value.trim());
const timestamp = (value: unknown): value is string => shortText(value, 100) && Number.isFinite(Date.parse(value));
export function readinessCriteriaError(params: URLSearchParams) {
  const keys = [...params.keys()];
  if (keys.some(key => params.getAll(key).length > 1)) return 'O endereço contém filtros repetidos. Limpe os filtros para consultar as pendências.';
  if (keys.some(key => !['q', 'teamId', 'serviceTypeId', 'status', 'unitId'].includes(key))) return 'O endereço contém filtros desconhecidos. Limpe os filtros para consultar as pendências.';
  if (params.has('status') && !statuses.includes(params.get('status')!)) return 'A situação documental do endereço é inválida. Escolha uma opção disponível ou limpe os filtros.';
  if ((params.get('q') ?? '').length > 2000 || /[\u0000-\u001f\u007f]/.test(params.get('q') ?? '')) return 'A busca do endereço é inválida. Limpe os filtros para consultar as pendências.';
  if (['teamId', 'serviceTypeId'].some(key => params.has(key) && !identifier(params.get(key)))) return 'O endereço contém uma equipe ou serviço inválido. Limpe os filtros para consultar as pendências.';
  return '';
}
export class ReadinessResponseError extends Error {
  constructor() { super('A consulta retornou dados inválidos para esta unidade. Atualize as pendências para tentar novamente.'); this.name = 'ReadinessResponseError'; }
}
/** Validate only the existing response contract; an absent legacy unitId is not proof of backend isolation. */
export function checkedReadiness(value: unknown, unitId: string): DocumentaryReadinessDto {
  if (!isRecord(value) || !timestamp(value.generatedAt) || !Array.isArray(value.rows)) throw new ReadinessResponseError();
  const appointments = new Set<string>();
  for (const row of value.rows) {
    if (!isRecord(row) || !identifier(row.appointmentId) || appointments.has(row.appointmentId)
      || !text(row.appointmentCode) || !identifier(row.teamId) || !text(row.teamName) || !identifier(row.serviceTypeId)
      || !text(row.serviceLabel) || !text(row.location) || !timestamp(row.startsAt) || !timestamp(row.endsAt)
      || Date.parse(row.startsAt) >= Date.parse(row.endsAt) || row.permitId !== undefined && !identifier(row.permitId)
      || row.serviceTypeIds !== undefined && (!Array.isArray(row.serviceTypeIds) || !row.serviceTypeIds.every(identifier))
      || row.services !== undefined && (!Array.isArray(row.services) || !row.services.every(service => isRecord(service) && identifier(service.id) && text(service.name)))) throw new ReadinessResponseError();
    const eligibility = row.eligibility;
    if (!isRecord(eligibility) || eligibility.appointmentId !== row.appointmentId || eligibility.unitId !== undefined && eligibility.unitId !== unitId
      || !timestamp(eligibility.checkedAt) || !text(eligibility.requirementVersion) || typeof eligibility.eligible !== 'boolean' || !Array.isArray(eligibility.participants)) throw new ReadinessResponseError();
    const people = new Set<string>();
    for (const person of eligibility.participants) {
      if (!isRecord(person) || !identifier(person.workerId) || people.has(person.workerId) || !text(person.name) || !text(person.serviceFunction)
        || typeof person.eligible !== 'boolean' || !Array.isArray(person.items)) throw new ReadinessResponseError();
      const requirements = new Set<string>();
      for (const item of person.items) {
        if (!isRecord(item) || !identifier(item.requirementId) || requirements.has(item.requirementId) || !text(item.label) || !shortText(item.description)
          || !shortText(item.status) || !Object.hasOwn(statusLabels, item.status) || typeof item.restricted !== 'boolean'
          || item.reason !== undefined && !shortText(item.reason)) throw new ReadinessResponseError();
        requirements.add(item.requirementId);
      }
      people.add(person.workerId);
    }
    appointments.add(row.appointmentId);
  }
  return value as unknown as DocumentaryReadinessDto;
}
export function readinessServiceIds(row: DocumentaryReadinessRowDto): string[] {
  return [...new Set([row.serviceTypeId, ...(row.serviceTypeIds ?? []), ...(row.services ?? []).map(service => service.id)])];
}
export function filterReadiness(rows: DocumentaryReadinessRowDto[], filters: ReadinessFilters): ReadinessGroup[] {
  if (!statuses.includes(filters.status)) return [];
  const terms = normalizeSearch(filters.query).split(/\s+/).filter(Boolean);
  return rows.flatMap(row => {
    if (filters.teamId && row.teamId !== filters.teamId || filters.serviceTypeId && !readinessServiceIds(row).includes(filters.serviceTypeId)) return [];
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
  groups.forEach(({ row, people }) => people.forEach(person => {
    const context = [row.appointmentCode, row.teamName, row.serviceLabel, row.location, row.startsAt, row.endsAt, person.name, person.serviceFunction, row.eligibility.requirementVersion];
    if (!person.items.length) records.push([...context, 'Matriz sem requisitos aplicáveis', 'Conferência necessária', 'Confira a configuração da matriz antes de liberar.', row.eligibility.checkedAt]);
    person.items.forEach(item => records.push([...context, item.label, statusLabels[item.status], item.restricted ? 'Conferência restrita por profissional autorizado.' : item.reason || '', row.eligibility.checkedAt]));
  }));
  return '\uFEFF' + records.map(record => record.map(csvCell).join(';')).join('\r\n');
}
