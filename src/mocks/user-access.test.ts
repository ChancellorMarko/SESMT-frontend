import { describe, expect, it } from 'vitest';
import type { MeDto, OrganizationDto, RoleDto, ScopeDto, UserDto } from '../shared/contracts';
import type { TeamDto } from '../shared/contracts/work-permits';
import { UserAccessError, userAccessManageable, userAccessPayload } from './user-access';

const now = Date.parse('2030-01-01T12:00:00Z');
const organization: OrganizationDto = {
  companies: ['a', 'b', 'outside'].map(key => ({ id: `company-${key}`, name: key, status: 'ACTIVE', revision: 1 })),
  units: ['a', 'b', 'outside'].map(key => ({ id: `unit-${key}`, name: key, companyId: `company-${key}`, status: 'ACTIVE', revision: 1 })),
  sectors: ['a', 'b', 'outside'].map(key => ({ id: `sector-${key}`, name: key, unitId: `unit-${key}`, status: 'ACTIVE', revision: 1 })),
  establishments: [], jobs: [], jobFunctions: [], workCenters: [],
};
const teams: TeamDto[] = ['a', 'b', 'outside'].map(key => ({ id: `team-${key}`, name: key, companyId: `company-${key}`, unitId: `unit-${key}`, chiefId: 'chief', members: [], revision: 1 }));
const scope: ScopeDto = { companyIds: ['company-a'], unitIds: ['unit-a'], teamIds: ['team-a'], sectorIds: ['sector-a'], ownOnly: false };
const actor: Pick<MeDto, 'scope' | 'permissions'> = { permissions: ['users.manage'], scope: { companyIds: ['company-a', 'company-b'], unitIds: ['unit-a', 'unit-b'], sectorIds: [], teamIds: [], ownOnly: false } };
const roles: RoleDto[] = [{ code: 'HR', label: 'Recursos Humanos', permissions: [] }, { code: 'ADMIN', label: 'Administrador', permissions: ['users.manage'] }, { code: 'SESMT_MANAGER', label: 'Engenheiro', permissions: ['permits.review'] }, { code: 'AUDITOR', label: 'Auditor', permissions: [] }, { code: 'MEDICAL', label: 'Médico', permissions: ['documents.medical.read'] }];
const original: UserDto = { id: 'user-a', displayName: 'Pessoa do teste', email: 'pessoa@example.invalid', status: 'ACTIVE', roles: ['HR'], revision: 7, scope, mfaRequired: false };
const create = { displayName: ' Nova pessoa ', email: 'NOVA@example.invalid', roles: ['HR'], scope };
const context = { actor, roles, organization, teams, now };
function rejected(input: unknown, expected: Partial<UserAccessError>, options: Partial<typeof context & { original: UserDto }> = {}) {
  let error: unknown; try { userAccessPayload(input, { ...context, ...options }); } catch (failure) { error = failure; }
  expect(error).toBeInstanceOf(UserAccessError); expect(error).toMatchObject(expected);
}

