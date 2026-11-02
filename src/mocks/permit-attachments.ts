/** Arquivos de acompanhamento em memória. Conferir cabeçalho não equivale a antivírus. */
import type { WorkPermitDto } from '../shared/contracts/work-permits';
import {
  PERMIT_ATTACHMENT_CAPTION_MAX, PERMIT_ATTACHMENT_MAX_BYTES, PERMIT_ATTACHMENT_MAX_PER_PERMIT,
  PERMIT_ATTACHMENT_MAX_PER_VERSION, PERMIT_ATTACHMENT_MIME_TYPES,
  type PermitAttachmentCreatedDto, type PermitAttachmentDownloadDto, type PermitAttachmentDto,
} from '../shared/contracts/permit-attachments';
import { PermitDemoError, type PermitDemoContext } from './work-permits';
import { id } from './fixtures';

function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function revision(request: Request, permit: WorkPermitDto) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue a PT antes de anexar.');
  assert(request.headers.get('If-Match') === `"${permit.revision}"`, 412, 'REVISION_CONFLICT', 'A PT mudou. Atualize e confira a versão antes de anexar.');
}
function writable(permit: WorkPermitDto, context: PermitDemoContext) {
  assert(context.permissions.includes('permits.operate'), 403, 'FORBIDDEN', 'Seu perfil não permite anexar arquivos à PT.');
  assert(permit.appointment.responsibleId === context.user.id, 403, 'NOT_DESIGNATED', 'Somente o responsável operacional designado pode anexar.');
  assert(permit.operationStatus === 'EXECUTING' && permit.reviewStatus === 'NOT_SUBMITTED', 409, 'ATTACHMENT_STATE_LOCKED', 'Anexe somente durante a execução. Registros encerrados são preservados para consulta.');
}
const copy = (value: PermitAttachmentDto): PermitAttachmentDto => ({ ...value });

