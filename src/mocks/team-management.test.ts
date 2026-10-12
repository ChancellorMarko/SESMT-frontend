import { beforeEach, describe, expect, it } from 'vitest';
import type { TeamDto } from '../shared/contracts/work-permits';
import type { TeamOptionsDto, TeamWriteDto } from '../shared/contracts/teams';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { PermitDemoError, type PermitDemoContext } from './work-permits';
import { createTeamManagement } from './team-management';

const context = (): PermitDemoContext => ({
  user: makeFixtures().users[0], permissions: ['teams.read', 'teams.write'], workers: makeFixtures().workers,
  checkUnit: unit => { if (![UNIT_A, UNIT_B].includes(unit)) throw new PermitDemoError(403, 'FORBIDDEN', 'Unidade fora do escopo.'); },
});
const input = (): TeamWriteDto => ({ name: 'Nova equipe sintética', unitId: UNIT_A, chiefId: id(40), members: [{ workerId: id(40), serviceFunction: 'Executante' }, { workerId: id(41), serviceFunction: 'Apoio' }] });
const seeded = (): TeamDto[] => [{ id: id(200), name: 'Equipe sintética existente', companyId: COMPANY, unitId: UNIT_A, chiefId: id(40), members: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }], revision: 1 }];

describe('gestão de equipes no demo', () => {
  let teams: TeamDto[];
  let demo: ReturnType<typeof createTeamManagement>;
  beforeEach(() => { teams = seeded(); demo = createTeamManagement(teams); });
  async function call<T>(path: string, method = 'GET', body?: unknown, actor = context(), revision?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), actor) as T;
  }
  it('lista opções mínimas somente de trabalhadores ativos da unidade e mantém GET /teams no mock principal', async () => {
    const options = await call<TeamOptionsDto>(`/team-options?unitId=${UNIT_A}`);
    expect(options.workers.map(worker => worker.name)).toEqual(['Camila Demo', 'Bruno Demo', 'Julia Demo', 'Pedro Demo', 'Gabriel Demo']);
    expect(Object.keys(options.workers[0]).sort()).toEqual(['companyId', 'id', 'name', 'unitId']);
    expect(await call('/teams')).toBeUndefined();
    await expect(call('/team-options')).rejects.toMatchObject({ status: 422, field: 'unitId' });
  });
  it('cria cadastro com nomes e empresa derivados do cadastro e revisão do servidor', async () => {
    const saved = await call<TeamDto>('/teams', 'POST', input());
    expect(saved).toMatchObject({ companyId: COMPANY, revision: 1, chiefId: id(40), members: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }, { workerId: id(41), name: 'Bruno Demo', serviceFunction: 'Apoio' }] });
    expect(teams).toHaveLength(2);
    expect(await call(`/teams/${saved.id}`)).toEqual(saved);
    saved.members[0].name = 'Alteração de DTO no cliente';
    expect(teams[1].members[0].name).toBe('Camila Demo');
  });
  it('substitui composição atual sem alterar objetos anteriores usados em agendamentos e PTs', async () => {
    const previous = teams[0];
    const saved = await call<TeamDto>(`/teams/${previous.id}`, 'PATCH', input(), context(), 1);
    expect(saved.revision).toBe(2);
    expect(saved.members).toHaveLength(2);
    expect(teams[0]).toEqual(saved);
    expect(previous.name).toBe('Equipe sintética existente');
    expect(previous.members).toEqual([{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }]);
  });
  it('exige revisão e não altera o registro diante de conflito', async () => {
    await expect(call(`/teams/${id(200)}`, 'PATCH', input())).rejects.toMatchObject({ status: 428, code: 'PRECONDITION_REQUIRED' });
    await expect(call(`/teams/${id(200)}`, 'PATCH', input(), context(), 0)).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
    expect(teams).toEqual(seeded());
  });
  it('reconfere revisão após leitura assíncrona do corpo para não perder alteração concorrente', async () => {
    let resolveBody!: (value: TeamWriteDto) => void;
    const pendingBody = new Promise<TeamWriteDto>(resolve => { resolveBody = resolve; });
    const url = new URL(`http://localhost/api/v1/teams/${id(200)}`);
    const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': '"1"' } });
    Object.defineProperty(request, 'json', { value: () => pendingBody });
    const pendingSave = demo.route(request, url, `/teams/${id(200)}`, context());
    const concurrent = await call<TeamDto>(`/teams/${id(200)}`, 'PATCH', { ...input(), name: 'Alteração concorrente' }, context(), 1);
    resolveBody(input());
    await expect(pendingSave).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
    expect(teams[0]).toEqual(concurrent);
    expect(teams[0].revision).toBe(2);
  });
  it('exige permissões diferentes de leitura e escrita', async () => {
    const actor = context(); actor.permissions = ['teams.read'];
    await expect(call('/teams', 'POST', input(), actor)).rejects.toMatchObject({ status: 403 });
    actor.permissions = ['teams.write'];
    await expect(call(`/teams/${id(200)}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: 403 });
    await expect(call(`/team-options?unitId=${UNIT_A}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: 403 });
  });
  it('não deixa concessão restrita ampliar cadastro nem consultar equipe fora dela', async () => {
    const actor = context(); actor.user.scope.teamIds = [id(201)];
    await expect(call(`/teams/${id(200)}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: 404 });
    await expect(call('/teams', 'POST', input(), actor)).rejects.toMatchObject({ status: 403 });
    expect((await call<TeamOptionsDto>(`/team-options?unitId=${UNIT_A}`, 'GET', undefined, actor)).workers).toEqual([]);
    actor.user.scope.teamIds = [id(200)];
    expect((await call<TeamOptionsDto>(`/team-options?unitId=${UNIT_A}`, 'GET', undefined, actor)).workers.map(worker => worker.id)).toEqual([id(40)]);
  });
  it('isola empresa, unidade e acesso individual', async () => {
    const actor = context(); actor.user.scope.companyIds = [id(999)];
    await expect(call(`/teams/${id(200)}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: 404 });
    actor.user.scope.companyIds = [COMPANY]; actor.user.scope.unitIds = [UNIT_B];
    await expect(call(`/teams/${id(200)}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: 404 });
    await expect(call('/teams', 'POST', input(), actor)).rejects.toMatchObject({ status: 403 });
    actor.user.scope.ownOnly = true;
    await expect(call(`/team-options?unitId=${UNIT_B}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: 403 });
  });
  it('rejeita afastados, unidade incoerente, membros repetidos e chefe que não participa', async () => {
    for (const workerId of [id(44), id(46), id(999)]) await expect(call('/teams', 'POST', { ...input(), members: [{ workerId, serviceFunction: 'Executante' }], chiefId: workerId })).rejects.toMatchObject({ status: 422, code: 'INVALID_ASSIGNMENT' });
    await expect(call('/teams', 'POST', { ...input(), chiefId: id(42) })).rejects.toMatchObject({ status: 422, field: 'chiefId' });
    await expect(call('/teams', 'POST', { ...input(), members: [input().members[0], input().members[0]] })).rejects.toMatchObject({ status: 422, field: 'members.1.workerId' });
    expect(teams).toEqual(seeded());
  });
  it('rejeita empresa incoerente e adulteração de campos de servidor', async () => {
    const actor = context(); actor.workers[1].companyId = id(999); actor.user.scope.companyIds.push(id(999));
    await expect(call('/teams', 'POST', input(), actor)).rejects.toMatchObject({ status: 422, code: 'INVALID_ASSIGNMENT' });
    await expect(call('/teams', 'POST', { ...input(), companyId: id(999), revision: 777 })).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    await expect(call('/teams', 'POST', { ...input(), members: [{ ...input().members[0], name: 'Nome falso' }] })).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
  });
  it('bloqueia mudança de unidade e duplicidade de nome normalizado', async () => {
    await expect(call(`/teams/${id(200)}`, 'PATCH', { ...input(), unitId: UNIT_B }, context(), 1)).rejects.toMatchObject({ status: 422, field: 'unitId' });
    await expect(call('/teams', 'POST', { ...input(), name: ' EQUIPE  SINTETICA EXISTENTE ' })).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_TEAM', field: 'name' });
    expect(teams).toEqual(seeded());
  });
  it('trata JSON nulo e estruturas inválidas como validação sem alterar cadastro', async () => {
    for (const value of [null, [], 12, 'texto', {}, { ...input(), members: [null] }, { ...input(), name: 'A'.repeat(121) }]) {
      await expect(call('/teams', 'POST', value)).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
      expect(teams).toEqual(seeded());
    }
    const url = new URL('http://localhost/api/v1/teams');
    const request = new Request(url, { method: 'POST', body: '{json inválido' });
    await expect(demo.route(request, url, '/teams', context())).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
    expect(teams).toEqual(seeded());
  });
});
