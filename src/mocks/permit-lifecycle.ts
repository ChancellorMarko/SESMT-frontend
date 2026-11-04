import type { WorkPermitDto } from '../shared/contracts/work-permits';
import { PERMIT_LIFECYCLE_REASON_MAX, type PermitLifecycleRecordDto } from '../shared/contracts/permit-lifecycle';
import { PermitDemoError, type PermitDemoContext } from './work-permits';

function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function revision(request: Request, permit: PermitLifecycleRecordDto) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue a PT antes de confirmar esta ação.');
  assert(request.headers.get('If-Match') === `"${permit.revision}"`, 412, 'REVISION_CONFLICT', 'A PT mudou. Atualize e confira a versão atual antes de confirmar.');
}
function authorized(permit: PermitLifecycleRecordDto, context: PermitDemoContext) {
  assert(context.permissions.includes('permits.read') && context.permissions.includes('permits.operate'), 403, 'FORBIDDEN', 'Seu perfil não permite alterar a operação da PT.');
  assert(context.user.scope.unitIds.includes(permit.appointment.unitId)
    && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(permit.appointment.teamId)), 404, 'NOT_FOUND', 'PT indisponível no seu alcance.');
  context.checkUnit(permit.appointment.unitId);
  assert(permit.appointment.responsibleId === context.user.id, 403, 'NOT_DESIGNATED', 'Somente o responsável operacional designado pode realizar esta ação.');
}
type EnsurePrepared = (permit: WorkPermitDto, context: PermitDemoContext) => void | Promise<void>;
type CheckCoverage = (permit: WorkPermitDto, context: PermitDemoContext) => void | Promise<void>;

/** O domínio principal fornece sua conferência atual de checklist, ciências, preparo, elegibilidade e designações. */
export function makePermitLifecycleDemo(ensurePrepared: EnsurePrepared, checkCoverage?: CheckCoverage) {
  const handles = (path: string) => /^\/work-permits\/[^/]+\/(suspend|resume|cancel)$/.test(path);
  async function route(request: Request, path: string, value: WorkPermitDto, context: PermitDemoContext): Promise<PermitLifecycleRecordDto | undefined> {
    if (!handles(path)) return undefined;
    assert(request.method === 'POST', 405, 'METHOD_NOT_ALLOWED', 'Esta ação exige uma confirmação enviada à API.');
    const parts = path.split('/').filter(Boolean);
    const permit = value as PermitLifecycleRecordDto;
    assert(parts[1] === permit.id, 404, 'NOT_FOUND', 'PT indisponível.');
    authorized(permit, context); revision(request, permit);
    let input: Record<string, unknown>;
    try {
      const body: unknown = await request.json();
      assert(body && typeof body === 'object' && !Array.isArray(body), 422, 'VALIDATION_FAILED', 'Envie os dados da ação em um objeto.');
      input = body as Record<string, unknown>;
    } catch (error) {
      if (error instanceof PermitDemoError) throw error;
      throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Os dados da ação não são um JSON válido.');
    }
    assert(typeof input.reason === 'string' && input.reason.trim().length >= 5 && input.reason.length <= PERMIT_LIFECYCLE_REASON_MAX,
      422, 'VALIDATION_FAILED', 'Informe um motivo com 5 a 1.000 caracteres.', 'reason');
    const reason = input.reason.trim();
    const action = parts[2];
    const time = new Date().toISOString();
    const beforeRevision = permit.revision;
    const beforeVersion = permit.version;
    const beforeState = permit.operationStatus;
    assert(permit.reviewStatus === 'NOT_SUBMITTED', 409, 'INVALID_TRANSITION', 'Esta PT não possui uma operação aberta para esta ação.');

    if (action === 'suspend') {
      assert(permit.operationStatus === 'RELEASED' || permit.operationStatus === 'EXECUTING', 409, 'INVALID_TRANSITION', 'Somente uma operação liberada ou em execução pode ser suspensa.');
      assert(input.confirmed === true, 422, 'CONFIRMATION_REQUIRED', 'Confirme a suspensão desta PT.', 'confirmed');
    } else if (action === 'resume') {
      assert(permit.operationStatus === 'SUSPENDED', 409, 'INVALID_TRANSITION', 'Somente uma operação suspensa pode ser retomada.');
      assert(input.confirmed === true, 422, 'CONFIRMATION_REQUIRED', 'Confirme a conferência antes de retomar.', 'confirmed');
      assert(input.sameTeam === true, 409, 'TEAM_CHANGED', 'Alterações na equipe exigem nova análise e uma nova permissão; a retomada direta permanece bloqueada.', 'sameTeam');
      assert(input.sameConditions === true, 409, 'CONDITIONS_CHANGED', 'Condições diferentes exigem nova análise e uma nova permissão; a retomada direta permanece bloqueada.', 'sameConditions');
      assert(permit.lifecycle?.suspendedFrom === 'RELEASED' || permit.lifecycle?.suspendedFrom === 'EXECUTING', 409, 'INVALID_TRANSITION', 'O estado anterior à suspensão não está disponível. Recarregue o registro.');
      await ensurePrepared(value, context);
      if (checkCoverage) await checkCoverage(value, context);
    } else {
      assert(['VERIFICATION', 'RELEASED', 'SUSPENDED'].includes(permit.operationStatus), 409, 'INVALID_TRANSITION', 'Cancele apenas antes do início ou após suspensão. Suspenda primeiro uma execução em andamento.');
      assert(input.confirmed === true, 422, 'CONFIRMATION_REQUIRED', 'Confirme o cancelamento desta PT.', 'confirmed');
    }

    // Leituras de JSON e verificações podem ser assíncronas. Preserve uma revisão concorrente.
    authorized(permit, context); revision(request, permit);
    assert(permit.revision === beforeRevision && permit.version === beforeVersion && permit.operationStatus === beforeState && permit.reviewStatus === 'NOT_SUBMITTED',
      412, 'REVISION_CONFLICT', 'O estado ou a versão da PT mudou durante a confirmação.');
    if (action === 'suspend') {
      permit.lifecycle = { ...permit.lifecycle, suspendedFrom: beforeState as 'RELEASED' | 'EXECUTING', suspendedAt: time,
        suspensionReason: reason, suspendedBy: context.user.id, suspendedByName: context.user.displayName,
        resumedAt: undefined, resumeReason: undefined, resumedBy: undefined };
      permit.operationStatus = 'SUSPENDED';
    } else if (action === 'resume') {
      permit.operationStatus = permit.lifecycle!.suspendedFrom!;
      permit.lifecycle = { ...permit.lifecycle, resumedAt: time, resumeReason: reason, resumedBy: context.user.id };
    } else {
      permit.operationStatus = 'CANCELED';
      permit.lifecycle = { ...permit.lifecycle, canceledAt: time, cancellationReason: reason, canceledBy: context.user.id, canceledByName: context.user.displayName };
    }
    permit.revision++;
    permit.availableActions = [];
    permit.history.push({ id: crypto.randomUUID(), action: action === 'suspend' ? 'OPERATION_SUSPENDED' : action === 'resume' ? 'OPERATION_RESUMED' : 'PERMIT_CANCELED',
      actorName: context.user.displayName, occurredAt: time, reason, version: permit.version });
    return structuredClone(permit);
  }
  return { handles, route };
}
