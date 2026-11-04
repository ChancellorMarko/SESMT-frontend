import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
const sessionKey = 'notification-document-test';
const search = `?read=false&page=2&unitId=${unitId}`;
const origin = { notificationReturnTo: { unitId, search } };
const baseDocument: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Procedimento original', companyId: unitId, unitId, typeId, ownerId, accessClass: 'INTERNAL', issueDate: '2026-10-05', status: 'DRAFT', activeVersionIds: [], availableActions: ['EDIT_METADATA', 'CREATE_VERSION'], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };
const type: DocumentTypeDto = { id: typeId, code: 'DOC', name: 'Procedimento', category: 'SST', requiredFields: [], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'REF', version: '1', source: 'test' }, workflow: { reviewRequired: false, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 };
const organization: OrganizationDto = { companies: [{ id: unitId, name: 'Empresa', status: 'ACTIVE', revision: 1 }], units: [{ id: unitId, companyId: unitId, name: 'Unidade', status: 'ACTIVE', revision: 1 }], sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [] };
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 10, total: items.length });
let current: DocumentDto;
let permissions: string[];
let currentUnit: string;

beforeEach(() => {
  vi.clearAllMocks(); current = structuredClone(baseDocument); currentUnit = unitId;
  permissions = ['documents.read', 'documents.write', 'notifications.read'];
  vi.mocked(useSession).mockImplementation(() => ({ me: null, unitId: currentUnit, sessionKey, can: permission => permissions.includes(permission), status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() }));
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

function LocationState() {
  const location = useLocation();
  return <><output aria-label="Origem recebida">{JSON.stringify(location.state)}</output><output aria-label="Endereço atual">{location.pathname}{location.search}</output></>;
}
function NotificationResult() {
  const location = useLocation();
  return <><h1>Resultado das notificações</h1><output aria-label="Filtros restaurados">{location.search}</output></>;
}
async function show(state: unknown = origin, waitForDocument = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: `/app/documentos/${current.id}`, state }]}><LocationState /><Routes>
    <Route path="/app/documentos/:id" element={<DocumentDetailPage />} />
    <Route path="/app/documentos/:id/editar" element={<DocumentFormPage />} />
    <Route path="/app/documentos/:id/versoes/nova" element={<VersionFormPage />} />
    <Route path="/app/notificacoes" element={<NotificationResult />} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  if (waitForDocument) await screen.findByRole('heading', { name: current.title });
  return { client, update: () => view.rerender(tree()) };
}
async function openEditor(version: boolean) {
  fireEvent.click(screen.getByRole('link', { name: version ? 'Nova versão' : 'Editar metadados' }));
  await screen.findByLabelText('Título *');
  await waitFor(() => expect(screen.getByLabelText('Proprietário *')).toHaveValue(ownerId));
}
function fillEditor(version: boolean) {
  if (version) {
    fireEvent.change(screen.getByLabelText('Arquivo da versão *'), { target: { files: [new File(['%PDF-test'], 'teste.pdf', { type: 'application/pdf' })] } });
    fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Versão revisada' } });
  } else fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Procedimento revisado' } });
}
async function cancelEditor(version: boolean, recordAvailable = true) {
  fireEvent.click(screen.getByRole('link', { name: version ? 'Voltar ao documento' : 'Voltar' }));
  const discard = screen.queryByRole('button', { name: 'Descartar e sair' });
  if (discard) fireEvent.click(discard);
  if (recordAvailable) await screen.findByRole('heading', { name: current.title });
  else await screen.findByRole('button', { name: 'Tentar novamente' });
}