describe('Concessão sintética de acesso sem ampliação da autoridade', () => {
  it('só remove prazo existente mediante null explícito e respeita auditor e autoridade temporária', () => {
    const temporary = { ...original, scope: { ...scope, expiresAt: '2030-01-10T12:00:00.000Z' } };
    expect(userAccessPayload({ roles: ['HR'], scope: { ownOnly: true } }, { ...context, original: temporary }).scope.expiresAt).toBe(temporary.scope.expiresAt);
    expect(userAccessPayload({ scope: { expiresAt: null } }, { ...context, original: temporary }).scope.expiresAt).toBeUndefined();
    rejected({ roles: ['AUDITOR'], scope: { expiresAt: null } }, { status: 422, field: 'scope.expiresAt' }, { original: temporary });
    rejected({ scope: { expiresAt: null } }, { status: 403, field: 'scope.expiresAt' }, { original: temporary, actor: { ...actor, scope: { ...actor.scope, expiresAt: '2030-01-15T12:00:00.000Z' } } });
  });
  it('normaliza o convite sem conceder empresas, equipes ou perfis adicionais', () => {
    expect(userAccessPayload(create, context)).toEqual({ displayName: 'Nova pessoa', email: 'nova@example.invalid', roles: ['HR'], scope, status: 'INVITED' });
    expect(create).toMatchObject({ email: 'NOVA@example.invalid', displayName: ' Nova pessoa ' });
  });
  it('aceita PATCH parcial preservando as restrições originais', () => {
    const result = userAccessPayload({ status: 'DISABLED' }, { ...context, original });
    expect(result).toEqual({ roles: ['HR'], status: 'DISABLED', scope });
    expect(userAccessPayload({ scope: { companyIds: ['company-a'], unitIds: ['unit-a'] } }, { ...context, original }).scope).toEqual(scope);
    expect(result.scope).not.toBe(original.scope); expect(result.scope.teamIds).not.toBe(original.scope.teamIds);
  });
  it('recusa empresas e unidades externas mesmo com um perfil administrativo', () => {
    rejected({ ...create, roles: ['ADMIN'], scope: { ...scope, companyIds: ['company-outside'] } }, { status: 403, field: 'scope.companyIds' });
    rejected({ ...create, roles: ['ADMIN'], scope: { ...scope, unitIds: ['unit-outside'] } }, { status: 403, field: 'scope.unitIds' });
  });
  it('valida os vínculos empresa-unidade-equipe, e não apenas a presença de IDs', () => {
    rejected({ ...create, scope: { ...scope, companyIds: ['company-b'] } }, { status: 422, field: 'scope.unitIds' });
    rejected({ ...create, scope: { ...scope, teamIds: ['team-b'] } }, { status: 422, field: 'scope.teamIds' });
    rejected({ ...create, scope: { ...scope, sectorIds: ['sector-b'] } }, { status: 422, field: 'scope.sectorIds' });
  });
  it('não remove silenciosamente setores ou equipes ao trocar a unidade no PATCH parcial', () => {
    const snapshot = structuredClone(original);
    rejected({ scope: { companyIds: ['company-b'], unitIds: ['unit-b'] } }, { status: 422, field: 'scope.teamIds' }, { original });
    expect(original).toEqual(snapshot);
    expect(userAccessPayload({ scope: { companyIds: ['company-b'], unitIds: ['unit-b'], teamIds: ['team-b'], sectorIds: ['sector-b'] } }, { ...context, original }).scope).toMatchObject({ teamIds: ['team-b'], sectorIds: ['sector-b'] });
  });
  it('impede conceder equipes externas ou escopo irrestrito por um delegante restrito', () => {
    const restricted = { ...actor, scope: { ...actor.scope, teamIds: ['team-a'] } };
    rejected({ ...create, scope: { ...scope, teamIds: [] } }, { status: 403, field: 'scope.teamIds' }, { actor: restricted });
    rejected({ ...create, scope: { ...scope, companyIds: ['company-b'], unitIds: ['unit-b'], teamIds: ['team-b'], sectorIds: ['sector-b'] } }, { status: 403, field: 'scope.teamIds' }, { actor: restricted });
    expect(userAccessPayload(create, { ...context, actor: restricted }).scope.teamIds).toEqual(['team-a']);
  });
  it('preserva a restrição de setores e dados próprios do delegante', () => {
    rejected({ ...create, scope: { ...scope, sectorIds: [] } }, { status: 403, field: 'scope.sectorIds' }, { actor: { ...actor, scope: { ...actor.scope, sectorIds: ['sector-a'] } } });
    rejected(create, { status: 403, field: 'scope.ownOnly' }, { actor: { ...actor, scope: { ...actor.scope, ownOnly: true } } });
  });
  it('recusa editar acessos históricos maiores que a autoridade sem mutilá-los', () => {
    const broader = { ...original, scope: { ...scope, companyIds: ['company-a', 'company-outside'] } };
    expect(userAccessManageable(broader, actor.scope)).toBe(false);
    rejected({ status: 'DISABLED' }, { status: 404 }, { original: broader });
    expect(broader.scope.companyIds).toEqual(['company-a', 'company-outside']);
    expect(userAccessManageable({ ...original, scope: { ...scope, teamIds: [] } }, { ...actor.scope, teamIds: ['team-a'] })).toBe(false);
  });
  it('não transforma ADMIN em engenheiro automaticamente e valida o perfil médico separadamente', () => {
    expect(userAccessPayload({ ...create, roles: ['ADMIN'] }, context).roles).toEqual(['ADMIN']);
    expect(userAccessPayload({ ...create, roles: ['SESMT_MANAGER'] }, context).roles).toEqual(['SESMT_MANAGER']);
    rejected({ ...create, roles: ['MEDICAL'] }, { status: 403, field: 'roles' });
    expect(userAccessPayload({ ...create, roles: ['MEDICAL'] }, { ...context, actor: { ...actor, permissions: [...actor.permissions, 'documents.medical.read'] } }).roles).toEqual(['MEDICAL']);
  });
  it('não aceita prazo além da autoridade e exige prazo futuro para auditor', () => {
    const limited = { ...actor, scope: { ...actor.scope, expiresAt: '2030-01-10T12:00:00Z' } };
    rejected(create, { status: 403, field: 'scope.expiresAt' }, { actor: limited });
    rejected({ ...create, scope: { ...scope, expiresAt: '2030-01-11T12:00:00Z' } }, { status: 403, field: 'scope.expiresAt' }, { actor: limited });
    rejected({ ...create, roles: ['AUDITOR'] }, { status: 422, field: 'scope.expiresAt' });
    rejected({ ...create, scope: { ...scope, expiresAt: '2029-12-31T23:00:00Z' } }, { status: 422, field: 'scope.expiresAt' });
    expect(userAccessPayload({ ...create, roles: ['AUDITOR'], scope: { ...scope, expiresAt: '2030-01-10T09:00:00-03:00' } }, { ...context, actor: limited }).scope.expiresAt).toBe('2030-01-10T12:00:00.000Z');
  });
  it('recusa concessão expirada do delegante e datas ISO civis inexistentes', () => {
    rejected(create, { status: 403 }, { actor: { ...actor, scope: { ...actor.scope, expiresAt: '2029-12-31T12:00:00Z' } } });
    for (const expiresAt of ['2030-02-30T12:00:00Z', '2030-13-01T12:00:00Z', '2030-01-01T24:00:00Z', '2030-01-01T12:60:00Z', '2030-01-01T12:00:00+99:00']) {
      rejected({ ...create, scope: { ...scope, expiresAt } }, { status: 422, field: 'scope.expiresAt' });
    }
  });
  it('recusa IDs duplicados, campos imutáveis e tipos inválidos sem mutação', () => {
    rejected({ ...create, scope: { ...scope, teamIds: ['team-a', 'team-a'] } }, { status: 422, field: 'scope.teamIds' });
    rejected({ displayName: 'Nome imposto' }, { status: 422 }, { original });
    rejected({ ...create, status: 'ACTIVE' }, { status: 422 });
    rejected({ ...create, scope: { ...scope, ownOnly: 'false' } }, { status: 422, field: 'scope.ownOnly' });
    rejected({ ...create, roles: ['UNKNOWN'] }, { status: 422, field: 'roles' });
  });
  it('preserva registros inativos históricos sem permitir novas concessões deles', () => {
    const inactiveOrganization = structuredClone(organization); inactiveOrganization.units[0].status = 'INACTIVE';
    const inactiveTeams = structuredClone(teams); inactiveTeams[0].status = 'INACTIVE';
    expect(userAccessPayload({ status: 'DISABLED' }, { ...context, original, organization: inactiveOrganization, teams: inactiveTeams }).scope).toEqual(scope);
    rejected(create, { status: 422, field: 'scope.unitIds' }, { organization: inactiveOrganization, teams: inactiveTeams });
  });
});
