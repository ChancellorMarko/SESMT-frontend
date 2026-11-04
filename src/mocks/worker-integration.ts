import type { DocumentDto, DocumentTypeDto, DocumentVersionDto, DownloadUrlDto, FileDto, WorkerDto, WorkerIntegrationEvidenceDto, WorkerIntegrationOptionsDto } from '../shared/contracts';
import { dateOnly } from '../shared/lib/format';

/** In-memory administrative proof workflow. No real scanning or storage is performed. */
export class IntegrationEvidenceError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}
function require(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new IntegrationEvidenceError(status, code, message, field);
}
const copy = <T,>(value: T): T => structuredClone(value);
export interface IntegrationEvidenceContext {
  worker: WorkerDto; userId: string; userName: string;
  can: (permission: string) => boolean; recheck: () => void;
}
type Dependencies = {
  documents: () => DocumentDto[]; versions: () => DocumentVersionDto[];
  documentVisible: (document: DocumentDto) => boolean;
  storeFile: (file: FormDataEntryValue | null, type: DocumentTypeDto) => Promise<FileDto>;
  download: (file: FileDto) => DownloadUrlDto;
  audit: (action: string, workerId: string) => void;
};
export function makeWorkerIntegrationDemo(dependencies: Dependencies) {
  const evidences = new Map<string, WorkerIntegrationEvidenceDto>();
  const scanReadyAt = new Map<string, number>();
  function policy(worker: WorkerDto) {
    const evidenceRequired = worker.integrationEvidenceRequired !== false;
    return { version: `DEMO-INTEGRACAO-1:${worker.companyId}:${worker.unitId}`, evidenceRequired, allowNotApplicable: !evidenceRequired, maxFileSizeBytes: 10 * 1024 * 1024, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'], description: `${evidenceRequired ? 'Este contexto demonstrativo exige comprovante conferido para concluir a integração.' : 'Neste contexto demonstrativo, o comprovante é opcional por uma exceção explicitamente configurada.'} A política não estabelece requisitos legais ou capacitação regulamentar.` };
  }
  function currentSource(worker: WorkerDto, documentId: string, versionId: string) {
    const availableNow = (value: Pick<DocumentDto, 'validFrom' | 'validUntil'>) => (!value.validFrom || value.validFrom <= dateOnly()) && (!value.validUntil || value.validUntil >= dateOnly());
    const document = dependencies.documents().find(value => value.id === documentId && value.companyId === worker.companyId && value.unitId === worker.unitId && value.workerIds.includes(worker.id) && ['APPROVED', 'ACTIVE'].includes(value.status) && value.accessClass !== 'MEDICAL' && availableNow(value) && dependencies.documentVisible(value));
    const version = dependencies.versions().find(value => value.id === versionId && value.documentId === documentId && ['APPROVED', 'ACTIVE'].includes(value.status) && value.metadataSnapshot.companyId === worker.companyId && value.metadataSnapshot.unitId === worker.unitId && value.metadataSnapshot.workerIds?.includes(worker.id) && value.metadataSnapshot.accessClass !== 'MEDICAL' && availableNow(value.metadataSnapshot) && value.file.scanStatus === 'CLEAN');
    return document && version ? { document, version } : undefined;
  }
  function options(context: IntegrationEvidenceContext): WorkerIntegrationOptionsDto {
    context.recheck(); require(context.can('workers.read'), 403, 'FORBIDDEN', 'Seu acesso não permite consultar esta integração.');
    const worker = context.worker;
    const documents = context.can('documents.read') ? dependencies.documents().flatMap(document => {
      const versions = dependencies.versions().filter(version => currentSource(worker, document.id, version.id)).map(({ id, versionNumber, file }) => ({ id, versionNumber, file: copy(file) }));
      return versions.length ? [{ documentId: document.id, title: document.title, code: document.code, versions }] : [];
    }) : [];
    return { policy: policy(worker), documents };
  }
  function processScans() {
    for (const [evidenceId, when] of scanReadyAt) if (when <= Date.now()) {
      const evidence = evidences.get(evidenceId); if (evidence) evidence.file.scanStatus = 'CLEAN';
      scanReadyAt.delete(evidenceId);
    }
  }
  function get(id: string, context: IntegrationEvidenceContext) {
    context.recheck(); processScans();
    const evidence = evidences.get(id), worker = context.worker;
    require(evidence && evidence.workerId === worker.id && evidence.companyId === worker.companyId && evidence.unitId === worker.unitId, 404, 'NOT_FOUND', 'Comprovante indisponível neste vínculo.');
    return evidence;
  }
  function forRegistration(id: string, context: IntegrationEvidenceContext, integrated = false) {
    const evidence = get(id, context);
    if (evidence.source === 'DOCUMENT_VERSION') {
      const source = currentSource(context.worker, evidence.documentId!, evidence.documentVersionId!);
      require(source && source.version.file.id === evidence.file.id && source.version.file.sha256 === evidence.file.sha256, 409, 'SOURCE_UNAVAILABLE', 'A versão documental vinculada mudou ou deixou de estar disponível.');
    }
    if (integrated) require(evidence.status === 'APPROVED' && evidence.file.scanStatus === 'CLEAN', 422, 'INTEGRATION_EVIDENCE_PENDING', 'O comprovante precisa estar conferido antes de registrar a integração como concluída.', 'evidenceId');
    return copy(evidence);
  }
  function operationalState(worker: WorkerDto, startsAt: string, endsAt: string) {
    const civil = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
    const currentDay = dateOnly(), startsOn = civil(startsAt), endsOn = civil(endsAt);
    if (worker.integrationEvidenceRequired === false) {
      if (worker.integrationStatus === 'NOT_APPLICABLE') return undefined;
      const validity = { validFrom: worker.integratedAt, validUntil: worker.integrationValidUntil };
      if (worker.integrationStatus === 'EXPIRED' || worker.integrationValidUntil && (worker.integrationValidUntil < currentDay || worker.integrationValidUntil < endsOn)) return { status: 'EXPIRED' as const, reason: 'A integração não cobre a data atual e o período planejado.', ...validity };
      if (worker.integrationStatus === 'INTEGRATED' && worker.integratedAt && worker.integratedAt <= startsOn && worker.integratedAt <= currentDay) return undefined;
      return { status: 'PENDING' as const, reason: 'Registre a integração concluída com datas que cubram a data atual e o período planejado. O comprovante é opcional nesta política.', ...validity };
    }
    processScans();
    const evidence = worker.integrationEvidence && evidences.get(worker.integrationEvidence.id);
    const source = evidence?.source === 'DOCUMENT_VERSION' ? currentSource(worker, evidence.documentId!, evidence.documentVersionId!) : undefined;
    let status: 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' = 'PENDING';
    let reason = 'Registre a integração concluída e vincule um comprovante conferido.';
    if (!evidence) { status = 'MISSING'; reason = 'Comprovante de integração não vinculado.'; }
    else if (evidence.workerId !== worker.id || evidence.companyId !== worker.companyId || evidence.unitId !== worker.unitId) { status = 'REJECTED'; reason = 'Comprovante incompatível com o vínculo atual.'; }
    else if (evidence.status === 'REJECTED') { status = 'REJECTED'; reason = 'O comprovante foi devolvido.'; }
    else if (evidence.status !== 'APPROVED' || evidence.file.scanStatus !== 'CLEAN') { reason = 'O comprovante ainda não foi conferido.'; }
    else if (evidence.source === 'DOCUMENT_VERSION' && !source) { status = 'REJECTED'; reason = 'A versão documental vinculada não está mais disponível.'; }
    else if (source && [source.document.validUntil, source.version.metadataSnapshot.validUntil].some(until => until && until < endsOn)) { status = 'EXPIRED'; reason = 'A vigência da versão documental não cobre o período planejado.'; }
    else if (source && [source.document.validFrom, source.version.metadataSnapshot.validFrom].some(from => from && from > startsOn)) { reason = 'A versão documental não cobre o início do período planejado.'; }
    else if (worker.integrationStatus === 'EXPIRED' || worker.integrationValidUntil && (worker.integrationValidUntil < currentDay || worker.integrationValidUntil < endsOn)) { status = 'EXPIRED'; reason = 'A integração não cobre a data atual e o período planejado.'; }
    else if (worker.integrationStatus === 'INTEGRATED' && worker.integratedAt && worker.integratedAt <= startsOn && worker.integratedAt <= currentDay) { status = 'APPROVED'; reason = ''; }
    return { status, reason: reason || undefined, evidenceId: evidence?.id, evidenceRevision: evidence?.revision, fileName: evidence?.file.name, validFrom: worker.integratedAt, validUntil: worker.integrationValidUntil };
  }
  function matchingRevision(request: Request, revision: number) {
    require(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue a revisão atual antes de alterar.');
    require(request.headers.get('If-Match') === `"${revision}"`, 412, 'REVISION_CONFLICT', 'O registro mudou. Seu preenchimento foi preservado; confira a revisão atual.');
  }
  async function route(request: Request, path: string, context: IntegrationEvidenceContext) {
    const base = `/workers/${context.worker.id}/integration`;
    if (path !== `${base}/options` && !path.startsWith(`${base}/evidences`)) return undefined;
    context.recheck(); require(context.can('workers.read'), 403, 'FORBIDDEN', 'Seu acesso não permite consultar esta integração.');
    if (path === `${base}/options`) { require(request.method === 'GET', 405, 'METHOD_NOT_ALLOWED', 'Método indisponível.'); return options(context); }
    if (path === `${base}/evidences` && request.method === 'GET') {
      processScans(); return [...evidences.values()].filter(value => value.workerId === context.worker.id && value.companyId === context.worker.companyId && value.unitId === context.worker.unitId).map(copy).reverse();
    }
    if (path === `${base}/evidences` && request.method === 'POST') {
      require(context.can('workers.write') && context.worker.status === 'ACTIVE', 403, 'FORBIDDEN', 'Seu acesso não permite enviar comprovantes para este trabalhador.');
      const worker = context.worker, companyId = worker.companyId, unitId = worker.unitId, revision = worker.revision;
      matchingRevision(request, revision);
      let file: FileDto, source: WorkerIntegrationEvidenceDto['source'] = 'UPLOAD', documentId: string | undefined, documentVersionId: string | undefined;
      if (request.headers.get('Content-Type')?.startsWith('multipart/form-data')) {
        let form: FormData; try { form = await request.formData(); } catch { throw new IntegrationEvidenceError(422, 'VALIDATION_FAILED', 'Envie um arquivo válido.', 'file'); }
        require([...form.keys()].every(key => key === 'file') && form.getAll('file').length === 1, 422, 'VALIDATION_FAILED', 'Envie somente um comprovante.', 'file');
        const selected = form.get('file'); require(selected && typeof selected !== 'string' && Object.prototype.toString.call(selected) === '[object File]' && selected.name.length <= 255, 422, 'VALIDATION_FAILED', 'Selecione um arquivo com nome válido.', 'file');
        const limits = policy(worker);
        require(selected.size > 0 && selected.size <= limits.maxFileSizeBytes, 413, 'FILE_TOO_LARGE', 'Selecione um arquivo de até 10 MB, com conteúdo.', 'file');
        require(limits.allowedMimeTypes.includes(selected.type), 415, 'UNSUPPORTED_MEDIA_TYPE', 'Use PDF, PNG ou JPEG.', 'file');
        const bytes = new Uint8Array(await selected.slice(0, 8).arrayBuffer());
        const headerValid = selected.type === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' : selected.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        require(headerValid, 415, 'UNSUPPORTED_MEDIA_TYPE', 'O conteúdo não corresponde ao formato informado.', 'file');
        file = await dependencies.storeFile(selected, { maxFileSizeBytes: limits.maxFileSizeBytes, allowedMimeTypes: limits.allowedMimeTypes } as DocumentTypeDto);
      } else {
        let body: unknown; try { body = await request.json(); } catch { throw new IntegrationEvidenceError(422, 'VALIDATION_FAILED', 'Envie uma referência documental válida.'); }
        require(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => ['documentId', 'documentVersionId'].includes(key)), 422, 'VALIDATION_FAILED', 'Envie somente a referência da versão documental.');
        const input = body as { documentId: string; documentVersionId: string };
        require(context.can('documents.read') && typeof input.documentId === 'string' && typeof input.documentVersionId === 'string', 422, 'VALIDATION_FAILED', 'Selecione uma versão documental permitida.');
        const linked = currentSource(worker, input.documentId, input.documentVersionId);
        require(linked, 422, 'INVALID_ASSIGNMENT', 'A versão deve estar conferida, disponível e vinculada a este trabalhador e a este vínculo.');
        source = 'DOCUMENT_VERSION'; documentId = input.documentId; documentVersionId = input.documentVersionId; file = copy(linked.version.file);
      }
      context.recheck(); require(context.can('workers.write') && worker.status === 'ACTIVE', 403, 'FORBIDDEN', 'Sua concessão não permite este envio.'); matchingRevision(request, worker.revision);
      require(worker.companyId === companyId && worker.unitId === unitId && worker.revision === revision, 412, 'REVISION_CONFLICT', 'O vínculo do trabalhador mudou durante o envio.');
      if (source === 'DOCUMENT_VERSION') require(currentSource(worker, documentId!, documentVersionId!), 409, 'SOURCE_UNAVAILABLE', 'A versão documental mudou durante o vínculo.');
      const evidence: WorkerIntegrationEvidenceDto = { id: crypto.randomUUID(), workerId: worker.id, companyId, unitId, source, documentId, documentVersionId, file, status: 'PENDING', revision: 1, submittedAt: new Date().toISOString(), submittedBy: context.userId, submittedByName: context.userName };
      evidences.set(evidence.id, evidence); if (source === 'UPLOAD') scanReadyAt.set(evidence.id, Date.now() + 700);
      dependencies.audit('INTEGRATION_EVIDENCE_SUBMITTED', worker.id); return copy(evidence);
    }
    const match = new RegExp(`^${base}/evidences/([^/]+)/(review|download)$`).exec(path);
    require(match && request.method === 'POST', 405, 'METHOD_NOT_ALLOWED', 'Operação indisponível.');
    const evidence = get(match[1], context);
    if (match[2] === 'download') { require(context.can('documents.download'), 403, 'FORBIDDEN', 'Seu acesso não permite baixar comprovantes.'); if (evidence.source === 'DOCUMENT_VERSION') forRegistration(evidence.id, context); return dependencies.download(evidence.file); }
    require(context.can('eligibility.review') && context.worker.status === 'ACTIVE', 403, 'FORBIDDEN', 'Seu acesso não permite conferir este comprovante.');
    matchingRevision(request, evidence.revision); require(evidence.status === 'PENDING', 409, 'IMMUTABLE_EVIDENCE', 'Esta decisão já foi registrada. Envie outro comprovante se houver correção.');
    let raw: unknown; try { raw = await request.json(); } catch { throw new IntegrationEvidenceError(422, 'VALIDATION_FAILED', 'Envie uma decisão válida.'); }
    require(raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).every(key => ['decision', 'comment', 'confirmed'].includes(key)), 422, 'VALIDATION_FAILED', 'Confira os campos da decisão.');
    const input = raw as { decision: string; comment: string; confirmed: boolean };
    require(input.confirmed === true && ['APPROVE', 'REJECT'].includes(input.decision), 422, 'VALIDATION_FAILED', 'Confirme explicitamente a decisão sobre este comprovante.');
    require(typeof input.comment === 'string' && input.comment.length <= 2000 && (input.decision !== 'REJECT' || input.comment.trim().length >= 5), 422, 'VALIDATION_FAILED', 'Informe o motivo da devolução, com 5 a 2.000 caracteres.', 'comment');
    context.recheck(); require(context.can('eligibility.review') && context.worker.status === 'ACTIVE', 403, 'FORBIDDEN', 'Sua concessão não permite esta conferência.');
    get(evidence.id, context); matchingRevision(request, evidence.revision); require(evidence.status === 'PENDING', 409, 'IMMUTABLE_EVIDENCE', 'Esta decisão já foi registrada.');
    forRegistration(evidence.id, context); require(evidence.file.scanStatus === 'CLEAN', 409, 'FILE_NOT_READY', 'Aguarde a verificação demonstrativa do arquivo antes de conferir.');
    Object.assign(evidence, { status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedAt: new Date().toISOString(), reviewedBy: context.userId, reviewedByName: context.userName, reviewComment: input.comment.trim(), revision: evidence.revision + 1 });
    dependencies.audit('INTEGRATION_EVIDENCE_REVIEWED', context.worker.id); return copy(evidence);
  }
  return { options, policy, forRegistration, operationalState, route, processScans };
}
