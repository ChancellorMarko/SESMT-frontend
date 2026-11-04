import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, downloadNativeDocument, nativeDocumentsApi } from '../../shared/api/client';
import { NativeDocumentDetail } from './NativeDocumentDetail';
import { NativeDocumentCreate } from './NativeDocumentCreate';
import { documentIds as ids, documentScope, nativeDocumentFixture, nativeVersionFixture, nativeTypeFixture, documentFilePolicy, documentDirectory, pdfContent, pdfHash } from '../../../tests/connection-ui/fixtures/native-documents';
import { permitFixture } from '../../../tests/connection-ui/fixtures/native-permits';

const state = vi.hoisted(() => ({ grants: ['documento:ler', 'documento:criar', 'documento:editar', 'documento:aprovar', 'organization.read', 'workers.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'native-doc-test', unitId: '71000000-0000-4000-8000-000000000002',
  me: { user: { id: '71000000-0000-4000-8000-000000000003', displayName: 'Pessoa Ficticia' }, scope: documentScope }, can: (p: string) => state.grants.includes(p) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn() }, nativeDocumentsApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, downloadNativeDocument: vi.fn() }));
let current = nativeDocumentFixture(), versions: ReturnType<typeof nativeVersionFixture>[], type = nativeTypeFixture();
function show(create = false, navigationState?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: create ? '/app/documentos/novo' : `/app/documentos/${ids.document}`, state: navigationState }]}><Routes>
    <Route path="/app/documentos/novo" element={<NativeDocumentCreate/>}/><Route path="/app/documentos/:id" element={<NativeDocumentDetail/>}/>
    <Route path="/app/documentos" element={<h1>Lista documental</h1>}/></Routes></MemoryRouter></QueryClientProvider>); return client;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID(), subtle: webcrypto.subtle });
  current = nativeDocumentFixture(); versions = []; type = nativeTypeFixture();
  state.grants = ['documento:ler', 'documento:criar', 'documento:editar', 'documento:aprovar', 'organization.read', 'workers.read'];
  vi.mocked(nativeDocumentsApi.get).mockImplementation(async path => {
    if (path === `/documents/${ids.document}`) return structuredClone(current) as never;
    if (path === `/documents/${ids.document}/versions`) return structuredClone(versions) as never;
    if (path === '/documents/file-policy') return structuredClone(documentFilePolicy) as never;
    if (path === '/document-types') return [structuredClone(type)] as never;
    if (path === `/document-types/${ids.type}`) return structuredClone(type) as never;
    throw new Error('Rota inesperada: ' + path);
  });
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/organization') return structuredClone(documentDirectory) as never;
    throw new Error('Projeção inesperada: ' + path);
  });
});
afterEach(() => vi.unstubAllGlobals());
async function upload() {
  fireEvent.click(await screen.findByRole('button', { name: 'Anexar versão' }));
  const dialog = await screen.findByRole('dialog', { name: 'Anexar versão' });
  fireEvent.change(within(dialog).getByLabelText('Arquivo'), { target: { files: [new File([pdfContent], 'certificado.pdf', { type: 'application/pdf' })] } });
  return dialog;
}
function pending() { versions = [nativeVersionFixture()]; current = { ...current, revision: 2, currentVersionNumber: 1, status: 'EM_REVISAO' }; }

