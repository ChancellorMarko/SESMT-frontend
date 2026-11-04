import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentTypeDto, DocumentVersionDto, MeDto } from '../../shared/contracts';
import { DocumentDetailPage, isDownloadUrlAllowed } from './DocumentDetailPage';

vi.mock('../../shared/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
const documentId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000001';
const metadata = { code: 'DOC-01', title: 'Programa de prevenção', typeId: documentId, companyId: documentId, unitId: documentId, ownerId: userId, accessClass: 'INTERNAL' as const, issueDate: '2026-10-05', workerIds: [], responsibleIds: [], keywords: [] };
let permissions: string[];
let document: DocumentDto;
let version: DocumentVersionDto;
let policy: DocumentTypeDto;
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 10, total: items.length });
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['documents.read', 'documents.download', 'documents.approve', 'documents.publish'];
  document = { ...metadata, id: documentId, status: 'IN_REVIEW', currentVersionId: versionId, activeVersionIds: [], availableActions: ['CREATE_VERSION', 'ARCHIVE'], revision: 4 };
  policy = { id: metadata.typeId, code: 'PGR', name: 'Política documental de teste', category: 'SST', requiredFields: ['title', 'issueDate'], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'TESTE', version: '1', source: 'Política sintética de teste' }, workflow: { reviewRequired: true, signatureRequired: true, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 };
  version = { id: versionId, documentId, versionNumber: 2, reason: 'Revisão de conteúdo', status: 'IN_REVIEW', metadataSnapshot: metadata, file: { id: versionId, name: 'programa.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'hash', scanStatus: 'CLEAN' }, createdAt: '2026-10-05T15:00:00.000Z', createdBy: userId, signatureEvidences: [], availableActions: ['APPROVE', 'PUBLISH', 'DOWNLOAD', 'PREVIEW'], revision: 7 };
  const me: MeDto = { user: { id: userId, displayName: 'Profissional SESMT', email: 'sesmt@example.test' }, roles: ['SESMT_MANAGER'], permissions, scope: { companyIds: [documentId], unitIds: [documentId], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: '2030-01-01T00:00:00Z' };
  vi.mocked(useSession).mockImplementation(() => ({ me, unitId: documentId, sessionKey: 'test-session', can: (permission) => permissions.includes(permission), status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() }));
  vi.mocked(api.get).mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === `/documents/${documentId}`) return document as T;
    if (path === '/document-types') return page([policy]) as T;
    if (path.endsWith('/versions')) return page([version]) as T;
    if (path.endsWith(`/versions/${versionId}`)) return version as T;
    if (path.endsWith('/history')) return page([]) as T;
    throw new Error(`Rota inesperada no teste: ${path}`);
  });
  vi.mocked(api.post).mockResolvedValue(version);
});

