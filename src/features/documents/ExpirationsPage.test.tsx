import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { api, ApiError } from '../../shared/api/client';
import type { DocumentDto, PageDto } from '../../shared/contracts';
import { ExpirationsPage } from './ExpirationsPage';
import { expiryQuery } from './expiry';
import { AppQueryNavigationProvider } from '../../shared/lib/app-query-params';

const state = vi.hoisted(() => ({ today: '2026-10-17', unitId: 'unit-a' as string | undefined, sessionKey: 'expiry-test', allowed: true }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ unitId: state.unitId, sessionKey: state.sessionKey, can: (permission: string) => state.allowed && permission === 'documents.read' }) }));
vi.mock('../../shared/lib/format', async original => ({ ...await original<typeof import('../../shared/lib/format')>(), dateOnly: vi.fn(() => state.today) }));
function document(unitId = 'unit-a'): DocumentDto { return { id: 'doc-1', code: 'DOC-001', title: 'Documento a renovar', companyId: 'company-a', unitId, typeId: 'type-a', ownerId: 'owner-a', accessClass: 'INTERNAL', issueDate: '2026-01-01', validUntil: state.today, status: 'ACTIVE', activeVersionIds: [], availableActions: [], revision: 1, workerIds: [], responsibleIds: [], keywords: [] }; }
function response(options?: Parameters<typeof api.get>[1], rows?: DocumentDto[]): PageDto<DocumentDto> {
  const query = options?.query ?? {}, page = Number(query.page ?? 1);
  const items = rows ?? [{ ...document(String(query.unitId || 'unit-a')), status: query.status === 'EXPIRED' ? 'EXPIRED' as const : 'ACTIVE' as const }];
  return { items: items.slice((page - 1) * 10, page * 10), total: items.length, page, pageSize: 10 };
}
function Harness() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate(-1)}>Voltar no teste</button><output aria-label="Endereço atual">{location.search}</output><ExpirationsPage /></>; }
function show(query = '?unitId=unit-a', client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/vencimentos${query}`]}><Harness /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, view, rerender: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.today = '2026-10-17'; state.unitId = 'unit-a'; state.sessionKey = 'expiry-test'; state.allowed = true;
  vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
});

describe('consulta validada de vencimentos', () => {
  it('preserva a pesquisa no Link aberto assim que a URL da consulta é atualizada', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    for (const query of ['?unitId=unit-a&days=90', '?unitId=unit-a&days=90&q=DOC-001']) {
      client.setQueryData(['documents', 'expirations', state.sessionKey, state.unitId, 1, expiryQuery(new URLSearchParams(query), state.today)], response());
    }
    function ReturnContext() {
      return <output aria-label="Contexto de retorno">{JSON.stringify(useLocation().state)}</output>;
    }
    const router = createMemoryRouter([{ path: '*', element: <AppQueryNavigationProvider><Routes>
      <Route path="/app/vencimentos" element={<ExpirationsPage />} />
      <Route path="/app/documentos/:id" element={<ReturnContext />} />
    </Routes></AppQueryNavigationProvider> }], { initialEntries: ['/app/vencimentos?unitId=unit-a&days=90'] });
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    let opened = false;
    const unsubscribe = router.subscribe(next => {
      if (opened || next.location.pathname !== '/app/vencimentos' || new URLSearchParams(next.location.search).get('q') !== 'DOC-001') return;
      opened = true;
      screen.getByRole('link', { name: 'Documento a renovar' }).click();
    });
    try {
      await screen.findByRole('link', { name: 'Documento a renovar' });
      fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'DOC-001' } });
      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
      const returned = await screen.findByLabelText('Contexto de retorno');
      expect(JSON.parse(returned.textContent!)).toEqual({ expirationReturnTo: { unitId: 'unit-a', search: '?unitId=unit-a&days=90&q=DOC-001' } });
    } finally { unsubscribe(); view.unmount(); router.dispose(); client.clear(); }
  });
  it('consulta o período escolhido, preserva critérios no repositório e sincroniza a busca no histórico', async () => {
    show('?unitId=unit-a&days=7'); await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'ACTIVE', validUntilFrom: '2026-10-17', validUntilTo: '2026-10-24' } }));
    expect(screen.getByText('Vence hoje')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Antecedência'), { target: { value: '90' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ validUntilTo: '2027-01-15' }) })));
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: ' DOC-001 ' } }); fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ q: 'DOC-001' }) })));
    const link = new URL(screen.getByRole('link', { name: /Abrir no repositório/ }).getAttribute('href')!, 'http://localhost');
    expect(link.searchParams.get('status')).toBe('ACTIVE'); expect(link.searchParams.get('q')).toBe('DOC-001'); expect(link.searchParams.get('unitId')).toBe('unit-a'); expect(link.searchParams.get('validUntilTo')).toBe('2027-01-15');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no teste' })); await waitFor(() => expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue(''));
  });
  it('consulta vencidos pelo estado e remove apenas o período de validade', async () => {
    show('?unitId=unit-a&days=90&q=DOC-001'); await screen.findByRole('link', { name: 'Documento a renovar' });
    fireEvent.change(screen.getByLabelText('Consultar'), { target: { value: 'expired' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'EXPIRED', q: 'DOC-001' } })));
    expect(screen.queryByLabelText('Antecedência')).not.toBeInTheDocument();
  });
  it.each(['view=other', 'view=', 'days=365', 'days=', 'days=7&days=90', 'view=expired&view=upcoming', 'q=um&q=dois', 'unitId=unit-b', 'page=1&page=2', 'status=ACTIVE', 'typeId=type-a', `q=${'a'.repeat(201)}`])('bloqueia critérios inválidos ou repetidos sem aplicar substitutos: %s', async query => {
    show(`?unitId=unit-a&${query}`); expect(api.get).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /Abrir no repositório/ })).not.toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' })); await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(api.get).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?unitId=unit-a');
  });
  it.each(['NaN', 'Infinity', '-1', '0', '1.5', '9007199254740992', ''])('exige recuperação explícita de page=%s, mantendo os demais filtros', async page => {
    show(`?unitId=unit-a&days=7&q=DOC-001&page=${page}`); expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('link', { name: /Abrir no repositório/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à primeira página' })); await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-a', page: 1, q: 'DOC-001', validUntilTo: '2026-10-24' }) }));
  });
  it('não faz consulta antes da seleção de unidade ou sem leitura documental', () => {
    state.unitId = undefined; const first = show(); expect(screen.getByText('Selecione uma unidade para consultar os vencimentos.')).toBeVisible(); expect(api.get).not.toHaveBeenCalled(); first.view.unmount();
    state.unitId = 'unit-a'; state.allowed = false; show('?unitId=unit-b&page=9'); expect(screen.getByText('Seu perfil não possui acesso à consulta documental.')).toBeVisible(); expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-b&page=9');
  });
  it('inclui unidade ausente e descarta a página de unidade anterior antes de consultar', async () => {
    const first = show('?days=7'); await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(api.get).toHaveBeenCalledTimes(1); expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-a', page: 1 }) })); first.view.unmount(); vi.mocked(api.get).mockClear();
    show('?unitId=unidade-anterior&page=4&days=7'); await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(vi.mocked(api.get).mock.calls.every(([, options]) => options?.query?.page === 1 && options.query.unitId === 'unit-a')).toBe(true);
  });
  it('conserva texto não aplicado durante alteração rápida de filtros, atualização e mudança do dia civil', async () => {
    show(); await screen.findByRole('link', { name: 'Documento a renovar' });
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Texto ainda não aplicado' } });
    act(() => { fireEvent.change(screen.getByLabelText('Antecedência'), { target: { value: '90' } }); fireEvent.change(screen.getByLabelText('Consultar'), { target: { value: 'expired' } }); });
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('days=90&view=expired'));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Texto ainda não aplicado');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled()); expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Texto ainda não aplicado');
    state.today = '2026-10-18'; fireEvent.focus(window); expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Texto ainda não aplicado');
    fireEvent.change(screen.getByLabelText('Consultar'), { target: { value: 'upcoming' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ validUntilFrom: '2026-10-18' }) })));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Texto ainda não aplicado');
  });
  it('atualiza a janela na virada do dia pelo intervalo sem perder a busca local', async () => {
    const timer = vi.spyOn(window, 'setInterval'); const view = show(); await screen.findByRole('link', { name: 'Documento a renovar' });
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Rascunho noturno' } }); state.today = '2026-10-18';
    const callback = timer.mock.calls.find(([, delay]) => delay === 60000)?.[0]; expect(typeof callback).toBe('function');
    act(() => { if (typeof callback === 'function') callback(); });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ validUntilFrom: '2026-10-18' }) })));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Rascunho noturno'); view.view.unmount(); timer.mockRestore();
  });
  it('respeita a página do servidor, mantém filtros e oferece primeira página vazia explicitamente', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ ...document(), id: `doc-${index}`, title: `Documento ${index}` }));
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(options, rows) as never); show('?unitId=unit-a&days=7&q=Documento');
    await screen.findByRole('link', { name: 'Documento 0' }); fireEvent.click(screen.getByRole('button', { name: 'Próxima' })); await screen.findByRole('link', { name: 'Documento 11' });
    expect(screen.getAllByRole('row')).toHaveLength(3); expect(screen.queryByRole('link', { name: 'Documento 0' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ page: 2, pageSize: 10, q: 'Documento' }) }));
  });
  it('oferece retorno explícito quando uma página válida já não tem resultados', async () => {
    show('?unitId=unit-a&days=7&q=DOC-001&page=9');
    await screen.findByRole('heading', { name: 'Esta página não possui documentos' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=9');
    fireEvent.click(screen.getByRole('button', { name: 'Primeira página' }));
    await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: 'DOC-001', validUntilTo: '2026-10-24' }) }));
  });
  it.each([
    ['array legado', (value: PageDto<DocumentDto>) => value.items], ['página diferente', (value: PageDto<DocumentDto>) => ({ ...value, page: 2 })],
    ['tamanho diferente', (value: PageDto<DocumentDto>) => ({ ...value, pageSize: 100 })], ['total inválido', (value: PageDto<DocumentDto>) => ({ ...value, total: -1 })],
    ['unidade diferente', (value: PageDto<DocumentDto>) => ({ ...value, items: [{ ...document(), unitId: 'unit-b' }] })],
    ['título inválido', (value: PageDto<DocumentDto>) => ({ ...value, items: [{ ...document(), title: {} }] })],
    ['situação incompatível', (value: PageDto<DocumentDto>) => ({ ...value, items: [{ ...document(), status: 'DRAFT' }] })],
    ['vencimento inválido', (value: PageDto<DocumentDto>) => ({ ...value, items: [{ ...document(), validUntil: '2026-02-30' }] })],
  ])('recusa resposta malformada antes de exibir nomes: %s', async (_label, change) => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => change(response(options)) as never); show();
    expect(await screen.findByRole('alert')).toHaveTextContent('página inválida'); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Documento a renovar' })).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])('não recupera nomes de cache após negativa%s ao mudar critérios, voltar ou remontar', async status => {
    const { client, view } = show('?unitId=unit-a&days=7'); await screen.findByRole('link', { name: 'Documento a renovar' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, { code: 'UNAVAILABLE', message: 'Título restrito de outra unidade.', requestId: 'expiry-denial' }));
    fireEvent.change(screen.getByLabelText('Antecedência'), { target: { value: '90' } }); await screen.findByRole('alert'); const calls = vi.mocked(api.get).mock.calls.length;
    expect(screen.queryByText('Título restrito de outra unidade.')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Abrir no repositório/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no teste' })); await waitFor(() => expect(screen.getByLabelText('Antecedência')).toHaveValue('7'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    view.unmount(); show('?unitId=unit-a&days=7', client); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never); fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('link', { name: 'Documento a renovar' }); expect(api.get).toHaveBeenCalledTimes(calls + 1);
  });
  it('preserva a busca não enviada ao retirar cache em erro de refetch e tentar novamente', async () => {
    const { client } = show(); await screen.findByRole('link', { name: 'Documento a renovar' });
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Busca local' } }); vi.mocked(api.get).mockRejectedValue(new Error('Falha de rede'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['documents', 'expirations', 'expiry-test', 'unit-a'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never); fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByRole('link', { name: 'Documento a renovar' });
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Busca local');
  });
  it('cancela contexto antigo e separa unidade, sessão e perda de permissão', async () => {
    let finish!: () => void, oldSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const value = response(options); value.items = value.items.map(item => ({ ...item, title: `Documento ${state.sessionKey} ${item.unitId}` }));
      if (options?.query?.unitId === 'unit-a') return new Promise(resolve => { oldSignal = options?.signal; finish = () => resolve(value as never); });
      return value as never;
    });
    const { rerender } = show('?unitId=unit-a&days=7'); await waitFor(() => expect(oldSignal).toBeDefined()); state.unitId = 'unit-b'; rerender();
    await screen.findByRole('link', { name: 'Documento expiry-test unit-b' }); expect(oldSignal?.aborted).toBe(true);
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Texto do contexto anterior' } });
    await act(async () => { finish(); }); expect(screen.queryByRole('link', { name: 'Documento expiry-test unit-a' })).not.toBeInTheDocument();
    state.sessionKey = 'session-new'; rerender(); await screen.findByRole('link', { name: 'Documento session-new unit-b' }); expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('');
    state.allowed = false; rerender(); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
