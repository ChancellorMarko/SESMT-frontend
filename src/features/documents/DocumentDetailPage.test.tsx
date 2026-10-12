import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentVersionDto, MeDto } from '../../shared/contracts';
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
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 10, total: items.length });
afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ['documents.read', 'documents.download', 'documents.approve', 'documents.publish'];
  document = { ...metadata, id: documentId, status: 'IN_REVIEW', currentVersionId: versionId, activeVersionIds: [], availableActions: ['CREATE_VERSION', 'ARCHIVE'], revision: 4 };
  version = { id: versionId, documentId, versionNumber: 2, reason: 'Revisão de conteúdo', status: 'IN_REVIEW', metadataSnapshot: metadata, file: { id: versionId, name: 'programa.pdf', mimeType: 'application/pdf', sizeBytes: 100, sha256: 'hash', scanStatus: 'CLEAN' }, createdAt: '2026-10-05T15:00:00.000Z', createdBy: userId, signatureEvidences: [], availableActions: ['APPROVE', 'PUBLISH', 'DOWNLOAD', 'PREVIEW'], revision: 7 };
  const me: MeDto = { user: { id: userId, displayName: 'Profissional SESMT', email: 'sesmt@example.test' }, roles: ['SESMT_MANAGER'], permissions, scope: { companyIds: [documentId], unitIds: [documentId], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: '2030-01-01T00:00:00Z' };
  vi.mocked(useSession).mockImplementation(() => ({ me, unitId: documentId, sessionKey: 'test-session', can: (permission) => permissions.includes(permission), status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() }));
  vi.mocked(api.get).mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === `/documents/${documentId}`) return document as T;
    if (path === '/document-types') return page([]) as T;
    if (path.endsWith('/versions')) return page([version]) as T;
    if (path.endsWith(`/versions/${versionId}`)) return version as T;
    if (path.endsWith('/history')) return page([]) as T;
    throw new Error(`Rota inesperada no teste: ${path}`);
  });
  vi.mocked(api.post).mockResolvedValue(version);
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/documentos/${documentId}`]}><Routes><Route path="/app/documentos/:id" element={<DocumentDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('detalhe de documento', () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar versão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/documents/${documentId}/versions/${versionId}/approvals`, { comment: undefined }, expect.objectContaining({ etag: '"7"', idempotencyKey: expect.any(String) })));
    expect(await screen.findByText('Aprovar versão: operação confirmada.')).toBeInTheDocument();
    expect(screen.queryByText('Vigente', { exact: true })).not.toBeInTheDocument();
  });
  it('rejeita esquemas ativos ou origens de armazenamento não permitidas', () => {
    expect(isDownloadUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(isDownloadUrlAllowed('https://externo.example.test/documento.pdf')).toBe(false);
    expect(isDownloadUrlAllowed('/arquivos/documento.pdf')).toBe(true);
  });
});