function show(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/documentos/${documentId}`]}><Routes><Route path="/app/documentos/:id" element={<DocumentDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}
async function clickEnabled(name: string) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

describe('detalhe de documento', () => {
  it.each([{ id: 'outro-documento' }, { unitId: 'outra-unidade' }, { availableActions: null }])('recusa detalhe incompatível antes de carregar versões: %j', change => {
    document = { ...document, ...change } as DocumentDto;
    show();
    return screen.findByRole('button', { name: 'Tentar novamente' }).then(() => {
      expect(screen.queryByRole('heading', { name: metadata.title })).not.toBeInTheDocument();
      expect(vi.mocked(api.get).mock.calls.some(([path]) => path.includes('/versions') || path.includes('/history'))).toBe(false);
    });
  });
  it('não exibe arquivo, evidências ou comandos de uma versão de outro documento', async () => {
    version = { ...version, documentId: 'outro-documento', file: { ...version.file, name: 'arquivo-de-outro-documento.pdf' } };
    show();
    await screen.findByRole('button', { name: 'Tentar carregar versão selecionada novamente' });
    expect(screen.queryByText('arquivo-de-outro-documento.pdf', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar versão' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Consultar v2' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('não exibe evento associado a outro documento', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path.endsWith('/history') ? page([{ id: 'foreign-event', documentId: 'outro-documento', action: 'CREATED', occurredAt: version.createdAt, actor: { id: userId, displayName: 'Autor de outro documento' } }]) as never : original(path, options));
    show();
    await screen.findByRole('button', { name: 'Tentar carregar histórico novamente' });
    expect(screen.queryByText('Autor de outro documento', { exact: false })).not.toBeInTheDocument();
  });
  it('não restaura metadados do cache após negativa até receber nova leitura válida', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    show(client);
    await screen.findByRole('heading', { name: metadata.title });
    await screen.findByRole('heading', { name: 'Versão 2' });
    const original = vi.mocked(api.get).getMockImplementation()!;
    let denied = true;
    vi.mocked(api.get).mockImplementation(async (path, options) => { if (path === `/documents/${documentId}` && denied) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso revogado.', requestId: 'test' }); return original(path, options); });
    await act(async () => { await client.refetchQueries({ queryKey: ['document', 'test-session', documentId, documentId], exact: true }); });
    await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByRole('heading', { name: metadata.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Versão 2' })).not.toBeInTheDocument();
    act(() => client.setQueryData(['document', 'test-session', documentId, documentId], document));
    expect(screen.queryByRole('heading', { name: metadata.title })).not.toBeInTheDocument();
    denied = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('heading', { name: metadata.title });
    await screen.findByRole('heading', { name: 'Versão 2' });
  });
  it('ignora prévia atrasada ao selecionar outra versão e cancela a requisição antiga', async () => {
    const secondId = '20000000-0000-4000-8000-000000000002';
    const second = { ...version, id: secondId, versionNumber: 3 };
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path.endsWith('/versions') ? page([version, second]) as never : path.endsWith(`/versions/${secondId}`) ? second as never : original(path, options));
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
    show();
    await clickEnabled('Visualizar arquivo');
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const signal = vi.mocked(api.post).mock.calls[0][2]?.signal;
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar v3' }));
    await screen.findByRole('heading', { name: 'Versão 3' });
    expect(signal?.aborted).toBe(true);
    await act(async () => finish({ url: '/arquivo-antigo.pdf', fileName: 'arquivo-antigo.pdf', mimeType: 'application/pdf', expiresAt: '2099-01-01T00:00:00Z' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Prévia de arquivo-antigo.pdf')).not.toBeInTheDocument();
  });
  it('não abre um arquivo quando a autorização de download retorna dados incompletos', async () => {
    vi.mocked(api.post).mockResolvedValue({ url: '/arquivo.pdf', expiresAt: '2099-01-01T00:00:00Z' } as never);
    show(); await clickEnabled('Solicitar download');
    await screen.findByText('O serviço não confirmou um acesso válido ao arquivo. Tente novamente.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('apresenta o cadastro demonstrativo no histórico com rótulo em português', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path.endsWith('/history') ? page([{ id: 'history-created', documentId, action: 'DOCUMENT_CREATED', actor: { id: userId, displayName: 'Profissional SESMT' }, occurredAt: '2026-10-19T12:00:00Z' }]) as never : original(path, options));
    show();
    expect(await screen.findByText('Documento cadastrado')).toBeVisible();
    expect(screen.queryByText('DOCUMENT_CREATED')).not.toBeInTheDocument();
  });
  it('destaca a versão selecionada e move o foco apenas na consulta explícita', async () => {
    show();
    const button = await screen.findByRole('button', { name: 'Consultar v2' });
    await screen.findByRole('heading', { name: 'Versão 2' });
    const panel = screen.getByRole('region', { name: 'Versão selecionada' });
    expect(panel).not.toHaveFocus();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button); expect(panel).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });
  it.each([
    ['versions', 'Tentar carregar versões novamente'],
    [`versions/${versionId}`, 'Tentar carregar versão selecionada novamente'],
    ['history', 'Tentar carregar histórico novamente'],
  ])('permite recuperar falha na consulta de %s sem alterar o documento', async (suffix, label) => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    let failed = true;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === `/documents/${documentId}/${suffix}` && failed) throw new Error('Falha temporária da consulta.');
      return original(path, options);
    });
    show(); const retry = await screen.findByRole('button', { name: label });
    failed = false; fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });
  it('oculta comandos sem capacidade mesmo que a API informe availableActions', async () => {
    permissions = ['documents.read', 'documents.download'];
    show();
    expect(await screen.findByRole('button', { name: 'Visualizar arquivo' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Aprovar versão' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar versão' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nova versão' })).not.toBeInTheDocument();
  });
  it('bloqueia aprovação, publicação e download enquanto o arquivo estiver em verificação', async () => {
    version.file.scanStatus = 'PENDING';
    show();
    expect(await screen.findByRole('button', { name: 'Aprovar versão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publicar versão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Solicitar download' })).toBeDisabled();
  });
  it('envia aprovação com revisão da versão e idempotência sem otimizar a vigência', async () => {
    show();
    await clickEnabled('Aprovar versão');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/documents/${documentId}/versions/${versionId}/approvals`, { comment: undefined }, expect.objectContaining({ etag: '"7"', idempotencyKey: expect.any(String) })));
    expect(await screen.findByText('Aprovar versão: operação confirmada.')).toBeInTheDocument();
    expect(screen.queryByText('Vigente', { exact: true })).not.toBeInTheDocument();
  });
  it('atualiza o resultado da consulta após um comando mesmo com cache infinito e preserva outro contexto', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    const read = vi.fn(async () => document.status);
    const query = { queryKey: ['consulta-documents', 'test-session', documentId, 2, 'Programa'], queryFn: read, staleTime: Infinity };
    const otherKey = ['consulta-documents', 'other-session', 'other-unit', 2, 'Programa'];
    await client.fetchQuery(query);
    client.setQueryData(otherKey, 'DRAFT');
    show(client);
    await clickEnabled('Aprovar versão');
    document = { ...document, status: 'APPROVED', revision: 5 };
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await screen.findByText('Aprovar versão: operação confirmada.');
    await waitFor(() => expect(client.getQueryState(query.queryKey)?.isInvalidated).toBe(true));
    expect(await client.fetchQuery(query)).toBe('APPROVED');
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
  it('invalida as duas unidades ao publicar um snapshot que transfere o documento, sem invalidar outra sessão', async () => {
    const targetUnitId = '40000000-0000-4000-8000-000000000001';
    version = { ...version, status: 'APPROVED', metadataSnapshot: { ...metadata, unitId: targetUnitId } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    const sourceKey = ['consulta-documents', 'test-session', documentId, 1];
    const targetKey = ['consulta-documents', 'test-session', targetUnitId, 1];
    const otherSessionKey = ['consulta-documents', 'other-session', targetUnitId, 1];
    const source = { queryKey: sourceKey, queryFn: vi.fn(async () => document.unitId === documentId ? [document.code] : []), staleTime: Infinity };
    const target = { queryKey: targetKey, queryFn: vi.fn(async () => document.unitId === targetUnitId ? [document.code] : []), staleTime: Infinity };
    await client.fetchQuery(source); await client.fetchQuery(target);
    client.setQueryData(otherSessionKey, ['outra sessão']);
    vi.mocked(api.post).mockImplementation(async <T,>(): Promise<T> => {
      document = { ...document, unitId: targetUnitId, status: 'ACTIVE', revision: 5 };
      return { document, version: { ...version, status: 'ACTIVE' } } as T;
    });
    show(client);
    await clickEnabled('Publicar versão');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await screen.findByText('Publicar versão: operação confirmada.');
    await waitFor(() => expect(client.getQueryState(targetKey)?.isInvalidated).toBe(true));
    expect(client.getQueryState(sourceKey)?.isInvalidated).toBe(true);
    expect(await client.fetchQuery(source)).toEqual([]);
    expect(await client.fetchQuery(target)).toEqual(['DOC-01']);
    expect(source.queryFn).toHaveBeenCalledTimes(2);
    expect(target.queryFn).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(otherSessionKey)?.isInvalidated).toBe(false);
  });
  it('rejeita esquemas ativos ou origens de armazenamento não permitidas', () => {
    expect(isDownloadUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(isDownloadUrlAllowed('https://externo.example.test/documento.pdf')).toBe(false);
    expect(isDownloadUrlAllowed('/arquivos/documento.pdf')).toBe(true);
  });
  it('resolve tipo além dos primeiros 100 e usa sua política no arquivo da assinatura', async () => {
    const rareId = '40000000-0000-4000-8000-000000000104';
    document = { ...document, typeId: rareId };
    version = { ...version, metadataSnapshot: { ...metadata, typeId: rareId }, availableActions: [...version.availableActions, 'ADD_SIGNATURE_EVIDENCE'] };
    policy = { ...policy, id: rareId, name: 'Política fora dos primeiros 100 tipos', allowedMimeTypes: ['image/png'], maxFileSizeBytes: 2048 };
    permissions.push('documents.write');
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: Parameters<typeof api.get>[1]): Promise<T> => {
      if (path === '/document-types') return (options?.query?.ids === rareId ? page([policy]) : { items: Array.from({ length: 20 }, (_, index) => ({ ...policy, id: `outro-${index}`, name: `Tipo inicial ${index}` })), total: 125, page: 1, pageSize: 20 }) as T;
      return original(path, options) as Promise<T>;
    });
    show();
    expect(await screen.findByText(policy.name, { exact: true })).toBeVisible();
    await clickEnabled('Registrar assinatura');
    expect(screen.getByLabelText('Arquivo da evidência *')).toHaveAttribute('accept', 'image/png');
    expect(screen.getByText('Limite: 2 KB.', { exact: true })).toBeVisible();
    expect(api.get).toHaveBeenCalledWith('/document-types', expect.objectContaining({ query: expect.objectContaining({ ids: rareId, page: 1, pageSize: 100 }) }));
    fireEvent.change(screen.getByLabelText('Arquivo da evidência *'), { target: { files: [new File(['conteúdo em formato incorreto'], 'comprovante.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Formato não permitido pelo tipo documental.')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('confere a política do snapshot selecionado quando seu tipo difere do documento atual', async () => {
    const historicalId = '40000000-0000-4000-8000-000000000002';
    const historicalPolicy = { ...policy, id: historicalId, name: 'Política preservada da versão', allowedMimeTypes: ['image/png'], maxFileSizeBytes: 2048 };
    version = { ...version, metadataSnapshot: { ...metadata, typeId: historicalId }, availableActions: [...version.availableActions, 'ADD_SIGNATURE_EVIDENCE'] };
    permissions.push('documents.write');
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: Parameters<typeof api.get>[1]): Promise<T> => {
      if (path === '/document-types') {
        const ids = String(options?.query?.ids ?? '').split(',');
        return page([policy, historicalPolicy].filter(type => !options?.query?.ids || ids.includes(type.id))) as T;
      }
      return original(path, options) as Promise<T>;
    });
    show();
    expect(await screen.findByText(policy.name, { exact: true })).toBeVisible();
    await clickEnabled('Registrar assinatura');
    expect(screen.getByLabelText('Arquivo da evidência *')).toHaveAttribute('accept', 'image/png');
    expect(api.get).toHaveBeenCalledWith('/document-types', expect.objectContaining({ query: expect.objectContaining({ ids: `${metadata.typeId},${historicalId}` }) }));
    fireEvent.change(screen.getByLabelText('Arquivo da evidência *'), { target: { files: [new File(['pdf'], 'arquivo.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Formato não permitido pelo tipo documental.')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('oculta a política em cache após 403 e bloqueia inclusive a confirmação já aberta até conferir novamente', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    show(client);
    await clickEnabled('Aprovar versão');
    expect(screen.getByText(policy.name, { exact: true })).toBeVisible();
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: Parameters<typeof api.get>[1]): Promise<T> => {
      if (path === '/document-types') throw new ApiError(403, { code: 'FORBIDDEN', message: 'Política indisponível neste escopo.', requestId: 'policy-denied' });
      return original(path, options) as Promise<T>;
    });
    await act(async () => { await client.invalidateQueries({ queryKey: ['document-types', 'test-session', documentId, 'document-detail'] }); });
    await screen.findByText('Não foi possível conferir a política documental.', { exact: false });
    expect(screen.queryByText(policy.name, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('Não foi possível conferir a política documental.', { exact: false })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aprovar versão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(await screen.findByText('Confira a política documental atual antes de confirmar esta ação.')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(api.get).mockImplementation(original);
    fireEvent.click(screen.getByRole('button', { name: 'Conferir política novamente' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled());
    expect(screen.getByText(policy.name, { exact: true })).toBeVisible();
  });
  it('não usa a lista paginada para autorizar uma política ausente na resolução dos IDs selecionados', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: Parameters<typeof api.get>[1]): Promise<T> => path === '/document-types' ? page(options?.query?.ids ? [] : [policy]) as T : original(path, options) as Promise<T>);
    show();
    expect(await screen.findByText('O tipo documental desta referência não está disponível.', { exact: false })).toBeVisible();
    expect(screen.queryByText(policy.name, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar versão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publicar versão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Solicitar download' })).toBeEnabled();
  });
});
