import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkPermitDto } from '../shared/contracts/work-permits';
import type { PermitLifecycleCommand, PermitLifecycleRecordDto } from '../shared/contracts/permit-lifecycle';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, PermitDemoError, type PermitDemoContext } from './work-permits';
import { makePermitLifecycleDemo } from './permit-lifecycle';

function actor(userId = 25, permissions = ['permits.read', 'permits.operate']): PermitDemoContext {
  return { user: { id: id(userId), displayName: 'Responsável Demo', email: 'actor@demo.local', roles: [], status: 'ACTIVE', mfaRequired: false, revision: 1,
    scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], teamIds: [], sectorIds: [], ownOnly: false } }, permissions, workers: makeFixtures().workers,
    checkUnit: unit => { if (unit !== UNIT_A) throw new Error('Unidade fora do contexto atual.'); } };
}
const confirmedResume = { reason: 'Condições conferidas e restabelecidas.', confirmed: true, sameTeam: true, sameConditions: true };
describe('suspensão, retomada e cancelamento da PT na demo', () => {
  let permit: PermitLifecycleRecordDto;
  let prepared: ReturnType<typeof vi.fn<(value: WorkPermitDto, context: PermitDemoContext) => void | Promise<void>>>;
  let module: ReturnType<typeof makePermitLifecycleDemo>;
  beforeEach(async () => {
    const source = makePermitDemo();
    const path = `/work-permits/${id(230)}`;
    const url = new URL(`http://localhost/api/v1${path}`);
    permit = await source.route(new Request(url), url, path, actor(20, ['permits.read', 'permits.review'])) as WorkPermitDto;
    permit.operationStatus = 'EXECUTING'; permit.reviewStatus = 'NOT_SUBMITTED'; permit.availableActions = ['COMPLETE'];
    prepared = vi.fn((value: WorkPermitDto) => {
      if (!value.eligibility.eligible) throw new PermitDemoError(409, 'DOCUMENTARY_BLOCK', 'Documentação atual não permite retomar.');
      if (value.checklist.some(item => item.required && item.answer !== 'YES')) throw new PermitDemoError(409, 'CHECKLIST_PENDING', 'Checklist não conferido.');
      if (value.appointment.participants.some(person => !value.sciences.some(science => science.workerId === person.workerId && science.version === value.version))) throw new PermitDemoError(409, 'SCIENCES_PENDING', 'Ciências não registradas.');
    });
    module = makePermitLifecycleDemo(prepared);
  });
  async function call(command: PermitLifecycleCommand, input: unknown = { reason: 'Interrupção por condição inesperada.', confirmed: true }, context = actor(), revision: number | null = permit.revision) {
    const path = `/work-permits/${permit.id}/${command}`;
    const headers = new Headers({ 'Content-Type': 'application/json' }); if (revision !== null) headers.set('If-Match', `"${revision}"`);
    const request = new Request(`http://localhost/api/v1${path}`, { method: 'POST', headers, body: JSON.stringify(input) });
    return await module.route(request, path, permit as WorkPermitDto, context) as PermitLifecycleRecordDto;
  }
  it.each(['RELEASED', 'EXECUTING'] as const)('suspende %s, preserva versão e documentos e retoma somente o estado anterior', async previous => {
    permit.operationStatus = previous;
    if (previous === 'RELEASED') permit.startedAt = undefined;
    const preserved = structuredClone({ checklist: permit.checklist, sciences: permit.sciences, preparation: permit.preparation, snapshots: permit.snapshots, releasedAt: permit.releasedAt, startedAt: permit.startedAt, version: permit.version });
    const beforeRevision = permit.revision;
    const suspended = await call('suspend');
    expect(suspended).toMatchObject({ operationStatus: 'SUSPENDED', revision: beforeRevision + 1, lifecycle: { suspendedFrom: previous, suspendedBy: id(25), suspensionReason: 'Interrupção por condição inesperada.' } });
    expect(prepared).not.toHaveBeenCalled();
    expect(suspended.history.at(-1)).toMatchObject({ action: 'OPERATION_SUSPENDED', version: permit.version });
    const resumed = await call('resume', confirmedResume);
    expect(resumed.operationStatus).toBe(previous); expect(resumed.revision).toBe(beforeRevision + 2);
    expect(prepared).toHaveBeenCalledOnce(); expect(prepared).toHaveBeenCalledWith(permit, expect.anything());
    expect({ checklist: resumed.checklist, sciences: resumed.sciences, preparation: resumed.preparation, snapshots: resumed.snapshots, releasedAt: resumed.releasedAt, startedAt: resumed.startedAt, version: resumed.version }).toEqual(preserved);
    expect(resumed.history.at(-1)).toMatchObject({ action: 'OPERATION_RESUMED', actorName: 'Responsável Demo', version: permit.version });
  });
  it('mantém registro de interrupções anteriores no histórico durante nova suspensão', async () => {
    await call('suspend', { reason: 'Primeira interrupção para conferir ambiente.', confirmed: true }); await call('resume', confirmedResume);
    const resumedAt = permit.lifecycle!.resumedAt;
    await call('suspend', { reason: 'Segunda interrupção para conferir acesso.', confirmed: true });
    expect(permit.lifecycle!.resumedAt).toBeUndefined();
    expect(permit.history.filter(value => value.action === 'OPERATION_SUSPENDED')).toHaveLength(2);
    expect(permit.history.find(value => value.action === 'OPERATION_RESUMED')!.occurredAt).toBe(resumedAt);
  });
  it.each(['VERIFICATION', 'COMPLETED', 'CANCELED', 'SUSPENDED'] as const)('não suspende o estado %s', async status => {
    permit.operationStatus = status;
    await expect(call('suspend')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it.each([undefined, false, 'true'])('suspensão exige confirmação booleana explícita e rejeita %s sem alterar o registro', async confirmed => {
    const original = structuredClone(permit);
    await expect(call('suspend', { reason: 'Interrupção fictícia por condição inesperada.', confirmed })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED', status: 422, field: 'confirmed' });
    expect(permit).toEqual(original);
  });
  it('nega retomada quando a documentação atual passou a bloquear a execução', async () => {
    await call('suspend'); const revision = permit.revision; const events = structuredClone(permit.history);
    permit.eligibility.eligible = false;
    await expect(call('resume', confirmedResume)).rejects.toMatchObject({ code: 'DOCUMENTARY_BLOCK' });
    expect(permit.operationStatus).toBe('SUSPENDED'); expect(permit.revision).toBe(revision); expect(permit.history).toEqual(events);
  });
  it('reconfere checklist e ciências antes de retomar', async () => {
    await call('suspend'); permit.checklist[0].answer = 'NO';
    await expect(call('resume', confirmedResume)).rejects.toMatchObject({ code: 'CHECKLIST_PENDING' });
    permit.checklist[0].answer = 'YES'; permit.sciences = [];
    await expect(call('resume', confirmedResume)).rejects.toMatchObject({ code: 'SCIENCES_PENDING' });
    expect(permit.operationStatus).toBe('SUSPENDED');
  });
  it('exige confirmações booleanas e bloqueia retomada com equipe ou condições alteradas', async () => {
    await call('suspend');
    await expect(call('resume', { ...confirmedResume, confirmed: 'true' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED', field: 'confirmed' });
    await expect(call('resume', { ...confirmedResume, sameTeam: false })).rejects.toMatchObject({ code: 'TEAM_CHANGED', field: 'sameTeam' });
    await expect(call('resume', { ...confirmedResume, sameConditions: false })).rejects.toMatchObject({ code: 'CONDITIONS_CHANGED', field: 'sameConditions' });
    expect(prepared).not.toHaveBeenCalled(); expect(permit.operationStatus).toBe('SUSPENDED');
  });
  it('exige suspensão e estado anterior conhecido para retomar', async () => {
    await expect(call('resume', confirmedResume)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    permit.operationStatus = 'SUSPENDED'; permit.lifecycle = {};
    await expect(call('resume', confirmedResume)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it.each(['VERIFICATION', 'RELEASED', 'SUSPENDED'] as const)('cancela %s preservando agendamento, ciências e snapshots', async status => {
    permit.operationStatus = status;
    const appointment = structuredClone(permit.appointment); const sciences = structuredClone(permit.sciences); const snapshots = structuredClone(permit.snapshots);
    const result = await call('cancel', { reason: 'Serviço não será realizado nesta permissão.', confirmed: true });
    expect(result.operationStatus).toBe('CANCELED'); expect(result.availableActions).toEqual([]);
    expect(result.appointment).toEqual(appointment); expect(result.sciences).toEqual(sciences); expect(result.snapshots).toEqual(snapshots);
    expect(result.history.at(-1)).toMatchObject({ action: 'PERMIT_CANCELED', version: result.version });
  });
  it('não cancela execução diretamente nem operação concluída ou já cancelada', async () => {
    await expect(call('cancel', { reason: 'Cancelar sem suspensão.', confirmed: true })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    for (const status of ['COMPLETED', 'CANCELED'] as const) { permit.operationStatus = status; await expect(call('cancel', { reason: 'Cancelar registro encerrado.', confirmed: true })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' }); }
  });
  it('exige motivo de 5 a 1.000 caracteres e confirmação explícita para cancelar', async () => {
    permit.operationStatus = 'VERIFICATION';
    await expect(call('cancel', { reason: 'abc', confirmed: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'reason' });
    await expect(call('cancel', { reason: 'a'.repeat(1001), confirmed: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', field: 'reason' });
    await expect(call('cancel', { reason: 'Motivo válido para cancelar.', confirmed: false })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });
  it('autoriza somente o responsável com alcance, consulta e operação', async () => {
    await expect(call('suspend', undefined, actor(20, ['permits.read', 'permits.review']))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(call('suspend', undefined, actor(25, ['permits.operate']))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(call('suspend', undefined, actor(26))).rejects.toMatchObject({ code: 'NOT_DESIGNATED' });
    const outside = actor(); outside.user.scope.unitIds = [UNIT_B];
    await expect(call('suspend', undefined, outside)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(permit.operationStatus).toBe('EXECUTING');
  });
  it('rejeita falta de If-Match, revisão concorrente e alteração durante conferência da retomada', async () => {
    await expect(call('suspend', undefined, actor(), null)).rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 });
    await expect(call('suspend', undefined, actor(), permit.revision - 1)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 412 });
    await call('suspend'); const events = structuredClone(permit.history);
    prepared.mockImplementation(async () => { permit.revision++; });
    await expect(call('resume', confirmedResume)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', status: 412 });
    expect(permit.operationStatus).toBe('SUSPENDED'); expect(permit.history).toEqual(events);
  });
  it('não permite ações operacionais depois do envio para revisão', async () => {
    permit.reviewStatus = 'PENDING_REVIEW';
    await expect(call('suspend')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
  it('não captura outras subrotas nem permite ação por GET', async () => {
    expect(module.handles(`/work-permits/${permit.id}/resume/history`)).toBe(false);
    const path = `/work-permits/${permit.id}/suspend`;
    await expect(module.route(new Request(`http://localhost${path}`), path, permit as WorkPermitDto, actor())).rejects.toMatchObject({ status: 405 });
    expect(await module.route(new Request('http://localhost/unknown'), '/unknown', permit as WorkPermitDto, actor())).toBeUndefined();
  });
});
