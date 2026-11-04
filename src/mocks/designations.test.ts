import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignationDto, DesignationCoverageDto } from '../shared/contracts/designations';
import { PT_SERVICE_TYPES } from '../shared/lib/service-types';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import type { PermitDemoContext } from './work-permits';
import { makeDesignationsDemo } from './designations';

const actor = (permissions = ['appointments.read', 'appointments.write', 'designations.read']): PermitDemoContext => ({
  user: makeFixtures().users[0],
  workers: makeFixtures().workers,
  permissions,
  checkUnit: () => {},
});

const services = [
  { id: id(210), name: 'Manutenção programada', description: 'demo', templateVersion: 'v1', requirementVersion: 'v1' },
  { id: id(211), name: 'Inspeção de área', description: 'demo', templateVersion: 'v1', requirementVersion: 'v1' },
  ...PT_SERVICE_TYPES,
];
const responsibles = [
  { id: id(25), name: 'Diego Demo · técnico' },
  { id: id(26), name: 'Felipe Demo · bombeiro' },
];

describe('designações operacionais em demonstração', () => {
  let demo: ReturnType<typeof makeDesignationsDemo>;

  beforeEach(() => {
    demo = makeDesignationsDemo({ services, responsibles });
  });

  async function call<T>(path: string, method = 'GET', body?: unknown, revision?: number, context = actor()): Promise<T> {
    const url = new URL(`http://localhost/api/v1${path}`);
    const headers = new Headers();
    if (revision !== undefined) headers.set('If-Match', `"${revision}"`);
    const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as T;
  }

  it('protege consultas por permissão e empresa mesmo com unidade autorizada no payload', async () => {
    await expect(call(`/designations/${id(600)}`, 'GET', undefined, undefined, actor([]))).rejects.toMatchObject({ status: 403 });
    const restricted = actor(); restricted.user.scope.companyIds = [];
    await expect(call(`/designations?unitId=${UNIT_A}`, 'GET', undefined, undefined, restricted)).rejects.toMatchObject({ status: 403 });
    await expect(call(`/designations/${id(600)}`, 'GET', undefined, undefined, restricted)).rejects.toMatchObject({ status: 404 });
    await expect(call(`/designation-coverage?unitId=${UNIT_A}&serviceTypeIds=${id(210)}`, 'GET', undefined, undefined, restricted)).rejects.toMatchObject({ status: 403 });
  });

  it('não altera campos ou histórico quando a edição contém vigência inválida ou serviço duplicado', async () => {
    const current = await call<DesignationDto>(`/designations/${id(600)}`);
    for (const change of [{ serviceTypeIds: [id(211)], validUntil: '1900-01-01' }, { validFrom: '2026-02-31' }, { serviceTypeIds: [id(210), id(210)] }, { notes: 'Notas novas', locationPattern: 42 }]) {
      await expect(call(`/designations/${current.id}`, 'PATCH', change, current.revision)).rejects.toMatchObject({ status: 422 });
      expect(await call(`/designations/${current.id}`)).toEqual(current);
    }
  });

  it('aceita troca de responsável e registra a nova revisão somente após validar todos os campos', async () => {
    const current = await call<DesignationDto>(`/designations/${id(600)}`);
    const updated = await call<DesignationDto>(`/designations/${current.id}`, 'PATCH', { responsibleId: id(26), notes: 'Troca registrada na demonstração.' }, current.revision);
    expect(updated.responsibleId).toBe(id(26));
    expect(updated.responsibleName).toBe('Felipe Demo · bombeiro');
    expect(updated.revision).toBe(current.revision + 1);
    expect(updated.history.at(-1)?.action).toBe('DESIGNATION_UPDATED');
  });

  it('rejeita configuração restrita antes de ler o corpo da requisição', async () => {
    const restricted = actor(); restricted.user.scope.teamIds = [id(200)];
    const url = new URL(`http://localhost/api/v1/designations?unitId=${UNIT_A}`);
    const request = new Request(url, { method: 'POST' });
    const reader = vi.fn(); Object.defineProperty(request, 'json', { value: reader });
    await expect(demo.route(request, url, '/designations', restricted)).rejects.toMatchObject({ status: 403 });
    expect(reader).not.toHaveBeenCalled();
  });

  it('apenas uma revogação vence quando dois corpos chegam com a mesma revisão', async () => {
    const current = await call<DesignationDto>(`/designations/${id(600)}`);
    const path = `/designations/${current.id}/revoke`;
    const paused = (reason: string) => {
      let resume!: () => void;
      const payload = new Promise<unknown>(resolve => { resume = () => resolve({ reason }); });
      const url = new URL(`http://localhost/api/v1${path}`);
      const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${current.revision}"` } });
      Object.defineProperty(request, 'json', { value: () => payload });
      return { resume, result: demo.route(request, url, path, actor()) };
    };
    const first = paused('Primeira revogação registrada.');
    const second = paused('Segunda revogação concorrente.');
    const result = Promise.allSettled([first.result, second.result]);
    first.resume(); second.resume();
    const settled = await result;
    expect(settled.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find(value => value.status === 'rejected')).toMatchObject({ reason: { status: 412, code: 'REVISION_CONFLICT' } });
    const saved = await call<DesignationDto>(`/designations/${current.id}`);
    expect(saved.history.filter(entry => entry.action === 'DESIGNATION_REVOKED')).toHaveLength(1);
    expect(saved.revision).toBe(current.revision + 1);
  });

  it('reconfere a concessão de acesso após aguardar o motivo da revogação', async () => {
    const current = await call<DesignationDto>(`/designations/${id(600)}`);
    const context = actor();
    let resume!: () => void;
    const payload = new Promise<unknown>(resolve => { resume = () => resolve({ reason: 'Revogação em trânsito.' }); });
    const path = `/designations/${current.id}/revoke`;
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${current.revision}"` } });
    Object.defineProperty(request, 'json', { value: () => payload });
    const pending = demo.route(request, url, path, context);
    context.user.scope.companyIds = [];
    const rejected = expect(pending).rejects.toMatchObject({ status: 403 });
    resume(); await rejected;
    expect(await call(`/designations/${current.id}`)).toEqual(current);
  });

  it('lista as designações com isolamento de unidade e filtros de situação', async () => {
    const all = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}`);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every(d => d.unitId === UNIT_A)).toBe(true);

    const activeOnly = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}&status=ACTIVE`);
    expect(activeOnly.every(d => d.status === 'ACTIVE')).toBe(true);

    const revokedOnly = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}&status=REVOKED`);
    expect(revokedOnly.every(d => d.status === 'REVOKED')).toBe(true);
    expect(revokedOnly.length).toBeGreaterThanOrEqual(1);
  });

  it('cria uma nova designação validando campos obrigatórios e vigência', async () => {
    const payload = {
      responsibleId: id(25),
      serviceTypeIds: [id(210), PT_SERVICE_TYPES[0].id],
      locationPattern: 'Setor Norte',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      notes: 'Designação para ensaios.',
    };

    const created = await call<DesignationDto>(`/designations?unitId=${UNIT_A}`, 'POST', payload);
    expect(created.id).toBeDefined();
    expect(created.status).toBe('ACTIVE');
    expect(created.serviceNames).toEqual(['Manutenção programada', PT_SERVICE_TYPES[0].name]);
    expect(created.revision).toBe(1);
    expect(created.history[0].action).toBe('DESIGNATION_CREATED');

    // Validação de intervalo invertido
    await expect(call(`/designations?unitId=${UNIT_A}`, 'POST', {
      ...payload,
      validFrom: '2026-12-31',
      validUntil: '2026-01-01',
    })).rejects.toMatchObject({ status: 422 });

    // Validação de serviços vazios
    await expect(call(`/designations?unitId=${UNIT_A}`, 'POST', {
      ...payload,
      serviceTypeIds: [],
    })).rejects.toMatchObject({ status: 422 });
  });

  it('revoga uma designação com motivo e protege contra conflito de revisão', async () => {
    const list = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}&status=ACTIVE`);
    const target = list[0];

    // Sem If-Match
    await expect(call(`/designations/${target.id}/revoke`, 'POST', { reason: 'Revogação para teste.' }))
      .rejects.toMatchObject({ status: 428 });

    // Com If-Match desatualizado
    await expect(call(`/designations/${target.id}/revoke`, 'POST', { reason: 'Revogação para teste.' }, target.revision + 99))
      .rejects.toMatchObject({ status: 412 });

    // Revogação bem-sucedida
    const revoked = await call<DesignationDto>(
      `/designations/${target.id}/revoke`,
      'POST',
      { reason: 'Término de atribuição operacional.' },
      target.revision,
    );
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revocationReason).toBe('Término de atribuição operacional.');
    expect(revoked.revision).toBe(target.revision + 1);
    expect(revoked.history.some(e => e.action === 'DESIGNATION_REVOKED')).toBe(true);

    // Tentativa de revogar novamente
    await expect(call(`/designations/${target.id}/revoke`, 'POST', { reason: 'Outro motivo.' }, revoked.revision))
      .rejects.toMatchObject({ status: 409 });
  });

  it('consulta cobertura por serviço e calcula operationalWindowEnd', async () => {
    const servicesToQuery = [id(210), PT_SERVICE_TYPES[0].id];
    const coverage = await call<DesignationCoverageDto>(
      `/designation-coverage?unitId=${UNIT_A}&serviceTypeIds=${servicesToQuery.join(',')}&location=Área Geral`,
    );

    expect(coverage.unitId).toBe(UNIT_A);
    expect(coverage.items).toHaveLength(2);
    expect(coverage.fullyCovered).toBe(true);
    expect(coverage.operationalWindowEnd).toBeDefined();

    // Consulta de serviço sem designação para Felipe no UNIT_A
    const heightServiceId = PT_SERVICE_TYPES[0].id;
    const felipeCoverage = await call<DesignationCoverageDto>(
      `/designation-coverage?unitId=${UNIT_A}&serviceTypeIds=${heightServiceId}&responsibleId=${id(26)}`,
    );
    // Felipe tem designação expirada (seed 604) no UNIT_A para altura
    expect(felipeCoverage.fullyCovered).toBe(false);
    expect(felipeCoverage.items[0].covered).toBe(false);
    expect(felipeCoverage.items[0].expired).toBe(true);
  });

  it('respeita o filtro de local/alcance locationPattern', async () => {
    // Cria designação restrita a "Subestação"
    const restricted = await call<DesignationDto>(`/designations?unitId=${UNIT_A}`, 'POST', {
      responsibleId: id(26),
      serviceTypeIds: [id(211)],
      locationPattern: 'Subestação',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
    });

    // Local compatível
    const match = await call<DesignationCoverageDto>(
      `/designation-coverage?unitId=${UNIT_A}&serviceTypeIds=${id(211)}&location=Subestação Principal&responsibleId=${id(26)}`,
    );
    expect(match.items.find(i => i.serviceTypeId === id(211))?.covered).toBe(true);

    // Local incompatível (se nenhuma outra cobrir)
    const noMatch = await call<DesignationCoverageDto>(
      `/designation-coverage?unitId=${UNIT_A}&serviceTypeIds=${id(210)}&location=Refeitório&responsibleId=${id(26)}`,
    );
    expect(noMatch.items.find(i => i.serviceTypeId === id(210))?.covered).toBe(false);
  });

  it('rejeita ações sem permissão ou em unidade fora do alcance', async () => {
    const unprivileged = actor([]);
    await expect(call(`/designations?unitId=${UNIT_A}`, 'GET', undefined, undefined, unprivileged))
      .rejects.toMatchObject({ status: 403 });

    const outsideScope = actor();
    outsideScope.user.scope.unitIds = ['outra-unidade'];
    await expect(call(`/designations?unitId=${UNIT_A}`, 'GET', undefined, undefined, outsideScope))
      .rejects.toMatchObject({ status: 403 });
  });
});
