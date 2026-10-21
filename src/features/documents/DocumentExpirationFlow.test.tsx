import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const sessionKey = 'expiration-document-test';
const search = `?view=upcoming&days=90&q=Procedimento%20revisado&page=2&unitId=${unitId}`;
const origin = { expirationReturnTo: { unitId, search } };
const queryKey = ['documents', 'expirations', sessionKey, unitId, 2, { status: 'ACTIVE', q: 'Procedimento revisado' }];
const baseDocument: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Procedimento original', companyId: unitId, unitId, typeId, ownerId, accessClass: 'INTERNAL', issueDate: '2026-10-05', validUntil: '2026-12-31', status: 'ACTIVE', activeVersionIds: [], availableActions: ['EDIT_METADATA', 'CREATE_VERSION'], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };
const type: DocumentTypeDto = { id: typeId, code: 'DOC', name: 'Procedimento', category: 'SST', requiredFields: [], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'REF', version: '1', source: 'test' }, workflow: { reviewRequired: false, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 };
const organization: OrganizationDto = { companies: [{ id: unitId, name: 'Empresa', status: 'ACTIVE', revision: 1 }], units: [{ id: unitId, companyId: unitId, name: 'Unidade', status: 'ACTIVE', revision: 1 }], sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [] };
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 10, total: items.length });
let current: DocumentDto;
let expirationRead: ReturnType<typeof vi.fn<() => Promise<string>>>;

beforeEach(() => {
  vi.clearAllMocks(); current = structuredClone(baseDocument);
  expirationRead = vi.fn(async () => current.title);
  vi.mocked(useSession).mockReturnValue({ me: null, unitId, sessionKey, can: permission => ['documents.read', 'documents.write'].includes(permission), status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() });
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

function ExpirationResult() {
  const location = useLocation();
  const result = useQuery({ queryKey, queryFn: expirationRead, staleTime: Infinity });
  return <><h1>Resultado dos vencimentos</h1><output aria-label="Filtros restaurados">{location.search}</output><p>{result.data}</p></>;
}
function LocationState() { const location = useLocation(); return <output aria-label="Origem recebida">{JSON.stringify(location.state)}</output>; }
async function show(state: unknown = origin, waitForDocument = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  await client.fetchQuery({ queryKey, queryFn: expirationRead, staleTime: Infinity });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: `/app/documentos/${current.id}`, state }]}><LocationState /><Routes>
    <Route path="/app/documentos/:id" element={<DocumentDetailPage />} />
    <Route path="/app/documentos/:id/editar" element={<DocumentFormPage />} />
    <Route path="/app/documentos/:id/versoes/nova" element={<VersionFormPage />} />
    <Route path="/app/vencimentos" element={<ExpirationResult />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  if (waitForDocument) await screen.findByRole('heading', { name: current.title });
  return client;
}
async function openEditor(version: boolean) {
  fireEvent.click(screen.getByRole('link', { name: version ? 'Nova versão' : 'Editar metadados' }));
  await screen.findByLabelText('Título *');
  await waitFor(() => expect(screen.getByLabelText('Proprietário *')).toHaveValue(ownerId));
}

describe('retorno aos vencimentos documentais', () => {
  it.each([false, true])('preserva consulta ao descartar e salvar, renovando somente o cache do contexto (versão=%s)', async version => {
    const client = await show({ ...origin, secret: 'não propagar', expirationReturnTo: { ...origin.expirationReturnTo, pathname: '/app/vencimentos', ignored: true } });
    const otherSession = ['documents', 'expirations', 'other-session', unitId, 2];
    const otherUnit = ['documents', 'expirations', sessionKey, 'other-unit', 2];
    client.setQueryData(otherSession, 'Outro contexto'); client.setQueryData(otherUnit, 'Outra unidade');
    await openEditor(version);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(origin);
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Preenchimento a descartar' } });
    fireEvent.click(screen.getByRole('link', { name: version ? 'Voltar ao documento' : 'Voltar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar e sair' }));
    expect(await screen.findByRole('link', { name: 'Voltar aos vencimentos' })).toHaveAttribute('href', `/app/vencimentos${search}`);
    await openEditor(version);
    if (version) {
      fireEvent.change(screen.getByLabelText('Arquivo da versão *'), { target: { files: [new File(['%PDF-test'], 'teste.pdf', { type: 'application/pdf' })] } });
      fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Versão revisada' } });
    } else fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Procedimento revisado' } });
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    expect(await screen.findByRole('link', { name: 'Voltar aos vencimentos' })).toHaveAttribute('href', `/app/vencimentos${search}`);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(origin);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherSession)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherUnit)?.isInvalidated).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar aos vencimentos' }));
    await screen.findByRole('heading', { name: 'Resultado dos vencimentos' });
    expect(await screen.findByText(current.title)).toBeVisible();
    expect(screen.getByLabelText('Filtros restaurados')).toHaveTextContent(search);
    expect(expirationRead).toHaveBeenCalledTimes(2);
  });

  it.each([
    { expirationReturnTo: { unitId: 'other-unit', search } },
    { expirationReturnTo: { unitId, search: 'https://external.example' } },
    { expirationReturnTo: { unitId, search: `?unitId=${unitId}&days=365` } },
    { expirationReturnTo: { unitId, search, pathname: '/app/consulta' } },
  ])('descarta origem incompatível inclusive ao cancelar a edição: %j', async state => {
    await show(state);
    expect(screen.queryByRole('link', { name: 'Voltar aos vencimentos' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    await openEditor(false); fireEvent.click(screen.getByRole('link', { name: 'Voltar' }));
    expect(await screen.findByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent('expirationReturnTo');
  });

  it('prioriza vencimentos válidos sobre a consulta e propaga apenas essa origem', async () => {
    await show({ ...origin, fromConsulta: true, fromSearch: `?tab=documents&unitId=${unitId}`, fromUnitId: unitId });
    expect(screen.getByRole('link', { name: 'Voltar aos vencimentos' })).toHaveAttribute('href', `/app/vencimentos${search}`);
    expect(screen.queryByRole('link', { name: 'Voltar à consulta' })).not.toBeInTheDocument();
    await openEditor(false);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(origin);
  });

  it('mantém a origem da consulta quando o retorno de vencimentos é incompatível', async () => {
    const fromSearch = `?tab=documents&unitId=${unitId}`;
    const consultation = { fromConsulta: true, fromSearch, fromUnitId: unitId };
    await show({ ...consultation, expirationReturnTo: { unitId: 'other-unit', search } });
    expect(screen.getByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${fromSearch}`);
    await openEditor(false);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(consultation);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar' }));
    expect(await screen.findByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${fromSearch}`);
  });

  it('oferece o mesmo retorno quando o documento não pode ser carregado', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Documento indisponível'));
    await show(origin, false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Documento indisponível');
    expect(screen.getByRole('link', { name: 'Voltar aos vencimentos' })).toHaveAttribute('href', `/app/vencimentos${search}`);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar aos vencimentos' }));
    await screen.findByRole('heading', { name: 'Resultado dos vencimentos' });
    expect(screen.getByLabelText('Filtros restaurados')).toHaveTextContent(search);
  });
});
