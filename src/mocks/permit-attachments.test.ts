import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkPermitDto } from '../shared/contracts/work-permits';
import { PERMIT_ATTACHMENT_MAX_BYTES, type PermitAttachmentCreatedDto, type PermitAttachmentDownloadDto, type PermitAttachmentDto } from '../shared/contracts/permit-attachments';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';
import { makePermitAttachmentsDemo } from './permit-attachments';

function actor(userId = 25, permissions = ['permits.read', 'permits.operate']): PermitDemoContext {
  return { user: { id: id(userId), displayName: 'Responsável Demo', email: 'example@demo.local', roles: [], status: 'ACTIVE', mfaRequired: false, revision: 1,
    scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], teamIds: [], sectorIds: [], ownOnly: false } }, permissions, workers: makeFixtures().workers,
    checkUnit: unit => { if (unit !== UNIT_A) throw new Error('Unidade fora do contexto atual.'); } };
}
function pdf(content = '%PDF-1.4\nDEMONSTRACAO\n%%EOF', name = 'acompanhamento.pdf') {
  const bytes = new TextEncoder().encode(content);
  const value = new File([bytes], name, { type: 'application/pdf' });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.buffer, configurable: true });
  return value;
}
function image(type: 'image/png' | 'image/jpeg') {
  const bytes = new Uint8Array(type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255, 224]);
  const value = new File([bytes], type === 'image/png' ? 'foto.png' : 'foto.jpg', { type });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => bytes.buffer, configurable: true });
  return value;
}
describe('anexos de acompanhamento em memória', () => {
  let module: ReturnType<typeof makePermitAttachmentsDemo>;
  let permit: WorkPermitDto;
  beforeEach(async () => {
    module = makePermitAttachmentsDemo();
    const source = makePermitDemo();
    const url = new URL(`http://localhost/api/v1/work-permits/${id(230)}`);
    permit = await source.route(new Request(url), url, `/work-permits/${id(230)}`, actor(20, ['permits.read', 'permits.review'])) as WorkPermitDto;
    permit.operationStatus = 'EXECUTING'; permit.reviewStatus = 'NOT_SUBMITTED'; permit.snapshots = [];
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:http://localhost/download-attachment'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  });
  afterEach(() => { module.dispose(); vi.useRealTimers(); });
  async function get(path = `/work-permits/${permit.id}/attachments`, who = actor(), value = permit) {
    return module.route(new Request(`http://localhost/api/v1${path}`), path, value, who);
  }
  async function upload(options: { file?: File; caption?: string; version?: string; revision?: number | null; actor?: PermitDemoContext; permit?: WorkPermitDto } = {}) {
    const value = options.permit || permit;
    const path = `/work-permits/${value.id}/attachments`;
    const form = new FormData(); form.set('file', options.file || pdf()); form.set('caption', options.caption ?? 'Registro do local de trabalho.'); form.set('version', options.version ?? String(value.version));
    const headers = new Headers();
    if (options.revision !== null) headers.set('If-Match', `"${options.revision ?? value.revision}"`);
    const request = new Request(`http://localhost/api/v1${path}`, { method: 'POST', headers });
    Object.defineProperty(request, 'formData', { value: async () => form });
    return await module.route(request, path, value, options.actor || actor()) as PermitAttachmentCreatedDto;
  }
  it('registra autoria, versão, revisão e histórico sem alterar a elegibilidade', async () => {
    const eligibility = structuredClone(permit.eligibility);
    const revision = permit.revision;
    const result = await upload();
    expect(result).toMatchObject({ permitRevision: revision + 1, permitVersion: 1, attachment: { name: 'acompanhamento.pdf', permitId: permit.id, version: 1, uploadedBy: id(25), caption: 'Registro do local de trabalho.' } });
    expect(permit.history.at(-1)).toMatchObject({ action: 'ATTACHMENT_ADDED', version: 1, actorName: 'Responsável Demo' });
    expect(permit.eligibility).toEqual(eligibility);
    expect(await get()).toEqual([result.attachment]);
  });
  it.each(['VERIFICATION', 'RELEASED', 'COMPLETED', 'CANCELED'] as const)('impede anexar no estado %s', async state => {
    permit.operationStatus = state;
    await expect(upload()).rejects.toMatchObject({ code: 'ATTACHMENT_STATE_LOCKED' });
    expect(await get()).toEqual([]);
  });
  it('restringe consulta ao alcance e exige operação do responsável para anexar', async () => {
    await expect(get(undefined, actor(20, []))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(upload({ actor: actor(20, ['permits.read', 'permits.review']) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(upload({ actor: actor(26) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(upload({ actor: actor(26, ['permits.read', 'permits.operate', 'permits.review']) })).rejects.toMatchObject({ code: 'NOT_DESIGNATED' });
    const otherUnit = actor(); otherUnit.user.scope.unitIds = [UNIT_B];
    await expect(get(undefined, otherUnit)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const otherTeam = actor(); otherTeam.user.scope.teamIds = ['other-team'];
    await expect(get(undefined, otherTeam)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('ownOnly preserva o vínculo pessoal e não expõe anexo de colega', async () => {
    const worker = actor(24, ['permits.read']); worker.user.scope.ownOnly = true;
    await upload(); expect(await get(undefined, worker)).toHaveLength(1);
    const outsider = actor(27, ['permits.read']); outsider.user.scope.ownOnly = true;
    await expect(get(undefined, outsider)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('exige If-Match e preserva estado ao rejeitar revisão ou versão desatualizada', async () => {
    await expect(upload({ revision: null })).rejects.toMatchObject({ status: 428, code: 'PRECONDITION_REQUIRED' });
    await expect(upload({ revision: permit.revision - 1 })).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT' });
    await expect(upload({ version: '2' })).rejects.toMatchObject({ status: 412, field: 'version' });
    expect(await get()).toEqual([]);
  });
  it('rejeita vazio, excesso de bytes e descrição inválida', async () => {
    await expect(upload({ file: pdf('') })).rejects.toMatchObject({ code: 'INVALID_FILE' });
    const large = pdf(); Object.defineProperty(large, 'size', { value: PERMIT_ATTACHMENT_MAX_BYTES + 1 });
    await expect(upload({ file: large })).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(upload({ caption: '  ' })).rejects.toMatchObject({ field: 'caption' });
    await expect(upload({ caption: 'x'.repeat(1001) })).rejects.toMatchObject({ field: 'caption' });
  });
  it('rejeita MIME, extensão, nome inseguro e conteúdo que diverge do cabeçalho', async () => {
    await expect(upload({ file: new File(['<svg/>'], 'foto.svg', { type: 'image/svg+xml' }) })).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    await expect(upload({ file: pdf(undefined, 'arquivo.html') })).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
    await expect(upload({ file: pdf(undefined, '../arquivo.pdf') })).rejects.toMatchObject({ code: 'INVALID_FILE_NAME' });
    await expect(upload({ file: pdf('<html>script</html>') })).rejects.toMatchObject({ code: 'INVALID_FILE_CONTENT' });
    const fakePng = image('image/png'); Object.defineProperty(fakePng, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer, configurable: true });
    await expect(upload({ file: fakePng })).rejects.toMatchObject({ code: 'INVALID_FILE_CONTENT' });
  });
  it('aceita PNG e JPG com cabeçalho e extensão compatíveis', async () => {
    expect((await upload({ file: image('image/png') })).attachment.mimeType).toBe('image/png');
    expect((await upload({ file: image('image/jpeg') })).attachment.mimeType).toBe('image/jpeg');
  });
  it('reconfere revisão após leitura assíncrona do arquivo', async () => {
    const file = pdf();
    Object.defineProperty(file, 'arrayBuffer', { value: async () => { permit.revision++; return new TextEncoder().encode('%PDF-1.4').buffer; }, configurable: true });
    await expect(upload({ file })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await get()).toEqual([]);
  });
  it('preserva arquivos por versão, bloqueia registro após encerramento e isola PTs', async () => {
    const first = await upload();
    permit.operationStatus = 'COMPLETED'; permit.reviewStatus = 'VALIDATED';
    await expect(upload()).rejects.toMatchObject({ code: 'ATTACHMENT_STATE_LOCKED' });
    const current = await get() as PermitAttachmentDto[];
    current[0].caption = 'Mudança local não salva';
    expect((await get() as PermitAttachmentDto[])[0].caption).toBe(first.attachment.caption);
    permit.version = 2;
    expect((await get() as PermitAttachmentDto[])[0].version).toBe(1);
    const other = structuredClone(permit); other.id = 'other-permit';
    const path = `/work-permits/${other.id}/attachments/${first.attachment.id}/download`;
    await expect(get(path, actor(), other)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('limita anexos da mesma versão sem incrementar revisão após rejeição', async () => {
    for (let index = 0; index < 10; index++) await upload();
    const revision = permit.revision;
    await expect(upload()).rejects.toMatchObject({ code: 'ATTACHMENT_LIMIT' });
    expect(permit.revision).toBe(revision);
    expect(await get()).toHaveLength(10);
  });
  it('gera download temporário e revoga no dispose preservando arquivos na memória da demo', async () => {
    const result = await upload(); vi.useFakeTimers();
    const path = `/work-permits/${permit.id}/attachments/${result.attachment.id}/download`;
    const downloaded = await get(path) as PermitAttachmentDownloadDto;
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(File));
    expect(Date.parse(downloaded.expiresAt) - Date.now()).toBe(60000);
    vi.advanceTimersByTime(60000); expect(URL.revokeObjectURL).toHaveBeenCalledWith(downloaded.url);
    await get(path); module.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(await get()).toHaveLength(1);
    expect(await get(path, actor(20, ['permits.read', 'permits.review']))).toMatchObject({ fileName: 'acompanhamento.pdf' });
  });
  it('execução concluída durante leitura não aceita anexo tardio', async () => {
    const file = pdf();
    Object.defineProperty(file, 'arrayBuffer', { value: async () => { permit.operationStatus = 'COMPLETED'; return new TextEncoder().encode('%PDF-1.4').buffer; }, configurable: true });
    await expect(upload({ file })).rejects.toMatchObject({ code: 'ATTACHMENT_STATE_LOCKED' });
    expect(await get()).toEqual([]);
  });
  it('não captura subrotas desconhecidas de anexos', async () => {
    expect(module.handles(`/work-permits/${permit.id}/attachments/id/edit`)).toBe(false);
    expect(await get(`/work-permits/${permit.id}/attachments/id/edit`)).toBeUndefined();
  });
});
