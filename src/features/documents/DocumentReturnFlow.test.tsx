import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const sessionKey = 'document-return-test';
const contexts = [
  { source: 'central', key: 'documentListReturnTo', resource: 'documents', pathname: '/app/documentos', search: `?q=Procedimento%20revisado&status=ACTIVE&page=2&unitId=${unitId}`, backLabel: 'Voltar à central' },
  { source: 'painel', key: 'documentDashboardReturnTo', resource: 'dashboard', pathname: '/app/painel-documental', search: '?from=2026-10-01&to=2026-10-31', backLabel: 'Voltar ao painel documental' },
] as const;
type Context = typeof contexts[number];
const origin = (context: Context) => ({ [context.key]: { unitId, search: context.search } });
const queryKey = (context: Context, session = sessionKey, unit = unitId) => [context.resource, session, unit, context.search];
const baseDocument: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Procedimento original', companyId: unitId, unitId, typeId, ownerId, accessClass: 'INTERNAL', issueDate: '2026-10-05', validUntil: '2026-12-31', status: 'ACTIVE', activeVersionIds: [], availableActions: ['EDIT_METADATA', 'CREATE_VERSION'], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };
const type: DocumentTypeDto = { id: typeId, code: 'DOC', name: 'Procedimento', category: 'SST', requiredFields: [], allowedAccessClasses: ['INTERNAL'], defaultAccessClass: 'INTERNAL', allowedMimeTypes: ['application/pdf'], maxFileSizeBytes: 1024 * 1024, renewalPolicy: { enabled: false, noticeDays: 30 }, retentionPolicyReference: { code: 'REF', version: '1', source: 'test' }, workflow: { reviewRequired: false, signatureRequired: false, allowSelfApproval: false, allowMultipleActiveVersions: false }, revision: 1 };
const organization: OrganizationDto = { companies: [{ id: unitId, name: 'Empresa', status: 'ACTIVE', revision: 1 }], units: [{ id: unitId, companyId: unitId, name: 'Unidade', status: 'ACTIVE', revision: 1 }], sectors: [], establishments: [], jobs: [], jobFunctions: [], workCenters: [] };
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 10, total: items.length });
let current: DocumentDto;
let currentUnit: string;
let permissions: string[];
let resultRead: ReturnType<typeof vi.fn<() => Promise<string>>>;

