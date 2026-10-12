import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentTypeDto, OrganizationDto } from '../../shared/contracts';
import { DocumentFormPage } from './DocumentFormPage';
import { VersionFormPage } from './VersionFormPage';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
const unitId = '10000000-0000-4000-8000-000000000001';
const typeId = '20000000-0000-4000-8000-000000000001';
const ownerId = '30000000-0000-4000-8000-000000000001';
const document: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Título inicial', companyId: unitId, unitId, typeId, ownerId, accessClass: 'INTERNAL', issueDate: '2026-10-05', status: 'DRAFT', activeVersionIds: [], availableActions: ['EDIT_METADATA', 'CREATE_VERSION'], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };
const type: DocumentTypeDto = { id: typeId, code: 'DOC', name: 'Procedimento', category: 'SST', requiredFields: [], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'REF', version: '1', source: 'test' }, workflow: { reviewRequired: false, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 };
const organization: OrganizationDto = { companies: [{ id: unitId, name: 'Empresa', status: 'ACTIVE', revision: 1 }], units: [{ id: unitId, companyId: unitId, name: 'Unidade', status: 'ACTIVE', revision: 1 }], sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({ me: null, unitId, sessionKey: 'forms-test', can: permission => permission === 'documents.write', status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() });
  vi.mocked(api.get).mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === `/documents/${document.id}`) return { ...document } as T;
    if (path === '/organization') return organization as T;
    const items = path === '/document-types' ? [type] : [{ id: ownerId, displayName: 'Responsável' }];
    return { items, total: items.length, page: 1, pageSize: 100 } as T;
  });
  vi.mocked(api.patch).mockResolvedValue(document);
  vi.mocked(api.post).mockResolvedValue({ id: 'version-1' });
});
afterEach(() => vi.restoreAllMocks());

async function show(version = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/documentos/${document.id}/${version ? 'versoes/nova' : 'editar'}`]}><Routes><Route path="/app/documentos/:id/editar" element={<DocumentFormPage />} /><Route path="/app/documentos/:id/versoes/nova" element={<VersionFormPage />} /><Route path="/app/documentos/:id" element={<h1>Documento salvo</h1>} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByLabelText('Título *');
  await waitFor(() => expect(screen.getByLabelText('Proprietário *')).toHaveValue(ownerId));
  return client;
}
function chooseFile() { fireEvent.change(screen.getByLabelText('Arquivo da versão *'), { target: { files: [new File(['%PDF-test'], 'teste.pdf', { type: 'application/pdf' })] } }); }

describe('edição e versão documental', () => {
  it.each([false, true])('preserva preenchimento e revisão de referência após atualização externa (versão=%s)', async version => {
    const client = await show(version);
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Meu preenchimento' } });
    if (version) { chooseFile(); fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Revisão de teste' } }); }
    act(() => { client.setQueryData(['document', 'forms-test', unitId, document.id], { ...document, title: 'Título alterado por outra pessoa', revision: 2 }); });
    expect(screen.getByLabelText('Título *')).toHaveValue('Meu preenchimento');
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    if (version) await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/documents/${document.id}/versions`, expect.any(FormData), expect.objectContaining({ etag: revisionEtag(1) })));
    else await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/documents/${document.id}`, expect.objectContaining({ title: 'Meu preenchimento' }), expect.objectContaining({ etag: revisionEtag(1) })));
    await screen.findByRole('heading', { name: 'Documento salvo' });
  });
  it.each(['arquivo', 'justificativa'])('protege troca de unidade ao alterar somente %s', async changed => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await show(true);
    if (changed === 'arquivo') chooseFile(); else fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Primeiro envio' } });
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('mantém campos e troca de contexto bloqueados durante envio', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(api.post).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    await show(true);
    chooseFile(); fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Primeiro envio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar nova versão' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.getByLabelText('Título *')).toBeDisabled();
    expect(screen.getByLabelText('Arquivo da versão *')).toBeDisabled();
    expect(screen.getByLabelText('Justificativa da versão *')).toBeDisabled();
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(false);
    await act(async () => complete({ id: 'version-1' }));
    await screen.findByRole('heading', { name: 'Documento salvo' });
  });
});
