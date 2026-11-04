import { beforeEach, describe, expect, it } from 'vitest';
import { AT_CHECKS, AT_CONTROLS, AT_SOURCE, createAuthorizationClosingChecks, createAuthorizationPreparation } from '../features/authorizations/model';
import type { AuthorizationOptionsDto, AuthorizationPreparationDto, WorkAuthorizationDto } from '../shared/contracts/work-authorizations';
import type { RequirementMatrixDto } from '../shared/contracts/requirements';
import type { AppointmentDto, WorkPermitDto } from '../shared/contracts/work-permits';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';

const actor = (manager = false): PermitDemoContext => ({
  user: { id: id(manager ? 20 : 25), displayName: manager ? 'Marina Demo' : 'Diego Demo', email: 'demo@example.local', roles: [manager ? 'SESMT_MANAGER' : 'TECHNICIAN'], status: 'ACTIVE', mfaRequired: false, revision: 1,
    scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], sectorIds: [], teamIds: [], ownOnly: false } },
  workers: makeFixtures().workers,
  permissions: manager ? ['at.read', 'at.write', 'appointments.read', 'appointments.write', 'permits.read', 'permits.review', 'requirements.read', 'requirements.write', 'eligibility.read']
    : ['at.read', 'at.write', 'at.operate', 'appointments.read', 'permits.read', 'permits.operate', 'eligibility.read'],
  checkUnit: () => {},
});