beforeEach(() => {
  vi.clearAllMocks(); current = structuredClone(baseDocument); currentUnit = unitId;
  permissions = ['documents.read', 'documents.write', 'dashboard.read', 'notifications.read'];
  resultRead = vi.fn(async () => current.title);
  vi.mocked(useSession).mockImplementation(() => ({ me: null, unitId: currentUnit, sessionKey, can: permission => permissions.includes(permission), status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn(), reloadIdentity: vi.fn() }));
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

function LocationState() { const location = useLocation(); return <output aria-label="Origem recebida">{JSON.stringify(location.state)}</output>; }
function Result({ context }: { context: Context }) {
  const location = useLocation();
  const result = useQuery({ queryKey: queryKey(context), queryFn: resultRead, staleTime: Infinity });
  return <><h1>Resultado da {context.source}</h1><output aria-label="Filtros restaurados">{location.search}</output><p>{result.data}</p></>;
}
async function show(state: unknown, waitForDocument = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  await Promise.all(contexts.map(context => client.fetchQuery({ queryKey: queryKey(context), queryFn: resultRead, staleTime: Infinity })));
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: `/app/documentos/${current.id}`, state }]}><LocationState /><Routes>
    <Route path="/app/documentos/:id" element={<DocumentDetailPage />} />
    <Route path="/app/documentos/:id/editar" element={<DocumentFormPage />} />
    <Route path="/app/documentos/:id/versoes/nova" element={<VersionFormPage />} />
    <Route path="/app/trabalhadores/:id" element={<><h1>Trabalhador original</h1></>} />
    {contexts.map(context => <Route key={context.key} path={context.pathname} element={<Result context={context} />} />)}
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  if (waitForDocument) await screen.findByRole('heading', { name: current.title });
  return { client, update: () => view.rerender(tree()) };
}
async function openEditor(version: boolean) {
  fireEvent.click(screen.getByRole('link', { name: version ? 'Nova versão' : 'Editar metadados' }));
  await screen.findByLabelText('Título *');
  await waitFor(() => expect(screen.getByLabelText('Proprietário *')).toHaveValue(ownerId));
  await waitFor(() => expect(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' })).toBeEnabled());
}
function fillEditor(version: boolean) {
  if (version) {
    fireEvent.change(screen.getByLabelText('Arquivo da versão *'), { target: { files: [new File(['%PDF-test'], 'teste.pdf', { type: 'application/pdf' })] } });
    fireEvent.change(screen.getByLabelText('Justificativa da versão *'), { target: { value: 'Versão revisada' } });
  } else fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Procedimento revisado' } });
}
async function cancelEditor(version: boolean, recordAvailable = true) {
  fireEvent.click(screen.getByRole('link', { name: version ? 'Voltar ao documento' : 'Voltar' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Descartar e sair' }));
  if (recordAvailable) await screen.findByRole('heading', { name: current.title });
  else await screen.findByRole('button', { name: 'Tentar novamente' });
}

describe.each(contexts)('retorno documental à $source', context => {
  it.each([false, true])('restaura a consulta depois de descartar e salvar, renovando somente caches do contexto (versão=%s)', async version => {
    const expectedOrigin = origin(context);
    const { client } = await show({ ...expectedOrigin, ignored: 'não propagar', [context.key]: { ...expectedOrigin[context.key], pathname: context.pathname, ignored: true } });
    contexts.forEach(other => {
      client.setQueryData(queryKey(other, 'another-session'), 'Outra sessão');
      client.setQueryData(queryKey(other, sessionKey, 'other-unit'), 'Outra unidade');
    });
    await openEditor(version);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(expectedOrigin);
    fillEditor(version); await cancelEditor(version);
    expect(screen.getByRole('link', { name: context.backLabel })).toHaveAttribute('href', `${context.pathname}${context.search}`);
    expect(api.patch).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
    await openEditor(version); fillEditor(version);
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    expect(await screen.findByRole('link', { name: context.backLabel })).toHaveAttribute('href', `${context.pathname}${context.search}`);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(expectedOrigin);
    expect(version ? api.post : api.patch).toHaveBeenCalledOnce();
    contexts.forEach(other => {
      expect(client.getQueryState(queryKey(other))?.isInvalidated).toBe(true);
      expect(client.getQueryState(queryKey(other, 'another-session'))?.isInvalidated).toBe(false);
      expect(client.getQueryState(queryKey(other, sessionKey, 'other-unit'))?.isInvalidated).toBe(false);
    });
    fireEvent.click(screen.getByRole('link', { name: context.backLabel }));
    await screen.findByRole('heading', { name: `Resultado da ${context.source}` });
    expect(await screen.findByText(current.title)).toBeVisible();
    expect(screen.getByLabelText('Filtros restaurados')).toHaveTextContent(context.search);
    expect(resultRead).toHaveBeenCalledTimes(3);
  });

  it.each([false, true].flatMap(version => ['unit', 'external'].map(fault => ({ version, fault }))))('descarta retorno incompatível antes e depois do editor: %j', async ({ version, fault }) => {
    await show({ [context.key]: fault === 'unit' ? { unitId: 'other-unit', search: context.search } : { unitId, search: 'https://external.example' } });
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    await openEditor(version);
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent(context.key);
    fillEditor(version); await cancelEditor(version);
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent(context.key);
  });

  it.each([false, true])('abandona a origem da unidade anterior ao cancelar (versão=%s)', async version => {
    const view = await show(origin(context)); await openEditor(version);
    currentUnit = '40000000-0000-4000-8000-000000000001'; view.update();
    await screen.findByLabelText('Título *'); fillEditor(version); await cancelEditor(version, false);
    expect(screen.queryByRole('heading', { name: current.title })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent(context.key);
  });

  it('mantém o retorno seguro se o documento não pode ser carregado', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Documento indisponível'));
    await show(origin(context), false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Documento indisponível');
    expect(screen.getByRole('link', { name: context.backLabel })).toHaveAttribute('href', `${context.pathname}${context.search}`);
  });
});

describe('precedência e permissão dos retornos documentais', () => {
  it.each([false, true])('volta ao trabalhador após descartar e salvar, renovando a consulta vinculada (versão=%s)', async version => {
    permissions.push('workers.read');
    const workerOrigin = { workerDocumentReturnTo: { workerId: 'worker-original', unitId, sessionKey, documentPage: 2, workerListReturnTo: { unitId, sessionKey, search: `?unitId=${unitId}&q=Camila&page=2`, draftSearch: 'Ainda não enviada', advancedOpen: true } } };
    const view = await show(workerOrigin);
    const key = ['worker-documents', sessionKey, unitId, 'worker-original', 2];
    const otherSession = ['worker-documents', 'other-session', unitId, 'worker-original', 2];
    const otherUnit = ['worker-documents', sessionKey, 'other-unit', 'worker-original', 2];
    [key, otherSession, otherUnit].forEach(value => view.client.setQueryData(value, 'Em cache'));
    const destination = '/app/trabalhadores/worker-original#documentos';
    expect(screen.getByRole('link', { name: 'Voltar ao trabalhador' })).toHaveAttribute('href', destination);
    await openEditor(version); fillEditor(version); await cancelEditor(version);
    expect(screen.getByRole('link', { name: 'Voltar ao trabalhador' })).toHaveAttribute('href', destination);
    await openEditor(version); fillEditor(version);
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    await screen.findByRole('heading', { name: version ? 'Procedimento com nova versão' : 'Procedimento revisado' });
    await waitFor(() => expect(view.client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(view.client.getQueryState(otherSession)?.isInvalidated).toBe(false);
    expect(view.client.getQueryState(otherUnit)?.isInvalidated).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Voltar ao trabalhador' }));
    await screen.findByRole('heading', { name: 'Trabalhador original' });
    const state = JSON.parse(screen.getByLabelText('Origem recebida').textContent!);
    expect(state.workerDocumentPageReturnTo.page).toBe(2);
    expect(state.workerListReturnTo).toEqual(workerOrigin.workerDocumentReturnTo.workerListReturnTo);
  });
  const priorities = [
    { origin: { notificationReturnTo: { unitId, search: `?read=false&page=2&unitId=${unitId}` } }, label: 'Voltar às notificações' },
    { origin: { expirationReturnTo: { unitId, search: `?unitId=${unitId}&view=upcoming&days=30` } }, label: 'Voltar aos vencimentos' },
    { origin: { fromConsulta: true, fromSearch: `?tab=documents&unitId=${unitId}`, fromUnitId: unitId }, label: 'Voltar à consulta' },
  ];
  it.each(priorities.flatMap(priority => [false, true].map(version => ({ ...priority, version }))))('preserva precedência de $label ao salvar (versão=$version)', async ({ origin: higher, label, version }) => {
    await show({ ...higher, ...origin(contexts[0]), ...origin(contexts[1]) });
    expect(screen.getByRole('link', { name: label })).toBeVisible();
    await openEditor(version);
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(higher);
    fillEditor(version); fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    expect(await screen.findByRole('link', { name: label })).toBeVisible();
    expect(JSON.parse(screen.getByLabelText('Origem recebida').textContent!)).toEqual(higher);
  });

  it.each([false, true])('revalida o acesso ao painel antes de concluir um envio pendente (versão=%s)', async version => {
    let complete!: (value: unknown) => void;
    if (version) vi.mocked(api.post).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    else vi.mocked(api.patch).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = await show(origin(contexts[1])); await openEditor(version); fillEditor(version);
    fireEvent.click(screen.getByRole('button', { name: version ? 'Enviar nova versão' : 'Salvar alterações' }));
    await waitFor(() => expect(version ? api.post : api.patch).toHaveBeenCalledOnce());
    permissions = permissions.filter(permission => permission !== 'dashboard.read'); view.update();
    await act(async () => complete(version ? { id: 'version-new' } : { ...current, revision: 2 }));
    expect(await screen.findByRole('link', { name: 'Voltar à central' })).toHaveAttribute('href', '/app/documentos');
    expect(screen.queryByRole('link', { name: 'Voltar ao painel documental' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Origem recebida')).not.toHaveTextContent('documentDashboardReturnTo');
  });
});
