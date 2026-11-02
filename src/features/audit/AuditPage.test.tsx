import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { AuditLogDto, PageDto } from '../../shared/contracts';
import { AuditPage } from './AuditPage';

const state = vi.hoisted(() => ({ permitted: true, unitId: 'unit' as string | undefined, sessionKey: 'audit-session' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: state.sessionKey, unitId: state.unitId, can: (permission: string) => permission === 'audit.read' && state.permitted }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
const event: AuditLogDto = { id: 'event', actorId: 'actor', action: 'DOCUMENT_CREATED', resourceType: 'DOCUMENT', resourceId: 'document', occurredAt: '2026-10-11T12:00:00Z', requestId: 'trace', outcome: 'DEMO' };
function pageResponse(options?: Parameters<typeof api.get>[1], rows = [event]): PageDto<AuditLogDto> {
  const page = Number(options?.query?.page ?? 1);
  const { action, from, to } = options?.query ?? {};
  const matching = rows.map(row => ({ ...row,
    ...(action ? { action: String(action) } : {}),
    ...(from || to ? { occurredAt: `${String(from || to)}T12:00:00Z` } : {}),
  }));
  return { items: matching.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: matching.length };
}
function Harness() {
  const location = useLocation(), navigate = useNavigate();
  return <><output aria-label="Endereço atual">{location.search}</output><button onClick={() => navigate(-1)}>Voltar no histórico</button><AuditPage /></>;
}
function show(query = '?unitId=unit', client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/auditoria${query}`]}><Harness /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, view, rerender: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.permitted = true; state.unitId = 'unit'; state.sessionKey = 'audit-session';
  vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options) as never);
});

describe('consulta e filtros de auditoria', () => {
  it.each(['Infinity', 'NaN', '1.5', '-1', '0', '9007199254740992', '450359962737050', '', '01'])('bloqueia page=%s até recuperação explícita, sem consultar outra página silenciosamente', async value => {
    show(`?unitId=unit&page=${value}&action=DOCUMENT_CREATED`);
    expect(screen.getByRole('alert')).toHaveTextContent('página de auditoria inválida');
    expect(api.get).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Filtrar eventos' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Eventos de auditoria' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à primeira página' }));
    await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 1, action: 'DOCUMENT_CREATED' }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
  });
  it.each(['from=2026-02-30', 'to=amanha', 'from=2026-2-01', 'to=2026-13-01', 'from=2026-12-31&to=2026-01-01'])('bloqueia período inválido do endereço e permite limpar: %s', async query => {
    show(`?unitId=unit&${query}`);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0); expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Eventos de auditoria' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('region', { name: 'Eventos de auditoria' })).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?unitId=unit');
  });
  it('mantém correção pelo formulário quando a data da URL é inválida', async () => {
    show('?unitId=unit&from=2026-02-30&to=2026-03-04'); expect(api.get).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-03-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ from: '2026-03-01', to: '2026-03-04' }) }));
  });
  it('permite corrigir o intervalo invertido sem perder a data inicial', async () => {
    show('?unitId=unit&from=2026-10-11&to=2026-10-10');
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ from: '2026-10-11', to: '2026-10-12' }) }));
  });
  it('mantém filtros recebidos no endereço, incluindo código seguro da API ainda desconhecido', async () => {
    show('?unitId=unit&action=EVENTO_NOVO&from=2024-02-29&to=2026-10-11');
    await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(screen.getByLabelText('Ação')).toHaveValue('EVENTO_NOVO'); expect(screen.getByLabelText('De')).toHaveValue('2024-02-29');
    expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'EVENTO_NOVO', from: '2024-02-29', to: '2026-10-11' }) }));
  });
  it.each(['A'.repeat(101), 'AÇÃO COM ESPAÇOS', '<script>', '../TODOS', 'ACAO\nOUTRA'])('bloqueia código de ação inseguro: %s', async action => {
    show(`?unitId=unit&action=${encodeURIComponent(action)}`);
    expect(screen.getByRole('alert')).toHaveTextContent('100 caracteres seguros'); expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
  });
  it.each(['q=texto', 'tab=documents', 'status=ACTIVE', 'resourceId=document', 'action=CREATE&action=UPDATE', 'from=2026-01-01&from=2026-02-01', 'to=2026-01-01&to=2026-02-01', 'page=1&page=2', 'unitId=unit', 'unitId=other'])('não ignora critérios desconhecidos ou repetidos: %s', async query => {
    show(`?unitId=unit&${query}`);
    expect(screen.getByRole('alert')).toHaveTextContent(/filtros incompatíveis|filtros de auditoria repetidos/);
    expect(api.get).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Filtrar eventos' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 1 }) }));
  });
  it('inclui a unidade ausente antes de consultar sem apagar filtros recebidos', async () => {
    show('?action=DOCUMENT_CREATED&from=2026-10-01');
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', action: 'DOCUMENT_CREATED', from: '2026-10-01' }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit');
  });
  it('substitui unidade única de outro contexto e reinicia a página antes de consultar', async () => {
    show('?unitId=other&page=4&action=DOCUMENT_CREATED');
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 1, action: 'DOCUMENT_CREATED' }) }));
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('unitId=other'); expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=4');
  });
  it('permite filtrar códigos emitidos pelos documentos e traduz os resultados', async () => {
    show(); await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(screen.getByRole('cell', { name: 'Documento cadastrado' })).toBeInTheDocument(); expect(screen.getByText('Demonstração')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ação'), { target: { value: 'DOCUMENT_VIEWED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'DOCUMENT_VIEWED', page: 1 }) })));
  });
  it('inclui os eventos de AT, PET e designações nos filtros e nos rótulos da trilha', async () => {
    const labels: Record<string, string> = { AUTHORIZATION_CREATED: 'AT criada', AUTHORIZATION_UPDATED: 'Rascunho da AT alterado', AUTHORIZATION_SCIENCE_COLLECTED: 'Ciência registrada na AT', AUTHORIZATION_AUTHORIZED: 'AT autorizada', AUTHORIZATION_REVALIDATED: 'AT revalidada', AUTHORIZATION_SUSPENDED: 'AT suspensa', AUTHORIZATION_CANCELED: 'AT cancelada', AUTHORIZATION_ADMIN_CANCELED: 'AT cancelada administrativamente', AUTHORIZATION_CLOSED: 'AT encerrada', PET_DRAFT_CREATED: 'Rascunho de PET criado', PET_DRAFT_UPDATED: 'Rascunho de PET alterado', DESIGNATION_CREATED: 'Designação criada', DESIGNATION_UPDATED: 'Designação alterada', DESIGNATION_REVOKED: 'Designação revogada' };
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, Object.keys(labels).map((action, index) => ({ ...event, id: `event-${index}`, action }))) as never);
    show(); const region = await screen.findByRole('region', { name: 'Eventos de auditoria' });
    for (const [action, label] of Object.entries(labels)) {
      expect(within(region).getByRole('cell', { name: label })).toBeVisible(); expect(screen.getByRole('option', { name: label })).toHaveValue(action);
    }
  });
  it('oferece tabela identificada e região de rolagem focalizável sem comandos de escrita', async () => {
    show(); await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(screen.getByRole('table', { name: 'Trilha de eventos de auditoria' })).toBeInTheDocument();
    const scroll = screen.getByRole('region', { name: 'Tabela dos eventos de auditoria' }); expect(scroll).toHaveAttribute('tabindex', '0');
    screen.getAllByRole('columnheader').forEach(header => expect(header).toHaveAttribute('scope', 'col'));
    expect(screen.getByText('Somente leitura')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Excluir|Editar/ })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });
  it('navega em páginas de 20 preservando ação e período sem duplicar a paginação da API', async () => {
    const rows = Array.from({ length: 43 }, (_, index) => ({ ...event, id: `event-${index}`, actorId: `actor-${index}` }));
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never);
    show('?unitId=unit&action=DOCUMENT_CREATED&from=2026-10-01&to=2026-10-31');
    await screen.findByRole('cell', { name: 'actor-0' }); expect(screen.getAllByRole('row')).toHaveLength(21);
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('cell', { name: 'actor-20' }); expect(screen.queryByRole('cell', { name: 'actor-0' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('cell', { name: 'actor-42' }); expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: { unitId: 'unit', page: 3, pageSize: 20, action: 'DOCUMENT_CREATED', from: '2026-10-01', to: '2026-10-31' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' })); await screen.findByRole('cell', { name: 'actor-20' });
  });
  it('recupera página sem resultados além do total somente depois de validar a resposta', async () => {
    show('?unitId=unit&page=99&action=DOCUMENT_CREATED');
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1'); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('action=DOCUMENT_CREATED');
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(vi.mocked(api.get).mock.calls.map(([, options]) => options?.query?.page)).toEqual([99, 1]);
  });
  it('não corrige a página a partir de metadados inválidos e preserva o endereço para uma nova tentativa', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ ...pageResponse(options), pageSize: 100 }) as never);
    show('?unitId=unit&page=99'); expect(await screen.findByRole('alert')).toHaveTextContent('página inválida');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=99'); expect(api.get).toHaveBeenCalledTimes(1);
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('cell', { name: 'Documento cadastrado' }); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
  });
  it('não expõe nem usa uma página inválida já armazenada no cache para recalcular o endereço', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['audit', 'audit-session', 'unit', 99, '', '', ''], { items: [], page: 99, pageSize: 100, total: 1 });
    show('?unitId=unit&page=99', client);
    expect(await screen.findByRole('alert')).toHaveTextContent('página inválida'); expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=99'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it.each([
    ['array legado', (value: PageDto<AuditLogDto>) => value.items],
    ['total inválido', (value: PageDto<AuditLogDto>) => ({ ...value, total: -1 })],
    ['IDs repetidos', (value: PageDto<AuditLogDto>) => ({ ...value, items: [event, event], total: 2 })],
    ['ator ausente', (value: PageDto<AuditLogDto>) => ({ ...value, items: [{ ...event, actorId: undefined }] })],
    ['identificador inseguro', (value: PageDto<AuditLogDto>) => ({ ...value, items: [{ ...event, resourceId: '../other' }] })],
    ['timestamp como objeto', (value: PageDto<AuditLogDto>) => ({ ...value, items: [{ ...event, occurredAt: {} }] })],
    ['ação inválida', (value: PageDto<AuditLogDto>) => ({ ...value, items: [{ ...event, action: 'AÇÃO LIVRE' }] })],
    ['resultado excessivo', (value: PageDto<AuditLogDto>) => ({ ...value, items: [{ ...event, outcome: 'A'.repeat(101) }] })],
  ])('não apresenta DTO de auditoria incompatível: %s', async (_description, change) => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => change(pageResponse(options)) as never); show();
    expect(await screen.findByRole('alert')).toHaveTextContent('página inválida'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('oferece recuperação da conexão preservando os filtros aplicados e o preenchimento local ainda não enviado', async () => {
    const { client } = show('?unitId=unit&action=DOCUMENT_CREATED&from=2026-10-01&to=2026-10-31');
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    fireEvent.change(screen.getByLabelText('Ação'), { target: { value: 'DOCUMENT_VIEWED' } });
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-02' } });
    vi.mocked(api.get).mockRejectedValue(new Error('Consulta indisponível.'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['audit', 'audit-session', 'unit'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulta indisponível.'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(screen.getByLabelText('Ação')).toHaveValue('DOCUMENT_VIEWED'); expect(screen.getByLabelText('De')).toHaveValue('2026-10-02');
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'DOCUMENT_CREATED', from: '2026-10-01', to: '2026-10-31' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'DOCUMENT_VIEWED', from: '2026-10-02', page: 1 }) })));
  });
  it.each([401, 403, 404])('oculta texto restrito após %s e não reaproveita página em cache ao navegar ou remontar', async status => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ ...event, id: `event-${index}`, actorId: `actor-${index}` }));
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never);
    const { client, view } = show(); await screen.findByRole('cell', { name: 'actor-0' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, { code: 'UNAVAILABLE', message: 'Nome confidencial de outro escopo.', requestId: 'restricted' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' })); await screen.findByRole('alert');
    expect(screen.queryByText('Nome confidencial de outro escopo.')).not.toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' }));
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    view.unmount(); show('?unitId=unit', client);
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByRole('cell', { name: 'actor-0' });
    expect(api.get).toHaveBeenCalledTimes(calls + 1);
  });
  it('mantém bloqueio de resposta inválida ao voltar a página em cache e permite verificação nova', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ ...event, id: `event-${index}`, actorId: `actor-${index}` }));
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never);
    show(); await screen.findByRole('cell', { name: 'actor-0' });
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ ...pageResponse(options, rows), items: [{ ...event, actorId: {} }] }) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' })); expect(await screen.findByRole('alert')).toHaveTextContent('página inválida');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' }));
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, rows) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByRole('cell', { name: 'actor-0' });
  });
  it('mantém a consulta acessível quando o timestamp textual da API é inválido', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => pageResponse(options, [{ ...event, occurredAt: 'inválido', outcome: 'DENIED' }]) as never);
    show(); expect(await screen.findByRole('cell', { name: 'Data inválida' })).toBeInTheDocument(); expect(screen.getByText('Negado')).toBeInTheDocument();
  });
  it('não consulta trilha sem a permissão de auditoria nem normaliza o endereço', () => {
    state.permitted = false; show('?unitId=other&page=4');
    expect(screen.getByText('Seu acesso não permite consultar auditoria.')).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=other&page=4');
  });
  it('não consulta trilha antes da seleção de unidade', () => {
    state.unitId = undefined; show(''); expect(screen.getByRole('heading', { name: 'Selecione uma unidade' })).toBeVisible(); expect(api.get).not.toHaveBeenCalled();
  });
  it('retira a tabela e o preenchimento local quando a permissão de leitura é revogada', async () => {
    const { rerender } = show(); await screen.findByRole('cell', { name: 'Documento cadastrado' });
    fireEvent.change(screen.getByLabelText('Ação'), { target: { value: 'DOCUMENT_VIEWED' } });
    const calls = vi.mocked(api.get).mock.calls.length; state.permitted = false; rerender();
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Ação')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
  });
  it('cancela resposta atrasada, separa unidade e sessão e não reutiliza o preenchimento anterior', async () => {
    let finish!: () => void, signal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const unit = String(options?.query?.unitId), session = state.sessionKey;
      const value = pageResponse(options, [{ ...event, actorId: `actor-${session}-${unit}` }]);
      if (unit === 'unit' && options?.query?.action === 'EVENTO_LENTO') return new Promise(resolve => { signal = options?.signal; finish = () => resolve(value as never); });
      return value as never;
    });
    const { rerender } = show('?unitId=unit&action=EVENTO_LENTO&page=2');
    await waitFor(() => expect(signal).toBeDefined()); state.unitId = 'unit-b'; rerender();
    await screen.findByRole('cell', { name: 'actor-audit-session-unit-b' }); expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
    fireEvent.change(screen.getByLabelText('Ação'), { target: { value: 'DOCUMENT_VIEWED' } });
    await act(async () => { finish(); }); expect(screen.queryByRole('cell', { name: 'actor-audit-session-unit' })).not.toBeInTheDocument();
    state.sessionKey = 'new-session'; rerender(); await screen.findByRole('cell', { name: 'actor-new-session-unit-b' });
    expect(screen.getByLabelText('Ação')).toHaveValue('EVENTO_LENTO');
    expect(screen.queryByRole('cell', { name: 'actor-audit-session-unit-b' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b', page: 1, action: 'EVENTO_LENTO' }) }));
  });
});
