import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDto, EligibilityDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { AuthorizationOptionsDto, AuthorizationPreparationDto, WorkAuthorizationDto } from '../shared/contracts/work-authorizations';
import { AT_CONTROLS, AT_SOURCE, createAuthorizationClosingChecks, createAuthorizationPreparation } from '../features/authorizations/model';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { PermitDemoError, type PermitDemoContext } from './work-permits';
import { makeWorkAuthorizationDemo } from './work-authorizations';

const permissions = ['at.read', 'at.write', 'at.operate'];
function context(userId = 25, role = 'TECHNICIAN', access = permissions): PermitDemoContext {
  const workers = makeFixtures().workers;
  return { user: { id: id(userId), displayName: userId === 25 ? 'Diego Demo' : userId === 26 ? 'Felipe Demo' : 'Marina Demo', email: 'demo@example.local', roles: [role], status: 'ACTIVE', mfaRequired: false, revision: 1,
    scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], sectorIds: [], teamIds: [], ownOnly: false } }, permissions: access, workers,
    checkUnit: unit => { if (![UNIT_A, UNIT_B].includes(unit)) throw new PermitDemoError(403, 'FORBIDDEN', 'Unidade fora do alcance.'); } };
}
describe('domínio demonstrativo da AT independente da PT', () => {
  let demo: ReturnType<typeof makeWorkAuthorizationDemo>;
  let appointment: AppointmentDto;
  let permits: WorkPermitDto[];
  let eligible: boolean;
  let requirementVersion: string;
  function eligibility(): EligibilityDto {
    return { unitId: UNIT_A, appointmentId: appointment.id, checkedAt: new Date().toISOString(), requirementVersion, eligible,
      participants: appointment.participants.map(participant => ({ ...participant, eligible, items: [{ requirementId: id(240), label: 'Regra Demo', description: 'Conferência fictícia', status: eligible ? 'APPROVED' : 'PENDING', restricted: false }] })) };
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    appointment = { id: id(600), code: 'AG-DEMO-AT', companyId: COMPANY, unitId: UNIT_A, teamId: id(200), teamName: 'Equipe Demo', serviceTypeId: id(210), serviceLabel: 'Manutenção Demo', location: 'Área Demo',
      startsAt: '2026-10-10T10:00:00Z', endsAt: '2026-10-10T20:00:00Z', responsibleId: id(25), responsibleName: 'Diego Demo · técnico', status: 'CONFIRMED', revision: 1, availableActions: [], history: [],
      participants: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }, { workerId: id(41), name: 'Bruno Demo', serviceFunction: 'Apoio' }] };
    permits = []; eligible = true; requirementVersion = 'DEMO-MATRIZ-1';
    demo = makeWorkAuthorizationDemo({ units: [{ id: UNIT_A, companyId: COMPANY }, { id: UNIT_B, companyId: COMPANY }], appointments: () => [appointment],
      appointmentById: appointmentId => { if (appointmentId !== appointment.id) throw new PermitDemoError(404, 'NOT_FOUND', 'Indisponível.'); return appointment; },
      eligibility, permitById: permitId => { const permit = permits.find(value => value.id === permitId); if (!permit) throw new PermitDemoError(404, 'NOT_FOUND', 'PT indisponível.'); return permit; },
      permitsForAppointment: appointmentId => permits.filter(value => value.appointment.id === appointmentId), knownResponsible: responsibleId => [id(25), id(26)].includes(responsibleId) });
  });
  afterEach(() => { vi.useRealTimers(); });
  function call<T>(path: string, method = 'GET', input?: unknown, actor = context(), rev?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rev !== undefined ? { 'If-Match': `"${rev}"` } : {}) }, body: input !== undefined ? JSON.stringify(input) : undefined });
    return demo.route(request, url, url.pathname.replace('/api/v1', ''), actor) as Promise<T>;
  }
  function preparation(): AuthorizationPreparationDto {
    const value = createAuthorizationPreparation(appointment);
    value.identification = { serviceManagement: 'Gerência Demo', serviceProvider: 'Fornecedor Demo', activityDescription: 'Manutenção fictícia da área compartilhada.', workFront: 'Frente Demo', areaManagement: 'Gerência Área Demo', riskAnalysisReference: 'AR-DEMO-1', notes: '' };
    value.controls = [AT_CONTROLS[0].id];
    value.checks = value.checks.map(item => ({ ...item, answer: item.id === 'at-check-b26' ? 'NO' : 'YES', note: item.id === 'at-check-b24' ? 'Rádio e contato de emergência fictícios definidos.' : item.id === 'at-check-b26' ? 'Não existem atividades simultâneas no cenário demonstrativo.' : undefined }));
    return value;
  }
  function create(input = preparation(), actor = context(), permitId?: string) {
    return call<WorkAuthorizationDto>(`/work-authorizations?unitId=${UNIT_A}`, 'POST', { appointmentId: appointment.id, ...input, permitId }, actor);
  }
  function declared(value: WorkAuthorizationDto) {
    return { responsibleName: '  DIEGO demo  ', foremanName: value.appointment.participants.find(participant => participant.workerId === value.preparation.foremanId)!.name, issuerName: 'Emissor declarado Demo', confirmed: true };
  }
  async function collect(input?: WorkAuthorizationDto) {
    let value = input || await create();
    for (const participant of value.appointment.participants) value = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/sciences`, 'POST', { workerId: participant.workerId, declarantName: participant.name, representation: participant.name, method: 'TYPED', confirmed: true }, context(), value.revision);
    return value;
  }
  async function authorize(input?: WorkAuthorizationDto, validUntil = appointment.endsAt) {
    const value = input || await collect();
    return call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/authorize`, 'POST', { validUntil, representations: declared(value) }, context(), value.revision);
  }
  function hold(path: string, method: string, data: unknown, rev?: number) {
    let resume!: () => void;
    const pendingBody = new Promise<unknown>(resolve => { resume = () => resolve(data); });
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: rev !== undefined ? { 'If-Match': `"${rev}"` } : {} });
    Object.defineProperty(request, 'json', { value: () => pendingBody });
    return { resume, result: demo.route(request, url, url.pathname.replace('/api/v1', ''), context()) };
  }
  it('pagina o conjunto autorizado depois de filtrar e preserva consumidores legados da demonstração', async () => {
    for (let index = 0; index < 26; index++) {
      const value = await create();
      await call(`/work-authorizations/${value.id}/cancel?unitId=${UNIT_A}`, 'POST', { reason: 'Cancelamento sintético para conferir paginação.', confirmed: true }, context(), value.revision);
    }
    const page = await call<{items: WorkAuthorizationDto[]; total: number; page: number; pageSize: number}>(`/work-authorizations?unitId=${UNIT_A}&page=3&pageSize=10&status=CANCELED`);
    expect(page).toMatchObject({ total: 26, page: 3, pageSize: 10 });
    expect(page.items).toHaveLength(6); expect(page.items.map(item => item.code)).toEqual(['AT-DEMO-021', 'AT-DEMO-022', 'AT-DEMO-023', 'AT-DEMO-024', 'AT-DEMO-025', 'AT-DEMO-026']);
    const searched = await call<{items: WorkAuthorizationDto[]; total: number}>(`/work-authorizations?unitId=${UNIT_A}&page=1&pageSize=10&q=AT-DEMO-026&status=CANCELED`);
    expect(searched.total).toBe(1); expect(searched.items[0].code).toBe('AT-DEMO-026');
    const other = await call<{items: WorkAuthorizationDto[]; total: number}>(`/work-authorizations?unitId=${UNIT_B}&page=1&pageSize=10`);
    expect(other.total).toBe(0); expect(other.items).toEqual([]);
    expect(await call<WorkAuthorizationDto[]>(`/work-authorizations?unitId=${UNIT_A}`)).toHaveLength(26);
  });

  it.each(['page=0', 'page=1.5', 'pageSize=101', 'status=UNKNOWN', 'page=1&page=2', 'q=' + 'a'.repeat(201)])('recusa parâmetro inválido de paginação/filtro: %s', async query => {
    await expect(call(`/work-authorizations?unitId=${UNIT_A}&${query}`)).rejects.toMatchObject({ status: 422 });
  });

  it('exige permissão antes de ler o corpo e nunca permite operação por gestor/admin', async () => {
    let read = false;
    const url = new URL(`http://localhost/api/v1/work-authorizations?unitId=${UNIT_A}`);
    const request = new Request(url, { method: 'POST' });
    Object.defineProperty(request, 'json', { value: async () => { read = true; return {}; } });
    await expect(demo.route(request, url, '/work-authorizations', context(20, 'AUDITOR', ['at.read']))).rejects.toMatchObject({ status: 403 });
    expect(read).toBe(false);
    const value = await create(preparation(), context(20, 'SESMT_MANAGER', ['at.read', 'at.write']));
    expect(value.availableActions).toEqual(['EDIT', 'CANCEL']);
    await expect(call(`/work-authorizations/${value.id}/sciences`, 'POST', {}, context(20, 'ADMIN'), value.revision)).rejects.toMatchObject({ code: 'NOT_DESIGNATED' });
  });
  it('oculta atendimento inteiro fora do alcance de empresa/unidade/equipe/setor/responsável', async () => {
    const base = await create();
    for (const [field, data] of [['companyIds', [id(999)]], ['unitIds', [UNIT_B]], ['teamIds', [id(201)]], ['sectorIds', [id(6)]], ['ownOnly', true]] as const) {
      const actor = context(); Object.assign(actor.user.scope, { [field]: data });
      await expect(call(`/work-authorizations/${base.id}`, 'GET', undefined, actor)).rejects.toMatchObject({ status: field === 'ownOnly' ? 403 : 404 });
    }
    const firefighter = context(26, 'FIREFIGHTER');
    expect(await call<WorkAuthorizationDto[]>(`/work-authorizations?unitId=${UNIT_A}`, 'GET', undefined, firefighter)).toEqual([]);
    const limited = context(20, 'AUDITOR', ['at.read']); limited.user.scope.sectorIds = [id(6)];
    expect(await call<WorkAuthorizationDto[]>(`/work-authorizations?unitId=${UNIT_A}`, 'GET', undefined, limited)).toEqual([]);
  });
  it('clona o contexto, guarda catálogo canônico e impede duplicidade concorrente por atendimento', async () => {
    const forged = { ...preparation(), sourceId: 'FALSO', sourceRevision: '99', sourceSha256: '0', checks: preparation().checks.map(item => ({ ...item, label: 'Adulterado', section: 'outro', sourceCell: 'A1' })) };
    const pending = hold(`/work-authorizations?unitId=${UNIT_A}`, 'POST', { ...forged, appointmentId: appointment.id });
    const current = await create(forged);
    const rejected = expect(pending.result).rejects.toMatchObject({ code: 'AUTHORIZATION_ALREADY_OPEN' }); pending.resume(); await rejected;
    expect(current.sourceId).toBe(AT_SOURCE.sourceId); expect(current.sourceSha256).toBe(AT_SOURCE.sourceSha256);
    expect(current.preparation.checks[0].label).toBe(AT_SOURCE.checks[0].label); expect(current.preparation.checks[0].sourceCell).toBe(AT_SOURCE.checks[0].sourceCell);
    appointment.location = 'Local alterado'; expect(current.appointment.location).toBe('Área Demo');
  });
  it('ciência canônica separa declarante e coletor e congela edição, inclusive corpo atrasado', async () => {
    const value = await create();
    await expect(call(`/work-authorizations/${value.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Outra Pessoa Demo', representation: 'Camila Demo', method: 'TYPED', confirmed: true }, context(), value.revision)).rejects.toMatchObject({ code: 'DECLARANT_MISMATCH' });
    const pending = hold(`/work-authorizations/${value.id}`, 'PATCH', { ...value.preparation, additionalControls: 'Texto tardio.' }, value.revision);
    const science = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/sciences`, 'POST', { workerId: id(40), declarantName: '  CAMILA demo ', representation: 'Camila Demo', method: 'TYPED', confirmed: true }, context(), value.revision);
    const rejected = expect(pending.result).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' }); pending.resume(); await rejected;
    expect(science.sciences[0]).toMatchObject({ declarantName: 'Camila Demo', collectedBy: id(25), version: 1, confirmed: true });
    await expect(call(`/work-authorizations/${value.id}`, 'PATCH', value.preparation, context(), science.revision)).rejects.toMatchObject({ code: 'SCIENCE_LOCKED_PREPARATION' });
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}`)).preparation).toEqual(value.preparation);
  });
  it('não autoriza sem preparo, ciência de todos e conferência documental atual', async () => {
    const incomplete = createAuthorizationPreparation(appointment);
    let value = await create(incomplete);
    expect(value.availableActions).not.toContain('AUTHORIZE');
    await expect(call(`/work-authorizations/${value.id}/sciences`, 'POST', {}, context(), value.revision)).rejects.toMatchObject({ code: 'PREPARATION_PENDING' });
    value = await call(`/work-authorizations/${value.id}`, 'PATCH', preparation(), context(), value.revision);
    await expect(authorize(value)).rejects.toMatchObject({ code: 'SCIENCES_PENDING' });
    value = await collect(value); eligible = false;
    await expect(authorize(value)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}`)).availableActions).not.toContain('AUTHORIZE');
    eligible = true; value = await authorize(value);
    expect(value.status).toBe('AUTHORIZED'); expect(value.releases[0].eligibility.eligible).toBe(true);
  });
  it('valida janela limitada ao agendamento e nomes declarados, preservando a revisão inválida', async () => {
    const value = await collect();
    for (const validUntil of ['2026-10-10T12:00:00Z', '2026-10-10T20:00:01Z', 'inválido']) await expect(authorize(value, validUntil)).rejects.toMatchObject({ code: 'INVALID_AUTHORIZATION_WINDOW' });
    await expect(call(`/work-authorizations/${value.id}/authorize`, 'POST', { validUntil: appointment.endsAt, representations: { ...declared(value), responsibleName: 'Marina Demo' } }, context(), value.revision)).rejects.toMatchObject({ code: 'REPRESENTATION_MISMATCH' });
    await expect(call(`/work-authorizations/${value.id}/authorize`, 'POST', { validUntil: appointment.endsAt, representations: { ...declared(value), foremanName: 'Bruno Demo' } }, context(), value.revision)).rejects.toMatchObject({ code: 'REPRESENTATION_MISMATCH' });
    const current = await authorize(value); expect(current.revision).toBe(value.revision + 1); expect(current.releases[0].validFrom).toBe('2026-10-10T12:00:00.000Z');
    expect(current.releases[0].representations.responsibleName).toBe('Diego Demo');
  });
  it('PT opcional exige mesmo atendimento não terminal; abertura legítima não muda contexto AT', async () => {
    const value = await collect();
    const permit = { id: id(700), code: 'PT-DEMO-700', appointment: structuredClone(appointment), operationStatus: 'VERIFICATION' } as WorkPermitDto;
    permits.push(permit); appointment.permitId = permit.id; appointment.status = 'ATTENDANCE_OPENED'; appointment.revision++;
    const current = await authorize(value); expect(current.status).toBe('AUTHORIZED'); expect(permit.operationStatus).toBe('VERIFICATION');
    const options = await call<AuthorizationOptionsDto>(`/authorization-options?unitId=${UNIT_A}`);
    expect(options.appointments[0].permits).toEqual([{ id: permit.id, code: permit.code }]);
  });
  it('recusa vínculo PT de outro atendimento e contexto já concluído, mesmo antes de ciências', async () => {
    const other = { id: id(700), code: 'PT-DEMO-700', appointment: { ...appointment, id: id(601) }, operationStatus: 'VERIFICATION' } as WorkPermitDto; permits.push(other);
    await expect(create(preparation(), context(), other.id)).rejects.toMatchObject({ code: 'INVALID_PT_LINK' });
    other.appointment.id = appointment.id; other.operationStatus = 'COMPLETED';
    await expect(create(preparation(), context(), other.id)).rejects.toMatchObject({ code: 'INVALID_PT_LINK' });
    appointment.permitId = other.id;
    expect((await call<AuthorizationOptionsDto>(`/authorization-options?unitId=${UNIT_A}`)).appointments).toEqual([]);
    await expect(create()).rejects.toMatchObject({ code: 'INVALID_APPOINTMENT' });
  });
  it.each(['location', 'endsAt', 'serviceTypeId'])('mudança de %s no atendimento bloqueia autorização', async field => {
    const value = await collect();
    appointment[field as 'location' | 'endsAt' | 'serviceTypeId'] = field === 'endsAt' ? '2026-10-10T19:00:00Z' : 'Condição alterada';
    await expect(authorize(value)).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}`)).releases).toHaveLength(0);
  });
  it('revalida com equipe/condições explícitas, docs atuais e seis espaços preservados', async () => {
    let value = await authorize();
    const initial = structuredClone(value.releases[0]);
    const revalidate = (input: Record<string, unknown> = {}) => call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/revalidate`, 'POST', { sameTeam: true, sameConditions: true, reason: 'Nova rodada fictícia de conferência.', validUntil: appointment.endsAt, representations: declared(value), ...input }, context(), value.revision);
    await expect(revalidate({ sameTeam: false })).rejects.toMatchObject({ code: 'TEAM_CHANGED' });
    await expect(revalidate({ sameConditions: false })).rejects.toMatchObject({ code: 'CONDITIONS_CHANGED' });
    eligible = false; requirementVersion = 'DEMO-MATRIZ-2'; await expect(revalidate()).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    eligible = true;
    value = await call(`/work-authorizations/${value.id}/suspend`, 'POST', { reason: 'Suspensão fictícia para nova conferência.', confirmed: true }, context(), value.revision);
    expect(value.status).toBe('SUSPENDED');
    for (let index = 0; index < 6; index++) value = await revalidate();
    expect(value.status).toBe('AUTHORIZED'); expect(value.releases).toHaveLength(7); expect(value.releases[0]).toEqual(initial); expect(value.releases.at(-1)!.eligibility.requirementVersion).toBe('DEMO-MATRIZ-2');
    expect(value.availableActions).not.toContain('REVALIDATE'); await expect(revalidate()).rejects.toMatchObject({ code: 'REVALIDATION_LIMIT' });
  });
  it('encerramento registra resultado após vencimento/docs pendentes e congela a conferência do término', async () => {
    const value = await authorize(); const original = structuredClone(value.releases[0].eligibility);
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z')); eligible = false; requirementVersion = 'DEMO-MATRIZ-2';
    const checks = createAuthorizationClosingChecks().map(item => ({ ...item, answer: 'NA', note: 'Não aplicável ao serviço fictício executado.' }));
    await expect(call(`/work-authorizations/${value.id}/close`, 'POST', { summary: 'Encerramento fictício', checks: checks.slice(1), representations: declared(value) }, context(), value.revision)).rejects.toMatchObject({ code: 'CLOSING_PENDING' });
    const closed = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/close`, 'POST', { summary: 'Atividade fictícia encerrada com registros conferidos.', checks, representations: declared(value) }, context(), value.revision);
    expect(closed.status).toBe('CLOSED'); expect(closed.eligibility.eligible).toBe(false); expect(closed.eligibility.requirementVersion).toBe('DEMO-MATRIZ-2'); expect(closed.releases[0].eligibility).toEqual(original); expect(closed.closure!.checks).toHaveLength(12); expect(closed.availableActions).toEqual([]);
    requirementVersion = 'DEMO-MATRIZ-3';
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${closed.id}`)).eligibility).toEqual(closed.eligibility);
    await expect(call(`/work-authorizations/${closed.id}/revalidate`, 'POST', { reason: 'Nova rodada fictícia' }, context(), closed.revision)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('cancelamento exige confirmação e preserva estado do agendamento; ETag é obrigatório', async () => {
    const value = await create();
    await expect(call(`/work-authorizations/${value.id}/cancel`, 'POST', { reason: 'Cancelamento fictício', confirmed: true })).rejects.toMatchObject({ status: 428 });
    await expect(call(`/work-authorizations/${value.id}/cancel`, 'POST', { reason: 'Cancelamento fictício', confirmed: false }, context(), value.revision)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}`)).revision).toBe(value.revision);
    const canceled = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/cancel`, 'POST', { reason: 'Cancelamento fictício confirmado.', confirmed: true }, context(), value.revision);
    expect(canceled.status).toBe('CANCELED'); expect(appointment.status).toBe('CONFIRMED'); expect(appointment.revision).toBe(1); expect(canceled.history.at(-1)!.action).toBe('AUTHORIZATION_CANCELED');
    const next = await create(); expect(next.id).not.toBe(canceled.id);
  });
  it('coleta de ciência recusa contexto alterado mesmo que a preparação permaneça completa', async () => {
    const value = await create(); appointment.location = 'Local novo demonstrativo';
    await expect(call(`/work-authorizations/${value.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', representation: 'Camila Demo', method: 'TYPED', confirmed: true }, context(), value.revision)).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}`)).sciences).toEqual([]);
  });
  it('gestor invalida AT obsoleta no alcance, liberando nova AT sem operar PT ou agendamento', async () => {
    const value = await authorize(); const manager = context(20, 'SESMT_MANAGER', ['at.read', 'at.write']);
    appointment.responsibleId = id(26); appointment.responsibleName = 'Felipe Demo'; appointment.revision++;
    eligible = false; requirementVersion = 'DEMO-MATRIZ-2';
    const canceled = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/cancel`, 'POST', { reason: 'AT obsoleta: o responsável designado mudou.', confirmed: true }, manager, value.revision);
    expect(canceled.status).toBe('CANCELED'); expect(canceled.history.at(-1)!.action).toBe('AUTHORIZATION_ADMIN_CANCELED'); expect(canceled.eligibility.eligible).toBe(false);
    expect(canceled.releases[0]).toEqual(value.releases[0]); expect(appointment.responsibleId).toBe(id(26)); expect(appointment.status).toBe('CONFIRMED'); expect(appointment.revision).toBe(2);
    expect((await create(preparation(), manager)).appointment.responsibleId).toBe(id(26));
  });
  it('transferência exige alcance da unidade atual do participante para consultar e cancelar a AT histórica', async () => {
    const value = await create();
    const manager = context(20, 'SESMT_MANAGER', ['at.read', 'at.write']);
    manager.workers.find(worker => worker.id === id(40))!.unitId = UNIT_B;
    const limited = { ...manager, user: structuredClone(manager.user), workers: structuredClone(manager.workers) };
    limited.user.scope.unitIds = [UNIT_A];
    await expect(call(`/work-authorizations/${value.id}`, 'GET', undefined, limited)).rejects.toMatchObject({ status: 404 });
    await expect(call(`/work-authorizations/${value.id}/cancel`, 'POST', { reason: 'Transferência demonstrativa do participante.', confirmed: true }, limited, value.revision)).rejects.toMatchObject({ status: 404 });
    expect((await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}`, 'GET', undefined, manager)).availableActions).toContain('CANCEL');
    expect((await call<AuthorizationOptionsDto>(`/authorization-options?unitId=${UNIT_A}`, 'GET', undefined, manager)).appointments).toEqual([]);
    eligible = false;
    const canceled = await call<WorkAuthorizationDto>(`/work-authorizations/${value.id}/cancel`, 'POST', { reason: 'Participante transferido: AT antiga invalidada.', confirmed: true }, manager, value.revision);
    expect(canceled.status).toBe('CANCELED'); expect(canceled.eligibility.eligible).toBe(false);
    expect(canceled.appointment.unitId).toBe(UNIT_A); expect(canceled.history.at(-1)!.action).toBe('AUTHORIZATION_ADMIN_CANCELED');
  });
});
