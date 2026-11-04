import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { File as NativeFile } from 'node:buffer';
import { handlers, resetDemo } from './handlers';
import { COMPANY, UNIT_A, UNIT_B, id } from './fixtures';
import * as fixtures from './fixtures';
import type { EligibilityDto } from '../shared/contracts/work-permits';
import type { DocumentDto, DocumentVersionDto, SessionDto, WorkerDto, WorkerIntegrationEvidenceDto, WorkerIntegrationOptionsDto } from '../shared/contracts';

const server = setupServer(...handlers), originalFixtures = fixtures.makeFixtures;
const workerId = id(42), base = `/workers/${workerId}/integration`;
let token = '';
function send(method: string, path: string, body?: unknown, revision?: number, key?: string) {
  const multipart = body && typeof body === 'object' && 'multipartBody' in body ? body as { multipartBody: string } : undefined;
  return fetch(`http://localhost/api/v1${path}`, { method, headers: { 'Content-Type': multipart ? 'multipart/form-data; boundary=integrationTestBoundary' : 'application/json', 'X-CSRF-Token': 'demo-csrf', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body !== undefined ? { body: multipart ? multipart.multipartBody : JSON.stringify(body) } : {}) });
}
async function login(role = 'rh') {
  token = ''; const response = await send('POST', '/auth/login', { email: `${role}@demo.sesmt.local`, password: 'Demo123!' }); expect(response.status).toBe(200); token = (await response.json() as SessionDto).accessToken;
}
const readWorker = async () => await (await send('GET', `/workers/${workerId}`)).json() as WorkerDto;
const readOptions = async () => await (await send('GET', `${base}/options`)).json() as WorkerIntegrationOptionsDto;
function uploadBody(content = '%PDF-1.4\nComprovante sintético de teste\n%%EOF', type = 'application/pdf') {
  return { multipartBody: `--integrationTestBoundary\r\nContent-Disposition: form-data; name="file"; filename="integracao-teste.pdf"\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--integrationTestBoundary--\r\n` };
}
async function upload(key: string = crypto.randomUUID()) {
  const response = await send('POST', `${base}/evidences`, uploadBody(), (await readWorker()).revision, key); expect(response.status, JSON.stringify(await response.clone().json())).toBe(200); return response.json() as Promise<WorkerIntegrationEvidenceDto>;
}
function scansReady() { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 1000); }
async function review(evidence: WorkerIntegrationEvidenceDto, decision = 'APPROVE') {
  const response = await send('POST', `${base}/evidences/${evidence.id}/review`, { decision, comment: 'Conteúdo e vínculo conferidos no teste.', confirmed: true }, evidence.revision); expect(response.status).toBe(200); return response.json() as Promise<WorkerIntegrationEvidenceDto>;
}
async function register(evidence?: WorkerIntegrationEvidenceDto, status = 'INTEGRATED', key?: string) {
  const policy = (await readOptions()).policy;
  return send('POST', base, { status, integratedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), evidenceId: evidence?.id, policyVersion: policy.version, notes: 'Registro sintético de teste.' }, (await readWorker()).revision, key);
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
// Undici parses multipart with the native File brand; jsdom's File is a different realm.
beforeEach(async () => { vi.stubGlobal('File', NativeFile); resetDemo(); await login(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); server.resetHandlers(); resetDemo(); });
afterAll(() => server.close());

