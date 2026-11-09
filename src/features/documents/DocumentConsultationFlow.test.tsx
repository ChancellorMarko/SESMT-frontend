import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentTypeDto, OrganizationDto } from '../../shared/contracts';
import { DocumentDetailPage } from './DocumentDetailPage';
import { DocumentFormPage } from './DocumentFormPage';
import { VersionFormPage } from './VersionFormPage';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
const unitId = '10000000-0000-4000-8000-000000000001';
const typeId = '20000000-0000-4000-8000-000000000001';
const ownerId = '30000000-0000-4000-8000-000000000001';
const sessionKey = 'consultation-document-test';
const search = `?tab=documents&q=Procedimento&status=DRAFT&page=2&unitId=${unitId}`;
const origin = { fromConsulta: true, fromSearch: search, fromUnitId: unitId };
const queryKey = ['consulta-documents', sessionKey, unitId, 2, 'Procedimento', typeId, 'DRAFT'] as const;
const baseDocument: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Procedimento original', companyId: unitId, unitId, typeId, ownerId, accessClass: 'INTERNAL', issueDate: '2026-10-05', status: 'DRAFT', activeVersionIds: [], availableActions: ['EDIT_METADATA', 'CREATE_VERSION'], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };
const type: DocumentTypeDto = { id: typeId, code: 'DOC', name: 'Procedimento', category: 'SST', requiredFields: [], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'REF', version: '1', source: 'test' }, workflow: { reviewRequired: false, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 };
const organization: OrganizationDto = { companies: [{ id: unitId, name: 'Empresa', status: 'ACTIVE', revision: 1 }], units: [{ id: unitId, companyId: unitId, name: 'Unidade', status: 'ACTIVE', revision: 1 }], sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [] };
let current: DocumentDto;
let consultationRead: ReturnType<typeof vi.fn<() => Promise<string>>>;
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 10, total: items.length });

beforeEach(() => {
  vi.clearAllMocks(); current = structuredClone(baseDocument);
  consultationRead = vi.fn(async () => current.title);
  vi.mocked(useSession).mockReturnValue({ me: null, unitId, sessionKey, can: permission => ['documents.read', 'documents.write'].includes(permission), status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn(), reloadIdentity: vi.fn() });
  vi.mocked(api.get).mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === `/documents/${current.id}`) return structuredClone(current) as T;
    if (path === '/organization') return organization as T;
    if (path === '/document-types') return page([type]) as T;
    if (path.endsWith('/versions') || path.endsWith('/history')) return page([]) as T;
    return page([{ id: ownerId, displayName: 'Responsável' }]) as T;
  });
  vi.mocked(api.patch).mockImplementation(async <T,>(_path: string, body?: unknown): Promise<T> => { current = { ...current, ...(body as object), revision: 2 }; return structuredClone(current) as T; });
  vi.mocked(api.post).mockImplementation(async <T,>(): Promise<T> => { current = { ...current, title: 'Procedimento com nova versão', revision: 2 }; return { id: 'version-new' } as T; });
});

function ConsultationResult() {
  const location = useLocation();
  const result = useQuery({ queryKey, queryFn: consultationRead, staleTime: Infinity });
  return <><h1>Resultado da consulta</h1><output aria-label="Filtros restaurados">{location.search}</output><p>{result.data}</p></>;
}
async function show(state: unknown = origin) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  await client.fetchQuery({ queryKey, queryFn: consultationRead, staleTime: Infinity });
  client.setQueryData(['document', 'other-session', 'other-unit', current.id], { ...current, title: 'Documento de outro contexto' });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: `/app/documentos/${current.id}`, state }]}><Routes>
    <Route path="/app/documentos/:id" element={<DocumentDetailPage />} />
    <Route path="/app/documentos/:id/editar" element={<DocumentFormPage />} />
    <Route path="/app/documentos/:id/versoes/nova" element={<VersionFormPage />} />
    <Route path="/app/consulta" element={<ConsultationResult />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('heading', { name: current.title });
  return client;
}
async function openEditor(version: boolean) {
  fireEvent.click(screen.getByRole('link', { name: version ? 'Nova versão' : 'Editar metadados' }));
  await screen.findByLabelText('Título *');
  await waitFor(() => expect(screen.getByLabelText('Proprietário *')).toHaveValue(ownerId));
}

