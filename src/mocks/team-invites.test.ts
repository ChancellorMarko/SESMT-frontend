import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamDto } from '../shared/contracts/work-permits';
import type { PublicTeamInviteDto, TeamInviteDto } from '../shared/contracts/teams';
import { createTeamInvites } from './team-invites';
import { COMPANY, UNIT_A, UNIT_B, id, makeFixtures } from './fixtures';
import type { PermitDemoContext } from './work-permits';

const actor = (): PermitDemoContext => ({ user: makeFixtures().users[0], permissions: ['teams.read', 'teams.write'], workers: makeFixtures().workers, checkUnit: vi.fn() });
const teamsSeed = (): TeamDto[] => [
  { id: id(200), name: 'Equipe fictícia A', companyId: COMPANY, unitId: UNIT_A, chiefId: id(40), revision: 1, members: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }] },
  { id: id(201), name: 'Equipe fictícia B', companyId: COMPANY, unitId: UNIT_B, chiefId: id(46), revision: 1, members: [{ workerId: id(46), name: 'Luiza Demo', serviceFunction: 'Executante' }] },
];

describe('convites de equipe em memória', () => {
  let teams: TeamDto[];
  let demo: ReturnType<typeof createTeamInvites>;
  beforeEach(() => { teams = teamsSeed(); demo = createTeamInvites(teams, () => makeFixtures().organization); });
  async function call<T>(path: string, method = 'GET', body?: unknown, context?: PermitDemoContext): Promise<T> {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as T;
  }
  it('deriva equipe, contagem e organização dos cadastros e permite GET público', async () => {
    const active = await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026');
    expect(active.teamName).toBe(teams[0].name); expect(active.companyName).toBe('Organização Exemplo');
    expect(active.unitName).toBe('Unidade Matriz'); expect(active.members).toHaveLength(1);
    expect(active.members[0].name).toBe('Camila Demo');
    const listed = await call<TeamInviteDto[]>('/team-invites', 'GET', undefined, actor());
    expect(listed.every(invite => invite.membersCount === 1)).toBe(true);
  });
  it.each(['tok-equipe-expirada', 'tok-equipe-revogada'])('omite participantes e instruções para %s', async token => {
    const result = await call<PublicTeamInviteDto>(`/team-invites/public/${token}`);
    expect(result.members).toEqual([]); expect(result.chiefName).toBe(''); expect(result.operationalInstructions).toBe('');
    expect(result.companyName).toBe(''); expect(result.unitName).toBe('');
  });
  it('remove a visualização pública após revogação e inativação da equipe', async () => {
    const revoked = await call<TeamInviteDto>('/team-invites/invite-demo-active/revoke', 'POST', {}, actor());
    expect(revoked.status).toBe('REVOKED');
    expect((await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026')).members).toEqual([]);
    demo = createTeamInvites(teams); teams[0].status = 'INACTIVE';
    const inactive = await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026');
    expect(inactive.status).toBe('REVOKED'); expect(inactive.members).toEqual([]);
    expect(inactive.unavailableReason).toBe('TEAM_INACTIVE');
    const administrative = await call<TeamInviteDto[]>('/team-invites', 'GET', undefined, actor());
    expect(administrative.find(invite => invite.id === 'invite-demo-active')?.unavailableReason).toBe('TEAM_INACTIVE');
    teams[0].status = 'ACTIVE';
    const reactivated = await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026');
    expect(reactivated.status).toBe('ACTIVE'); expect(reactivated.unavailableReason).toBeUndefined();
    expect(reactivated.members).toHaveLength(1);
    await call('/team-invites/invite-demo-active/revoke', 'POST', {}, actor());
    teams[0].status = 'INACTIVE'; teams[0].status = 'ACTIVE';
    expect((await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026')).status).toBe('REVOKED');
  });
  it('rejeita link inexistente, token malformado e mutação em endpoint público', async () => {
    await expect(call('/team-invites/public/nao-existe')).rejects.toMatchObject({ status: 404 });
    await expect(call('/team-invites/public/%E0%A4%A')).rejects.toMatchObject({ status: 404 });
    await expect(call('/team-invites/public/tok-equipe-civil-2026', 'POST', {})).rejects.toMatchObject({ status: 405 });
  });
  it.each(['company', 'unit', 'team', 'expired'] as const)('isola listagem e revogação pelo escopo %s', async dimension => {
    const context = actor();
    if (dimension === 'company') context.user.scope.companyIds = [id(999)];
    if (dimension === 'unit') context.user.scope.unitIds = [UNIT_B];
    if (dimension === 'team') context.user.scope.teamIds = [id(201)];
    if (dimension === 'expired') context.user.scope.expiresAt = '2000-01-01T00:00:00Z';
    expect(await call('/team-invites', 'GET', undefined, context)).toEqual([]);
    await expect(call('/team-invites/invite-demo-active/revoke', 'POST', {}, context)).rejects.toMatchObject({ status: 404 });
    await expect(call('/team-invites', 'POST', { teamId: id(200) }, context)).rejects.toMatchObject({ status: 404 });
    expect((await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026')).status).toBe('ACTIVE');
  });
  it('exige sessão, permissão e acesso coletivo para alterações', async () => {
    await expect(call('/team-invites')).rejects.toMatchObject({ status: 401 });
    const context = actor(); context.permissions = ['teams.read'];
    await expect(call('/team-invites/invite-demo-active/revoke', 'POST', {}, context)).rejects.toMatchObject({ status: 403 });
    context.permissions = ['teams.read', 'teams.write']; context.user.scope.ownOnly = true;
    await expect(call('/team-invites', 'GET', undefined, context)).rejects.toMatchObject({ status: 403 });
  });
  it('cria convite para a unidade correta com UUID completo e valida sua expiração', async () => {
    const created = await call<TeamInviteDto>('/team-invites', 'POST', { teamId: id(201), validityHours: 24 }, actor());
    expect(created.unitName).toBe('Unidade Operacional'); expect(created.teamName).toBe(teams[1].name);
    expect(created.token).toMatch(/^inv-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
    expect(Date.parse(created.expiresAt) - Date.parse(created.createdAt)).toBe(24 * 3600000);
    expect((await call<PublicTeamInviteDto>(`/team-invites/public/${created.token}`)).members[0].name).toBe('Luiza Demo');
    const current = Date.now(); const mockClock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(created.expiresAt));
    expect((await call<PublicTeamInviteDto>(`/team-invites/public/${created.token}`)).status).toBe('EXPIRED');
    mockClock.mockRestore(); expect(Date.now()).toBeGreaterThanOrEqual(current);
  });
  it.each([0, -1, 1.5, 169, '24', null])('rejeita validade inválida %s sem criar convite', async validityHours => {
    await expect(call('/team-invites', 'POST', { teamId: id(200), validityHours }, actor())).rejects.toMatchObject({ status: 422, field: 'validityHours' });
    expect(await call<TeamInviteDto[]>('/team-invites', 'GET', undefined, actor())).toHaveLength(3);
  });
  it('rejeita corpo JSON inválido e equipe inativa', async () => {
    await expect(call('/team-invites', 'POST', null, actor())).rejects.toMatchObject({ status: 422 });
    teams[0].status = 'INACTIVE';
    await expect(call('/team-invites', 'POST', { teamId: id(200) }, actor())).rejects.toMatchObject({ status: 409 });
  });
});