it('cria metadados nativos e confirma o registro persistido sem enviar versões ilustrativas', async () => {
  vi.mocked(nativeDocumentsApi.post).mockImplementation(async (path, body) => {
    expect(path).toBe('/documents'); current = { ...current, ...(body as typeof current) }; return structuredClone(current) as never;
  });
  const client = show(true);
  const origins = [['documents', 'expirations', 'native-doc-test', ids.unit], ['consulta-documents', 'native-doc-test', ids.unit]];
  origins.forEach(key => client.setQueryData(key, { cached: true }));
  client.setQueryData(['documents', 'expirations', 'another-session', ids.unit], { cached: true });
  await screen.findByRole('option', { name: 'Unidade Matriz' });
  fireEvent.change(screen.getByLabelText(/Tipo documental/), { target: { value: ids.type } });
  fireEvent.change(screen.getByLabelText(/^Código/), { target: { value: 'NR-TESTE' } });
  fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: 'Certificado de treinamento' } });
  fireEvent.change(screen.getByLabelText(/^Emissão/), { target: { value: '2026-10-01' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cadastrar documento' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar documento' }));
  await screen.findByRole('heading', { name: 'Certificado de treinamento' });
  expect(nativeDocumentsApi.post).toHaveBeenCalledWith('/documents', expect.objectContaining({ companyId: ids.company, unitId: ids.unit, ownerId: ids.user, links: [], metadata: '{}', personId: null }), expect.anything());
  expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/documents'), expect.anything());
  origins.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
  expect(client.getQueryState(['documents', 'expirations', 'another-session', ids.unit])?.isInvalidated).toBe(false);
});
it.each(['{"required":["cargaHoraria"]}', '{"required":"cargaHoraria"}'])('não cadastra um tipo com requisitos específicos sem um formulário compatível (%s)', async metadataSchema => {
  type = { ...type, metadataSchema }; show(true); await screen.findByRole('option', { name: 'Unidade Matriz' });
  fireEvent.change(screen.getByLabelText(/Tipo documental/), { target: { value: ids.type } });
  await screen.findByText('Este tipo exige informações específicas que precisam ser preenchidas no seu fluxo próprio.');
  expect(screen.getByRole('button', { name: 'Cadastrar documento' })).toBeDisabled(); expect(nativeDocumentsApi.post).not.toHaveBeenCalled();
});
it('anexa multipart com revisão, confere o hash e mantém a evidência aguardando conferência', async () => {
  vi.mocked(nativeDocumentsApi.post).mockImplementation(async (path, body) => {
    expect(path).toBe(`/documents/${ids.document}/versions`); expect(body).toBeInstanceOf(FormData);
    const data = body as FormData; expect(data.get('expectedVersion')).toBe('1'); expect(data.has('authorId')).toBe(false);
    pending(); return structuredClone(versions[0]) as never;
  });
  show(); const dialog = await upload(); fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar para conferência' }));
  await screen.findByText('Arquivo recebido para conferência.');
  expect(current.status).toBe('EM_REVISAO'); expect(versions[0].isCurrent).toBe(false); expect(nativeDocumentsApi.post).toHaveBeenCalledTimes(1);
});
it('não envia arquivo em conflito e preserva o preenchimento sem repetição automática', async () => {
  show(); const dialog = await upload(); fireEvent.change(within(dialog).getByLabelText('Observação da versão'), { target: { value: 'Documento selecionado' } });
  current = { ...current, revision: 2 }; fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar para conferência' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('documento foi alterado');
  expect(within(dialog).getByLabelText('Observação da versão')).toHaveValue('Documento selecionado');
  expect(within(dialog).getByRole('button', { name: 'Enviar para conferência' })).toBeDisabled(); expect(nativeDocumentsApi.post).not.toHaveBeenCalled();
});
it('recibo com outro hash não informa sucesso nem permite repetir um envio ambíguo', async () => {
  vi.mocked(nativeDocumentsApi.post).mockResolvedValue({ ...nativeVersionFixture(), fileHash: 'a'.repeat(64) });
  show(); const dialog = await upload(); fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar para conferência' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('resposta não confirmou');
  expect(within(dialog).getByRole('button', { name: 'Enviar para conferência' })).toBeDisabled(); expect(screen.queryByText('Arquivo recebido para conferência.')).not.toBeInTheDocument();
});
it('aceita somente a versão atual com revisão e confirmação explícitas', async () => {
  pending(); vi.mocked(nativeDocumentsApi.post).mockImplementation(async (path, body) => {
    expect(path).toBe(`/documents/${ids.document}/versions/${ids.version}/review`);
    expect(body).toEqual({ expectedVersion: 2, version: 1, decision: 'aceita', reason: null });
    versions[0] = { ...versions[0], state: 'VIGENTE', isCurrent: true, approverId: ids.user, approvedAt: '2026-11-01T13:00:00Z' } as typeof versions[0];
    current = { ...current, revision: 3, status: 'VIGENTE' }; return structuredClone(versions[0]) as never;
  });
  show(); const button = await screen.findByRole('button', { name: 'Aceitar' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Aceitar evidência' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar aceite' })); expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirme'); expect(nativeDocumentsApi.post).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar aceite' })); await screen.findByText('Evidência aceita pela API.');
});
it('reprovação exige motivo e registra a decisão sem alterar a versão do arquivo', async () => {
  pending(); vi.mocked(nativeDocumentsApi.post).mockImplementation(async (_path, body) => {
    expect(body).toEqual({ expectedVersion: 2, version: 1, decision: 'reprovada', reason: 'Documento incompleto' });
    versions[0] = { ...versions[0], state: 'REJEITADA', approverId: ids.user, justification: 'Documento incompleto' } as typeof versions[0]; current = { ...current, revision: 3 }; return structuredClone(versions[0]) as never;
  });
  show(); fireEvent.click(await screen.findByRole('button', { name: 'Reprovar' })); const dialog = await screen.findByRole('dialog', { name: 'Reprovar evidência' });
  fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar reprovação' })); expect(await within(dialog).findByRole('alert')).toHaveTextContent('motivo');
  fireEvent.change(within(dialog).getByLabelText(/Motivo da reprovação/), { target: { value: 'Documento incompleto' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar reprovação' })); await screen.findByText('Evidência reprovada pela API.');
});
it('respeita grants explícitos e não aprova requisito de assinatura sem verificação', async () => {
  pending(); type = { ...type, requiresSignature: true }; state.grants = ['documento:ler', 'documento:aprovar']; show();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Aceitar' })).toBeDisabled());
  expect(screen.queryByRole('button', { name: 'Anexar versão' })).not.toBeInTheDocument();
});
it('baixa um blob autenticado, verifica seu hash e revoga a URL temporária', async () => {
  pending(); const create = vi.fn(() => 'blob:verified-file'), revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.mocked(downloadNativeDocument).mockResolvedValue({ blob: new Blob([pdfContent], { type: 'application/pdf' }), mimeType: 'application/pdf' });
  show(); const button = await screen.findByRole('button', { name: 'Baixar arquivo' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(downloadNativeDocument).toHaveBeenCalledWith(ids.document, ids.version, documentFilePolicy.maxSizeBytes, expect.anything());
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:verified-file'), { timeout: 2000 }); expect(pdfHash).toHaveLength(64);
});
it('oculta o registro após recusa de download e não abre uma URL', async () => {
  pending(); vi.mocked(downloadNativeDocument).mockRejectedValue(new ApiError(404, { code: 'NOT_FOUND', message: 'Privado', requestId: 'test' }));
  show(); const button = await screen.findByRole('button', { name: 'Baixar arquivo' }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  await screen.findByText('Não foi possível conferir este documento com seu acesso.'); expect(screen.queryByRole('region', { name: 'Dados do documento' })).not.toBeInTheDocument();
});
it('mantém o trabalhador de origem, confere o vínculo persistido e conserva o retorno', async () => {
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    if (path === `/workers/${ids.worker}`) return { id: ids.worker, companyId: ids.company, unitId: ids.unit, sectorId: ids.sector, fullName: 'Alice Trabalhadora', registration: 'MAT-01', status: 'ACTIVE', admissionDate: '2020-01-01' } as never;
    if (path === `/documents/${ids.document}`) return { id: ids.document, workerIds: [ids.worker] } as never;
    return original(path, options);
  });
  vi.mocked(nativeDocumentsApi.post).mockImplementation(async (_path, body) => { current = { ...current, ...(body as typeof current) }; return structuredClone(current) as never; });
  show(true, { workerDocumentReturnTo: { workerId: ids.worker, unitId: ids.unit, sessionKey: 'native-doc-test', documentPage: 2 } });
  await screen.findByText('Alice Trabalhadora'); expect(screen.getByLabelText(/^Unidade/)).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Tipo documental/), { target: { value: ids.type } }); fireEvent.change(screen.getByLabelText(/^Código/), { target: { value: 'NR-TESTE' } });
  fireEvent.change(screen.getByLabelText(/^Título/), { target: { value: 'Certificado de treinamento' } }); fireEvent.change(screen.getByLabelText(/^Emissão/), { target: { value: '2026-10-01' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cadastrar documento' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Cadastrar documento' }));
  await screen.findByRole('heading', { name: current.title }); expect(nativeDocumentsApi.post).toHaveBeenCalledWith('/documents', expect.objectContaining({ personId: ids.worker, departmentId: ids.sector }), expect.anything());
  expect(screen.getByRole('link', { name: 'Voltar ao trabalhador' })).toHaveAttribute('href', `/app/trabalhadores/${ids.worker}#documentos`);
});

function mockLink(compatible = true) {
  state.grants.push('pt:editar'); let permit = { ...permitFixture(), companyId: compatible ? ids.company : ids.foreign };
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    if (path === '/work-permits/search') return { items: [structuredClone(permit)], page: 1, pageSize: 20, total: 1 } as never;
    if (path === `/work-permits/${permit.id}`) return structuredClone(permit) as never;
    return original(path, options);
  });
  vi.mocked(api.post).mockImplementation(async (path, body) => {
    expect(path).toBe(`/work-permits/${permit.id}/documents`); expect(body).toEqual({ documentId: ids.document, expectedVersion: 4 });
    permit = { ...permit, version: 5, contentVersion: 4 }; return undefined as never;
  });
  return permit.id;
}
it('vincula pelo comando da PT, com versão esperada, sem liberar a atividade', async () => {
  const permitId = mockLink(); show(); fireEvent.click(await screen.findByRole('button', { name: 'Vincular a uma PT' }));
  const dialog = await screen.findByRole('dialog', { name: 'Vincular documento à PT' }); await within(dialog).findByRole('option', { name: /Manutenção da cobertura/ });
  fireEvent.change(within(dialog).getByLabelText(/Permissão de trabalho/), { target: { value: permitId } }); fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar vínculo' })); await screen.findByText('Vínculo registrado. Confira as pendências e as ciências na PT.'); expect(api.post).toHaveBeenCalledTimes(1);
});
it('documento alterado impede o vínculo e mantém a escolha para conferência', async () => {
  const permitId = mockLink(); show(); fireEvent.click(await screen.findByRole('button', { name: 'Vincular a uma PT' }));
  const dialog = await screen.findByRole('dialog', { name: 'Vincular documento à PT' }); await within(dialog).findByRole('option', { name: /Manutenção da cobertura/ });
  fireEvent.change(within(dialog).getByLabelText(/Permissão de trabalho/), { target: { value: permitId } }); fireEvent.click(within(dialog).getByRole('checkbox')); current = { ...current, revision: 2 };
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar vínculo' })); expect(await within(dialog).findByRole('alert')).toHaveTextContent('foi alterado'); expect(api.post).not.toHaveBeenCalled(); expect(within(dialog).getByRole('button', { name: 'Confirmar vínculo' })).toBeDisabled();
});
it('lista de PTs de outra empresa não habilita um vínculo', async () => {
  mockLink(false); show(); fireEvent.click(await screen.findByRole('button', { name: 'Vincular a uma PT' })); const dialog = await screen.findByRole('dialog', { name: 'Vincular documento à PT' });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Não foi possível consultar'); expect(within(dialog).getByRole('button', { name: 'Confirmar vínculo' })).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
});