describe('retorno às notificações após consultar documentos', () => {
  it.each([false, true])('preserva leitura, página e unidade ao descartar e salvar (versão=%s)', async version => {
    await show({ ...origin, ignored: 'descartar', notificationReturnTo: { ...origin.notificationReturnTo, pathname: '/app/notificacoes', ignored: true } });
    await openEditor(version);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(origin);
    fillEditor(version);
    await cancelEditor(version);
    expect(screen.getByRole('link', { name: 'Voltar às notificações' })).toHaveAttribute('href', `/app/notificacoes${search}`);
    expect(api.patch).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
    await openEditor(version); fillEditor(version);
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    expect(await screen.findByRole('link', { name: 'Voltar às notificações' })).toHaveAttribute('href', `/app/notificacoes${search}`);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(origin);
    expect(version ? api.post : api.patch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', { name: 'Voltar às notificações' }));
    await screen.findByRole('heading', { name: 'Resultado das notificações' });
    expect(screen.getByLabelText('Filtros restaurados')).toHaveTextContent(search);
  });

  it.each([
    { notificationReturnTo: { unitId: 'other-unit', search } },
    { notificationReturnTo: { unitId, search: 'https://external.example' } },
    { notificationReturnTo: { unitId, search: `?unitId=${unitId}&read=invalid` } },
    { notificationReturnTo: { unitId, search, pathname: '/app/consulta' } },
  ])('descarta origem incompatível no detalhe e ao cancelar: %j', async invalid => {
    await show(invalid);
    expect(screen.queryByRole('link', { name: 'Voltar às notificações' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    await openEditor(false); await cancelEditor(false);
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent('notificationReturnTo');
  });

  it('prioriza notificações válidas e propaga somente essa origem', async () => {
    await show({ ...origin, expirationReturnTo: { unitId, search: `?unitId=${unitId}&view=upcoming&days=30` }, fromConsulta: true, fromSearch: `?tab=documents&unitId=${unitId}`, fromUnitId: unitId });
    expect(screen.getByRole('link', { name: 'Voltar às notificações' })).toHaveAttribute('href', `/app/notificacoes${search}`);
    expect(screen.queryByRole('link', { name: 'Voltar aos vencimentos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voltar à consulta' })).not.toBeInTheDocument();
    await openEditor(false);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(origin);
  });

  it('omite a origem de notificações quando o perfil não permite consultá-las', async () => {
    permissions = permissions.filter(permission => permission !== 'notifications.read');
    await show();
    expect(screen.queryByRole('link', { name: 'Voltar às notificações' })).not.toBeInTheDocument();
    await openEditor(false);
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent('notificationReturnTo');
  });

  it.each([false, true])('revalida a permissão ao cancelar o editor (versão=%s)', async version => {
    const view = await show(); await openEditor(version); fillEditor(version);
    permissions = permissions.filter(permission => permission !== 'notifications.read'); view.update();
    await cancelEditor(version);
    expect(screen.queryByRole('link', { name: 'Voltar às notificações' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
  });

  it.each([false, true])('revalida a permissão antes de concluir um envio pendente (versão=%s)', async version => {
    let complete!: (value: unknown) => void;
    if (version) vi.mocked(api.post).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    else vi.mocked(api.patch).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = await show(); await openEditor(version); fillEditor(version);
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    await waitFor(() => expect(version ? api.post : api.patch).toHaveBeenCalledOnce());
    permissions = permissions.filter(permission => permission !== 'notifications.read'); view.update();
    await act(async () => complete(version ? { id: 'version-new' } : { ...current, revision: 2 }));
    expect(await screen.findByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    expect(screen.queryByRole('link', { name: 'Voltar às notificações' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent('notificationReturnTo');
  });

  it.each([false, true])('não carrega a origem de outra unidade após mudança de contexto no editor (versão=%s)', async version => {
    const view = await show(); await openEditor(version);
    currentUnit = '40000000-0000-4000-8000-000000000001'; view.update();
    await screen.findByLabelText('Título *');
    await cancelEditor(version, false);
    expect(screen.queryByRole('heading', { name: current.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voltar às notificações' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent('notificationReturnTo');
  });

  it('mantém o retorno validado quando o documento não pode ser carregado', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Documento indisponível'));
    await show(origin, false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Documento indisponível');
    expect(screen.getByRole('link', { name: 'Voltar às notificações' })).toHaveAttribute('href', `/app/notificacoes${search}`);
  });
});
