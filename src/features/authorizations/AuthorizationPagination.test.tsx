import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { PageDto } from '../../shared/contracts';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import { WorkAuthorizationsPage } from './WorkAuthorizationsPage';
import { AuthorizationDetailPage } from './AuthorizationDetailPage';
import { AuthorizationFormPage } from './AuthorizationFormPage';
import { AuthorizationPrintPage } from './AuthorizationPrintPage';
import { AT_SOURCE, createAuthorizationClosingChecks, createAuthorizationPreparation } from './model';

const state = vi.hoisted(() => ({ sessionKey: 'session-a', unitId: 'unit-a', permissions: ['at.read', 'at.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, me: { user: { id: 'operator', displayName: 'Operador de teste' }, roles: ['TECHNICIAN'] }, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn() } }));
let records: WorkAuthorizationDto[];
function example(index: number, unitId = 'unit-a'): WorkAuthorizationDto {
  const appointment: AppointmentDto = { id: `appointment-${unitId}-${index}`, code: `AGE-${index}`, companyId: 'company', unitId, teamId: 'team', teamName: `Equipe ${index === 31 ? 'alvo' : 'de teste'}`, serviceTypeId: 'service', serviceLabel: 'Manutenção', location: 'Área comum', startsAt: '2099-10-10T12:00:00Z', endsAt: '2099-10-10T20:00:00Z', responsibleId: 'operator', responsibleName: 'Operador de teste', participants: [], status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
  return { id: `at-${unitId}-${index}`, code: `${unitId === 'unit-a' ? 'AT' : 'AT-B'}-${String(index).padStart(3, '0')}`, companyId: 'company', unitId, revision: 1, status: 'DRAFT', sourceId: AT_SOURCE.sourceId, sourceRevision: AT_SOURCE.sourceRevision, sourceSha256: AT_SOURCE.sourceSha256, appointment, preparation: createAuthorizationPreparation(appointment), sciences: [], eligibility: { appointmentId: appointment.id, unitId, checkedAt: '2026-10-10T12:00:00Z', eligible: true, requirementVersion: 'MATRIZ-1', participants: [] }, releases: [], closingChecks: createAuthorizationClosingChecks(), history: [], availableActions: ['EDIT'], createdAt: '2026-10-10T12:00:00Z', createdByName: 'Operador de teste' };
}
function pageFor(query: Record<string, unknown> = {}): PageDto<WorkAuthorizationDto> {
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 10), q = String(query.q || '').toLocaleLowerCase('pt-BR');
  const filtered = records.filter(value => value.unitId === query.unitId && (!query.status || value.status === query.status) && `${value.code} ${value.appointment.code} ${value.appointment.teamName} ${value.appointment.serviceLabel} ${value.appointment.location}`.toLocaleLowerCase('pt-BR').includes(q));
  return { items: structuredClone(filtered.slice((page - 1) * pageSize, page * pageSize)), total: filtered.length, page, pageSize };
}
function LocationProbe() { const location = useLocation(); return <output aria-label="Endereço atual">{location.pathname}{location.search}</output>; }
function show(route = '/app/ats?unitId=unit-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><LocationProbe /><Routes>
    <Route path="/app/ats" element={<WorkAuthorizationsPage />} /><Route path="/app/ats/:id" element={<AuthorizationDetailPage />} />
    <Route path="/app/ats/:id/editar" element={<AuthorizationFormPage />} /><Route path="/app/ats/:id/imprimir" element={<AuthorizationPrintPage />} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, ...view, update: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.sessionKey = 'session-a'; state.unitId = 'unit-a'; state.permissions = ['at.read', 'at.write'];
  records = [...Array.from({ length: 31 }, (_, index) => example(index + 1)), example(1, 'unit-b')];
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    if (path === '/authorization-options') return { appointments: [] } as never;
    if (path === '/work-authorizations') return pageFor(options?.query) as never;
    const value = records.find(record => path === `/work-authorizations/${record.id}` && record.unitId === options?.query?.unitId);
    if (!value) throw new ApiError(404, { code: 'NOT_FOUND', message: 'Indisponível', requestId: '' });
    return structuredClone(value) as never;
  });
  vi.mocked(api.patch).mockImplementation(async (path, input) => {
    const value = records.find(record => path === `/work-authorizations/${record.id}`)!;
    value.preparation = input as WorkAuthorizationDto['preparation']; value.revision++;
    return structuredClone(value) as never;
  });
});

describe('paginação e filtros das ATs', () => {
  it('aguarda a unidade canônica antes de aceitar pesquisa e estado consecutivos', async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let canonicalReady = false, releaseCanonical!: () => void;
    const canonical = new Promise<null>(resolve => { releaseCanonical = () => { canonicalReady = true; resolve(null); }; });
    let releaseFiltered!: () => void;
    const filtered = new Promise<void>(resolve => { releaseFiltered = resolve; });
    const get = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === '/work-authorizations' && options?.query?.q === 'alvo' && options.query.status === 'DRAFT') await filtered;
      return get(path, options);
    });
    const router = createMemoryRouter([{
      path: '/app/ats',
      loader: ({ request }) => new URL(request.url).searchParams.has('unitId') && !canonicalReady ? canonical : null,
      HydrateFallback: () => <span>Preparando consulta</span>,
      element: <><LocationProbe /><WorkAuthorizationsPage /></>,
    }], { initialEntries: ['/app/ats'] });
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    try {
      const search = await screen.findByLabelText('Pesquisar AT'), status = screen.getByLabelText('Estado da AT');
      await waitFor(() => expect(router.state.navigation.location?.search).toBe('?unitId=unit-a'));
      expect(search).toBeDisabled(); expect(status).toBeDisabled();
      expect(api.get).not.toHaveBeenCalled();
      await act(async () => releaseCanonical());
      await waitFor(() => expect(search).toBeEnabled());
      fireEvent.change(search, { target: { value: 'alvo' } });
      await user.selectOptions(status, 'DRAFT');
      await waitFor(() => {
        const params = new URLSearchParams(router.state.location.search);
        expect(params.get('unitId')).toBe('unit-a'); expect(params.get('q')).toBe('alvo'); expect(params.get('status')).toBe('DRAFT');
        expect(router.state.navigation.state).toBe('idle');
        expect(api.get).toHaveBeenLastCalledWith('/work-authorizations', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: 'alvo', status: 'DRAFT' } }));
        expect(screen.queryByRole('link', { name: 'Consultar AT-031' })).not.toBeInTheDocument();
      });
      // The q-only response may briefly contain the same AT. Wait for the final
      // query, whose pending state removes that earlier result from the document.
      await act(async () => releaseFiltered());
      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'Consultar AT-031' })).toBeInTheDocument();
        expect(screen.getByLabelText('Pesquisar AT')).toHaveValue('alvo');
        expect(screen.getByLabelText('Estado da AT')).toHaveValue('DRAFT');
      });
    } finally { view.unmount(); router.dispose(); client.clear(); }
  });

  it('consulta páginas além dos primeiros 25 registros com total e sem buscar a lista completa', async () => {
    const user = userEvent.setup(); show('/app/ats?unitId=unit-a&page=3');
    const results = await screen.findByRole('region', { name: 'Resultados de ATs' });
    expect(within(results).getAllByRole('link')).toHaveLength(10);
    expect(within(results).getByRole('link', { name: 'Consultar AT-030' })).toBeInTheDocument();
    expect(within(results).queryByRole('link', { name: 'Consultar AT-001' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/work-authorizations', expect.objectContaining({ query: { unitId: 'unit-a', page: 3, pageSize: 10, q: '', status: '' }, signal: expect.any(AbortSignal) }));
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-031' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Resultados de ATs' })).getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Paginação de ATs' })).toHaveTextContent('31 AT(s) · página 4 de 4');
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=4');
  });

  it('aplica busca e estado no servidor e reinicia a página ao modificar critérios', async () => {
    const user = userEvent.setup(); show('/app/ats?unitId=unit-a&page=3');
    await screen.findByRole('link', { name: 'Consultar AT-021' });
    fireEvent.change(screen.getByLabelText('Pesquisar AT'), { target: { value: 'alvo' } });
    expect(await screen.findByRole('link', { name: 'Consultar AT-031' })).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=3');
    expect(api.get).toHaveBeenLastCalledWith('/work-authorizations', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: 'alvo', status: '' } }));
    await user.selectOptions(screen.getByLabelText('Estado da AT'), 'CANCELED');
    expect(await screen.findByText('Nenhuma AT encontrada')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/work-authorizations', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: 'alvo', status: 'CANCELED' } }));
  });

  it.each(['search-first', 'status-first'] as const)('mescla alterações consecutivas de pesquisa e estado antes do próximo render: %s', async order => {
    show('/app/ats?unitId=unit-a&page=3');
    await screen.findByRole('link', { name: 'Consultar AT-021' });
    const search = screen.getByLabelText('Pesquisar AT'), status = screen.getByLabelText('Estado da AT');
    const changeSearch = () => fireEvent.change(search, { target: { value: 'alvo' } });
    const changeStatus = () => fireEvent.change(status, { target: { value: 'DRAFT' } });
    act(() => {
      if (order === 'search-first') { changeSearch(); changeStatus(); }
      else { changeStatus(); changeSearch(); }
    });
    expect(await screen.findByRole('link', { name: 'Consultar AT-031' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pesquisar AT')).toHaveValue('alvo');
    expect(screen.getByLabelText('Estado da AT')).toHaveValue('DRAFT');
    const current = new URL(screen.getByLabelText('Endereço atual').textContent!, 'http://localhost');
    expect(current.searchParams.get('q')).toBe('alvo'); expect(current.searchParams.get('status')).toBe('DRAFT');
    expect(current.searchParams.get('unitId')).toBe('unit-a'); expect(current.searchParams.has('page')).toBe(false);
    expect(api.get).toHaveBeenLastCalledWith('/work-authorizations', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: 'alvo', status: 'DRAFT' } }));
  });

  it.each([
    ['status=UNKNOWN', /estado de AT inválido/, 'Limpar estado'],
    ['page=0', /página de AT inválida/, 'Voltar à primeira página'],
    ['page=Infinity', /página de AT inválida/, 'Voltar à primeira página'],
    ['q=um&q=dois', /critérios de AT repetidos/, 'Limpar filtros'],
  ])('suspende a consulta de critérios inválidos: %s', async (criteria, message, recovery) => {
    const user = userEvent.setup(); show(`/app/ats?unitId=unit-a&${criteria}`);
    expect(await screen.findByText(message)).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: recovery }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-001' })).toBeInTheDocument();
  });

  it.each([
    ['status=UNKNOWN', 'Limpar estado'],
    ['page=0', 'Voltar à primeira página'],
  ])('permite reparar %s junto de unidade repetida sem consultar antes da correção', async (criteria, recovery) => {
    const user = userEvent.setup(); show(`/app/ats?unitId=unit-a&unitId=unit-a&${criteria}`);
    await user.click(await screen.findByRole('button', { name: recovery }));
    expect(await screen.findByText(/critérios de AT repetidos/)).toBeInTheDocument();
    expect(screen.getByLabelText('Pesquisar AT')).toBeDisabled();
    expect(api.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-001' })).toBeInTheDocument();
    const params = new URLSearchParams(screen.getByLabelText('Endereço atual').textContent!.split('?')[1]);
    expect(params.getAll('unitId')).toEqual(['unit-a']);
    expect(screen.getByLabelText('Pesquisar AT')).toBeEnabled();
  });

  it('permite recuperar página vazia sem apagar a busca e o estado', async () => {
    const user = userEvent.setup(); show('/app/ats?unitId=unit-a&page=9&q=Equipe&status=DRAFT');
    await screen.findByText('Nenhuma AT encontrada');
    await user.click(screen.getByRole('button', { name: 'Primeira página' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-001' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pesquisar AT')).toHaveValue('Equipe'); expect(screen.getByLabelText('Estado da AT')).toHaveValue('DRAFT');
  });

  it('repete a página que falhou preservando todos os critérios', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta temporariamente indisponível.'));
    const user = userEvent.setup(); show('/app/ats?unitId=unit-a&page=3&q=Equipe&status=DRAFT');
    await screen.findByText('Consulta temporariamente indisponível.');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-021' })).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/work-authorizations', expect.objectContaining({ query: { unitId: 'unit-a', page: 3, pageSize: 10, q: 'Equipe', status: 'DRAFT' } }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=3&q=Equipe&status=DRAFT');
  });

  it('oculta os resultados em cache depois de acesso negado e recupera a mesma página por retry', async () => {
    const view = show('/app/ats?unitId=unit-a&page=3'); await screen.findByRole('link', { name: 'Consultar AT-021' });
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso negado', requestId: '' }));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['work-authorizations'] }); });
    expect(await screen.findByText('Seu acesso não permite esta ação na AT desta unidade.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consultar AT-021' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-021' })).toBeInTheDocument();
  });

  it('cancela a consulta anterior e reinicia a página ao trocar de unidade', async () => {
    let resolve!: (value: PageDto<WorkAuthorizationDto>) => void; let signal!: AbortSignal;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      if (options?.query?.unitId === 'unit-a') { signal = options.signal!; return new Promise(done => { resolve = done; }) as never; }
      return pageFor(options?.query) as never;
    });
    const view = show('/app/ats?unitId=unit-a&page=3&q=Equipe');
    await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
    state.unitId = 'unit-b'; view.update();
    expect(await screen.findByRole('link', { name: 'Consultar AT-B-001' })).toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(pageFor({ unitId: 'unit-a', page: 3, q: 'Equipe' })));
    expect(screen.queryByRole('link', { name: 'Consultar AT-021' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-b');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=3');
    expect(vi.mocked(api.get).mock.calls.filter(([, options]) => options?.query?.unitId === 'unit-b').every(([, options]) => options?.query?.page === 1)).toBe(true);
  });

  it.each(['unit', 'page', 'array'] as const)('recusa resposta de %s incompatível com a página solicitada', async mismatch => {
    const response = pageFor({ unitId: 'unit-a' });
    if (mismatch === 'unit') response.items[0].unitId = 'unit-b';
    if (mismatch === 'page') response.page = 2;
    vi.mocked(api.get).mockResolvedValue(mismatch === 'array' ? response.items : response);
    show(); await screen.findByText(mismatch === 'unit' ? /AT fora do contexto esperado/ : /página válida de ATs/);
    expect(screen.queryByRole('link', { name: 'Consultar AT-001' })).not.toBeInTheDocument();
  });

  it('não consulta ATs sem a permissão de leitura', () => {
    state.permissions = ['at.write']; show(); expect(screen.getByText('Acesso restrito')).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
  });

  it('preserva página, busca e estado ao consultar, imprimir, editar e salvar uma AT', async () => {
    const user = userEvent.setup(); const route = '/app/ats?unitId=unit-a&page=3&q=Equipe&status=DRAFT'; show(route);
    await user.click(await screen.findByRole('link', { name: 'Consultar AT-021' }));
    await user.click(await screen.findByRole('link', { name: 'Imprimir AT' }));
    await screen.findByRole('article', { name: 'Registro imprimível da AT' });
    await user.click(screen.getByRole('link', { name: 'Voltar à AT' }));
    await user.click(await screen.findByRole('link', { name: 'Editar rascunho' }));
    fireEvent.change(await screen.findByLabelText('Descrição da atividade'), { target: { value: 'Preparação atualizada conservando a terceira página.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    const back = await screen.findByRole('link', { name: 'Voltar às ATs' }); expect(back).toHaveAttribute('href', route);
    await user.click(back); await screen.findByRole('link', { name: 'Consultar AT-021' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(route);
    expect(screen.getByRole('navigation', { name: 'Paginação de ATs' })).toHaveTextContent('página 3 de 4');
  });
});