async function editMetadata() {
  fireEvent.click(await screen.findByRole('button', { name: 'Editar dados' }));
  return screen.findByRole('dialog', { name: 'Editar dados do documento' });
}
it('edita os dados com a revisão original, preserva arquivo, sigilo, palavras-chave e metadados', async () => {
  current = { ...current, metadata: '{"cargaHoraria":8}', keywords: ['NR'] };
  vi.mocked(nativeDocumentsApi.patch).mockImplementation(async (_path, body) => {
    current = { ...current, ...(body as typeof current), revision: 2 }; return structuredClone(current) as never;
  });
  show(); const dialog = await editMetadata();
  fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: 'Certificado corrigido' } });
  fireEvent.change(within(dialog).getByLabelText('Válido até'), { target: { value: '2027-11-01' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
  await screen.findByText('Dados do documento atualizados.'); await screen.findByRole('heading', { name: 'Certificado corrigido' });
  expect(nativeDocumentsApi.patch).toHaveBeenCalledWith(`/documents/${ids.document}`, expect.objectContaining({ expectedVersion: 1, title: 'Certificado corrigido', validUntilDate: '2027-11-01', secrecyLevel: 'Interno', metadata: '{"cargaHoraria":8}', keywords: ['NR'] }), expect.anything());
  expect(current.currentVersionNumber).toBe(0); expect(current.status).toBe('RASCUNHO');
});
it('conflito de edição mantém os dados sem repetir a alteração', async () => {
  vi.mocked(nativeDocumentsApi.patch).mockRejectedValue(new ApiError(409, { code: 'CONFLICT', message: 'Conflito', requestId: 'fixture' }));
  show(); const dialog = await editMetadata(); fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: 'Título preservado' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Seus dados foram mantidos');
  expect(within(dialog).getByLabelText(/^Título/)).toHaveValue('Título preservado'); expect(within(dialog).getByRole('button', { name: 'Salvar alterações' })).toBeDisabled(); expect(nativeDocumentsApi.patch).toHaveBeenCalledTimes(1);
});
it('não envia a edição se o documento mudou desde a abertura', async () => {
  show(); const dialog = await editMetadata(); fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: 'Meu título' } }); current.revision++;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' })); expect(await within(dialog).findByRole('alert')).toHaveTextContent('Seus dados foram mantidos'); expect(nativeDocumentsApi.patch).not.toHaveBeenCalled();
});
it('não oferece edição direta de dados em uma evidência vigente', async () => {
  pending(); current.status = 'VIGENTE'; versions[0] = { ...versions[0], state: 'VIGENTE', isCurrent: true };
  show(); await screen.findByRole('heading', { name: current.title }); expect(screen.queryByRole('button', { name: 'Editar dados' })).not.toBeInTheDocument();
});
it('recusa vencimento anterior à emissão e permite corrigir o preenchimento', async () => {
  show(); const dialog = await editMetadata(); fireEvent.change(within(dialog).getByLabelText('Válido até'), { target: { value: '2026-01-01' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' })); expect(await within(dialog).findByRole('alert')).toHaveTextContent('O vencimento não pode anteceder'); expect(nativeDocumentsApi.patch).not.toHaveBeenCalled(); expect(within(dialog).getByRole('button', { name: 'Salvar alterações' })).toBeEnabled();
});
it('recibo sem a revisão incrementada não confirma a edição e bloqueia repetição', async () => {
  vi.mocked(nativeDocumentsApi.patch).mockImplementation(async () => structuredClone(current) as never);
  show(); const dialog = await editMetadata(); fireEvent.change(within(dialog).getByLabelText(/^Título/), { target: { value: 'Alterado' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('A resposta não confirmou'); expect(within(dialog).getByRole('button', { name: 'Salvar alterações' })).toBeDisabled(); expect(screen.queryByText('Dados do documento atualizados.')).not.toBeInTheDocument();
});