describe('comprovação da integração pelos handlers HTTP de demonstração', () => {
  it.each(['PENDING', 'EXPIRED'])('política de comprovante opcional não dispensa a situação administrativa %s', async status => {
    const target = `/workers/${id(40)}/integration`;
    const before = await (await send('GET', `/appointments/${id(221)}/eligibility`)).json() as EligibilityDto;
    expect(before.eligible).toBe(true);
    const policy = (await (await send('GET', `${target}/options`)).json() as WorkerIntegrationOptionsDto).policy;
    expect(policy.evidenceRequired).toBe(false);
    const response = await send('POST', target, { status, integratedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), policyVersion: policy.version }, 1);
    expect(response.status).toBe(200);
    const after = await (await send('GET', `/appointments/${id(221)}/eligibility`)).json() as EligibilityDto;
    expect(after.eligible).toBe(false);
    expect(after.participants[0].items.find(item => item.requirementId === `integration:${id(40)}`)?.status).toBe(status);
  });
  it.each([
    ['vencida hoje', -10, -1, 'EXPIRED'],
    ['sem vigência para a agenda', -10, 1, 'EXPIRED'],
    ['realização futura', 1, 365, 'PENDING'],
  ] as const)('integração sem comprovante obrigatório ainda respeita datas: %s', async (_label, start, end, expected) => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); const worker = data.workers.find(value => value.id === id(40))!;
      const civil = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      worker.integrationStatus = 'INTEGRATED'; worker.integratedAt = civil(start); worker.integrationValidUntil = civil(end);
      return data;
    });
    resetDemo(); await login();
    const eligibility = await (await send('GET', `/appointments/${id(221)}/eligibility`)).json() as EligibilityDto;
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.participants[0].items.find(item => item.requirementId === `integration:${id(40)}`)?.status).toBe(expected);
  });
  it('separa upload, conferência e integração e revalida a elegibilidade da agenda', async () => {
    const initial = await readWorker(), options = await readOptions(); expect(options.policy.evidenceRequired).toBe(true);
    const before = await (await send('GET', `/appointments/${id(222)}/eligibility`)).json() as EligibilityDto;
    expect(before.eligible).toBe(false); expect(before.participants[0].items.some(item => item.requirementId.startsWith('integration:') && item.status === 'MISSING')).toBe(true);
    const proof = await upload(); expect(proof).toMatchObject({ status: 'PENDING', workerId, companyId: COMPANY, unitId: UNIT_A, revision: 1 }); expect(proof.file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readWorker()).toEqual(initial);
    expect((await register(proof)).status).toBe(422);
    expect((await send('POST', `${base}/evidences/${proof.id}/review`, { decision: 'APPROVE', comment: 'Tentativa pelo RH', confirmed: true }, 1)).status).toBe(403);
    scansReady(); await login('gestor');
    expect((await send('POST', `${base}/evidences/${proof.id}/review`, { decision: 'APPROVE', comment: '', confirmed: false }, 1)).status).toBe(422);
    const approved = await review(proof); expect(approved.status).toBe('APPROVED'); expect((await readWorker()).integrationStatus).toBe('PENDING');
    const registered = await register(approved); expect(registered.status).toBe(200);
    const worker = await registered.json() as WorkerDto; expect(worker.integrationStatus).toBe('INTEGRATED'); expect(worker.integrationHistory![0].evidence).toMatchObject({ id: proof.id, status: 'APPROVED', revision: 2 });
    const after = await (await send('GET', `/appointments/${id(222)}/eligibility`)).json() as EligibilityDto;
    expect(after.eligible).toBe(true); expect(after.participants[0].items.find(item => item.requirementId.startsWith('integration:'))?.status).toBe('APPROVED');
    expect((await (await send('GET', `/appointments/${id(222)}`)).json()).permitId).toBeUndefined();
  });
  it('nome de arquivo, autoria forjada, política antiga e falta de revisão não alteram o histórico', async () => {
    const before = await readWorker(), policy = (await readOptions()).policy;
    for (const body of [
      { status: 'INTEGRATED', integratedAt: '2025-03-12', evidenceFileName: 'aprovado.pdf', policyVersion: policy.version },
      { status: 'PENDING', integratedAt: '2025-03-12', responsibleName: 'Outra pessoa' },
      { status: 'PENDING', integratedAt: '2025-03-12', policyVersion: 'antiga' },
      { status: 'NOT_APPLICABLE', integratedAt: '2025-03-12', notes: 'Tentativa de exceção sem política.' },
    ]) expect([422, 412]).toContain((await send('POST', base, body, 1)).status);
    expect((await send('POST', base, { status: 'PENDING', integratedAt: '2025-03-12' })).status).toBe(428);
    expect(await readWorker()).toEqual(before);
  });
  it('valida tamanho, cabeçalho, formato e escopo antes de vincular um arquivo', async () => {
    for (const [content, type] of [['arquivo falso', 'application/pdf'], ['\x89PNG', 'image/png'], ['%PDF-1.4', 'image/svg+xml'], ['', 'application/pdf']]) {
      const response = await send('POST', `${base}/evidences`, uploadBody(content, type), 1); expect([413, 415]).toContain(response.status);
    }
    expect((await send('POST', `${base}/evidences`, uploadBody('a'.repeat(10 * 1024 * 1024 + 1)), 1)).status).toBe(413);
    expect(await (await send('GET', `${base}/evidences`)).json()).toEqual([]);
    await login('auditor'); expect((await send('POST', `${base}/evidences`, uploadBody(), 1)).status).toBe(403);
    await login('trabalhador'); expect((await send('GET', `${base}/evidences`)).status).toBe(404);
    token = ''; expect((await send('GET', `${base}/evidences`)).status).toBe(401);
  });
  it('decisão é imutável; rejeição não pode ser usada para concluir integração', async () => {
    const evidence = await upload(); scansReady(); await login('gestor'); const rejected = await review(evidence, 'REJECT');
    expect((await register(rejected)).status).toBe(422);
    expect((await send('POST', `${base}/evidences/${evidence.id}/review`, { decision: 'APPROVE', comment: 'Não substituir a decisão.', confirmed: true }, rejected.revision)).status).toBe(409);
    const pending = await register(rejected, 'PENDING'); expect(pending.status).toBe(200); const historical = (await pending.json() as WorkerDto).integrationHistory![0];
    expect(historical.evidence?.status).toBe('REJECTED'); expect((await readWorker()).integrationStatus).toBe('PENDING');
  });
  it('recibo repetido não duplica arquivo ou histórico e deixa de valer após mudança do vínculo', async () => {
    const evidence = await upload('upload-idempotent');
    expect((await (await send('POST', `${base}/evidences`, uploadBody(), 1, 'upload-idempotent')).json()).id).toBe(evidence.id);
    expect(await (await send('GET', `${base}/evidences`)).json()).toHaveLength(1);
    const response = await register(evidence, 'PENDING', 'register-once'); expect(response.status).toBe(200); const receipt = await response.json() as WorkerDto;
    const body = { status: 'PENDING', integratedAt: receipt.integratedAt, evidenceId: evidence.id, policyVersion: receipt.integrationPolicyVersion, notes: 'Registro sintético de teste.' };
    const replay = await send('POST', base, body, 1, 'register-once'); expect(replay.status).toBe(200); expect((await replay.json()).integrationHistory).toHaveLength(1);
    const moved = await send('POST', `/workers/${workerId}/movements`, { type: 'TRANSFER', effectiveDate: '2025-03-12', reason: 'Conferir a restrição do comprovante ao vínculo.', newAssignment: { companyId: COMPANY, unitId: UNIT_B, sectorId: id(7), jobId: null, jobFunctionId: null, workCenterId: null, managerId: null } }, receipt.revision); expect(moved.status).toBe(200);
    expect((await send('POST', `${base}/evidences`, uploadBody(), 1, 'upload-idempotent')).status).toBe(404);
    expect((await send('POST', base, body, 1, 'register-once')).status).toBe(404);
    expect((await send('POST', `${base}/evidences/${evidence.id}/download`, {})).status).toBe(404);
  });
  it('apenas uma conferência concorrente é registrada para a revisão apresentada', async () => {
    const evidence = await upload(); scansReady(); await login('gestor');
    const responses = await Promise.all(['APPROVE', 'REJECT'].map(decision => send('POST', `${base}/evidences/${evidence.id}/review`, { decision, comment: 'Conferência concorrente no teste.', confirmed: true }, 1)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    expect((await (await send('GET', `${base}/evidences`)).json())[0].revision).toBe(2);
  });
  it('filtra versões documentais por trabalhador, vínculo, acesso, vigência e conferência', async () => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); const document = data.documents.find(value => value.workerIds.includes(id(40)))!; const version = data.versions.find(value => value.documentId === document.id)!;
      document.workerIds = [workerId]; version.metadataSnapshot.workerIds = [workerId]; return data;
    });
    resetDemo(); await login();
    const options = await readOptions(); expect(options.documents).toHaveLength(1); const document = options.documents[0];
    const linked = await send('POST', `${base}/evidences`, { documentId: document.documentId, documentVersionId: document.versions[0].id }, 1); expect(linked.status).toBe(200); const proof = await linked.json() as WorkerIntegrationEvidenceDto;
    expect(proof).toMatchObject({ source: 'DOCUMENT_VERSION', status: 'PENDING', file: document.versions[0].file });
    expect((await send('POST', `/workers/${id(41)}/integration/evidences`, { documentId: document.documentId, documentVersionId: document.versions[0].id }, 1)).status).toBe(422);
    await login('gestor'); const approved = await review(proof); expect((await register(approved)).status).toBe(200);
    const worker = await readWorker();
    const source = await send('POST', `/documents/${document.documentId}/archive`, { reason: 'Retirar a fonte para conferir revalidação.' }, 1); expect(source.status).toBe(200);
    expect((await register(approved)).status).toBe(409);
    expect((await readWorker()).integrationHistory).toEqual(worker.integrationHistory);
    const eligibility = await (await send('GET', `/appointments/${id(222)}/eligibility`)).json() as EligibilityDto;
    expect(eligibility.eligible).toBe(false);
  });
  it.each<[string, (document: DocumentDto, version: DocumentVersionDto) => void]>([
    ['documento médico', document => { document.accessClass = 'MEDICAL'; }],
    ['snapshot médico', (_document, version) => { version.metadataSnapshot.accessClass = 'MEDICAL'; }],
    ['documento de outra empresa', document => { document.companyId = id(999); }],
    ['snapshot de outra empresa', (_document, version) => { version.metadataSnapshot.companyId = id(999); }],
    ['documento de outra unidade', document => { document.unitId = UNIT_B; }],
    ['snapshot de outra unidade', (_document, version) => { version.metadataSnapshot.unitId = UNIT_B; }],
    ['versão aguardando conferência', (_document, version) => { version.status = 'IN_REVIEW'; }],
    ['arquivo aguardando verificação', (_document, version) => { version.file.scanStatus = 'PENDING'; }],
  ])('exclui %s das opções e rejeita vínculo direto sem alterar a integração', async (_case, mutateSource) => {
    let documentId = '', documentVersionId = '';
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures();
      const document = data.documents.find(value => value.workerIds.includes(id(40)))!;
      const version = data.versions.find(value => value.documentId === document.id)!;
      // Keep every other criterion valid to exercise one source boundary per case.
      document.workerIds = [workerId]; version.metadataSnapshot.workerIds = [workerId];
      documentId = document.id; documentVersionId = version.id;
      mutateSource(document, version);
      return data;
    });
    resetDemo(); await login();
    const initial = await readWorker();
    expect((await readOptions()).documents).toEqual([]);
    const rejected = await send('POST', `${base}/evidences`, { documentId, documentVersionId }, initial.revision);
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).code).toBe('INVALID_ASSIGNMENT');
    expect(await (await send('GET', `${base}/evidences`)).json()).toEqual([]);
    expect(await readWorker()).toEqual(initial);
    // A refused reference cannot become an option as a side effect of the POST.
    expect((await readOptions()).documents).toEqual([]);
  });
  it('vigência da versão documental também precisa cobrir o período planejado da PT', async () => {
    vi.spyOn(fixtures, 'makeFixtures').mockImplementation(() => {
      const data = originalFixtures(); const document = data.documents.find(value => value.workerIds.includes(id(40)))!; const version = data.versions.find(value => value.documentId === document.id)!;
      const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      document.workerIds = [workerId]; document.validUntil = tomorrow; version.metadataSnapshot.workerIds = [workerId]; version.metadataSnapshot.validUntil = tomorrow; return data;
    });
    resetDemo(); await login(); const document = (await readOptions()).documents[0];
    const proof = await (await send('POST', `${base}/evidences`, { documentId: document.documentId, documentVersionId: document.versions[0].id }, 1)).json() as WorkerIntegrationEvidenceDto;
    await login('gestor'); const approved = await review(proof); expect((await register(approved)).status).toBe(200);
    const eligibility = await (await send('GET', `/appointments/${id(222)}/eligibility`)).json() as EligibilityDto;
    expect(eligibility.eligible).toBe(false); expect(eligibility.participants[0].items.find(item => item.requirementId.startsWith('integration:'))?.status).toBe('EXPIRED');
  });
});
