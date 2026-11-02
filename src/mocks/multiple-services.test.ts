import { beforeEach, describe, expect, it } from 'vitest';
import type { ServiceCatalogDto, ServiceTemplateDto } from '../shared/contracts/service-templates';
import type { AppointmentDto, AppointmentWriteDto, EligibilityDto, PermitOptionsDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { DocumentaryReadinessDto } from '../shared/contracts/requirements';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';

const actor = (operator = false): PermitDemoContext => ({
  user: { id: id(operator ? 25 : 20), displayName: operator ? 'Diego Demo' : 'Marina Demo', email: 'demo@example.local', roles: [], status: 'ACTIVE', mfaRequired: false, revision: 1, scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], teamIds: [], sectorIds: [], ownOnly: false } },
  permissions: operator ? ['appointments.read', 'permits.read', 'permits.operate', 'eligibility.read'] : ['appointments.read', 'appointments.write', 'requirements.read', 'requirements.write', 'eligibility.read', 'permits.read', 'permits.review'],
  workers: makeFixtures().workers, checkUnit: () => {},
});
const hot = id(511), confined = id(513);
describe('agenda composta, templates fixos e união documental', () => {
  let demo: ReturnType<typeof makePermitDemo>;
  beforeEach(() => { demo = makePermitDemo(); });
  async function call<T>(path: string, method = 'GET', input?: unknown, context = actor(), revision?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: input === undefined ? undefined : JSON.stringify(input) });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as T;
  }
  function input(serviceTypeIds = [hot, confined], workerIds = [40]): AppointmentWriteDto {
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    return { unitId: UNIT_A, teamId: id(200), serviceTypeId: serviceTypeIds[0], serviceTypeIds, location: 'Frente de teste fictícia', startsAt: `${day}T09:00:00-03:00`, endsAt: `${day}T10:00:00-03:00`, responsibleId: id(25), participants: workerIds.map(worker => ({ workerId: id(worker), name: worker === 40 ? 'Camila Demo' : 'Bruno Demo', serviceFunction: 'Executante' })) };
  }
  async function open(serviceIds = [hot, confined], workerIds = [40]) {
    let appointment = await call<AppointmentDto>('/appointments', 'POST', input(serviceIds, workerIds));
    appointment = await call<AppointmentDto>(`/appointments/${appointment.id}/confirm`, 'POST', {}, actor(), appointment.revision);
    return call<WorkPermitDto>(`/appointments/${appointment.id}/open-permit`, 'POST', {}, actor(true), appointment.revision);
  }
  async function prepare(permit: WorkPermitDto, answer: 'YES' | 'NO' = 'YES') {
    const preparation = permit.preparation!;
    preparation.identification = { ...preparation.identification, serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', activityDescription: 'Atividade fictícia para validar o conjunto de serviços.', riskAnalysisReference: 'AR-DEMO' };
    preparation.checks = preparation.checks.map(item => ({ ...item, answer: preparation.activities.includes(item.section) ? 'YES' : null }));
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/preparation`, 'PATCH', preparation, actor(true), permit.revision);
    return call<WorkPermitDto>(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, answer, ...(answer === 'NO' ? { note: 'Condição impeditiva ausente no cenário fictício.' } : {}) })) }, actor(true), permit.revision);
  }
  const catalog = () => call<ServiceCatalogDto>(`/service-templates?unitId=${UNIT_A}`);
  async function publish(serviceId = hot, invert = false) {
    const current = (await catalog()).templates.find(template => template.service.id === serviceId)!;
    const draft = await call<ServiceTemplateDto>(`/service-templates/${serviceId}/draft?unitId=${UNIT_A}`, 'PATCH', { questions: current.published.questions.map(question => ({ ...question, label: `Pergunta publicada novamente: ${question.label}`, ...(invert ? { blockingAnswers: ['YES'] } : {}) })) }, actor(), current.revision);
    return call<ServiceTemplateDto>(`/service-templates/${serviceId}/publish?unitId=${UNIT_A}`, 'POST', { reason: 'Publicação demonstrativa para verificar preservação das PTs.' }, actor(), draft.revision);
  }
  it.each([[], [hot, hot], [hot, id(999)]].map(selected => ({ selected })))('rejeita seleção inválida $selected sem criar agendamento', async ({ selected }) => {
    await expect(call('/appointments', 'POST', { ...input(), serviceTypeIds: selected })).rejects.toMatchObject({ status: 422, field: 'serviceTypeIds' });
    expect(await call<AppointmentDto[]>('/appointments')).toHaveLength(5);
  });
  it('rejeita principal divergente e aceita registros escritos no contrato legado', async () => {
    await expect(call('/appointments', 'POST', { ...input(), serviceTypeId: confined })).rejects.toMatchObject({ status: 422, field: 'serviceTypeId' });
    const legacy = await call<AppointmentDto>('/appointments', 'POST', { ...input([id(210)]), serviceTypeIds: undefined });
    expect(legacy.serviceTypeIds).toEqual([id(210)]);
  });
  it('reúne requisitos de quente e espaço confinado para cada participante, incluindo pendência no primeiro serviço', async () => {
    const permit = await open([hot, confined], [40, 41]);
    expect(permit.appointment.serviceTypeIds).toEqual([hot, confined]);
    expect(permit.appointment.serviceLabel).toBe('Trabalho a quente + Espaço confinado');
    expect(permit.serviceTemplates?.map(template => template.serviceTypeId)).toEqual([hot, confined]);
    expect(permit.checklist).toHaveLength(4);
    expect(permit.preparation?.requiredActivities).toEqual(['hot-work', 'confined-space']);
    const eligibility = await call<EligibilityDto>(`/appointments/${permit.appointment.id}/eligibility`);
    expect(eligibility.participants.map(person => person.items.map(item => item.requirementId))).toEqual([[id(521), id(523)], [id(521), id(523)]]);
    expect(eligibility.participants[1].items.map(item => item.status)).toEqual(['PENDING', 'APPROVED']);
    expect(eligibility.eligible).toBe(false);
    const row = (await call<DocumentaryReadinessDto>(`/documentary-readiness?unitId=${UNIT_A}`)).rows.find(row => row.appointmentId === permit.appointment.id)!;
    expect(row.serviceTypeIds).toEqual([hot, confined]);
    expect(row.services).toEqual([{ id: hot, name: 'Trabalho a quente' }, { id: confined, name: 'Espaço confinado' }]);
  });
  it('não permite remover o serviço vinculado nem substituir bloqueadores enviados no checklist', async () => {
    let permit = await open();
    await expect(call(`/work-permits/${permit.id}/preparation`, 'PATCH', { ...permit.preparation, activities: ['hot-work'], requiredActivities: ['hot-work'] }, actor(true), permit.revision)).rejects.toMatchObject({ status: 422 });
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, required: false, blockingAnswers: [], serviceName: 'Serviço substituído', answer: 'NO', note: 'Condição não atendida.' })) }, actor(true), permit.revision);
    expect(permit.checklist.every(item => item.required && item.blockingAnswers?.[0] === 'NO')).toBe(true);
    expect(permit.checklist[0].serviceName).toBe('Trabalho a quente');
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, actor(true), permit.revision)).rejects.toMatchObject({ status: 409 });
  });
  it('revalida a pendência do segundo serviço ao liberar, mesmo com preparação, checklist e todas as ciências completas', async () => {
    let permit = await prepare(await open([confined, hot], [40, 41]));
    for (const participant of permit.appointment.participants) permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: participant.workerId, declarantName: participant.name, method: 'TYPED', representation: participant.name, confirmed: true }, actor(true), permit.revision);
    expect(permit.sciences).toHaveLength(2);
    expect(permit.availableActions).not.toContain('RELEASE');
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, actor(true), permit.revision)).rejects.toMatchObject({ status: 409, code: 'DOCUMENTARY_BLOCK' });
    expect((await call<WorkPermitDto>(`/work-permits/${permit.id}`, 'GET', undefined, actor(true))).operationStatus).toBe('VERIFICATION');
  });
  it('publicação atualiza opções e próximas PTs sem alterar os templates da PT aberta, encerramento ou correção', async () => {
    let permit = await prepare(await open());
    const original = structuredClone(permit.serviceTemplates);
    const published = await publish();
    expect((await call<PermitOptionsDto>(`/permit-options?unitId=${UNIT_A}`)).services.find(service => service.id === hot)?.templateVersion).toBe(published.published.version);
    expect((await call<WorkPermitDto>(`/work-permits/${permit.id}`, 'GET', undefined, actor(true))).serviceTemplates).toEqual(original);
    const next = await open();
    expect(next.serviceTemplates?.[0].version).toBe(published.published.version);
    expect(next.serviceTemplates?.[1].version).toBe(original?.[1].version);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, actor(true), permit.revision);
    const closingChecks = permit.preparation!.closingChecks.map(item => ({ ...item, answer: 'YES' }));
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/complete`, 'POST', { summary: 'Conclusão fictícia da atividade composta.', closingChecks }, actor(true), permit.revision);
    expect(permit.snapshots[0].serviceTemplates).toEqual(original);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/review`, 'POST', { decision: 'RETURN', comment: 'Complementar a conclusão registrada.' }, actor(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/new-version`, 'POST', { reason: 'Complemento documental demonstrativo.' }, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/submit-correction`, 'POST', { summary: 'Conclusão fictícia complementada na correção.', closingChecks }, actor(true), permit.revision);
    expect(permit.serviceTemplates).toEqual(original);
    expect(permit.snapshots.map(snapshot => snapshot.serviceTemplates)).toEqual([original, original]);
  });
  it('pergunta invertida impede ciência quando Sim é bloqueador e aceita Não justificado', async () => {
    await publish(id(512), true);
    let permit = await prepare(await open([id(512)]));
    expect(permit.preparation?.requiredActivities).toEqual([]);
    await expect(call(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, actor(true), permit.revision)).rejects.toMatchObject({ code: 'CHECKLIST_PENDING' });
    permit = await prepare(permit, 'NO');
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, actor(true), permit.revision);
    expect(permit.operationStatus).toBe('RELEASED');
  });
});