/** A integração resolve/autoriza a PT antes de chamar route; a mutação usa o registro armazenado. */
export function makePermitAttachmentsDemo() {
  const attachments = new Map<string, PermitAttachmentDto>();
  const files = new Map<string, File>();
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  const list = (permitId: string) => [...attachments.values()].filter(value => value.permitId === permitId);
  const handles = (path: string) => /^\/work-permits\/[^/]+\/attachments(?:\/[^/]+\/download)?$/.test(path);

  async function route(request: Request, path: string, permit: WorkPermitDto, context: PermitDemoContext): Promise<PermitAttachmentDto[] | PermitAttachmentCreatedDto | PermitAttachmentDownloadDto | undefined> {
    if (!handles(path)) return undefined;
    const parts = path.split('/').filter(Boolean);
    assert(parts[1] === permit.id, 404, 'NOT_FOUND', 'PT indisponível.');
    assert(context.permissions.includes('permits.read'), 403, 'FORBIDDEN', 'Seu perfil não permite consultar esta PT.');
    const assignedOnly = context.permissions.includes('permits.operate') && !context.permissions.includes('permits.review');
    assert(context.user.scope.unitIds.includes(permit.appointment.unitId)
      && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(permit.appointment.teamId))
      && (!assignedOnly || permit.appointment.responsibleId === context.user.id)
      && (!context.user.scope.ownOnly || permit.appointment.participants.some(participant => participant.workerId === (context.user.id === id(24) ? id(40) : context.user.id))), 404, 'NOT_FOUND', 'PT indisponível no seu alcance.');
    context.checkUnit(permit.appointment.unitId);

    if (parts.length === 3 && request.method === 'GET') return list(permit.id).map(copy);
    if (parts.length === 5 && request.method === 'GET') {
      const attachment = attachments.get(parts[3]);
      assert(attachment && attachment.permitId === permit.id && attachment.version <= permit.version, 404, 'NOT_FOUND', 'Anexo indisponível nesta PT.');
      const file = files.get(attachment.id);
      assert(file, 404, 'NOT_FOUND', 'Arquivo indisponível nesta sessão de demonstração.');
      const url = URL.createObjectURL(file);
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
      downloads.set(url, timer);
      return { url, expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: attachment.fileName, mimeType: attachment.mimeType };
    }
    if (parts.length !== 3 || request.method !== 'POST') throw new PermitDemoError(405, 'METHOD_NOT_ALLOWED', 'Ação não disponível para anexos.');
    writable(permit, context); revision(request, permit);
    const expectedVersion = permit.version;
    const form = await request.formData();
    const file = form.get('file');
    const caption = form.get('caption');
    assert(typeof caption === 'string' && caption.trim().length >= 3 && caption.length <= PERMIT_ATTACHMENT_CAPTION_MAX, 422, 'VALIDATION_FAILED', 'Descreva o anexo com 3 a 1.000 caracteres.', 'caption');
    assert(typeof form.get('version') === 'string' && form.get('version') === String(expectedVersion), 412, 'REVISION_CONFLICT', 'O anexo precisa identificar a versão atual da PT.', 'version');
    assert(file instanceof File && file.size > 0 && file.size <= PERMIT_ATTACHMENT_MAX_BYTES, 422, 'INVALID_FILE', 'Envie um arquivo não vazio de até 5 MB.', 'file');
    assert(PERMIT_ATTACHMENT_MIME_TYPES.some(value => value === file.type), 422, 'INVALID_FILE_TYPE', 'Envie JPG, PNG ou PDF.', 'file');
    assert(file.name.length > 0 && file.name.length <= 200 && !/[\x00-\x1f\x7f/\\]/.test(file.name), 422, 'INVALID_FILE_NAME', 'Use um nome de arquivo válido com até 200 caracteres.', 'file');
    const extension = file.name.split('.').at(-1)?.toLocaleLowerCase();
    assert(file.type === 'application/pdf' ? extension === 'pdf' : file.type === 'image/png' ? extension === 'png' : ['jpg', 'jpeg'].includes(extension || ''), 422, 'INVALID_FILE_TYPE', 'A extensão precisa corresponder ao tipo do arquivo.', 'file');
    const header = new Uint8Array(await file.arrayBuffer()).subarray(0, 8);
    const matches = file.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
      : file.type === 'image/jpeg' ? header[0] === 255 && header[1] === 216 && header[2] === 255
        : new TextDecoder().decode(header.subarray(0, 5)) === '%PDF-';
    assert(matches, 422, 'INVALID_FILE_CONTENT', 'O conteúdo não corresponde ao formato JPG, PNG ou PDF informado.', 'file');
    // A PT pode mudar enquanto o navegador lê os bytes. Nenhuma alteração ocorre antes desta conferência.
    writable(permit, context); revision(request, permit);
    assert(permit.version === expectedVersion, 412, 'REVISION_CONFLICT', 'A versão da PT mudou durante o envio.');
    const existing = list(permit.id);
    assert(existing.filter(value => value.version === permit.version).length < PERMIT_ATTACHMENT_MAX_PER_VERSION && existing.length < PERMIT_ATTACHMENT_MAX_PER_PERMIT,
      409, 'ATTACHMENT_LIMIT', 'Limite de 10 anexos por versão e 20 por PT atingido.');
    const attachment: PermitAttachmentDto = { id: crypto.randomUUID(), permitId: permit.id, version: permit.version, name: file.name, fileName: file.name,
      mimeType: file.type as PermitAttachmentDto['mimeType'], sizeBytes: file.size, caption: caption.trim(),
      uploadedAt: new Date().toISOString(), uploadedBy: context.user.id, uploadedByName: context.user.displayName };
    attachments.set(attachment.id, attachment); files.set(attachment.id, file);
    permit.revision++;
    permit.history.push({ id: crypto.randomUUID(), action: 'ATTACHMENT_ADDED', actorName: context.user.displayName,
      occurredAt: attachment.uploadedAt, reason: `${attachment.fileName}: ${attachment.caption}`, version: permit.version });
    return { attachment: copy(attachment), permitRevision: permit.revision, permitVersion: permit.version };
  }
  return { route, handles, dispose: () => {
    downloads.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url); });
    downloads.clear();
  } };
}
