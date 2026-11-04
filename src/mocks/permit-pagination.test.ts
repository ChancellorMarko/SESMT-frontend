import { beforeEach, describe, expect, it } from 'vitest';
import type { PageDto } from '../shared/contracts';
import type { AppointmentDto, WorkPermitDto } from '../shared/contracts/work-permits';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';

const actor = (): PermitDemoContext => ({
  user: { id: id(25), displayName: 'Operador de teste', email: 'teste@example.local', roles: [], status: 'ACTIVE', mfaRequired: false, revision: 1, scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], sectorIds: [], teamIds: [], ownOnly: false } },
  permissions: ['appointments.read', 'appointments.write', 'permits.read', 'permits.operate', 'permits.review'], workers: makeFixtures().workers,
  checkUnit: unit => { if (![UNIT_A, UNIT_B].includes(unit)) throw new Error('Unidade fora do alcance'); },
});

describe('consulta paginada de PTs na simulação', () => {
  let demo: ReturnType<typeof makePermitDemo>;
  beforeEach(() => { demo = makePermitDemo(); });
  async function call<T>(path: string, method = 'GET', body?: unknown, context = actor(), revision?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { 'Content-Type': 'application/json', ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as T;
  }
  async function createPermit(index: number) {
    const appointment = await call<AppointmentDto>('/appointments', 'POST', {
      unitId: UNIT_A, teamId: id(200), serviceTypeId: id(210), serviceTypeIds: [id(210)], responsibleId: id(25),
      location: `Lote de paginação ${String(index).padStart(2, '0')}`,
      startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(),
      participants: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }],
    });
    const confirmed = await call<AppointmentDto>(`/appointments/${appointment.id}/confirm`, 'POST', {}, actor(), appointment.revision);
    return call<WorkPermitDto>(`/appointments/${appointment.id}/open-permit`, 'POST', {}, actor(), confirmed.revision);
  }
  it('ordena, filtra e conta antes de dividir 25 registros, mantendo a compatibilidade da consulta sem paginação', async () => {
    const created: WorkPermitDto[] = [];
    for (let index = 0; index < 25; index++) created.push(await createPermit(index));
    const query = `unitId=${UNIT_A}&q=Lote%20de%20paginacao&operationStatus=VERIFICATION&reviewStatus=NOT_SUBMITTED&teamId=${id(200)}`;
    const pages: PageDto<WorkPermitDto>[] = [];
    for (const page of [1, 2, 3]) pages.push(await call(`/work-permits?${query}&page=${page}&pageSize=10`));
    expect(pages.map(page => page.items.length)).toEqual([10, 10, 5]);
    expect(pages.map(page => page.total)).toEqual([25, 25, 25]);
    expect(pages.flatMap(page => page.items.map(item => item.id))).toEqual(created.map(item => item.id));
    const repeated = await call<PageDto<WorkPermitDto>>(`/work-permits?${query}&page=2&pageSize=10`);
    expect(repeated).toMatchObject({ total: 25, page: 2, pageSize: 10 });
    expect(repeated.items.map(item => item.id)).toEqual(pages[1].items.map(item => item.id));
    const legacy = await call<WorkPermitDto[]>(`/work-permits?${query}`); expect(legacy.map(item => item.id)).toEqual(created.map(item => item.id));
    const beyond = await call(`/work-permits?${query}&page=4&pageSize=10`); expect(beyond).toMatchObject({ items: [], total: 25, page: 4, pageSize: 10 });
    const otherUnit = await call(`/work-permits?unitId=${UNIT_B}&q=Lote&page=1&pageSize=10`); expect(otherUnit).toMatchObject({ items: [], total: 0 });
    const otherTeam = await call(`/work-permits?unitId=${UNIT_A}&teamId=${id(201)}&page=1&pageSize=10`); expect(otherTeam).toMatchObject({ items: [], total: 0 });
  });
  it('conserva autorização e isolamento antes de informar a contagem', async () => {
    const restricted = actor(); restricted.user.scope.teamIds = [id(201)];
    expect(await call(`/work-permits?unitId=${UNIT_A}&page=1&pageSize=10`, 'GET', undefined, restricted)).toMatchObject({ items: [], total: 0 });
    restricted.permissions = [];
    await expect(call('/work-permits?page=1&pageSize=10', 'GET', undefined, restricted)).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    'page=0', 'page=-1', 'page=01', 'page=1.5', 'page=Infinity', 'page=9007199254740992',
    'page=900719925474099&pageSize=100', 'pageSize=0', 'pageSize=101', 'pageSize=1.5',
    'q=um&q=dois', 'page=1&page=2', 'unitId=', `unitId=${UNIT_A}&unitId=${UNIT_B}`,
    'operationStatus=UNKNOWN', 'reviewStatus=UNKNOWN', 'teamId=a%2Fb', 'unsupported=1', 'q=%00',
    `q=${'a'.repeat(201)}`,
  ])('recusa critérios incompatíveis em vez de ampliar a consulta: %s', async criteria => {
    await expect(call(`/work-permits?${criteria}`)).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' });
  });
});
