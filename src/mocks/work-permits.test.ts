import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDto, WorkPermitDto, EvidenceDto, EligibilityDto, PermitDashboardDto, FinalPdfDto } from '../shared/contracts/work-permits';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';

const operational = ['appointments.read', 'teams.read', 'permits.read', 'permits.operate', 'eligibility.read', 'eligibility.write'];
const managerPermissions = ['appointments.read', 'appointments.write', 'teams.read', 'permits.read', 'permits.review', 'eligibility.read', 'eligibility.write', 'eligibility.review'];
const context = (userId: number, displayName: string, permissions: string[]): PermitDemoContext => ({
  user: { id: id(userId), displayName, email: 'demo@example.local', roles: [], status: 'ACTIVE', mfaRequired: false, revision: 1, scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], teamIds: [], sectorIds: [], ownOnly: false } },
  permissions, workers: makeFixtures().workers,
  checkUnit: (unit) => { if (![UNIT_A, UNIT_B].includes(unit)) throw new Error('Outside scope'); },
});
const technician = () => context(25, 'Diego Demo', operational);
const engineer = () => context(20, 'Marina Demo', managerPermissions);

describe('simulação de PT e elegibilidade no navegador', () => {
  let demo: ReturnType<typeof makePermitDemo>;
  beforeEach(() => { demo = makePermitDemo(); });
  async function call<T>(path: string, method = 'GET', input?: unknown, actor = technician(), rev?: number) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { ...(input ? { 'Content-Type': 'application/json' } : {}), ...(rev !== undefined ? { 'If-Match': `"${rev}"` } : {}) }, body: input ? JSON.stringify(input) : undefined });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), actor) as T;
  }
  async function prepared(appointmentId = id(221), collectSciences = true) {
    const appointment = await call<AppointmentDto>(`/appointments/${appointmentId}`);
    let permit = await call<WorkPermitDto>(`/appointments/${appointmentId}/open-permit`, 'POST', {}, technician(), appointment.revision);
    const preparation = permit.preparation!;
    preparation.identification = { ...preparation.identification, serviceProvider: 'Fornecedor Demo', workFront: 'Frente Demo', activityDescription: 'Inspeção fictícia da área de apoio.', riskAnalysisReference: 'AR-DEMO-1' };
    preparation.activities = ['overlapping'];
    preparation.checks = preparation.checks.map(item => item.section === 'overlapping' ? { ...item, answer: 'YES' } : item);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/preparation`, 'PATCH', preparation, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, answer: 'YES' })) }, technician(), permit.revision);
    if (collectSciences) for (const participant of permit.appointment.participants) permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: participant.workerId, declarantName: participant.name, method: 'TYPED', representation: participant.name, confirmed: true }, technician(), permit.revision);
    return permit;
  }
  function holdJson(path: string, method: string, input: unknown, actor: PermitDemoContext, rev: number) {
    let resume!: () => void;
    const payload = new Promise<unknown>(resolve => { resume = () => resolve(input); });
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { 'If-Match': `"${rev}"` } });
    Object.defineProperty(request, 'json', { value: () => payload });
    return { resume, result: demo.route(request, url, path, actor) };
  }
  it.each(['preparation', 'checklist'])('rejeita %s cujo corpo chega depois da ciência, preservando o conteúdo apresentado', async command => {
    const permit = await prepared(id(221), false);
    const input = command === 'preparation' ? { ...permit.preparation!, additionalControls: 'Texto que não pode substituir o conteúdo após ciência.' } : { items: permit.checklist.map(item => ({ ...item, note: 'Texto ainda em trânsito.' })) };
    const pending = holdJson(`/work-permits/${permit.id}/${command}`, 'PATCH', input, technician(), permit.revision);
    const current = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, technician(), permit.revision);
    const rejected = expect(pending.result).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
    pending.resume(); await rejected;
    const preserved = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    expect(preserved.revision).toBe(current.revision);
    expect(preserved.preparation).toEqual(permit.preparation);
    expect(preserved.checklist).toEqual(permit.checklist);
    expect(preserved.sciences).toHaveLength(1);
  });
  it('apenas uma revisão vence quando dois corpos concorrentes são liberados no mesmo turno', async () => {
    const permit = await call<WorkPermitDto>(`/work-permits/${id(230)}`, 'GET', undefined, engineer());
    const approve = holdJson(`/work-permits/${permit.id}/review`, 'POST', { decision: 'APPROVE', comment: 'Conferência fictícia.', signatureRepresentation: 'Marina Demo' }, engineer(), permit.revision);
    const giveBack = holdJson(`/work-permits/${permit.id}/review`, 'POST', { decision: 'RETURN', comment: 'Complementar registro fictício.' }, engineer(), permit.revision);
    const results = Promise.allSettled([approve.result, giveBack.result]);
    approve.resume(); giveBack.resume();
    const settled = await results;
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(settled.find(result => result.status === 'rejected')).toMatchObject({ reason: { status: 412, code: 'REVISION_CONFLICT' } });
    const current = await call<WorkPermitDto>(`/work-permits/${permit.id}`, 'GET', undefined, engineer());
    expect(current.revision).toBe(permit.revision + 1);
    expect(current.history.filter(event => ['FINAL_REVIEW_APPROVED', 'FINAL_REVIEW_RETURNED'].includes(event.action))).toHaveLength(1);
    expect(current.snapshots[0].decision).toBe('APPROVE');
  });
  it.each(['formData', 'arrayBuffer'])('upload de evidência rejeita revisão alterada enquanto aguarda %s', async stage => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(221)}`, 'GET', undefined, engineer());
    const bytes = new TextEncoder().encode('%PDF-1.4\nARQUIVO FICTICIO\n%%EOF');
    const file = new File([bytes], 'evidencia-demo.pdf', { type: 'application/pdf' });
    const form = new FormData();
    form.set('file', file); form.set('workerId', id(40)); form.set('requirementId', id(240)); form.set('validFrom', '2020-01-01'); form.set('validUntil', '2099-01-01');
    let resume!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>(resolve => { signalEntered = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => { if (stage === 'arrayBuffer') { signalEntered(); await paused; } return bytes.buffer; } });
    const path = `/appointments/${appointment.id}/evidence`;
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${appointment.revision}"` } });
    Object.defineProperty(request, 'formData', { value: async () => { if (stage === 'formData') { signalEntered(); await paused; } return form; } });
    const pending = demo.route(request, url, path, engineer());
    await entered;
    const canceled = await call<AppointmentDto>(`/appointments/${appointment.id}/cancel`, 'POST', { reason: 'Cancelamento fictício durante o recebimento do arquivo.' }, engineer(), appointment.revision);
    const rejected = expect(pending).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
    resume(); await rejected;
    const current = await call<AppointmentDto>(`/appointments/${appointment.id}`, 'GET', undefined, engineer());
    expect(current.revision).toBe(canceled.revision);
    expect(current.history.some(event => event.action === 'EVIDENCE_SUBMITTED')).toBe(false);
    const eligibility = await call<EligibilityDto>(`/appointments/${appointment.id}/eligibility`, 'GET', undefined, engineer());
    expect(eligibility.participants[0].items.find(item => item.requirementId === id(240))!.status).toBe('APPROVED');
  });
  async function upload(appointmentId: string, workerId: string, requirementId: string, validUntil = '2020-01-01') {
    const appointment = await call<AppointmentDto>(`/appointments/${appointmentId}`, 'GET', undefined, engineer());
    const bytes = new TextEncoder().encode('%PDF-1.4\nDEMONSTRACAO\n%%EOF');
    const file = new File([bytes], 'evidencia-demo.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    const form = new FormData();
    form.append('file', file); form.append('workerId', workerId); form.append('requirementId', requirementId); form.append('validFrom', '2019-01-01'); form.append('validUntil', validUntil);
    const url = new URL(`http://localhost/api/v1/appointments/${appointmentId}/evidence`);
    const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${appointment.revision}"` } });
    Object.defineProperty(request, 'formData', { value: async () => form });
    return await demo.route(request, url, `/appointments/${appointmentId}/evidence`, engineer()) as EvidenceDto;
  }
  it('abre verificações sem liberar a execução e impede início prematuro', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(221)}`);
    const permit = await call<WorkPermitDto>(`/appointments/${appointment.id}/open-permit`, 'POST', {}, technician(), appointment.revision);
    expect(permit.operationStatus).toBe('VERIFICATION');
    expect(permit.releasedAt).toBeUndefined();
    await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'RELEASE_REQUIRED' });
  });
  it.each(['RELEASED', 'EXECUTING'] as const)('suspensão e retomada integradas restauram %s com ações recalculadas pelo domínio', async previous => {
    let permit = await prepared();
    expect(permit.availableActions).toContain('CANCEL');
    expect(permit.availableActions).not.toContain('SUSPEND');
    expect(permit.availableActions).not.toContain('RESUME');
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    expect(permit.availableActions).toEqual(expect.arrayContaining(['START', 'SUSPEND', 'CANCEL']));
    if (previous === 'EXECUTING') {
      permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision);
      expect(permit.availableActions).toEqual(expect.arrayContaining(['COMPLETE', 'SUSPEND']));
      expect(permit.availableActions).not.toContain('CANCEL');
    }
    const preserved = structuredClone({ preparation: permit.preparation, checklist: permit.checklist, sciences: permit.sciences, snapshots: permit.snapshots, version: permit.version, releasedAt: permit.releasedAt, startedAt: permit.startedAt });
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/suspend`, 'POST', { reason: 'Condição inesperada fictícia, equipe interrompida.', confirmed: true }, technician(), permit.revision);
    expect(permit.operationStatus).toBe('SUSPENDED');
    expect(permit.lifecycle?.suspendedFrom).toBe(previous);
    expect(permit.availableActions).toEqual(expect.arrayContaining(['RESUME', 'CANCEL']));
    expect(permit.availableActions).not.toContain('SUSPEND');
    expect(permit.availableActions).not.toContain('START');
    expect(permit.availableActions).not.toContain('COMPLETE');
    const observer = await call<WorkPermitDto>(`/work-permits/${permit.id}`, 'GET', undefined, engineer());
    expect(observer.availableActions).not.toContain('RESUME');
    expect(observer.availableActions).not.toContain('CANCEL');
    await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'RELEASE_REQUIRED' });
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/resume`, 'POST', { reason: 'Condições fictícias conferidas e restabelecidas.', confirmed: true, sameTeam: true, sameConditions: true }, technician(), permit.revision);
    expect(permit.operationStatus).toBe(previous);
    expect(permit.availableActions).toContain(previous === 'RELEASED' ? 'START' : 'COMPLETE');
    expect(permit.availableActions).not.toContain('RESUME');
    expect({ preparation: permit.preparation, checklist: permit.checklist, sciences: permit.sciences, snapshots: permit.snapshots, version: permit.version, releasedAt: permit.releasedAt, startedAt: permit.startedAt }).toEqual(preserved);
    expect(permit.history.slice(-2).map(event => event.action)).toEqual(['OPERATION_SUSPENDED', 'OPERATION_RESUMED']);
  });
  it.each(['PENDING', 'EXPIRED'] as const)('conferência real de elegibilidade impede retomar após evidência ficar %s', async evidenceState => {
    let permit = await prepared();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/suspend`, 'POST', { reason: 'Interrupção fictícia para conferir os documentos.', confirmed: true }, technician(), permit.revision);
    const evidence = await upload(id(221), id(40), id(240), evidenceState === 'EXPIRED' ? '2020-01-01' : '2099-01-01');
    if (evidenceState === 'EXPIRED') await call(`/evidence/${evidence.id}/review`, 'POST', { decision: 'APPROVE' }, engineer(), evidence.revision);
    const blocked = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    expect(blocked.eligibility.eligible).toBe(false);
    expect(blocked.eligibility.participants[0].items.find(item => item.requirementId === id(240))!.status).toBe(evidenceState);
    const resumeBody = { reason: 'Equipe e condições fictícias conferidas novamente.', confirmed: true, sameTeam: true, sameConditions: true };
    await expect(call(`/work-permits/${permit.id}/resume`, 'POST', resumeBody, technician(), blocked.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    const unchanged = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    expect(unchanged.operationStatus).toBe('SUSPENDED');
    expect(unchanged.revision).toBe(blocked.revision);
    expect(unchanged.history).toEqual(blocked.history);
    const replacement = evidenceState === 'EXPIRED' ? await upload(id(221), id(40), id(240), '2099-01-01') : evidence;
    await call(`/evidence/${replacement.id}/review`, 'POST', { decision: 'APPROVE' }, engineer(), replacement.revision);
    const resumed = await call<WorkPermitDto>(`/work-permits/${permit.id}/resume`, 'POST', resumeBody, technician(), blocked.revision);
    expect(resumed.operationStatus).toBe('EXECUTING');
    expect(resumed.eligibility.eligible).toBe(true);
  });
  it('cancelamento de uma PT suspensa preserva agendamento, arquivos e histórico da execução', async () => {
    let permit = await prepared();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision);
    const bytes = new TextEncoder().encode('%PDF-1.4\nREGISTRO FICTICIO\n%%EOF');
    const file = new File([bytes], 'acompanhamento-demo.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    const form = new FormData(); form.set('file', file); form.set('caption', 'Registro fictício da execução antes da interrupção.'); form.set('version', String(permit.version));
    const path = `/work-permits/${permit.id}/attachments`;
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method: 'POST', headers: { 'If-Match': `"${permit.revision}"` } });
    Object.defineProperty(request, 'formData', { value: async () => form });
    await demo.route(request, url, path, technician());
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    const files = await call<unknown[]>(path);
    expect(files).toHaveLength(1);
    const appointment = await call<AppointmentDto>(`/appointments/${permit.appointment.id}`);
    const preserved = structuredClone({ preparation: permit.preparation, checklist: permit.checklist, sciences: permit.sciences, snapshots: permit.snapshots, version: permit.version });
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/suspend`, 'POST', { reason: 'Interrupção fictícia antes de cancelar a permissão.', confirmed: true }, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/cancel`, 'POST', { reason: 'Permissão fictícia cancelada; serviço requer nova avaliação.', confirmed: true }, technician(), permit.revision);
    expect(permit.operationStatus).toBe('CANCELED');
    expect(permit.availableActions).toEqual([]);
    expect(permit.lifecycle?.cancellationReason).toMatch(/nova avaliação/);
    expect(await call<AppointmentDto>(`/appointments/${appointment.id}`)).toEqual(appointment);
    expect(permit.appointment.status).toBe('ATTENDANCE_OPENED');
    expect(await call<unknown[]>(path)).toEqual(files);
    expect({ preparation: permit.preparation, checklist: permit.checklist, sciences: permit.sciences, snapshots: permit.snapshots, version: permit.version }).toEqual(preserved);
    expect(permit.history.slice(-3).map(event => event.action)).toEqual(['ATTACHMENT_ADDED', 'OPERATION_SUSPENDED', 'PERMIT_CANCELED']);
    const dashboard = await call<PermitDashboardDto>(`/permit-dashboard?unitId=${UNIT_A}`, 'GET', undefined, engineer());
    expect(dashboard.activePermits).toBe(0);
    await expect(call(`/work-permits/${permit.id}/complete`, 'POST', { summary: 'Não deve concluir uma PT cancelada.' }, technician(), permit.revision)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('preparação incompleta impede ciência, exige If-Match e preserva os dados apresentados', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(221)}`);
    let permit = await call<WorkPermitDto>(`/appointments/${appointment.id}/open-permit`, 'POST', {}, technician(), appointment.revision);
    expect(permit.preparation?.sourceId).toBe('RI-S-36001');
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, answer: 'YES' })) }, technician(), permit.revision);
    await expect(call(`/work-permits/${permit.id}/sciences`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'PREPARATION_PENDING' });
    await expect(call(`/work-permits/${permit.id}/preparation`, 'PATCH', permit.preparation)).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED' });
    const ready = await prepared(id(220));
    await expect(call(`/work-permits/${ready.id}/preparation`, 'PATCH', ready.preparation, technician(), ready.revision)).rejects.toMatchObject({ code: 'SCIENCE_LOCKED_PREPARATION' });
  });
  it('N/A documental justificado não satisfaz o checklist demonstrativo de liberação', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(221)}`);
    let permit = await call<WorkPermitDto>(`/appointments/${appointment.id}/open-permit`, 'POST', {}, technician(), appointment.revision);
    const input = permit.preparation!;
    input.identification = { ...input.identification, serviceProvider: 'Demo', workFront: 'Demo', activityDescription: 'Inspeção fictícia de área.', riskAnalysisReference: 'AR-DEMO' };
    input.activities = ['overlapping'];
    input.checks = input.checks.map(item => item.section === 'overlapping' ? { ...item, answer: 'NA', note: 'Não há trabalho sobreposto no cenário didático.' } : item);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/preparation`, 'PATCH', input, technician(), permit.revision);
    await expect(call(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, answer: 'NA' })) }, technician(), permit.revision)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'CHECKLIST_PENDING' });
  });
  it('encerramento exige respostas justificadas e snapshot preserva preparação e contexto', async () => {
    let permit = await prepared();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision);
    const summary = 'Conclusão fictícia com as condições registradas.';
    await expect(call(`/work-permits/${permit.id}/complete`, 'POST', { summary }, technician(), permit.revision)).rejects.toMatchObject({ code: 'CLOSING_PENDING' });
    expect((await call<WorkPermitDto>(`/work-permits/${permit.id}`)).operationStatus).toBe('EXECUTING');
    const closingChecks = permit.preparation!.closingChecks.map(item => ({ ...item, answer: 'NA', note: 'Não aplicável à inspeção fictícia; situação e procedimento conferidos.' }));
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/complete`, 'POST', { summary, closingChecks }, technician(), permit.revision);
    expect(permit.snapshots[0].preparation).toEqual(permit.preparation);
    expect(permit.snapshots[0].appointment?.location).toBe(permit.appointment.location);
    const original = structuredClone(permit.snapshots[0].preparation);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/review`, 'POST', { decision: 'RETURN', comment: 'Complementar registro demonstrativo.' }, engineer(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/new-version`, 'POST', { reason: 'Complementar campo.' }, technician(), permit.revision);
    permit.preparation!.identification.activityDescription = 'Descrição complementada da inspeção fictícia.';
    const corrected = await call<WorkPermitDto>(`/work-permits/${permit.id}/preparation`, 'PATCH', permit.preparation, technician(), permit.revision);
    expect(corrected.snapshots[0].preparation).toEqual(original);
    expect(corrected.operationStatus).toBe('COMPLETED');
  });
  it('requisitos pendentes impedem liberação, mesmo com checklist e ciências completos', async () => {
    const permit = await prepared(id(220));
    expect(permit.eligibility.eligible).toBe(false);
    expect(permit.availableActions).not.toContain('RELEASE');
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
  });
  it('evidência ausente impede liberação e nenhum documento de colega satisfaz o requisito', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(222)}`, 'GET', undefined, engineer());
    const missingAppointment = await call<AppointmentDto>('/appointments', 'POST', { ...appointment, participants: [{ workerId: id(41), name: 'Nome falso', serviceFunction: 'Apoio' }], responsibleId: id(25) }, engineer());
    await call(`/appointments/${missingAppointment.id}/confirm`, 'POST', {}, engineer(), missingAppointment.revision);
    const permit = await prepared(missingAppointment.id);
    expect(permit.appointment.participants[0].name).toBe('Bruno Demo');
    expect(permit.eligibility.participants[0].items[0].status).toBe('MISSING');
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    await expect(upload(missingAppointment.id, id(40), id(242))).rejects.toMatchObject({ code: 'INVALID_ASSIGNMENT' });
  });
  it('upload exige conferência e a rejeição da evidência atual bloqueia o início após liberação', async () => {
    let permit = await prepared();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    const value = await upload(id(221), id(40), id(240), '2099-01-01');
    expect(value.status).toBe('PENDING');
    await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    await call(`/evidence/${value.id}/review`, 'POST', { decision: 'REJECT', reason: 'Vínculo ou conteúdo não comprovado no exemplo.' }, engineer(), value.revision);
    const current = await call<WorkPermitDto>(`/work-permits/${permit.id}`);
    expect(current.eligibility.participants[0].items[0].status).toBe('REJECTED');
    await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
  });
  it('mesmo um arquivo conferido não satisfaz requisito com validade encerrada', async () => {
    const permit = await prepared();
    const value = await upload(id(221), id(40), id(240));
    await call(`/evidence/${value.id}/review`, 'POST', { decision: 'APPROVE' }, engineer(), value.revision);
    const check = await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`);
    expect(check.participants[0].items[0].status).toBe('EXPIRED');
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
  });
  it('a matriz didática exige vigência da capacitação e rejeita data inexistente', async () => {
    await expect(upload(id(221), id(40), id(240), '')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'validUntil' });
    await expect(upload(id(221), id(40), id(240), '2099-02-31')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'validUntil' });
    const result = await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`);
    expect(result.participants[0].items[0]).toMatchObject({ validFromRequired: true, validUntilRequired: true });
  });
  it('revalida o vencimento entre liberação e início', async () => {
    let permit = await prepared();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    const until = permit.eligibility.participants[0].items[0].validUntil!;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(`${until}T23:59:59-03:00`).getTime() + 86400000);
      await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    } finally { vi.useRealTimers(); }
  });
  it('restringe atendimento ao responsável e não concede liberação ao administrador', async () => {
    const permit = await prepared();
    const other = context(26, 'Felipe Demo', operational);
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, other, permit.revision)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const admin = context(23, 'Lucas Demo', managerPermissions.filter(permission => permission !== 'permits.review'));
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, admin, permit.revision)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, engineer(), permit.revision)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('não aceita revisão concorrente nem falta de If-Match', async () => {
    const permit = await prepared();
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision - 1)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 412 });
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician())).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
  });
  it('preserva autoria e impede ciência falsa ou alteração de checklist já apresentado', async () => {
    const permit = await prepared();
    expect(permit.sciences[0].collectedBy).toBe(id(25));
    expect(permit.sciences[0].workerId).toBe(id(40));
    await expect(call(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist }, technician(), permit.revision)).rejects.toMatchObject({ code: 'SCIENCE_LOCKED_CHECKLIST' });
    await expect(call(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Outro participante', method: 'TYPED', representation: 'Outro participante', confirmed: true }, technician(), permit.revision)).rejects.toMatchObject({ code: 'DECLARANT_MISMATCH' });
  });
  it('conclui operação e permite aprovação somente com representação própria explícita', async () => {
    let permit = await prepared();
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/complete`, 'POST', { summary: 'Atendimento concluído no cenário didático.', closingChecks: permit.preparation!.closingChecks.map(item => ({ ...item, answer: 'YES' })) }, technician(), permit.revision);
    expect(permit.operationStatus).toBe('COMPLETED');
    expect(permit.reviewStatus).toBe('PENDING_REVIEW');
    await expect(call(`/work-permits/${permit.id}/review`, 'POST', { decision: 'APPROVE', comment: 'Conferido no exemplo.' }, engineer(), permit.revision)).rejects.toMatchObject({ field: 'signatureRepresentation' });
    await expect(call(`/work-permits/${permit.id}/review`, 'POST', { decision: 'APPROVE', comment: 'Conferido no exemplo.', signatureRepresentation: 'Diego Demo' }, engineer(), permit.revision)).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    const reviewed = await call<WorkPermitDto>(`/work-permits/${permit.id}/review`, 'POST', { decision: 'APPROVE', comment: 'Conferido no exemplo.', signatureRepresentation: 'Marina Demo' }, engineer(), permit.revision);
    expect(reviewed.reviewStatus).toBe('VALIDATED');
    expect(reviewed.snapshots[0]).toMatchObject({ reviewedBy: id(20), signatureRepresentation: 'Marina Demo', decision: 'APPROVE' });
    await expect(call(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: reviewed.checklist }, technician(), reviewed.revision)).rejects.toMatchObject({ code: 'IMMUTABLE_VERSION' });
  });
  it('devolução preserva operação concluída e correção cria versão sem reabrir execução', async () => {
    let permit = await call<WorkPermitDto>(`/work-permits/${id(230)}`, 'GET', undefined, engineer());
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/review`, 'POST', { decision: 'RETURN', comment: 'Complemente o resumo do atendimento.' }, engineer(), permit.revision);
    const original = JSON.parse(JSON.stringify(permit.snapshots[0]));
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/new-version`, 'POST', { reason: 'Complementar a informação solicitada.' }, technician(), permit.revision);
    expect(permit.operationStatus).toBe('COMPLETED');
    expect(permit.reviewStatus).toBe('NOT_SUBMITTED');
    expect(permit.version).toBe(2);
    expect(permit.sciences).toEqual([]);
    await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), permit.revision)).rejects.toMatchObject({ code: 'RELEASE_REQUIRED' });
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', { workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED', representation: 'Camila Demo', confirmed: true }, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/submit-correction`, 'POST', { summary: 'Resumo complementado sem executar novo trabalho.' }, technician(), permit.revision);
    expect(permit.operationStatus).toBe('COMPLETED');
    expect(permit.reviewStatus).toBe('PENDING_REVIEW');
    expect(permit.snapshots).toHaveLength(2);
    expect(permit.snapshots[0]).toEqual(original);
    expect(permit.snapshots[1].version).toBe(2);
  });
  it('aprovação permite observação vazia, mas exige assinatura própria, e devolução exige motivo', async () => {
    const permit = await call<WorkPermitDto>(`/work-permits/${id(230)}`, 'GET', undefined, engineer());
    await expect(call(`/work-permits/${permit.id}/review`, 'POST', { decision: 'RETURN', comment: '' }, engineer(), permit.revision)).rejects.toMatchObject({ field: 'comment' });
    const reviewed = await call<WorkPermitDto>(`/work-permits/${permit.id}/review`, 'POST', { decision: 'APPROVE', comment: '', signatureRepresentation: 'Marina Demo' }, engineer(), permit.revision);
    expect(reviewed.reviewStatus).toBe('VALIDATED');
    expect(reviewed.snapshots[0].comment).toBe('');
  });
  it('não expõe arquivo/datas de informação restrita e impede conferência genérica', async () => {
    const result = await call<EligibilityDto>(`/appointments/${id(221)}/eligibility`, 'GET', undefined, engineer());
    const restricted = result.participants[0].items.find(item => item.restricted)!;
    expect(restricted.status).toBe('APPROVED');
    expect(restricted.evidenceId).toBeUndefined();
    expect(restricted.fileName).toBeUndefined();
    expect(restricted.validUntil).toBeUndefined();
    await expect(call(`/evidence/${id(252)}/review`, 'POST', { decision: 'APPROVE' }, engineer(), 1)).rejects.toMatchObject({ code: 'RESTRICTED_EVIDENCE' });
    await expect(call(`/evidence/${id(252)}/download`, 'GET', undefined, engineer())).rejects.toMatchObject({ code: 'RESTRICTED_EVIDENCE' });
  });
  it('filtro de pendência e dashboard usam a mesma avaliação por unidade', async () => {
    const list = await call<AppointmentDto[]>(`/appointments?unitId=${UNIT_A}&eligibility=blocked`, 'GET', undefined, engineer());
    const dashboard = await call<PermitDashboardDto>(`/permit-dashboard?unitId=${UNIT_A}`, 'GET', undefined, engineer());
    expect(list.map(value => value.id)).toEqual([id(220)]);
    expect(dashboard.blockedAppointments).toBe(list.length);
    expect(dashboard.pendingReviews).toBe(1);
    expect(dashboard.nextAppointments.every(value => value.unitId === UNIT_A)).toBe(true);
  });
  it('filtra atendimentos por equipe, responsável, serviço, local e período (#102)', async () => {
    const byTeam = await call<AppointmentDto[]>(`/appointments?unitId=${UNIT_A}&teamId=${id(201)}`, 'GET', undefined, engineer());
    expect(byTeam.every(a => a.teamId === id(201))).toBe(true);

    const byResponsible = await call<AppointmentDto[]>(`/appointments?unitId=${UNIT_A}&responsibleId=${id(25)}`, 'GET', undefined, engineer());
    expect(byResponsible.every(a => a.responsibleId === id(25))).toBe(true);

    const byService = await call<AppointmentDto[]>(`/appointments?unitId=${UNIT_A}&serviceTypeId=${id(210)}`, 'GET', undefined, engineer());
    expect(byService.every(a => (a.serviceTypeIds || [a.serviceTypeId]).includes(id(210)))).toBe(true);

    const byLocation = await call<AppointmentDto[]>(`/appointments?unitId=${UNIT_A}&location=Área A`, 'GET', undefined, engineer());
    expect(byLocation.length).toBeGreaterThan(0);
    expect(byLocation.every(a => a.location.includes('Área A'))).toBe(true);

    const fromDate = '2026-01-01';
    const toDate = '2030-12-31';
    const byPeriod = await call<AppointmentDto[]>(`/appointments?unitId=${UNIT_A}&from=${fromDate}&to=${toDate}`, 'GET', undefined, engineer());
    expect(byPeriod.length).toBeGreaterThan(0);
  });
  it('confirmação separa horário solicitado do confirmado e preserva no histórico (#102)', async () => {
    const appointment = await call<AppointmentDto>(`/appointments/${id(222)}`, 'GET', undefined, engineer());
    expect(appointment.status).toBe('REQUESTED');
    expect(appointment.requestedStartsAt).toBeDefined();

    const confirmedStartsAt = '2026-10-25T14:00:00-03:00';
    const confirmedEndsAt = '2026-10-25T17:00:00-03:00';

    const confirmed = await call<AppointmentDto>(
      `/appointments/${appointment.id}/confirm`,
      'POST',
      { confirmedStartsAt, confirmedEndsAt, note: 'Janela ajustada pelo responsável operacional' },
      engineer(),
      appointment.revision
    );

    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.startsAt).toBe(confirmedStartsAt);
    expect(confirmed.endsAt).toBe(confirmedEndsAt);
    expect(confirmed.confirmedStartsAt).toBe(confirmedStartsAt);
    expect(confirmed.confirmedEndsAt).toBe(confirmedEndsAt);
    expect(confirmed.requestedStartsAt).toBe(appointment.startsAt);
    expect(confirmed.history.some(e => e.action === 'APPOINTMENT_CONFIRMED' && e.reason?.includes('Horário confirmado'))).toBe(true);
  });

  it('revisão com assinatura desenhada DRAWN persiste imagem e método no snapshot (#112)', async () => {
    const permit = await call<WorkPermitDto>(`/work-permits/${id(230)}`, 'GET', undefined, engineer());
    const signatureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const reviewed = await call<WorkPermitDto>(
      `/work-permits/${permit.id}/review`,
      'POST',
      {
        decision: 'APPROVE',
        comment: 'Aprovado com assinatura desenhada em campo.',
        signatureMethod: 'DRAWN',
        signatureImage,
      },
      engineer(),
      permit.revision
    );

    expect(reviewed.reviewStatus).toBe('VALIDATED');
    expect(reviewed.snapshots[0].decision).toBe('APPROVE');
    expect(reviewed.snapshots[0].signatureMethod).toBe('DRAWN');
    expect(reviewed.snapshots[0].signatureImage).toBe(signatureImage);
    expect(reviewed.snapshots[0].signatureRepresentation).toBe('Marina Demo');
  });

  it('revisão com upload de rubrica IMAGE persiste imagem e método no snapshot (#112)', async () => {
    const permit = await call<WorkPermitDto>(`/work-permits/${id(230)}`, 'GET', undefined, engineer());
    const signatureImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const reviewed = await call<WorkPermitDto>(
      `/work-permits/${permit.id}/review`,
      'POST',
      {
        decision: 'APPROVE',
        comment: 'Aprovado com rubrica digitalizada.',
        signatureMethod: 'IMAGE',
        signatureImage,
      },
      engineer(),
      permit.revision
    );

    expect(reviewed.reviewStatus).toBe('VALIDATED');
    expect(reviewed.snapshots[0].decision).toBe('APPROVE');
    expect(reviewed.snapshots[0].signatureMethod).toBe('IMAGE');
    expect(reviewed.snapshots[0].signatureImage).toBe(signatureImage);
    expect(reviewed.snapshots[0].signatureRepresentation).toBe('Marina Demo');
  });

  it('disponibiliza download de PDF final controlado sintético e suporta alias /pts (#115)', async () => {
    const pdfDirect = await call<FinalPdfDto>(`/work-permits/${id(230)}/final-pdf`, 'GET', undefined, engineer());
    expect(pdfDirect.fileName).toBe(`PT-DEMO-230-final-v1.pdf`);
    expect(pdfDirect.mimeType).toBe('application/pdf');
    expect(pdfDirect.backendPersisted).toBe(false);
    expect(pdfDirect.disclaimer).toContain('demonstrativo');
    expect(pdfDirect.url).toContain('blob:');

    const pdfAlias = await call<FinalPdfDto>(`/pts/${id(230)}/final-pdf`, 'GET', undefined, engineer());
    expect(pdfAlias.fileName).toBe(pdfDirect.fileName);

    const openPermit = await prepared(id(221), false);
    await expect(call(`/work-permits/${openPermit.id}/final-pdf`, 'GET', undefined, engineer())).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });

  it('atualização de participantes revoga ciências de membros removidos e recalcula elegibilidade (#94/#116)', async () => {
    const permit = await prepared(id(220), true);
    expect(permit.appointment.participants.length).toBe(2);
    expect(permit.sciences.length).toBe(2);

    const retainedWorkerId = permit.appointment.participants[0].workerId;
    const removedWorkerId = permit.appointment.participants[1].workerId;

    const updated = await call<WorkPermitDto>(
      `/work-permits/${permit.id}/participants`,
      'PATCH',
      {
        participants: [
          { workerId: retainedWorkerId, name: permit.appointment.participants[0].name, serviceFunction: 'Líder de Frente' },
        ],
        reason: 'Redução de equipe por escopo ajustado',
      },
      technician(),
      permit.revision
    );

    expect(updated.appointment.participants.length).toBe(1);
    expect(updated.appointment.participants[0].workerId).toBe(retainedWorkerId);
    expect(updated.appointment.participants[0].serviceFunction).toBe('Líder de Frente');
    expect(updated.sciences.length).toBe(1);
    expect(updated.sciences[0].workerId).toBe(retainedWorkerId);
    expect(updated.sciences.some(s => s.workerId === removedWorkerId)).toBe(false);
    expect(updated.history.some(e => e.action === 'PARTICIPANTS_UPDATED' && e.reason?.includes('Redução de equipe'))).toBe(true);

    await expect(
      call(
        `/work-permits/${permit.id}/participants`,
        'PATCH',
        {
          participants: [{ workerId: retainedWorkerId, name: permit.appointment.participants[0].name, serviceFunction: 'Líder' }],
          reason: 'Conflito de concorrência',
        },
        technician(),
        permit.revision
      )
    ).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
  });
});

