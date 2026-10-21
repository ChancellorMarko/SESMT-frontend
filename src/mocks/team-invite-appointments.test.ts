import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDto, ServiceTypeDto, TeamDto } from '../shared/contracts/work-permits';
import type { PublicInviteAppointmentDto, PublicInviteAppointmentWriteDto, PublicTeamInviteDto, TeamInviteDto } from '../shared/contracts/teams';
import { createTeamInvites, type TeamInviteAppointmentCreateInput } from './team-invites';
import { COMPANY, UNIT_A, id, makeFixtures } from './fixtures';
import type { PermitDemoContext } from './work-permits';

describe('solicitações limitadas ao convite público', () => {
  let teams: TeamDto[];
  let store: Map<string, AppointmentDto>;
  let create: ReturnType<typeof vi.fn<(input: TeamInviteAppointmentCreateInput) => AppointmentDto>>;
  let demo: ReturnType<typeof createTeamInvites>;
  const services: ServiceTypeDto[] = [
    { id: id(210), name: 'Manutenção', description: 'Serviço demonstrativo', templateVersion: 'demo', requirementVersion: 'demo' },
    { id: id(211), name: 'Inspeção', description: 'Serviço demonstrativo', templateVersion: 'demo', requirementVersion: 'demo' },
  ];
  const path = '/team-invites/public/tok-equipe-civil-2026/appointments';
  const actor = (): PermitDemoContext => ({ user: makeFixtures().users[0], permissions: ['teams.read', 'teams.write'], workers: makeFixtures().workers, checkUnit: vi.fn() });
  beforeEach(() => {
    teams = [{ id: id(200), name: 'Equipe exemplo', companyId: COMPANY, unitId: UNIT_A, chiefId: id(40), revision: 1, members: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }, { workerId: id(41), name: 'Bruno Demo', serviceFunction: 'Apoio' }] }];
    store = new Map();
    create = vi.fn(input => {
      const created: AppointmentDto = { id: crypto.randomUUID(), code: `AG-PUBLIC-${store.size + 1}`, companyId: input.team.companyId, unitId: input.team.unitId, teamId: input.team.id, teamName: input.team.name, responsibleId: '', responsibleName: 'A designar', serviceTypeId: input.serviceTypeIds[0], serviceTypeIds: input.serviceTypeIds, serviceLabel: input.services.map(service => service.name).join(' + '), location: input.location, startsAt: input.startsAt, endsAt: input.endsAt, requestedStartsAt: input.startsAt, requestedEndsAt: input.endsAt, participants: input.participants, notes: input.notes, status: 'REQUESTED', revision: 1, availableActions: [], history: [] };
      store.set(created.id, created); return created;
    });
    demo = createTeamInvites(teams, () => makeFixtures().organization, { services: () => services, create, read: key => store.get(key) });
  });
  async function call<T>(target: string, method = 'GET', payload?: unknown, key = 'test-request-key', context?: PermitDemoContext) {
    const url = new URL(`http://localhost/api/v1${target}`);
    return await demo.route(new Request(url, { method, headers: { 'Idempotency-Key': key }, body: payload === undefined ? undefined : JSON.stringify(payload) }), url, target, context) as T;
  }
  async function input(): Promise<PublicInviteAppointmentWriteDto> {
    const invite = await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026');
    return { serviceTypeIds: services.map(service => service.id), location: 'Galpão de teste', startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 90_000_000).toISOString(), participants: [{ memberId: invite.members[0].memberId!, serviceFunction: 'Encarregada' }], notes: 'Contexto do acesso', declarantName: 'Ana Exemplo', acknowledged: true };
  }
  it('apresenta opções e identificadores opacos limitados ao token, sem IDs de trabalhadores', async () => {
    const invite = await call<PublicTeamInviteDto>('/team-invites/public/tok-equipe-civil-2026');
    expect(invite.appointmentRequestsEnabled).toBe(true); expect(invite.services).toHaveLength(2);
    expect(JSON.stringify(invite)).not.toContain(id(40));
    const another = await call<TeamInviteDto>('/team-invites', 'POST', { teamId: teams[0].id }, 'create-key', actor());
    const other = await call<PublicTeamInviteDto>(`/team-invites/public/${another.token}`);
    expect(other.members[0].memberId).not.toBe(invite.members[0].memberId);
    const payload = await input();
    await expect(call(`/team-invites/public/${another.token}/appointments`, 'POST', payload)).rejects.toMatchObject({ status: 422, field: 'participants' });
    expect(create).not.toHaveBeenCalled();
  });
  it('cria REQUESTED sem sessão, deriva vínculos e nunca confirma ou cria PT', async () => {
    const payload = await input();
    const result = await call<PublicInviteAppointmentDto>(path, 'POST', payload);
    expect(result.status).toBe('REQUESTED'); expect(result.services.map(service => service.name)).toEqual(['Manutenção', 'Inspeção']);
    expect(result.participants).toEqual([{ name: 'Camila Demo', serviceFunction: 'Encarregada' }]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ inviteId: 'invite-demo-active', team: expect.objectContaining({ companyId: COMPANY, unitId: UNIT_A }), participants: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Encarregada' }] }));
    const internal = store.get(result.id)!;
    expect(internal.responsibleId).toBe(''); expect(internal.permitId).toBeUndefined();
    expect(result).not.toHaveProperty('history'); expect(result).not.toHaveProperty('notes'); expect(result).not.toHaveProperty('companyId');
    expect(await call(path)).toEqual([result]);
  });
  it('repete a mesma chave sem duplicar e recusa reutilização com outro conteúdo', async () => {
    const payload = await input();
    const first = await call<PublicInviteAppointmentDto>(path, 'POST', payload);
    expect(await call(path, 'POST', payload)).toEqual(first); expect(create).toHaveBeenCalledTimes(1);
    await expect(call(path, 'POST', { ...payload, location: 'Outro local' })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('lista apenas pedidos deste link e expõe somente o estado/horário atualizados pela agenda', async () => {
    const saved = await call<PublicInviteAppointmentDto>(path, 'POST', await input());
    Object.assign(store.get(saved.id)!, { status: 'CONFIRMED', confirmedStartsAt: saved.requestedStartsAt, confirmedEndsAt: saved.requestedEndsAt, notes: 'Nota interna secreta', permitId: id(999), history: [{ reason: 'Dado interno' }] });
    const listed = await call<PublicInviteAppointmentDto[]>(path);
    expect(listed[0].status).toBe('CONFIRMED'); expect(listed[0].confirmedStartsAt).toBe(saved.requestedStartsAt);
    expect(JSON.stringify(listed)).not.toMatch(/Nota interna secreta|Dado interno|permitId|workerId/);
    const other = await call<TeamInviteDto>('/team-invites', 'POST', { teamId: teams[0].id }, 'other-key', actor());
    expect(await call(`/team-invites/public/${other.token}/appointments`)).toEqual([]);
  });
  it.each(['tok-equipe-expirada', 'tok-equipe-revogada'])('recusa consulta e envio por %s', async token => {
    await expect(call(`/team-invites/public/${token}/appointments`)).rejects.toMatchObject({ status: 410 });
    await expect(call(`/team-invites/public/${token}/appointments`, 'POST', await input())).rejects.toMatchObject({ status: 410 });
    expect(create).not.toHaveBeenCalled();
  });
  it('reconfere a revogação durante a leitura do corpo, inclusive em repetição idempotente', async () => {
    const payload = await input();
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'Idempotency-Key': 'deferred-key' } });
    let resolve!: (value: unknown) => void;
    vi.spyOn(request, 'json').mockReturnValue(new Promise(done => { resolve = done; }));
    const sending = demo.route(request, url, path);
    await call('/team-invites/invite-demo-active/revoke', 'POST', {}, 'revoke-key', actor());
    resolve(payload);
    await expect(sending).rejects.toMatchObject({ status: 410 }); expect(create).not.toHaveBeenCalled();
  });
  it('reconfere a equipe removida ou alterada durante o envio e impede participante antigo', async () => {
    const payload = await input();
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'Idempotency-Key': 'roster-key' } });
    let resolve!: (value: unknown) => void;
    vi.spyOn(request, 'json').mockReturnValue(new Promise(done => { resolve = done; }));
    const sending = demo.route(request, url, path);
    teams[0] = { ...teams[0], members: [] };
    resolve(payload);
    await expect(sending).rejects.toMatchObject({ status: 422, field: 'participants' }); expect(create).not.toHaveBeenCalled();
  });
  it.each([
    { teamId: 'another-team' }, { unitId: 'another-unit' }, { responsibleId: 'someone' }, { status: 'CONFIRMED' },
    { serviceTypeIds: [] }, { serviceTypeIds: [id(210), id(210)] }, { serviceTypeIds: [id(999)] },
    { participants: [] }, { participants: [{ memberId: 'not-a-member', serviceFunction: 'Execução' }] },
    { startsAt: '2026-02-31T12:00:00.000Z' }, { endsAt: '2026-01-01T12:00:00.000Z' }, { acknowledged: false }, { declarantName: 'A' },
  ])('rejeita dados inválidos ou privilégios forjados: %s', async override => {
    await expect(call(path, 'POST', { ...await input(), ...override })).rejects.toMatchObject({ status: 422 });
    expect(create).not.toHaveBeenCalled();
  });
  it('exige JSON e chave idempotente válidos e não oferece mutações operacionais públicas', async () => {
    await expect(call(path, 'POST', await input(), '')).rejects.toMatchObject({ status: 422 });
    await expect(call(path, 'POST', null)).rejects.toMatchObject({ status: 422 });
    await expect(call(path, 'PATCH', {})).rejects.toMatchObject({ status: 405 });
    expect(demo.handles('/team-invites/public/tok-equipe-civil-2026/appointments')).toBe(true);
    expect(demo.handles('/team-invites/public/tok-equipe-civil-2026/appointments/confirm')).toBe(false);
  });
});
