import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentaryReadinessDto, MatrixRuleWriteDto, RequirementMatrixDto } from '../shared/contracts/requirements';
import type { AppointmentDto, EligibilityDto, EvidenceDto, WorkPermitDto } from '../shared/contracts/work-permits';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';

const managerPermissions = ['requirements.read', 'requirements.write', 'appointments.read', 'appointments.write', 'permits.read', 'permits.review', 'eligibility.read', 'eligibility.write', 'eligibility.review'];
const actor = (operator = false): PermitDemoContext => ({ user: { id: id(operator ? 25 : 20), displayName: operator ? 'Diego Demo' : 'Marina Demo', email: 'demo@example.local', roles: [], status: 'ACTIVE', mfaRequired: false, revision: 1, scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], sectorIds: [], teamIds: [], ownOnly: false } }, workers: makeFixtures().workers, permissions: operator ? ['requirements.read', 'appointments.read', 'permits.read', 'permits.operate', 'eligibility.read', 'eligibility.write'] : managerPermissions, checkUnit: () => {} });

describe('matriz administrativa publicada e prontidão documental integrada', () => {
  let demo: ReturnType<typeof makePermitDemo>;
  beforeEach(() => { demo = makePermitDemo(); });
  async function call<T>(path: string, method = 'GET', input?: unknown, context = actor(), revision?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const headers = new Headers();
    if (revision !== undefined) headers.set('If-Match', `"${revision}"`);
    if (input !== undefined) headers.set('Content-Type', 'application/json');
    return await demo.route(new Request(url, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) }), url, url.pathname.replace('/api/v1', ''), context) as T;
  }
  const matrix = (unitId = UNIT_A, context = actor()) => call<RequirementMatrixDto>(`/requirement-matrix?unitId=${unitId}`, 'GET', undefined, context);
  async function save(rules: MatrixRuleWriteDto[], unitId = UNIT_A) {
    const current = await matrix(unitId);
    return call<RequirementMatrixDto>(`/requirement-matrix/draft?unitId=${unitId}`, 'PATCH', { rules }, actor(), current.revision);
  }
  async function publish(rules: MatrixRuleWriteDto[], unitId = UNIT_A) {
    const draft = await save(rules, unitId);
    return call<RequirementMatrixDto>(`/requirement-matrix/publish?unitId=${unitId}`, 'POST', { reason: 'Ajuste administrativo fictício para o cenário de teste.' }, actor(), draft.revision);
  }
  async function prepare() {
    const appointment = await call<AppointmentDto>(`/appointments/${id(221)}`, 'GET', undefined, actor(true));
    let permit = await call<WorkPermitDto>(`/appointments/${appointment.id}/open-permit`, 'POST', {}, actor(true), appointment.revision);
    const preparation = permit.preparation!;
    preparation.identification = { ...preparation.identification, serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', activityDescription: 'Inspeção fictícia de sistema despressurizado.', riskAnalysisReference: 'AR-DEMO' };
    preparation.activities = ['pressurized']; preparation.additionalControls = 'Registro fictício do procedimento e dos controles aplicáveis.';
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/preparation`, 'PATCH', preparation, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, answer: 'YES' })) }, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, actor(true), permit.revision);
    return permit;
  }
  async function upload(appointmentId: string, workerId: string, requirementId: string, validFrom?: string, validUntil?: string) {
    const appointment = await call<AppointmentDto>(`/appointments/${appointmentId}`);
    const fileBytes = new TextEncoder().encode('%PDF-1.4\nDOCUMENTO FICTICIO\n%%EOF');
    const file = new File([fileBytes], 'comprovante-demo.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => fileBytes.buffer });
    const form = new FormData(); form.set('file', file); form.set('workerId', workerId); form.set('requirementId', requirementId);
    if (validFrom !== undefined) form.set('validFrom', validFrom);
    if (validUntil !== undefined) form.set('validUntil', validUntil);
    const path = `/appointments/${appointmentId}/evidence`;
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${appointment.revision}"` } });
    Object.defineProperty(request, 'formData', { value: async () => form });
    return await demo.route(request, url, path, actor()) as EvidenceDto;
  }
  it('consulta a publicação inicial, opções e versões por unidade sem expor referência mutável', async () => {
    const current = await matrix();
    expect(current.published.version).toBe('DEMO-MATRIZ-1');
    expect(current.published.rules.map(rule => rule.id)).toEqual([id(240), id(241), id(242), id(520), id(521), id(522), id(523), id(524)]);
    expect(current.published.rules[0]).toMatchObject({ validFromRequired: true, validUntilRequired: true });
    expect(current.availableActions).toEqual(['EDIT_DRAFT']);
    current.published.rules[0].label = 'Alteração somente na cópia retornada';
    expect((await matrix()).published.rules[0].label).not.toBe(current.published.rules[0].label);
  });
  it('exige unidade, empresa e permissões antes de ler o corpo; somente acesso integral pode escrever', async () => {
    await expect(call('/requirement-matrix')).rejects.toMatchObject({ status: 422, field: 'unitId' });
    const wrongCompany = actor(); wrongCompany.user.scope.companyIds = [];
    await expect(matrix(UNIT_A, wrongCompany)).rejects.toMatchObject({ status: 403 });
    const own = actor(); own.user.scope.ownOnly = true;
    await expect(matrix(UNIT_A, own)).rejects.toMatchObject({ status: 403 });
    const restricted = actor(); restricted.user.scope.teamIds = [id(200)];
    const path = `/requirement-matrix/draft?unitId=${UNIT_A}`;
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': '"1"' } });
    const reader = vi.fn(); Object.defineProperty(request, 'json', { value: reader });
    await expect(demo.route(request, url, '/requirement-matrix/draft', restricted)).rejects.toMatchObject({ status: 403 });
    expect(reader).not.toHaveBeenCalled();
    expect((await matrix(UNIT_A, actor(true))).availableActions).toEqual([]);
    const allSectors = actor(); allSectors.user.scope.sectorIds = [id(5), id(6), id(7)];
    expect((await matrix(UNIT_A, allSectors)).availableActions).toEqual(['EDIT_DRAFT']);
  });
  it('rascunho não altera elegibilidade; publicação gera IDs para regras alteradas e preserva evidência das iguais', async () => {
    const current = await matrix();
    const rules = current.published.rules.map(rule => rule.id === id(240) ? { ...rule, label: 'Capacitação aplicável atualizada (demo)' } : { ...rule, id: 'ID_FORJADO_CLIENTE' });
    const draft = await save(rules);
    expect(draft.draft!.rules[0].id).not.toBe(id(240));
    expect(draft.draft!.rules[1].id).toBe(id(241));
    expect(draft.availableActions).toEqual(['EDIT_DRAFT', 'PUBLISH']);
    expect((await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`)).eligible).toBe(true);
    const published = await call<RequirementMatrixDto>(`/requirement-matrix/publish?unitId=${UNIT_A}`, 'POST', { reason: 'Publicação fictícia da regra administrativa alterada.' }, actor(), draft.revision);
    const eligibility = await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`);
    expect(eligibility).toMatchObject({ requirementVersion: 'DEMO-MATRIZ-2', eligible: false });
    expect(eligibility.participants[0].items[0].status).toBe('MISSING');
    expect(eligibility.participants[0].items[1].status).toBe('APPROVED');
    expect(published.versions[0]).toEqual(current.published);
    expect(published.published.publishedBy).toBe(id(20));
    expect(published.history.map(event => event.action)).toEqual(['MATRIX_DRAFT_SAVED', 'MATRIX_PUBLISHED']);
    expect((await matrix(UNIT_B)).published.version).toBe('DEMO-MATRIZ-1');
    expect(published.services.every(service => service.requirementVersion === published.published.version)).toBe(true);
    // Evidência histórica segue consultável por sua classificação original, mas
    // não satisfaz o novo requisito com identidade diferente.
    await call(`/evidence/${id(250)}/review`, 'POST', { decision: 'APPROVE' }, actor(), 1);
    expect((await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`)).participants[0].items[0].status).toBe('MISSING');
  });
  it.each(['label', 'description', 'serviceFunction', 'locationContains', 'validFromRequired', 'validUntilRequired', 'restricted'] as const)('a mudança de %s não herda o identificador/evidência do requisito anterior', async key => {
    const current = await matrix();
    const rules = structuredClone(current.published.rules);
    const target = rules[0];
    if (key === 'restricted') { target.restricted = true; target.validFromRequired = false; target.validUntilRequired = false; }
    else if (key === 'validFromRequired' || key === 'validUntilRequired') target[key] = false;
    else target[key] = key === 'serviceFunction' ? 'Executante' : key === 'locationContains' ? 'Área A' : `${target[key]} alterado`;
    const draft = await save(rules);
    expect(draft.draft!.rules[0].id).not.toBe(current.published.rules[0].id);
  });
  it('publicar exige cobertura base de todos os serviços e salvar rejeita configuração vazia/restrita com datas', async () => {
    await expect(save([])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const current = await matrix();
    await expect(save(current.published.rules.map(rule => rule.restricted ? { ...rule, validUntilRequired: true } : rule))).rejects.toMatchObject({ code: 'RESTRICTED_POLICY' });
    const draft = await save(current.published.rules.filter(rule => rule.serviceTypeId === id(210)));
    await expect(call(`/requirement-matrix/publish?unitId=${UNIT_A}`, 'POST', { reason: 'Tentativa fictícia de publicar sem a cobertura mínima.' }, actor(), draft.revision)).rejects.toMatchObject({ code: 'MATRIX_COVERAGE_REQUIRED' });
    expect((await matrix()).revision).toBe(draft.revision);
    expect((await matrix()).published).toEqual(current.published);
  });
  it('datas exigidas são flags da regra ativa, inclusive para requisito novo fora do ID240', async () => {
    const current = await matrix();
    const changed = await publish(current.published.rules.map(rule => rule.id === id(242) ? { ...rule, validFromRequired: true, validUntilRequired: true } : rule));
    const requirementId = changed.published.rules.find(rule => rule.serviceTypeId === id(211))!.id;
    expect(requirementId).not.toBe(id(242));
    await expect(upload(id(222), id(42), requirementId)).rejects.toMatchObject({ status: 422, field: 'validFrom' });
    await expect(upload(id(222), id(42), requirementId, '2020-01-01')).rejects.toMatchObject({ status: 422, field: 'validUntil' });
    const evidence = await upload(id(222), id(42), requirementId, '2020-01-01', '2099-01-01');
    expect(evidence.requirementVersion).toBe('DEMO-MATRIZ-2');
    await call(`/evidence/${evidence.id}/review`, 'POST', { decision: 'APPROVE' }, actor(), evidence.revision);
    expect((await call<EligibilityDto>(`/appointments/${id(222)}/eligibility`)).eligible).toBe(true);
  });
  it('aplicabilidade usa função e trecho do local normalizados mantendo a regra base', async () => {
    const current = await matrix();
    const extra = { ...current.published.rules[0], label: 'Orientação adicional de área (demo)', description: 'Conferência administrativa fictícia para esta função e área.', serviceFunction: 'EXECUTANTE', locationContains: 'aReA a', validFromRequired: false, validUntilRequired: false };
    await publish([...current.published.rules, extra]);
    expect((await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`)).participants[0].items).toHaveLength(3);
    const original = await call<AppointmentDto>(`/appointments/${id(221)}`);
    const outside = await call<AppointmentDto>('/appointments', 'POST', { ...original, location: 'Pátio independente fictício' });
    const otherFunction = await call<AppointmentDto>('/appointments', 'POST', { ...original, participants: original.participants.map(participant => ({ ...participant, serviceFunction: 'Apoio' })) });
    expect((await call<EligibilityDto>(`/appointments/${outside.id}/eligibility`)).participants[0].items).toHaveLength(2);
    expect((await call<EligibilityDto>(`/appointments/${otherFunction.id}/eligibility`)).eligible).toBe(true);
  });
  it.each(['release', 'start', 'resume'] as const)('publicação passa a bloquear %s com a elegibilidade atual, sem depender de revisão da PT', async command => {
    let permit = await prepare();
    if (command !== 'release') permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, actor(true), permit.revision);
    if (command === 'resume') {
      permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, actor(true), permit.revision);
      permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/suspend`, 'POST', { reason: 'Interrupção fictícia da operação.', confirmed: true }, actor(true), permit.revision);
    }
    const current = await matrix();
    await publish(current.published.rules.map(rule => rule.id === id(240) ? { ...rule, description: `${rule.description} Regra administrativa atualizada.` } : rule));
    await expect(call(`/work-permits/${permit.id}/${command}`, 'POST', command === 'resume' ? { reason: 'Condições fictícias conferidas novamente.', confirmed: true, sameTeam: true, sameConditions: true } : {}, actor(true), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    expect((await call<WorkPermitDto>(`/work-permits/${permit.id}`, 'GET', undefined, actor(true))).operationStatus).toBe(permit.operationStatus);
  });
  it('conclusão e seed preservam a conferência documental que não é reescrita pela publicação posterior', async () => {
    const oldSeed = await call<WorkPermitDto>(`/work-permits/${id(230)}`);
    let permit = await prepare();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, actor(true), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/complete`, 'POST', { summary: 'Atendimento fictício concluído e registrado.', closingChecks: permit.preparation!.closingChecks.map(item => ({ ...item, answer: 'YES' })) }, actor(true), permit.revision);
    expect(permit.snapshots[0].eligibility).toEqual(permit.eligibility);
    const current = await matrix(); await publish(current.published.rules.map(rule => rule.id === id(240) ? { ...rule, label: 'Requisito administrativo alterado posteriormente' } : rule));
    const preserved = await call<WorkPermitDto>(`/work-permits/${permit.id}`, 'GET', undefined, actor(true));
    expect(preserved.eligibility).toEqual(permit.eligibility);
    expect(preserved.snapshots).toEqual(permit.snapshots);
    const preservedSeed = await call<WorkPermitDto>(`/work-permits/${id(230)}`);
    expect(preservedSeed.eligibility).toEqual(oldSeed.eligibility);
    expect(preservedSeed.snapshots).toEqual(oldSeed.snapshots);
  });
  it('prontidão filtra unidade, empresa, equipe, responsável e participantes fora do setor autorizado', async () => {
    const path = `/documentary-readiness?unitId=${UNIT_A}`;
    const all = await call<DocumentaryReadinessDto>(path);
    expect(all.rows.map(row => row.appointmentId)).toEqual([id(220), id(221), id(222)]);
    expect((await call<DocumentaryReadinessDto>(path, 'GET', undefined, actor(true))).rows.map(row => row.appointmentId)).toEqual([id(220), id(221)]);
    expect((await call<DocumentaryReadinessDto>(`/documentary-readiness?unitId=${UNIT_B}`)).rows.map(row => row.appointmentId)).toEqual([id(223)]);
    const otherSector = actor(); otherSector.user.scope.sectorIds = [id(6)];
    expect((await call<DocumentaryReadinessDto>(path, 'GET', undefined, otherSector)).rows).toEqual([]);
    const wrongCompany = actor(); wrongCompany.user.scope.companyIds = [];
    await expect(call(path, 'GET', undefined, wrongCompany)).rejects.toMatchObject({ status: 403 });
    const restrictedTeam = actor(); restrictedTeam.user.scope.teamIds = [id(201)];
    expect((await call<DocumentaryReadinessDto>(path, 'GET', undefined, restrictedTeam)).rows).toEqual([]);
    const hiddenWorker = actor(); hiddenWorker.workers.find(worker => worker.id === id(40))!.companyId = 'OUTSIDE_COMPANY';
    expect((await call<DocumentaryReadinessDto>(path, 'GET', undefined, hiddenWorker)).rows.map(row => row.appointmentId)).toEqual([id(222)]);
    const own = actor(); own.user.id = id(24); own.user.scope.ownOnly = true;
    expect((await call<DocumentaryReadinessDto>(path, 'GET', undefined, own)).rows.map(row => row.appointmentId)).toEqual([id(221)]);
    await expect(call('/documentary-readiness')).rejects.toMatchObject({ field: 'unitId' });
  });
  it('prontidão remove agendamentos cancelados e PTs concluídas/canceladas, mantendo pendências abertas', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(222)}`);
    await call(`/appointments/${appointment.id}/cancel`, 'POST', { reason: 'Serviço fictício cancelado antes do atendimento.' }, actor(), appointment.revision);
    const permit = await prepare();
    await call(`/work-permits/${permit.id}/cancel`, 'POST', { reason: 'Permissão fictícia cancelada antes da execução.', confirmed: true }, actor(true), permit.revision);
    const readiness = await call<DocumentaryReadinessDto>(`/documentary-readiness?unitId=${UNIT_A}`);
    expect(readiness.rows.map(row => row.appointmentId)).toEqual([id(220)]);
    expect(readiness.rows[0].eligibility.eligible).toBe(false);
  });
  it('If-Match é conferido após a leitura do corpo e rejeita rascunho recebido depois de publicação concorrente', async () => {
    const current = await matrix();
    const draft = await save(current.published.rules);
    let resume!: () => void;
    const body = new Promise<unknown>(resolve => { resume = () => resolve({ rules: current.published.rules.map(rule => ({ ...rule, label: `${rule.label} atrasado` })) }); });
    const path = '/requirement-matrix/draft';
    const url = new URL(`http://localhost/api/v1${path}?unitId=${UNIT_A}`);
    const request = new Request(url, { method: 'PATCH', headers: { 'If-Match': `"${draft.revision}"` } });
    Object.defineProperty(request, 'json', { value: () => body });
    const pending = demo.route(request, url, path, actor());
    const published = await call<RequirementMatrixDto>(`/requirement-matrix/publish?unitId=${UNIT_A}`, 'POST', { reason: 'Publicação fictícia que venceu a escrita concorrente.' }, actor(), draft.revision);
    const rejected = expect(pending).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' }); resume(); await rejected;
    expect((await matrix()).revision).toBe(published.revision);
    expect((await matrix()).draft).toBeNull();
    await expect(call(`/requirement-matrix/draft?unitId=${UNIT_A}`, 'PATCH', { rules: current.published.rules })).rejects.toMatchObject({ status: 428 });
  });
  it('publicação durante leitura do arquivo rejeita upload da matriz anterior sem criar evidência', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(221)}`);
    const bytes = new TextEncoder().encode('%PDF-1.4\nARQUIVO FICTICIO\n%%EOF');
    const file = new File([bytes], 'documento-demo.pdf', { type: 'application/pdf' });
    let signalEntered!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => { signalEntered(); await paused; return bytes.buffer; } });
    const form = new FormData(); form.set('file', file); form.set('workerId', id(40)); form.set('requirementId', id(240)); form.set('validFrom', '2020-01-01'); form.set('validUntil', '2099-01-01');
    const path = `/appointments/${appointment.id}/evidence`;
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${appointment.revision}"` } });
    Object.defineProperty(request, 'formData', { value: async () => form });
    const pending = demo.route(request, url, path, actor());
    await entered;
    const current = await matrix();
    await publish(current.published.rules.map(rule => rule.id === id(240) ? { ...rule, label: `${rule.label} atualizado` } : rule));
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REQUIREMENTS_CHANGED', status: 409 }); resume(); await rejected;
    expect((await call<AppointmentDto>(`/appointments/${appointment.id}`)).revision).toBe(appointment.revision);
    expect((await call<EligibilityDto>(`/appointments/${appointment.id}/eligibility`)).participants[0].items[0].status).toBe('MISSING');
  });
});