describe('AT integrada ao atendimento, matriz e PT pela factory da demonstração', () => {
  let demo: ReturnType<typeof makePermitDemo>;
  beforeEach(() => { demo = makePermitDemo(); });

  async function call<T>(path: string, method = 'GET', input?: unknown, context = actor(), revision?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const headers = new Headers();
    if (revision !== undefined) headers.set('If-Match', `"${revision}"`);
    if (input !== undefined) headers.set('Content-Type', 'application/json');
    const request = new Request(url, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as T;
  }
  const appointment = () => call<AppointmentDto>(`/appointments/${id(221)}`);
  const read = (authorizationId: string) => call<WorkAuthorizationDto>(`/work-authorizations/${authorizationId}?unitId=${UNIT_A}`);
  function preparation(value: AppointmentDto): AuthorizationPreparationDto {
    const result = createAuthorizationPreparation(value);
    result.identification = { serviceManagement: 'Gerência Demo', serviceProvider: 'Fornecedor Demo', activityDescription: 'Inspeção fictícia para verificar os registros da demonstração.', workFront: 'Frente Demo', areaManagement: 'Área Demo', riskAnalysisReference: 'AR-DEMO', notes: '' };
    result.controls = [AT_CONTROLS[0].id];
    result.checks = result.checks.map(check => ({ ...check, answer: 'YES', ...(check.id === 'at-check-b24' ? { note: 'Rádio e contato de emergência fictícios definidos.' } : {}) }));
    return result;
  }
  async function create(permitId?: string) {
    const value = await appointment();
    return call<WorkAuthorizationDto>(`/work-authorizations?unitId=${UNIT_A}`, 'POST', { appointmentId: value.id, ...preparation(value), permitId });
  }
  function representations(value: WorkAuthorizationDto) {
    return { responsibleName: actor().user.displayName, foremanName: value.appointment.participants.find(person => person.workerId === value.preparation.foremanId)!.name, issuerName: 'Emitente Demo', confirmed: true };
  }
  async function authorize(value: WorkAuthorizationDto) {
    for (const person of value.appointment.participants) {
      value = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/sciences`, 'POST', { workerId: person.workerId, declarantName: person.name, method: 'TYPED', representation: person.name, confirmed: true }, actor(), value.revision);
    }
    return call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/authorize`, 'POST', { validUntil: value.appointment.endsAt, representations: representations(value) }, actor(), value.revision);
  }
  function revalidation(value: WorkAuthorizationDto) {
    return { validUntil: value.appointment.endsAt, representations: representations(value), reason: 'Condições fictícias conferidas novamente.', sameTeam: true, sameConditions: true };
  }
  async function close(value: WorkAuthorizationDto) {
    return call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/close`, 'POST', { summary: 'Encerramento fictício dos registros desta autorização.', checks: createAuthorizationClosingChecks().map(check => ({ ...check, answer: 'YES' })), representations: representations(value) }, actor(), value.revision);
  }

  it('encaminha opções, criação e consulta, conservando fonte canônica e contexto do atendimento', async () => {
    expect(demo.handles('/authorization-options')).toBe(true);
    expect(demo.handles('/work-authorizations')).toBe(true);
    const options = await call<AuthorizationOptionsDto>(`/authorization-options?unitId=${UNIT_A}`);
    expect(options.appointments.some(option => option.appointment.id === id(221))).toBe(true);
    const before = await appointment();
    const input = preparation(before);
    input.checks[0] = { ...input.checks[0], label: 'Pergunta forjada', sourceCell: 'Fonte forjada', section: 'Outra seção' };
    const value = await call<WorkAuthorizationDto>(`/work-authorizations?unitId=${UNIT_A}`, 'POST', { appointmentId: before.id, ...input });
    expect(value).toMatchObject({ sourceId: AT_SOURCE.sourceId, sourceRevision: AT_SOURCE.sourceRevision, sourceSha256: AT_SOURCE.sourceSha256, status: 'DRAFT', revision: 1, eligibility: { eligible: true, requirementVersion: 'DEMO-MATRIZ-1' } });
    expect(value.preparation.checks[0]).toMatchObject({ label: AT_CHECKS[0].label, section: AT_CHECKS[0].section, sourceCell: AT_CHECKS[0].sourceCell });
    expect(value.permitId).toBeUndefined();
    expect((await call<WorkAuthorizationDto[]>(`/work-authorizations?unitId=${UNIT_A}`)).map(record => record.id)).toEqual([value.id]);
    expect(await read(value.id)).toMatchObject({ id: value.id, sourceSha256: value.sourceSha256, appointment: value.appointment, preparation: value.preparation, revision: value.revision });
    expect(await appointment()).toEqual(before);
    await expect(call(`/work-authorizations/${value.id}?unitId=${UNIT_B}`)).rejects.toMatchObject({ status: 404 });
  });

  it('publicação da matriz bloqueia nova rodada, preserva autorização anterior e permite registrar encerramento', async () => {
    const value = await authorize(await create());
    const originalRelease = structuredClone(value.releases[0]);
    const matrix = await call<RequirementMatrixDto>(`/requirement-matrix?unitId=${UNIT_A}`, 'GET', undefined, actor(true));
    const draft = await call<RequirementMatrixDto>(`/requirement-matrix/draft?unitId=${UNIT_A}`, 'PATCH', { rules: matrix.published.rules.map(rule => rule.id === id(240) ? { ...rule, label: 'Capacitação administrativa atualizada (demo)' } : rule) }, actor(true), matrix.revision);
    await call(`/requirement-matrix/publish?unitId=${UNIT_A}`, 'POST', { reason: 'Publicação fictícia para conferir a independência entre versões.' }, actor(true), draft.revision);
    const current = await read(value.id);
    expect(current.eligibility).toMatchObject({ eligible: false, requirementVersion: 'DEMO-MATRIZ-2' });
    expect(current.releases).toEqual([originalRelease]);
    await expect(call(`/work-authorizations/${value.id}/revalidate`, 'POST', revalidation(value), actor(), value.revision)).rejects.toMatchObject({ status: 409, code: 'DOCUMENTARY_BLOCK' });
    expect((await read(value.id)).revision).toBe(value.revision);
    const closed = await close(current);
    expect(closed.status).toBe('CLOSED');
    expect(closed.eligibility).toMatchObject({ eligible: false, requirementVersion: 'DEMO-MATRIZ-2' });
    expect(closed.releases).toEqual([originalRelease]);
    const nextMatrix = await call<RequirementMatrixDto>(`/requirement-matrix?unitId=${UNIT_A}`, 'GET', undefined, actor(true));
    const nextDraft = await call<RequirementMatrixDto>(`/requirement-matrix/draft?unitId=${UNIT_A}`, 'PATCH', { rules: nextMatrix.published.rules.map(rule => rule.restricted ? { ...rule, label: `${rule.label} — versão posterior (demo)` } : rule) }, actor(true), nextMatrix.revision);
    await call(`/requirement-matrix/publish?unitId=${UNIT_A}`, 'POST', { reason: 'Nova publicação fictícia após o encerramento do registro.' }, actor(true), nextDraft.revision);
    const afterPublication = await read(value.id);
    expect(afterPublication.eligibility).toEqual(closed.eligibility);
    expect(afterPublication.releases).toEqual([originalRelease]);
  });

  it('duas gravações com o mesmo If-Match não sobrescrevem a alteração confirmada', async () => {
    const value = await create();
    function deferredUpdate(description: string) {
      let resume!: () => void;
      const input = { ...value.preparation, identification: { ...value.preparation.identification, activityDescription: description } };
      const pending = new Promise<unknown>(resolve => { resume = () => resolve(input); });
      const url = new URL(`http://localhost/api/v1/work-authorizations/${value.id}?unitId=${UNIT_A}`);
      const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': `"${value.revision}"` } });
      Object.defineProperty(request, 'json', { value: () => pending });
      return { resume, result: demo.route(request, url, url.pathname.replace('/api/v1', ''), actor()) };
    }
    const first = deferredUpdate('Primeira descrição fictícia confirmada.');
    const second = deferredUpdate('Segunda descrição fictícia em conflito.');
    const conflict = expect(second.result).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
    first.resume();
    const saved = await first.result as WorkAuthorizationDto;
    second.resume();
    await conflict;
    const current = await read(value.id);
    expect(current.revision).toBe(value.revision + 1);
    expect(current.preparation.identification.activityDescription).toBe(saved.preparation.identification.activityDescription);
    expect(current.history.filter(event => event.action === 'AUTHORIZATION_UPDATED')).toHaveLength(1);
  });

  it('vínculo opcional e ações da AT preservam o estado, ciências e histórico próprios da PT', async () => {
    const scheduled = await appointment();
    const permit = await call<WorkPermitDto>(`/appointments/${scheduled.id}/open-permit`, 'POST', {}, actor(), scheduled.revision);
    const before = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    const options = await call<AuthorizationOptionsDto>(`/authorization-options?unitId=${UNIT_A}`);
    expect(options.appointments.find(option => option.appointment.id === scheduled.id)?.permits).toEqual([{ id: before.id, code: before.code }]);
    let value = await authorize(await create(before.id));
    expect(value).toMatchObject({ permitId: before.id, permitCode: before.code });
    value = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/revalidate`, 'POST', revalidation(value), actor(), value.revision);
    value = await close(value);
    expect(value.status).toBe('CLOSED');
    const after = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    // A consulta refaz a data de elegibilidade; isso não é uma mutação da PT.
    expect({ ...after, eligibility: undefined }).toEqual({ ...before, eligibility: undefined });
    expect({ ...after.eligibility, checkedAt: undefined }).toEqual({ ...before.eligibility, checkedAt: undefined });
    expect(after.operationStatus).toBe('VERIFICATION');
    expect(after.sciences).toEqual([]);
    expect(after.snapshots).toEqual([]);
    expect((await appointment()).status).toBe('ATTENDANCE_OPENED');
  });
});
