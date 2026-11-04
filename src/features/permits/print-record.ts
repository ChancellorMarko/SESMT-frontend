import type { WorkPermitDto } from '../../shared/contracts/work-permits';

/** A printed historical version always uses its submitted content and decision. */
export function printablePermit(permit: WorkPermitDto, requestedVersion?: string | null) {
  if (requestedVersion !== undefined && requestedVersion !== null && !/^[1-9]\d*$/.test(requestedVersion)) return undefined;
  const version = requestedVersion == null ? permit.version : Number(requestedVersion);
  if (!Number.isSafeInteger(version) || version < 1) return undefined;
  const snapshot = permit.snapshots.find(item => item.version === version);
  if (!snapshot && version !== permit.version) return undefined;
  const isDraft = !snapshot && !['RELEASED', 'EXECUTING', 'SUSPENDED', 'CANCELED'].includes(permit.operationStatus);
  const liveStatus = permit.operationStatus === 'CANCELED' ? 'PERMISSÃO CANCELADA'
    : permit.operationStatus === 'SUSPENDED' ? 'OPERAÇÃO SUSPENSA'
    : permit.operationStatus === 'EXECUTING' ? 'EM EXECUÇÃO · REVISÃO NÃO ENVIADA'
    : permit.operationStatus === 'RELEASED' ? 'EXECUÇÃO LIBERADA · REVISÃO NÃO ENVIADA'
    : 'RASCUNHO · REGISTRO EM PREENCHIMENTO';
  return {
    version,
    snapshot,
    release: snapshot ? snapshot.release : permit.release,
    startedAt: snapshot ? snapshot.startedAt : permit.startedAt,
    completedAt: snapshot ? snapshot.completedAt : permit.completedAt,
    isDraft,
    identificationVersioned: !snapshot || Boolean(snapshot.appointment),
    templateVersion: snapshot?.templateVersion || (snapshot ? snapshot.preparation ? `${snapshot.preparation.sourceId} / ${snapshot.preparation.sourceRevision}` : 'Não registrado nesta versão histórica' : permit.templateVersion),
    appointment: snapshot?.appointment || permit.appointment,
    preparation: snapshot ? snapshot.preparation : permit.preparation,
    serviceTemplates: snapshot ? snapshot.serviceTemplates : permit.serviceTemplates,
    checklist: snapshot?.checklist || permit.checklist,
    sciences: snapshot?.sciences || permit.sciences.filter(item => item.version === version),
    summary: snapshot?.summary ?? permit.summary,
    eligibility: snapshot ? snapshot.eligibility : permit.eligibility,
    reviewStatus: snapshot ? snapshot.decision === 'APPROVE' ? 'VALIDATED' : snapshot.decision === 'RETURN' ? 'RETURNED' : 'PENDING_REVIEW' : 'NOT_SUBMITTED',
    documentStatus: !snapshot ? liveStatus : snapshot.decision === 'APPROVE' ? 'ENCERRAMENTO VALIDADO' : snapshot.decision === 'RETURN' ? 'DEVOLVIDA PARA CORREÇÃO' : 'PENDENTE DE REVISÃO',
    history: permit.history.filter(item => item.version === version),
  };
}