describe('retorno da consulta documental', () => {
  it.each([false, true])('preserva os filtros ao cancelar e salvar o editor e atualiza o cache infinito (versão=%s)', async version => {
    const user = userEvent.setup();
    const client = await show();
    await openEditor(version);
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Preenchimento a descartar' } });
    fireEvent.click(screen.getByRole('link', { name: version ? 'Voltar ao documento' : 'Voltar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar e sair' }));
    expect(await screen.findByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${search}`);
    await openEditor(version);
    if (version) {
      fireEvent.change(screen.getByLabelText('Arquivo da versão *'), { target: { files: [new File(['%PDF-test'], 'teste.pdf', { type: 'application/pdf' })] } });
      fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Versão revisada' } });
    } else fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Procedimento revisado' } });
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    const back = await screen.findByRole('link', { name: 'Voltar à consulta' });
    expect(back).toHaveAttribute('href', `/app/consulta${search}`);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(['document', 'other-session', 'other-unit', current.id])).toMatchObject({ title: 'Documento de outro contexto', revision: 1 });
    await screen.findByRole('heading', { name: current.title });
    await user.click(screen.getByRole('link', { name: 'Voltar à consulta' }));
    await screen.findByRole('heading', { name: 'Resultado da consulta' });
    expect(await screen.findByText(current.title)).toBeVisible();
    expect(screen.getByLabelText('Filtros restaurados')).toHaveTextContent(search);
    expect(consultationRead).toHaveBeenCalledTimes(2);
  });

  it.each([
    { fromConsulta: true, fromSearch: search, fromUnitId: 'other-unit' },
    { fromConsulta: true, fromSearch: 'https://external.example/consulta' },
    { fromConsulta: true, fromSearch: '?q=Procedimento#fora' },
  ])('descarta uma origem de consulta incompatível ao abrir e cancelar a edição: %j', async state => {
    await show(state);
    expect(screen.queryByRole('link', { name: 'Voltar à consulta' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    await openEditor(false);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar' }));
    expect(await screen.findByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
  });

  it('aceita a origem legada da consulta sem identificador da unidade', async () => {
    await show({ fromConsulta: true, fromSearch: search });
    await openEditor(false);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar' }));
    expect(await screen.findByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${search}`);
  });

  it.each([false, true])('chega ao detalhe quando a confirmação remove a ação de edição (versão=%s)', async version => {
    vi.mocked(api.patch).mockImplementation(async <T,>(): Promise<T> => { current = { ...current, title: 'Documento protegido', availableActions: [], revision: 2 }; return structuredClone(current) as T; });
    vi.mocked(api.post).mockImplementation(async <T,>(): Promise<T> => { current = { ...current, title: 'Documento protegido', availableActions: [], revision: 2 }; return { id: 'version-new' } as T; });
    await show();
    await openEditor(version);
    if (version) {
      fireEvent.change(screen.getByLabelText('Arquivo da versão *'), { target: { files: [new File(['%PDF-test'], 'teste.pdf', { type: 'application/pdf' })] } });
      fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Versão protegida após confirmação' } });
    } else fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Documento protegido' } });
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    expect(await screen.findByRole('heading', { name: 'Documento protegido' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${search}`);
    expect(screen.queryByRole('link', { name: 'Editar metadados' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nova versão' })).not.toBeInTheDocument();
  });

  it('invalida a consulta das duas unidades após transferir metadados sem alterar outra sessão', async () => {
    const otherUnitId = '40000000-0000-4000-8000-000000000001';
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: Parameters<typeof api.get>[1]): Promise<T> => path === '/organization' ? { ...organization, units: [...organization.units, { id: otherUnitId, companyId: unitId, name: 'Segunda unidade', status: 'ACTIVE', revision: 1 }] } as T : originalGet(path, options) as Promise<T>);
    const client = await show();
    const targetKey = ['consulta-documents', sessionKey, otherUnitId, 1];
    const otherSessionKey = ['consulta-documents', 'other-session', otherUnitId, 1];
    client.setQueryData(targetKey, []);
    client.setQueryData(otherSessionKey, []);
    await openEditor(false);
    fireEvent.change(screen.getByLabelText('Unidade *'), { target: { value: otherUnitId } });
    await waitFor(() => expect(screen.getByLabelText('Proprietário *')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Proprietário *'), { target: { value: ownerId } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await screen.findByRole('link', { name: 'Voltar à consulta' });
    expect(api.patch).toHaveBeenCalledWith(`/documents/${current.id}`, expect.objectContaining({ unitId: otherUnitId }), expect.anything());
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(targetKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherSessionKey)?.isInvalidated).toBe(false);
  });

  it('não grava em outro contexto nem navega quando uma resposta chega depois de desmontar o editor', async () => {
    let complete!: (value: DocumentDto) => void;
    vi.mocked(api.patch).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const client = await show();
    await openEditor(false);
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Alteração em envio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    // This simulates an external session/context transition, which unmounts protected routes.
    client.clear();
    cleanup();
    await act(async () => complete({ ...current, title: 'Resposta da sessão anterior', revision: 2 }));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
