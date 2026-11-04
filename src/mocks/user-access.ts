/** Synthetic access validation; the production API remains the authority. */
import type { MeDto, OrganizationDto, RoleDto, ScopeDto, UserDto } from '../shared/contracts';
import type { TeamDto } from '../shared/contracts/work-permits';

export class UserAccessError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}
function require(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new UserAccessError(status, code, message, field);
}
const subset = (child: string[], authority: string[]) => child.every(id => authority.includes(id));
const restrictedSubset = (child: string[], authority: string[]) => !authority.length || child.length > 0 && subset(child, authority);
export function userAccessManageable(user: UserDto, authority: ScopeDto): boolean {
  return user.scope.companyIds.length > 0 && user.scope.unitIds.length > 0
    && subset(user.scope.companyIds, authority.companyIds) && subset(user.scope.unitIds, authority.unitIds)
    && restrictedSubset(user.scope.teamIds, authority.teamIds) && restrictedSubset(user.scope.sectorIds, authority.sectorIds)
    && (!authority.ownOnly || user.scope.ownOnly);
}
type Context = { actor: Pick<MeDto, 'scope' | 'permissions'>; roles: RoleDto[]; organization: OrganizationDto; teams: TeamDto[]; original?: UserDto; now?: number };
export type UserAccessPayload = { displayName?: string; email?: string; roles: string[]; scope: ScopeDto; status: UserDto['status'] };
export function userAccessPayload(input: unknown, { actor, roles, organization, teams, original, now = Date.now() }: Context): UserAccessPayload {
  require(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Informe os dados da concessão.');
  const raw = input as Record<string, unknown>;
  const allowed = original ? ['roles', 'scope', 'status'] : ['displayName', 'email', 'roles', 'scope'];
  require(Object.keys(raw).every(key => allowed.includes(key)), 422, 'VALIDATION_FAILED', 'A alteração contém campos não permitidos.');
  require(!original || userAccessManageable(original, actor.scope), 404, 'NOT_FOUND', 'Usuário indisponível no seu escopo.');
  require(!actor.scope.expiresAt || Date.parse(actor.scope.expiresAt) > now, 403, 'FORBIDDEN', 'Sua concessão de acesso expirou.');
  const list = (value: unknown, field: string, nonempty = false) => {
    require(Array.isArray(value) && (!nonempty || value.length > 0) && value.every(id => typeof id === 'string' && id.length > 0 && id.trim() === id), 422, 'VALIDATION_FAILED', 'Seleção de acesso inválida.', field);
    require(new Set(value).size === value.length, 422, 'VALIDATION_FAILED', 'A seleção contém referências duplicadas.', field);
    return [...value] as string[];
  };
  const selectedRoles = list(raw.roles ?? original?.roles, 'roles', true);
  const definitions = selectedRoles.map(code => roles.find(role => role.code === code));
  require(definitions.every(Boolean), 422, 'VALIDATION_FAILED', 'Perfil inválido.', 'roles');
  require(definitions.every(role => !role!.permissions.some(permission => permission.startsWith('documents.medical.') && !actor.permissions.includes(permission))), 403, 'FORBIDDEN', 'Seu acesso não permite conceder o perfil médico selecionado.', 'roles');
  const source = raw.scope ?? original?.scope;
  require(source && typeof source === 'object' && !Array.isArray(source), 422, 'VALIDATION_FAILED', 'Informe o escopo da concessão.', 'scope');
  require(Object.keys(source).every(key => ['companyIds', 'unitIds', 'sectorIds', 'teamIds', 'ownOnly', 'expiresAt'].includes(key)), 422, 'VALIDATION_FAILED', 'O escopo contém campos não permitidos.', 'scope');
  const rawScope: Record<string, unknown> = { sectorIds: [], teamIds: [], ownOnly: false, ...original?.scope, ...source };
  const scope: ScopeDto = { companyIds: list(rawScope.companyIds, 'scope.companyIds', true), unitIds: list(rawScope.unitIds, 'scope.unitIds', true), sectorIds: list(rawScope.sectorIds, 'scope.sectorIds'), teamIds: list(rawScope.teamIds, 'scope.teamIds'), ownOnly: rawScope.ownOnly as boolean };
  require(typeof scope.ownOnly === 'boolean', 422, 'VALIDATION_FAILED', 'Informe a restrição aos dados próprios.', 'scope.ownOnly');
  require(subset(scope.companyIds, actor.scope.companyIds), 403, 'FORBIDDEN', 'Empresa fora da sua autoridade.', 'scope.companyIds');
  require(subset(scope.unitIds, actor.scope.unitIds), 403, 'FORBIDDEN', 'Unidade fora da sua autoridade.', 'scope.unitIds');
  require(restrictedSubset(scope.teamIds, actor.scope.teamIds), 403, 'FORBIDDEN', 'Equipe fora da sua autoridade.', 'scope.teamIds');
  require(restrictedSubset(scope.sectorIds, actor.scope.sectorIds), 403, 'FORBIDDEN', 'Setor fora da sua autoridade.', 'scope.sectorIds');
  require(!actor.scope.ownOnly || scope.ownOnly, 403, 'FORBIDDEN', 'Sua autoridade limita a concessão aos dados próprios.', 'scope.ownOnly');
  require(scope.companyIds.every(id => organization.companies.some(company => company.id === id && (company.status === 'ACTIVE' || original?.scope.companyIds.includes(id)))), 422, 'VALIDATION_FAILED', 'Empresa indisponível para a concessão.', 'scope.companyIds');
  require(scope.unitIds.every(id => organization.units.some(unit => unit.id === id && scope.companyIds.includes(unit.companyId ?? '') && (unit.status === 'ACTIVE' || original?.scope.unitIds.includes(id)))), 422, 'VALIDATION_FAILED', 'Unidades incompatíveis com as empresas selecionadas.', 'scope.unitIds');
  require(scope.teamIds.every(id => teams.some(team => team.id === id && scope.companyIds.includes(team.companyId) && scope.unitIds.includes(team.unitId) && (team.status !== 'INACTIVE' || original?.scope.teamIds.includes(id)))), 422, 'VALIDATION_FAILED', 'Equipes incompatíveis com empresas e unidades selecionadas.', 'scope.teamIds');
  require(scope.sectorIds.every(id => organization.sectors.some(sector => sector.id === id && scope.unitIds.includes(sector.unitId ?? '') && (sector.status === 'ACTIVE' || original?.scope.sectorIds.includes(id)))), 422, 'VALIDATION_FAILED', 'Setores incompatíveis com as unidades selecionadas.', 'scope.sectorIds');
  const status = raw.status ?? original?.status ?? 'INVITED';
  require(['ACTIVE', 'DISABLED', 'INVITED'].includes(status as string), 422, 'VALIDATION_FAILED', 'Situação inválida.', 'status');
  const expiresAt = rawScope.expiresAt;
  if (expiresAt !== undefined && expiresAt !== null) {
    require(typeof expiresAt === 'string', 422, 'VALIDATION_FAILED', 'Prazo de concessão inválido.', 'scope.expiresAt');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(expiresAt);
    const civil = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) : null;
    require(match && civil && Number.isFinite(civil.getTime()) && civil.toISOString().slice(0, 10) === `${match[1]}-${match[2]}-${match[3]}` && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) < 60 && (!match[7] || Number(match[7]) < 24 && Number(match[8]) < 60) && Number.isFinite(Date.parse(expiresAt as string)), 422, 'VALIDATION_FAILED', 'Prazo de concessão inválido.', 'scope.expiresAt');
    require(status === 'DISABLED' || Date.parse(expiresAt) > now, 422, 'VALIDATION_FAILED', 'Escolha um prazo futuro.', 'scope.expiresAt');
    scope.expiresAt = new Date(expiresAt).toISOString();
  }
  require(status === 'DISABLED' || !selectedRoles.includes('AUDITOR') || scope.expiresAt, 422, 'VALIDATION_FAILED', 'Auditores exigem uma concessão temporária.', 'scope.expiresAt');
  require(!actor.scope.expiresAt || scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(actor.scope.expiresAt), 403, 'FORBIDDEN', 'A concessão deve terminar até o vencimento do seu acesso.', 'scope.expiresAt');
  const result: UserAccessPayload = { roles: selectedRoles, scope, status: status as UserDto['status'] };
  if (!original) {
    require(typeof raw.displayName === 'string' && raw.displayName.trim().length >= 3 && raw.displayName.trim().length <= 120, 422, 'VALIDATION_FAILED', 'Informe o nome completo.', 'displayName');
    require(typeof raw.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim()) && raw.email.length <= 254, 422, 'VALIDATION_FAILED', 'Informe um e-mail válido.', 'email');
    result.displayName = raw.displayName.trim(); result.email = raw.email.trim().toLocaleLowerCase('pt-BR');
  }
  return result;
}
