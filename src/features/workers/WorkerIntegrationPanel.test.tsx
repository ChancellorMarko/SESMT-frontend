import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { WorkerDto, WorkerIntegrationEvidenceDto, WorkerIntegrationOptionsDto } from '../../shared/contracts';
import { WorkerIntegrationPanel, integrationFileError } from './WorkerIntegrationPanel';

const session = vi.hoisted(() => ({ unitId: 'unit-1', sessionKey: 'rh-1', permissions: ['workers.read', 'workers.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const worker: WorkerDto = { id: 'worker-1', fullName: 'Camila Exemplo', registration: '001', companyId: 'company-1', unitId: 'unit-1', sectorId: 'sector-1', admissionDate: '2024-01-01', employmentType: 'CLT', status: 'ACTIVE', revision: 3, integrationStatus: 'PENDING' };
const proof: WorkerIntegrationEvidenceDto = { id: 'proof-1', workerId: worker.id, unitId: worker.unitId, companyId: worker.companyId, source: 'UPLOAD', file: { id: 'file-1', name: 'integracao.pdf', mimeType: 'application/pdf', sizeBytes: 30, sha256: 'test', scanStatus: 'CLEAN' }, status: 'PENDING', revision: 7, submittedAt: '2026-04-01T15:00:00Z', submittedBy: 'rh-1', submittedByName: 'RH Exemplo' };
const options: WorkerIntegrationOptionsDto = { policy: { version: 'DEMO-POLICY-1', evidenceRequired: true, allowNotApplicable: false, maxFileSizeBytes: 10 * 1024 * 1024, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'], description: 'Política administrativa de demonstração.' }, documents: [{ documentId: 'document-1', title: 'Comprovante individual', code: 'INT-1', versions: [{ id: 'version-1', versionNumber: 1, file: proof.file }] }] };
let evidence: WorkerIntegrationEvidenceDto[];
beforeEach(() => {
  vi.clearAllMocks(); session.permissions = ['workers.read', 'workers.write']; session.unitId = worker.unitId; session.sessionKey = 'rh-1'; evidence = [];
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/options') ? structuredClone(options) : path.endsWith('/evidences') ? evidence : worker);
  vi.mocked(api.post).mockImplementation(async path => path.endsWith('/evidences') ? proof : path.endsWith('/review') ? { ...proof, status: 'APPROVED', revision: 8 } : { ...worker, revision: 4 });
});
function show(current = worker) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (data: WorkerDto) => <QueryClientProvider client={client}><MemoryRouter><WorkerIntegrationPanel worker={data} /></MemoryRouter></QueryClientProvider>;
  const result = render(tree(current));
  return { ...result, client, replace: (data: WorkerDto) => result.rerender(tree(data)) };
}
async function open() {
  const button = await screen.findByRole('button', { name: 'Registrar nova integração' });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  fireEvent.change(screen.getByLabelText('Data de realização *'), { target: { value: '2026-04-01' } });
}
function cachedRead<T>(client: QueryClient, queryKey: readonly unknown[], read: () => T) {
  const query = { queryKey, queryFn: vi.fn(async () => read()), staleTime: Infinity };
  return { query, read: () => client.fetchQuery(query) };
}

describe('comprovantes de integração', () => {
  it('envia arquivo real e registra PENDING com prova vinculada e sem autoria livre', async () => {
    const user = userEvent.setup(); show(); await open();
    await user.selectOptions(screen.getByLabelText('Origem do comprovante'), 'UPLOAD');
    const file = new File(['%PDF-1.4\nconteúdo de teste'], 'integracao.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Arquivo do comprovante *'), file);
    await screen.findByText('Selecionado: integracao.pdf');
    expect(screen.queryByLabelText('Responsável pelo registro')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar integração' }));
    await screen.findByText(/Integração administrativa registrada\. A execução continua/);
    expect(api.post).toHaveBeenNthCalledWith(1, '/workers/worker-1/integration/evidences', expect.any(FormData), expect.objectContaining({ etag: '"3"', signal: expect.any(AbortSignal) }));
    const uploaded = vi.mocked(api.post).mock.calls[0][1] as FormData;
    expect(uploaded.get('file')).toBe(file);
    expect(api.post).toHaveBeenNthCalledWith(2, '/workers/worker-1/integration', expect.objectContaining({ status: 'PENDING', evidenceId: proof.id, policyVersion: options.policy.version, integratedAt: '2026-04-01' }), expect.objectContaining({ etag: '"3"' }));
    expect(screen.queryByRole('button', { name: /^Conferir comprovante/ })).not.toBeInTheDocument();
  });
  it('vincula versão documental própria e mantém a conferência pendente', async () => {
    const user = userEvent.setup(); show(); await open();
    await user.selectOptions(screen.getByLabelText('Origem do comprovante'), 'DOCUMENT_VERSION');
    await user.selectOptions(screen.getByLabelText('Versão documental do trabalhador *'), 'version-1');
    await user.click(screen.getByRole('button', { name: 'Salvar integração' }));
    await screen.findByText(/Integração administrativa registrada/);
    expect(api.post).toHaveBeenNthCalledWith(1, '/workers/worker-1/integration/evidences', { documentId: 'document-1', documentVersionId: 'version-1' }, expect.objectContaining({ etag: '"3"' }));
    expect(vi.mocked(api.post).mock.calls[1][1]).toMatchObject({ status: 'PENDING', evidenceId: proof.id });
  });
  it('não registra INTEGRATED com prova pendente nem aceita não aplicável fora da política', async () => {
    evidence = [proof]; show(); await open();
    fireEvent.change(screen.getByLabelText('Origem do comprovante'), { target: { value: 'EXISTING' } });
    fireEvent.change(screen.getByLabelText('Comprovante já vinculado *'), { target: { value: proof.id } });
    fireEvent.change(screen.getByLabelText('Situação da integração *'), { target: { value: 'INTEGRATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    expect(await screen.findByText(/selecione um comprovante conferido e liberado/)).toBeVisible();
    expect(api.post).not.toHaveBeenCalled(); expect(screen.queryByRole('option', { name: 'Não aplicável' })).not.toBeInTheDocument();
  });
  it.each(['REJECTED', 'PENDING'] as const)('recusa prova %s selecionada mesmo quando a política torna a prova opcional', async proofStatus => {
    evidence = [{ ...proof, status: proofStatus }];
    const optionalOptions = { ...options, policy: { ...options.policy, evidenceRequired: false, allowNotApplicable: true } };
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/options') ? optionalOptions : path.endsWith('/evidences') ? evidence : worker);
    show({ ...worker, integrationEvidenceRequired: false }); await open();
    fireEvent.change(screen.getByLabelText('Origem do comprovante'), { target: { value: 'EXISTING' } });
    fireEvent.change(screen.getByLabelText('Comprovante já vinculado *'), { target: { value: proof.id } });
    fireEvent.change(screen.getByLabelText('Situação da integração *'), { target: { value: 'INTEGRATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    expect(await screen.findByText(/Para registrar Integrado, selecione um comprovante conferido e liberado/)).toBeVisible();
    expect(screen.getByLabelText('Comprovante já vinculado *')).toHaveValue(proof.id);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('permite registro integrado sem prova quando a política explicitamente a dispensa', async () => {
    evidence = [{ ...proof, status: 'REJECTED' }];
    const optionalOptions = { ...options, policy: { ...options.policy, evidenceRequired: false, allowNotApplicable: true } };
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/options') ? optionalOptions : path.endsWith('/evidences') ? evidence : worker);
    show({ ...worker, integrationEvidenceRequired: false }); await open();
    // Returning to NONE must discard the previously selected, invalid reference.
    fireEvent.change(screen.getByLabelText('Origem do comprovante'), { target: { value: 'EXISTING' } });
    fireEvent.change(screen.getByLabelText('Comprovante já vinculado *'), { target: { value: proof.id } });
    fireEvent.change(screen.getByLabelText('Origem do comprovante'), { target: { value: 'NONE' } });
    fireEvent.change(screen.getByLabelText('Situação da integração *'), { target: { value: 'INTEGRATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    await screen.findByText(/Integração administrativa registrada/);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/workers/worker-1/integration', expect.objectContaining({ status: 'INTEGRATED', evidenceId: undefined, policyVersion: optionalOptions.policy.version }), expect.objectContaining({ etag: '"3"' }));
    expect(screen.queryByText(/Para registrar Integrado, selecione um comprovante conferido/)).not.toBeInTheDocument();
  });
  it('exige conferência explícita somente do perfil permitido e não integra ao aprovar prova', async () => {
    session.permissions.push('eligibility.review'); evidence = [proof]; show();
    fireEvent.click(await screen.findByRole('button', { name: 'Conferir comprovante integracao.pdf' }));
    const modal = screen.getByRole('dialog', { name: 'Conferir comprovante de integração' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Registrar conferência' }));
    expect(within(modal).getByText(/Informe a justificativa e confirme explicitamente/)).toBeVisible(); expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(within(modal).getByLabelText('Justificativa da conferência *'), { target: { value: 'Comprovante e vínculo administrativo conferidos.' } });
    fireEvent.click(within(modal).getByRole('checkbox', { name: 'Confirmo explicitamente a decisão para este comprovante.' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Registrar conferência' }));
    await screen.findByText(/Conferência registrada\. A aprovação do comprovante não muda/);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/workers/worker-1/integration/evidences/proof-1/review', { decision: 'APPROVE', comment: 'Comprovante e vínculo administrativo conferidos.', confirmed: true }, expect.objectContaining({ etag: '"7"' }));
  });
  it('requer outro registro explícito para marcar INTEGRATED após aprovação', async () => {
    evidence = [{ ...proof, status: 'APPROVED' }]; show(); await open();
    fireEvent.change(screen.getByLabelText('Origem do comprovante'), { target: { value: 'EXISTING' } });
    fireEvent.change(screen.getByLabelText('Comprovante já vinculado *'), { target: { value: proof.id } });
    fireEvent.change(screen.getByLabelText('Situação da integração *'), { target: { value: 'INTEGRATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    await screen.findByText(/Integração administrativa registrada/);
    expect(api.post).toHaveBeenCalledTimes(1); expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ status: 'INTEGRATED', evidenceId: proof.id });
  });
  it('atualiza pendências abertas e consultas operacionais já visitadas após registrar integração', async () => {
    evidence = [{ ...proof, status: 'APPROVED' }];
    const page = show(); await open();
    let integrated = false;
    vi.mocked(api.post).mockImplementation(async () => {
      integrated = true;
      return { ...worker, revision: 4, integrationStatus: 'INTEGRATED', integrationEvidence: evidence[0] };
    });
    const context = [session.sessionKey, session.unitId];
    const readiness = cachedRead(page.client, ['documentary-readiness', ...context], () => ({ rows: [{ eligibility: { eligible: integrated } }] }));
    const dashboard = cachedRead(page.client, ['permit-dashboard', ...context, '', '', '', '', ''], () => ({ blockedAppointments: integrated ? 0 : 1 }));
    const permit = cachedRead(page.client, ['work-permit', ...context, 'permit-1'], () => ({ eligibility: { eligible: integrated }, operationStatus: 'DRAFT' }));
    const consultation = cachedRead(page.client, ['consulta-permits', ...context, 1, '', '', '', ''], () => ({ items: [{ eligible: integrated }] }));
    const authorization = cachedRead(page.client, ['work-authorization', ...context, 'authorization-1'], () => ({ eligible: integrated, status: 'DRAFT' }));
    await Promise.all([readiness.read(), dashboard.read(), permit.read(), consultation.read(), authorization.read()]);
    const observer = new QueryObserver(page.client, readiness.query);
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      expect(observer.getCurrentResult().data?.rows[0].eligibility.eligible).toBe(false);
      fireEvent.change(screen.getByLabelText('Origem do comprovante'), { target: { value: 'EXISTING' } });
      fireEvent.change(screen.getByLabelText('Comprovante já vinculado *'), { target: { value: proof.id } });
      fireEvent.change(screen.getByLabelText('Situação da integração *'), { target: { value: 'INTEGRATED' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
      await screen.findByText(/Integração administrativa registrada/);
      await waitFor(() => expect(observer.getCurrentResult().data?.rows[0].eligibility.eligible).toBe(true));
      // These pages are inactive here. Even with an infinite freshness window,
      // reopening them must read the changed server state instead of their old cache.
      expect(await dashboard.read()).toMatchObject({ blockedAppointments: 0 });
      expect(await permit.read()).toMatchObject({ eligibility: { eligible: true }, operationStatus: 'DRAFT' });
      expect(await consultation.read()).toMatchObject({ items: [{ eligible: true }] });
      expect(await authorization.read()).toMatchObject({ eligible: true, status: 'DRAFT' });
      expect(api.post).toHaveBeenCalledTimes(1);
    } finally { unsubscribe(); }
  });
  it('reconsulta o contexto afetado ao conferir prova e preserva outras sessões, unidades e trabalhadores', async () => {
    session.permissions.push('eligibility.review'); evidence = [proof];
    const page = show();
    await screen.findByRole('button', { name: 'Conferir comprovante integracao.pdf' });
    let checked = false;
    vi.mocked(api.post).mockImplementation(async () => {
      checked = true;
      return { ...proof, status: 'APPROVED', revision: 8 };
    });
    const context = [session.sessionKey, session.unitId];
    const currentWorker = cachedRead(page.client, ['worker', ...context, worker.id], () => ({ integrationStatus: 'PENDING', proofChecked: checked }));
    const eligibility = cachedRead(page.client, ['eligibility', ...context, 'appointment-1'], () => ({ eligible: false, proofChecked: checked }));
    const workers = cachedRead(page.client, ['workers', ...context, '', '', '', '', '', 1], () => ({ items: [{ id: worker.id, integrationStatus: 'PENDING', proofChecked: checked }] }));
    const documentSelector = cachedRead(page.client, ['workers', 'document-form', ...context], () => ({ proofChecked: checked }));
    const consultationSelector = cachedRead(page.client, ['workers', 'consulta-filter', ...context], () => ({ proofChecked: checked }));
    const retained = [
      ['worker', ...context, 'another-worker'],
      ['workers', session.sessionKey, 'another-unit'],
      ['workers', 'another-session', session.unitId],
      ['workers', 'document-form', 'another-session', session.unitId],
      ['workers', 'consulta-filter', session.sessionKey, 'another-unit'],
      ['documentary-readiness', session.sessionKey, 'another-unit'],
      ['permit-dashboard', 'another-session', session.unitId],
      ['documents', ...context],
    ];
    retained.forEach(key => page.client.setQueryData(key, { preserved: true }));
    await Promise.all([currentWorker.read(), eligibility.read(), workers.read(), documentSelector.read(), consultationSelector.read()]);
    fireEvent.click(screen.getByRole('button', { name: 'Conferir comprovante integracao.pdf' }));
    const modal = screen.getByRole('dialog', { name: 'Conferir comprovante de integração' });
    fireEvent.change(within(modal).getByLabelText('Justificativa da conferência *'), { target: { value: 'Comprovante conferido.' } });
    fireEvent.click(within(modal).getByRole('checkbox', { name: 'Confirmo explicitamente a decisão para este comprovante.' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Registrar conferência' }));
    await screen.findByText(/Conferência registrada\. A aprovação do comprovante não muda/);
    expect(await currentWorker.read()).toEqual({ integrationStatus: 'PENDING', proofChecked: true });
    expect(await eligibility.read()).toEqual({ eligible: false, proofChecked: true });
    expect(await workers.read()).toMatchObject({ items: [{ integrationStatus: 'PENDING', proofChecked: true }] });
    expect(await documentSelector.read()).toEqual({ proofChecked: true });
    expect(await consultationSelector.read()).toEqual({ proofChecked: true });
    retained.forEach(key => {
      expect(page.client.getQueryData(key)).toEqual({ preserved: true });
      expect(page.client.getQueryState(key)?.isInvalidated).toBe(false);
    });
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('recusa cabeçalho falso e remove arquivo anterior ao escolher formato inválido', async () => {
    const user = userEvent.setup(); show(); await open();
    await user.selectOptions(screen.getByLabelText('Origem do comprovante'), 'UPLOAD');
    await user.upload(screen.getByLabelText('Arquivo do comprovante *'), new File(['%PDF-1.4 teste'], 'antigo.pdf', { type: 'application/pdf' }));
    await screen.findByText('Selecionado: antigo.pdf');
    await user.upload(screen.getByLabelText('Arquivo do comprovante *'), new File(['arquivo falso'], 'falso.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('O conteúdo do arquivo não corresponde ao formato informado.')).toBeVisible();
    expect(screen.queryByText('Selecionado: antigo.pdf')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar integração' })); expect(api.post).not.toHaveBeenCalled();
  });
  it('preserva preenchimento em conflito, atualiza revisão e reaproveita prova já enviada', async () => {
    const user = userEvent.setup(); const page = show(); await open();
    await user.selectOptions(screen.getByLabelText('Origem do comprovante'), 'UPLOAD');
    await user.upload(screen.getByLabelText('Arquivo do comprovante *'), new File(['%PDF-1.4 teste'], 'integracao.pdf', { type: 'application/pdf' }));
    await screen.findByText('Selecionado: integracao.pdf');
    fireEvent.change(screen.getByLabelText('Observações operacionais'), { target: { value: 'Preservar minha observação.' } });
    vi.mocked(api.post).mockResolvedValueOnce(proof).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Revisão mudou.', requestId: 'test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    expect(await screen.findByText(/O cadastro ou a política mudou/)).toBeVisible();
    expect(screen.getByLabelText('Observações operacionais')).toHaveValue('Preservar minha observação.');
    const current = { ...worker, revision: 4 };
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/options') ? options : path.endsWith('/evidences') ? [proof] : current);
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar integração' }));
    await screen.findByText(/Dados atuais carregados/); page.replace(current);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    await screen.findByText(/Integração administrativa registrada/);
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.post).mock.calls[2][1]).toMatchObject({ evidenceId: proof.id, notes: 'Preservar minha observação.' });
    expect(vi.mocked(api.post).mock.calls[2][2]).toMatchObject({ etag: '"4"' });
  });
  it('aborta envio ao trocar contexto e ignora a resposta tardia', async () => {
    const page = show(); await open(); let resolve!: (value: WorkerDto) => void;
    vi.mocked(api.post).mockReturnValue(new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const signal = vi.mocked(api.post).mock.calls[0][2]!.signal!;
    const event = new Event('sesmt:before-context-change', { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    page.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ...worker, revision: 9 }));
    expect(page.client.getQueryData(['worker', session.sessionKey, session.unitId, worker.id])).toBeUndefined();
  });
  it('identifica referência legada sem criar link de arquivo ou migração fictícia', async () => {
    show({ ...worker, integrationStatus: 'INTEGRATED', integrationEvidenceFileName: 'referencia-antiga.pdf' });
    expect(screen.getByText('referencia-antiga.pdf')).toBeVisible(); expect(screen.getByText('Referência antiga sem arquivo vinculado')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Consultar arquivo referencia-antiga.pdf' })).not.toBeInTheDocument();
  });
  it('retira dados de prova mantidos em cache após atualização negar acesso', async () => {
    evidence = [proof]; show({ ...worker, integrationEvidence: proof });
    await screen.findByRole('button', { name: 'Consultar arquivo integracao.pdf' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso negado.', requestId: 'test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar integração' }));
    await screen.findByText('Você não tem permissão para consultar ou alterar este registro.');
    expect(screen.queryByRole('button', { name: 'Consultar arquivo integracao.pdf' })).not.toBeInTheDocument();
    expect(screen.queryByText(proof.file.name)).not.toBeInTheDocument();
  });
  it('bloqueia aprovação durante verificação do arquivo e conflito na revisão', async () => {
    session.permissions.push('eligibility.review'); evidence = [{ ...proof, file: { ...proof.file, scanStatus: 'PENDING' } }];
    const page = show();
    expect(await screen.findByRole('button', { name: 'Conferir comprovante integracao.pdf' })).toBeDisabled();
    page.client.setQueryData(['worker-integration-evidences', session.sessionKey, session.unitId, worker.id], [proof]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conferir comprovante integracao.pdf' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Conferir comprovante integracao.pdf' }));
    act(() => page.client.setQueryData(['worker-integration-evidences', session.sessionKey, session.unitId, worker.id], [{ ...proof, revision: 8, status: 'APPROVED' }]));
    await screen.findByText(/O comprovante mudou/);
    expect(screen.getByRole('button', { name: 'Registrar conferência' })).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('preserva draft e impede envio quando política muda durante preenchimento', async () => {
    const page = show(); await open();
    fireEvent.change(screen.getByLabelText('Observações operacionais'), { target: { value: 'Observação mantida.' } });
    act(() => page.client.setQueryData(['worker-integration-options', session.sessionKey, session.unitId, worker.id], { ...options, policy: { ...options.policy, version: 'DEMO-POLICY-2' } }));
    await screen.findByText(/O cadastro ou a política mudou/);
    expect(screen.getByLabelText('Observações operacionais')).toHaveValue('Observação mantida.');
    expect(screen.getByRole('button', { name: 'Salvar integração' })).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('não expõe comprovante de outro trabalhador e não monta painel fora da unidade', async () => {
    evidence = [{ ...proof, workerId: 'other-worker' }]; const page = show();
    await screen.findByText('Nenhum arquivo de integração vinculado.'); expect(screen.queryByText(proof.file.name)).not.toBeInTheDocument();
    page.unmount(); session.unitId = 'other-unit'; show(); expect(screen.queryByRole('heading', { name: 'Integração administrativa' })).not.toBeInTheDocument();
  });
  it('valida tamanho vazio, excesso e extensão incoerente com MIME', () => {
    expect(integrationFileError(new File([], 'arquivo.pdf', { type: 'application/pdf' }))).toMatch(/vazio/);
    expect(integrationFileError(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'arquivo.pdf', { type: 'application/pdf' }))).toMatch(/10 MB/);
    expect(integrationFileError(new File(['abc'], 'arquivo.exe', { type: 'application/pdf' }))).toMatch(/PDF, PNG ou JPEG/);
  });
});
