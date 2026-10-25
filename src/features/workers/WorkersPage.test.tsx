import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { OrganizationDto, PageDto, WorkerDto } from '../../shared/contracts';
import { WorkersPage } from './WorkersPage';

const state = vi.hoisted(() => ({ unitId: 'unit-1' as string | undefined, sessionKey: 'workers-list', permissions: ['workers.read', 'organization.read', 'teams.read'] }));
const queryCommit = vi.hoisted(() => ({ deferred: false, pending: undefined as (() => void) | undefined }));
vi.mock('react-router', async original => {
  const router = await original<typeof import('react-router')>();
  return { ...router, useSearchParams: (...args: Parameters<typeof router.useSearchParams>) => {
    const result = router.useSearchParams(...args);
    if (!queryCommit.deferred) return result;
    const [params, setParams] = result;
    return [params, (next, options) => { queryCommit.pending = () => setParams(next, options); }] as ReturnType<typeof router.useSearchParams>;
  } };
});
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
const worker: WorkerDto = { id: 'worker-1', fullName: 'Carlos Mendes', registration: 'MAT-001', companyId: 'comp-1', unitId: 'unit-1', sectorId: 'sec-1', employmentType: 'CLT', admissionDate: '2025-01-15', status: 'ACTIVE', integrationStatus: 'INTEGRATED', integrationValidUntil: '2026-12-31', revision: 1 };
const organization: OrganizationDto = { companies: [{ id: 'comp-1', name: 'Empresa Alfa', status: 'ACTIVE', revision: 1 }, { id: 'comp-2', name: 'Empresa Beta', status: 'ACTIVE', revision: 1 }], establishments: [], units: [{ id: 'unit-1', name: 'Unidade Principal', companyId: 'comp-1', status: 'ACTIVE', revision: 1 }], sectors: [{ id: 'sec-1', name: 'Manutenção', unitId: 'unit-1', status: 'ACTIVE', revision: 1 }], jobs: [], jobFunctions: [], workCenters: [] };
const team = { id: 'team-1', name: 'Equipe Civil', unitId: 'unit-1', companyId: 'comp-1', chiefId: 'worker-1', members: [], status: 'ACTIVE', revision: 1 };
function pageResponse(options?: Parameters<typeof api.get>[1], rows = [worker]): PageDto<WorkerDto> {
  const page = Number(options?.query?.page || 1);
  return { items: rows.slice((page - 1) * 10, page * 10), total: rows.length, page, pageSize: 10 };
}
function mockGet(path: string, options?: Parameters<typeof api.get>[1]): unknown {
  if (path === '/organization') return structuredClone(organization);
  if (path === '/teams') return [structuredClone(team)];
  return pageResponse(options);
}
function Harness() { const location = useLocation(), navigate = useNavigate(); return <><output aria-label="Endereço atual">{location.search}</output><button onClick={() => navigate(-1)}>Voltar no histórico</button><WorkersPage /></>; }
function show(query = '?unitId=unit-1', client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/trabalhadores${query}`]}><Harness /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, view, rerender: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.unitId = 'unit-1'; state.sessionKey = 'workers-list'; state.permissions = ['workers.read', 'organization.read', 'teams.read'];
  queryCommit.deferred = false; queryCommit.pending = undefined;
  vi.mocked(api.get).mockImplementation(async (path, options) => mockGet(path, options) as never);
});

describe('consulta segura de trabalhadores', () => {
  it('preserva um novo rascunho digitado antes do commit da pesquisa e limpa ao remover o critério aplicado', async () => {
    queryCommit.deferred = true;
    show(); await screen.findByRole('link', { name: 'Carlos Mendes' });
    const search = screen.getByLabelText('Buscar nome ou matrícula');
    fireEvent.change(search, { target: { value: '  Carlos  ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtros de trabalhadores' }));
    expect(queryCommit.pending).toBeTypeOf('function');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('q=');
    fireEvent.change(search, { target: { value: 'Ainda não pesquisado' } });
    await act(async () => { queryCommit.pending!(); });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=Carlos');
    expect(search).toHaveValue('Ainda não pesquisado');
    expect(screen.getByText(/Busca digitada ainda não aplicada/)).toBeVisible();
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ q: 'Carlos' }) }));
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/workers').every(([, options]) => options?.query?.q !== 'Ainda não pesquisado')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Busca' }));
    await act(async () => { queryCommit.pending!(); });
    expect(search).toHaveValue('');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('q=');
  });
  it('sinaliza a busca não enviada, preserva o texto ao remover outro filtro e limpa o rascunho', async () => {
    show('?unitId=unit-1&status=ACTIVE'); await screen.findByRole('link', { name: 'Carlos Mendes' });
    const search = screen.getByLabelText('Buscar nome ou matrícula');
    fireEvent.change(search, { target: { value: 'Ainda não enviado' } });
    expect(screen.getByText(/Busca digitada ainda não aplicada/)).toHaveAttribute('id', search.getAttribute('aria-describedby'));
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Situação cadastral' }));
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('status='));
    expect(search).toHaveValue('Ainda não enviado');
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/workers').every(([, options]) => !options?.query?.q)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(search).toHaveValue(''); expect(screen.queryByText(/Busca digitada ainda não aplicada/)).not.toBeInTheDocument();
  });
  it('recolhe os filtros secundários e permite abri-los sem disparar pesquisa', async () => {
    show(); await screen.findByRole('link', { name: 'Carlos Mendes' });
    const disclosure = await screen.findByRole('button', { name: 'Empresa e equipe' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Equipe operacional' })).not.toBeInTheDocument();
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Equipe operacional' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(calls);
  });
  it('mostra filtros secundários recebidos no endereço e remove somente o critério escolhido', async () => {
    show('?unitId=unit-1&companyId=comp-1&teamId=team-1&q=Carlos&page=1');
    await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(await screen.findByRole('button', { name: /Empresa e equipe/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Equipe' }));
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('teamId='));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('companyId=comp-1');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=Carlos');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  });
  it.each(['Infinity', 'NaN', '-1', '0', '2.5', '01', '', '9007199254740992'])('bloqueia página inválida %s sem consultar outra página silenciosamente', async page => {
    show(`?unitId=unit-1&page=${page}`);
    expect(screen.getByText(/página de trabalhadores inválida/)).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à primeira página' }));
    await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ page: 1, pageSize: 10 }) }));
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  });
  it.each(['status=DESCONHECIDO', 'status=__proto__', 'integrationStatus=LIBERADO', 'q=a&q=b', 'status=ACTIVE&status=ON_LEAVE', 'companyId=comp-1&companyId=comp-2', 'teamId=team-1&teamId=team-2', 'unitId=unit-2', 'page=1&page=2', 'integrationStatus=PENDING&integrationStatus=EXPIRED', 'tab=documents', 'workerId=worker-1', 'teamId=..%2Fother', `q=${'a'.repeat(201)}`])('mantém filtros inválidos ou incompatíveis bloqueados até limpar: %s', async criteria => {
    show(`?unitId=unit-1&${criteria}`); expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeDisabled(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?unitId=unit-1');
  });
  it('canonicaliza unidade ausente antes de qualquer GET e preserva os filtros recebidos', async () => {
    show('?q=Carlos&status=ACTIVE&integrationStatus=INTEGRATED&companyId=comp-1&teamId=team-1');
    await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(vi.mocked(api.get).mock.calls.every(([, options]) => options?.query?.unitId === 'unit-1')).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: { unitId: 'unit-1', q: 'Carlos', status: 'ACTIVE', integrationStatus: 'INTEGRATED', companyId: 'comp-1', teamId: 'team-1', page: 1, pageSize: 10 } }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-1');
  });
  it('normaliza unidade única diferente e reinicia página sem apagar os filtros dos links', async () => {
    show('?unitId=old-unit&page=9&q=Carlos&status=ACTIVE&companyId=comp-1&teamId=team-1');
    await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-1', page: 1, q: 'Carlos', status: 'ACTIVE', companyId: 'comp-1', teamId: 'team-1' }) }));
    expect(vi.mocked(api.get).mock.calls.every(([, options]) => options?.query?.unitId === 'unit-1')).toBe(true);
  });
  it('não consulta trabalhadores nem auxiliares sem permissão de leitura', () => {
    state.permissions = ['workers.write', 'organization.read', 'teams.read']; show('');
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
  });
  it('não faz GET antes de selecionar unidade', () => {
    state.unitId = undefined; show(''); expect(screen.getByRole('heading', { name: 'Selecione uma unidade' })).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
  });
  it('consulta sem enumerar empresa ou equipes se o perfil não lê esses recursos, preservando IDs da URL', async () => {
    state.permissions = ['workers.read']; show('?unitId=unit-1&companyId=comp-1&teamId=team-1');
    await screen.findByRole('link', { name: 'Carlos Mendes' }); expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Empresa')).toHaveValue('comp-1'); expect(screen.getByLabelText('Equipe operacional')).toHaveValue('team-1');
    expect(screen.getByRole('option', { name: /Empresa selecionada; identificação indisponível/ })).toBeInTheDocument();
    expect(screen.queryByText('Equipe Civil')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Novo trabalhador' })).not.toBeInTheDocument();
  });
  it('exibe badges, localização autorizada, data e tabela acessível sem comandar alterações', async () => {
    show(); const link = await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(link).toHaveAttribute('href', '/app/trabalhadores/worker-1');
    const table = screen.getByRole('table', { name: 'Trabalhadores encontrados' });
    await waitFor(() => expect(table).toHaveTextContent('Empresa Alfa')); expect(table).toHaveTextContent('Unidade Principal · Manutenção');
    expect(table).toHaveTextContent('MAT-001'); expect(table).toHaveTextContent('Integrado'); expect(table).toHaveTextContent('Até 31/12/2026');
    expect(screen.getByRole('region', { name: 'Tabela de trabalhadores' })).toHaveAttribute('tabindex', '0');
    screen.getAllByRole('columnheader').forEach(header => expect(header).toHaveAttribute('scope', 'col'));
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
  });
  it('preserva todos os filtros rápidos no mesmo ciclo de atualização e os combina com a busca por envio', async () => {
    show('?unitId=unit-1&page=1'); await screen.findByRole('link', { name: 'Carlos Mendes' });
    fireEvent.click(await screen.findByRole('button', { name: 'Empresa e equipe' }));
    await screen.findByRole('option', { name: 'Equipe Civil' });
    fireEvent.change(screen.getByLabelText('Buscar nome ou matrícula'), { target: { value: 'Carlos' } });
    act(() => {
      fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'comp-1' } });
      fireEvent.change(screen.getByLabelText('Equipe operacional'), { target: { value: 'team-1' } });
      fireEvent.change(screen.getByLabelText('Integração administrativa'), { target: { value: 'PENDING' } });
      fireEvent.change(screen.getByLabelText('Situação cadastral'), { target: { value: 'ON_LEAVE' } });
    });
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('status=ON_LEAVE'));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('companyId=comp-1&teamId=team-1&integrationStatus=PENDING&status=ON_LEAVE');
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ q: 'Carlos', status: 'ON_LEAVE', companyId: 'comp-1', teamId: 'team-1', integrationStatus: 'PENDING', page: 1 }) })));
  });
  it('navega páginas de 10 sem reaplicar paginação e recupera página vazia com critérios preservados', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({ ...worker, id: `worker-${index}`, fullName: `Pessoa ${index}` }));
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/workers' ? pageResponse(options, rows) as never : mockGet(path, options) as never);
    show('?unitId=unit-1&q=Pessoa&status=ACTIVE'); await screen.findByRole('link', { name: 'Pessoa 0' });
    expect(screen.getAllByRole('row')).toHaveLength(11); fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('link', { name: 'Pessoa 11' }); expect(screen.getAllByRole('row')).toHaveLength(3); expect(screen.queryByRole('link', { name: 'Pessoa 0' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ q: 'Pessoa', status: 'ACTIVE', page: 2, pageSize: 10 }) }));
  });
  it('recupera página vazia mantendo busca e situação sem normalização silenciosa', async () => {
    show('?unitId=unit-1&page=90&q=Ana&status=ACTIVE'); fireEvent.click(await screen.findByRole('button', { name: 'Voltar à primeira página' }));
    await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: 'Ana', status: 'ACTIVE' }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=Ana&status=ACTIVE'); expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  });
  it.each([
    ['array legado', (value: PageDto<WorkerDto>) => value.items],
    ['total inválido', (value: PageDto<WorkerDto>) => ({ ...value, total: -1 })],
    ['página diferente', (value: PageDto<WorkerDto>) => ({ ...value, page: 2 })],
    ['tamanho diferente', (value: PageDto<WorkerDto>) => ({ ...value, pageSize: 100 })],
    ['IDs repetidos', (value: PageDto<WorkerDto>) => ({ ...value, items: [worker, worker], total: 2 })],
    ['unidade diferente', (value: PageDto<WorkerDto>) => ({ ...value, items: [{ ...worker, unitId: 'unit-2' }] })],
    ['nome inválido', (value: PageDto<WorkerDto>) => ({ ...value, items: [{ ...worker, fullName: {} }] })],
    ['situação inválida', (value: PageDto<WorkerDto>) => ({ ...value, items: [{ ...worker, status: 'UNKNOWN' }] })],
    ['integração inválida', (value: PageDto<WorkerDto>) => ({ ...value, items: [{ ...worker, integrationStatus: 'AUTHORIZED' }] })],
    ['revisão inválida', (value: PageDto<WorkerDto>) => ({ ...value, items: [{ ...worker, revision: 0 }] })],
  ])('oculta resposta inválida da consulta: %s', async (_label, change) => {
    state.permissions = ['workers.read']; vi.mocked(api.get).mockImplementation(async (_path, options) => change(pageResponse(options)) as never);
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('página inválida'); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Carlos Mendes' })).not.toBeInTheDocument();
  });
  it('retira dados em cache após erro e preserva preenchimento local durante retry', async () => {
    const { client } = show(); await screen.findByRole('link', { name: 'Carlos Mendes' });
    fireEvent.change(screen.getByLabelText('Buscar nome ou matrícula'), { target: { value: 'Busca ainda não aplicada' } });
    vi.mocked(api.get).mockImplementation(async (path, options) => { if (path === '/workers') throw new Error('Consulta indisponível.'); return mockGet(path, options) as never; });
    await act(async () => { await client.invalidateQueries({ queryKey: ['workers', 'workers-list', 'unit-1'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulta indisponível.'); expect(screen.queryByText('Carlos Mendes')).not.toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'Equipe Civil' })).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (path, options) => mockGet(path, options) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByRole('link', { name: 'Carlos Mendes' });
    expect(screen.getByLabelText('Buscar nome ou matrícula')).toHaveValue('Busca ainda não aplicada');
  });
  it.each([401, 403, 404])('não restaura nomes após negativa %s ao voltar ou remontar até resposta fresca', async status => {
    state.permissions = ['workers.read']; const rows = Array.from({ length: 11 }, (_, index) => ({ ...worker, id: `worker-${index}`, fullName: `Pessoa ${index}` }));
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never);
    const { client, view } = show(); await screen.findByRole('link', { name: 'Pessoa 0' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, { code: 'DENIED', message: 'Nome restrito de outro contexto.', requestId: 'denial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' })); await screen.findByRole('alert');
    expect(screen.queryByText('Nome restrito de outro contexto.')).not.toBeInTheDocument(); const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' })); await waitFor(() => expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    view.unmount(); show('?unitId=unit-1', client); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never); fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('link', { name: 'Pessoa 0' }); expect(api.get).toHaveBeenCalledTimes(calls + 1);
  });
  it.each(['/organization', '/teams'])('retira nomes auxiliares após403 em %s e conserva IDs escolhidos e dados de leitura independente', async path => {
    const { client, view } = show('?unitId=unit-1&companyId=comp-1&teamId=team-1');
    await screen.findByRole('option', { name: 'Equipe Civil' }); await screen.findByRole('option', { name: 'Empresa Alfa' });
    vi.mocked(api.get).mockImplementation(async (resource, options) => { if (resource === path) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Identificação restrita de outra unidade.', requestId: 'aux-denial' }); return mockGet(resource, options) as never; });
    const key = path === '/organization' ? 'organization' : 'teams';
    await act(async () => { await client.invalidateQueries({ queryKey: [key, 'workers-list', 'unit-1'] }); });
    await screen.findByRole('alert'); expect(screen.queryByText('Identificação restrita de outra unidade.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Carlos Mendes' })).toBeInTheDocument();
    const hidden = path === '/organization' ? 'Empresa Alfa' : 'Equipe Civil'; expect(screen.queryByRole('option', { name: hidden })).not.toBeInTheDocument();
    expect(screen.getByLabelText(path === '/organization' ? 'Empresa' : 'Equipe operacional')).toHaveValue(path === '/organization' ? 'comp-1' : 'team-1');
    view.unmount(); show('?unitId=unit-1&companyId=comp-1&teamId=team-1', client);
    expect(screen.queryByRole('option', { name: hidden })).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (resource, options) => mockGet(resource, options) as never);
    const retry = await screen.findByRole('button', { name: path === '/organization' ? 'Tentar carregar organização novamente' : 'Tentar carregar equipes novamente' });
    await waitFor(() => expect(retry).toBeEnabled()); fireEvent.click(retry);
    await screen.findByRole('option', { name: hidden });
  });
  it('cancela busca antiga e separa unidade, sessão e perda de permissão sem reexibir dados anteriores', async () => {
    state.permissions = ['workers.read']; let finish!: () => void, oldSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const unit = String(options?.query?.unitId), session = state.sessionKey;
      if (unit === 'unit-1') return new Promise(resolve => { oldSignal = options?.signal; finish = () => resolve(pageResponse(options) as never); });
      return pageResponse(options, [{ ...worker, unitId: unit, fullName: `Pessoa ${session} ${unit}` }]) as never;
    });
    const { rerender } = show('?unitId=unit-1&page=2&q=original'); await waitFor(() => expect(oldSignal).toBeDefined());
    state.unitId = 'unit-2'; rerender(); await screen.findByRole('link', { name: 'Pessoa workers-list unit-2' }); expect(oldSignal?.aborted).toBe(true);
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
    fireEvent.change(screen.getByLabelText('Buscar nome ou matrícula'), { target: { value: 'Não enviado' } });
    await act(async () => { finish(); }); expect(screen.queryByRole('link', { name: 'Carlos Mendes' })).not.toBeInTheDocument();
    state.sessionKey = 'session-new'; rerender(); await screen.findByRole('link', { name: 'Pessoa session-new unit-2' });
    expect(screen.getByLabelText('Buscar nome ou matrícula')).toHaveValue('original'); expect(screen.queryByRole('link', { name: 'Pessoa workers-list unit-2' })).not.toBeInTheDocument();
    state.permissions = []; rerender(); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
  });
});
