import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { PageDto } from '../../shared/contracts';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import type { ConfinedSpacePermitDto } from '../../shared/contracts/confined-space-permits';
import { createAuthorizationPreparation } from '../authorizations/model';
import { createPetPreparation } from '../confined-space/model';
import { PreparationSearchTab } from './PreparationSearchTab';

type Kind = 'ats' | 'pets';
type RecordDto = WorkAuthorizationDto | ConfinedSpacePermitDto;
const session = vi.hoisted(() => ({ unitId: 'unit-a' as string | undefined, sessionKey: 'session-a', permissions: ['at.read', 'pet.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

const endpoint = (kind: Kind) => kind === 'ats' ? '/work-authorizations' : '/confined-space-permits';
const prefix = (kind: Kind) => kind === 'ats' ? 'consulta-ats' : 'consulta-pets';
const code = (kind: Kind, number = 1) => `${kind === 'ats' ? 'AT' : 'PET'}-${String(number).padStart(3, '0')}`;
const searchFor = (kind: Kind, number = 1) => kind === 'ats' ? code(kind, number) : `EC-${String(number).padStart(3, '0')}`;

function records(kind: Kind, unitId = 'unit-a', sessionKey = 'session-a'): RecordDto[] {
  return Array.from({ length: 23 }, (_, index) => {
    const number = index + 1;
    const appointment: AppointmentDto = {
      id: `appointment-${number}`, code: `AGE-${number}`, companyId: 'company-a', unitId, teamId: 'team-a', teamName: `Equipe ${sessionKey}:${unitId}`,
      serviceTypeId: 'service-a', serviceLabel: 'Inspeção de demonstração', location: 'Pátio sintético', startsAt: '2099-01-01T12:00:00Z', endsAt: '2099-01-01T14:00:00Z',
      responsibleId: 'operator-a', responsibleName: 'Responsável sintético', participants: [], status: 'CONFIRMED', revision: 1, availableActions: [], history: [],
    };
    const common = { id: `${kind}-${number}`, code: code(kind, number), companyId: 'company-a', unitId, revision: 2, appointment, sourceId: 'SOURCE-DEMO', sourceRevision: '1', sourceSha256: 'a'.repeat(64), createdAt: '2026-10-16T12:00:00Z', createdByName: 'Pessoa fictícia', availableActions: ['EDIT'], history: [] };
    if (kind === 'ats') return { ...common, status: number === 12 ? 'SUSPENDED' : 'DRAFT', preparation: createAuthorizationPreparation(appointment), sciences: [], releases: [], closingChecks: [], eligibility: { appointmentId: appointment.id, checkedAt: '2026-10-16T12:00:00Z', requirementVersion: 'DEMO-1', eligible: false, participants: [] } } as WorkAuthorizationDto;
    const preparation = createPetPreparation(appointment);
    preparation.identification.spaceCode = `EC-${String(number).padStart(3, '0')}`;
    preparation.identification.task = `Tarefa ${sessionKey}:${unitId} · espaço ${number}`;
    return { ...common, status: 'DRAFT', preparation, snapshots: [], updatedAt: common.createdAt } as ConfinedSpacePermitDto;
  });
}

function response(kind: Kind, options?: Parameters<typeof api.get>[1], sessionKey = session.sessionKey): PageDto<RecordDto> {
  const query = options?.query ?? {}, unitId = String(query.unitId || 'unit-a');
  const q = String(query.q || '').toLocaleLowerCase('pt-BR');
  let rows = records(kind, unitId, sessionKey);
  if (kind === 'ats' && query.status) rows = rows.filter(row => row.status === query.status);
  if (q) rows = rows.filter(row => JSON.stringify(row).toLocaleLowerCase('pt-BR').includes(q));
  const page = Number(query.page || 1);
  return { items: rows.slice((page - 1) * 10, page * 10), total: rows.length, page, pageSize: 10 };
}

function Probe() {
  const location = useLocation(), navigate = useNavigate(); const [params, setParams] = useSearchParams();
  return <><output aria-label="Endereço atual">{location.pathname}{location.search}</output><output aria-label="Origem atual">{JSON.stringify(location.state)}</output>
    <button onClick={() => navigate(-1)}>Retornar histórico</button><button onClick={() => { const next = new URLSearchParams({ tab: params.get('tab') || 'ats' }); if (session.unitId) next.set('unitId', session.unitId); setParams(next); }}>Atualizar unidade na URL</button></>;
}

function show(kind: Kind, suffix = '', client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const route = `/app/consulta?tab=${kind}&unitId=unit-a${suffix ? `&${suffix}` : ''}`;
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><PreparationSearchTab kind={kind} /><Probe /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, view, rerender: () => view.rerender(tree()), route };
}

beforeEach(() => {
  vi.clearAllMocks(); session.unitId = 'unit-a'; session.sessionKey = 'session-a'; session.permissions = ['at.read', 'pet.read'];
  vi.mocked(api.get).mockImplementation(async (path, options) => response(path === '/work-authorizations' ? 'ats' : 'pets', options) as never);
});

describe.each<Kind>(['ats', 'pets'])('consulta unificada de %s', kind => {
  const label = kind === 'ats' ? 'ATs' : 'PETs';
  const permission = kind === 'ats' ? 'at.read' : 'pet.read';

  it('consulta somente o recurso permitido, apresenta tabela e transporta a origem completa para o detalhe', async () => {
    session.permissions = [permission]; const user = userEvent.setup(); const { route } = show(kind);
    const link = await screen.findByRole('link', { name: code(kind) });
    expect(link).toHaveAttribute('href', `/app/${kind}/${kind}-1`);
    expect(screen.getByRole('table')).toHaveAccessibleName(`Resultados da consulta de ${label}`);
    expect(screen.getByRole('region', { name: `Tabela de ${label}` })).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('row')).toHaveLength(11);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith(endpoint(kind), expect.objectContaining({ signal: expect.any(AbortSignal), query: { unitId: 'unit-a', page: 1, pageSize: 10, q: undefined, ...(kind === 'ats' ? { status: undefined } : {}) } }));
    if (kind === 'pets') expect(screen.getByRole('region', { name: 'Consulta de PETs' })).toHaveTextContent('A entrada não está autorizada.');
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    await user.click(link);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/${kind}/${kind}-1`);
    expect(JSON.parse(screen.getByLabelText('Origem atual').textContent!)).toEqual({ fromConsulta: true, fromSearch: route.slice(route.indexOf('?')), fromUnitId: 'unit-a' });
  });

  it('aplica pesquisa por envio explícito e reinicia a paginação com filtros próprios do recurso', async () => {
    const user = userEvent.setup(); show(kind, 'page=2');
    await screen.findByRole('link', { name: code(kind, 11) });
    const search = screen.getByRole('searchbox');
    await user.type(search, `  ${searchFor(kind, 12)}  `);
    if (kind === 'ats') await user.selectOptions(screen.getByRole('combobox', { name: 'Estado da AT' }), 'SUSPENDED');
    else expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Pesquisar' }));
    expect(await screen.findByRole('link', { name: code(kind, 12) })).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
    expect(api.get).toHaveBeenLastCalledWith(endpoint(kind), expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: searchFor(kind, 12), ...(kind === 'ats' ? { status: 'SUSPENDED' } : {}) } }));
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('link', { name: code(kind) });
    expect(search).toHaveValue(''); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/consulta?tab=${kind}&unitId=unit-a`);
  });

  it('conserva critérios entre páginas e não pagina novamente a resposta do servidor', async () => {
    const user = userEvent.setup(); show(kind, 'q=DEMO');
    // All fixtures identify their source as a demonstration, so the same search spans all pages.
    await screen.findByRole('link', { name: code(kind) });
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('link', { name: code(kind, 11) });
    expect(screen.queryByRole('link', { name: code(kind) })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('link', { name: code(kind, 23) });
    expect(screen.getAllByRole('row')).toHaveLength(4); expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByRole('navigation', { name: `Paginação da consulta de ${label}` })).toHaveTextContent('página 3 de 3');
    expect(api.get).toHaveBeenLastCalledWith(endpoint(kind), expect.objectContaining({ query: expect.objectContaining({ page: 3, pageSize: 10, q: 'DEMO' }) }));
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByRole('link', { name: code(kind, 11) })).toBeVisible();
  });

  it('não faz consultas com somente permissão de outro recurso ou de escrita', () => {
    session.permissions = kind === 'ats' ? ['pet.read', 'at.write'] : ['at.read', 'pet.write']; show(kind);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible(); expect(api.get).not.toHaveBeenCalled();
  });
  it('não faz consultas sem unidade selecionada', () => {
    session.unitId = undefined; show(kind);
    expect(screen.getByRole('heading', { name: 'Selecione uma unidade' })).toBeVisible(); expect(api.get).not.toHaveBeenCalled();
  });
  it('aguarda a normalização da unidade na URL sem expor registros de outro contexto', () => {
    session.unitId = 'unit-b'; show(kind);
    expect(screen.getByText(/Conferindo a unidade da consulta/)).toBeVisible(); expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each([
    ['página zero', 'page=0'], ['página fracionária', 'page=1.5'], ['página insegura', 'page=9007199254740992'],
    ['página com deslocamento inseguro', 'page=900719925474100'], ['página vazia', 'page='], ['pesquisa longa', `q=${'a'.repeat(201)}`],
    ['pesquisa repetida', 'q=um&q=dois'], ['unidade repetida', 'unitId=unit-a'], ['aba repetida', `tab=${kind}`],
    ['situação operacional incompatível', 'operationStatus=ACTIVE'], ['revisão incompatível', 'reviewStatus=PENDING'], ['tipo documental incompatível', 'typeId=type-a'],
  ])('bloqueia %s e permite limpar os critérios explicitamente', async (_description, query) => {
    const user = userEvent.setup(); show(kind, query);
    expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeDisabled();
    expect(screen.getByRole('region', { name: `Consulta de ${label}` })).toHaveTextContent(/endereço contém|pesquisa deve ter/);
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('link', { name: code(kind) })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('rejeita o estado inválido da AT ou qualquer filtro de estado da PET', () => {
    show(kind, kind === 'ats' ? 'status=__proto__' : 'status=DRAFT');
    expect(screen.getByRole('region', { name: `Consulta de ${label}` })).toHaveTextContent(kind === 'ats' ? 'Selecione um estado válido da AT.' : 'filtros incompatíveis');
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([
    ['array legado', (value: PageDto<RecordDto>) => value.items],
    ['página diferente', (value: PageDto<RecordDto>) => ({ ...value, page: 2 })],
    ['tamanho de página diferente', (value: PageDto<RecordDto>) => ({ ...value, pageSize: 100 })],
    ['total negativo', (value: PageDto<RecordDto>) => ({ ...value, total: -1 })],
    ['identificador de rota inválido', (value: PageDto<RecordDto>) => ({ ...value, items: [{ ...value.items[0], id: '../outro-contexto' }] })],
    ['unidade do registro', (value: PageDto<RecordDto>) => ({ ...value, items: [{ ...value.items[0], unitId: 'unit-b' }] })],
    ['unidade do atendimento', (value: PageDto<RecordDto>) => ({ ...value, items: [{ ...value.items[0], appointment: { ...value.items[0].appointment, unitId: 'unit-b' } }] })],
    ['revisão inválida', (value: PageDto<RecordDto>) => ({ ...value, items: [{ ...value.items[0], revision: 0 }] })],
    ['IDs duplicados', (value: PageDto<RecordDto>) => ({ ...value, items: [value.items[0], value.items[0]] })],
  ])('oculta a resposta incompatível: %s', async (_description, change) => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => change(response(kind, options)) as never); show(kind);
    expect(await screen.findByRole('alert')).toHaveTextContent(/página válida|contexto esperado/);
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('não apresenta estado operacional inexistente como válido', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const value = response(kind, options); return { ...value, items: [{ ...value.items[0], status: kind === 'ats' ? 'UNKNOWN' : 'AUTHORIZED' }] } as never;
    }); show(kind);
    expect(await screen.findByRole('alert')).toHaveTextContent('contexto esperado'); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each([401, 404])('oculta a mensagem restrita de erro %s e exige nova consulta autorizada', async status => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new ApiError(status, { code: 'UNAVAILABLE', message: 'Identificação restrita de outra unidade.', requestId: 'scope-failure' }));
    show(kind);
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 401 ? 'Sua sessão precisa ser verificada novamente.' : `A consulta de ${label} não está disponível nesta unidade.`);
    expect(screen.queryByText('Identificação restrita de outra unidade.')).not.toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(kind, options) as never);
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: code(kind) })).toBeVisible();
  });

  it('preserva a busca local após erro de atualização, esconde cache e recupera resultados na tentativa explícita', async () => {
    const user = userEvent.setup(); const { client } = show(kind);
    await screen.findByRole('link', { name: code(kind) });
    await user.type(screen.getByRole('searchbox'), 'Busca local ainda não aplicada');
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, { code: 'UNAVAILABLE', message: 'Consulta temporariamente indisponível.', requestId: 'search-failure' }));
    await act(async () => { await client.invalidateQueries({ queryKey: [prefix(kind), session.sessionKey, session.unitId] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulta temporariamente indisponível.'); expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('Busca local ainda não aplicada');
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(kind, options) as never);
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: code(kind) })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('Busca local ainda não aplicada');
  });

  it('não reutiliza uma página em cache depois de 403 nem ao remontar até nova confirmação de acesso', async () => {
    const user = userEvent.setup(); const { client, view } = show(kind);
    await screen.findByRole('link', { name: code(kind) });
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Nome restrito do servidor não deve aparecer.', requestId: 'search-denial' }));
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Seu acesso não permite consultar ${label} nesta unidade.`);
    expect(screen.queryByText('Nome restrito do servidor não deve aparecer.')).not.toBeInTheDocument();
    const calls = vi.mocked(api.get).mock.calls.length;
    view.unmount(); show(kind, '', client);
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(kind, options) as never);
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: code(kind) })).toBeVisible(); expect(api.get).toHaveBeenCalledTimes(calls + 1);
  });

  it('cancela o contexto antigo, aguarda unidade na URL e separa nova sessão sem recuperar nomes antigos', async () => {
    let finish!: () => void, signal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const key = session.sessionKey;
      if (options?.query?.q === 'atrasada') return new Promise(resolve => { signal = options.signal; finish = () => resolve(response(kind, { ...options, query: { ...options.query, q: undefined } }, key) as never); });
      return response(kind, options, key) as never;
    });
    const user = userEvent.setup(); const { rerender } = show(kind);
    await screen.findByRole('link', { name: code(kind) });
    await user.type(screen.getByRole('searchbox'), 'atrasada{Enter}'); await waitFor(() => expect(signal).toBeDefined());
    session.unitId = 'unit-b'; rerender();
    expect(signal?.aborted).toBe(true); const calls = vi.mocked(api.get).mock.calls.length;
    expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    // The wrapper owns normalization; represent that explicit route update here.
    await user.click(screen.getByRole('button', { name: 'Atualizar unidade na URL' }));
    await screen.findByRole('link', { name: code(kind) });
    const section = screen.getByRole('region', { name: `Consulta de ${label}` });
    expect(section).toHaveTextContent('session-a:unit-b'); expect(section).not.toHaveTextContent('session-a:unit-a');
    await act(async () => { finish(); });
    expect(section).not.toHaveTextContent('session-a:unit-a');
    session.sessionKey = 'session-b'; rerender();
    await waitFor(() => expect(screen.getByRole('region', { name: `Consulta de ${label}` })).toHaveTextContent('session-b:unit-b'));
    expect(screen.getByRole('region', { name: `Consulta de ${label}` })).not.toHaveTextContent('session-a:unit-b');
    expect(api.get).toHaveBeenLastCalledWith(endpoint(kind), expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b', page: 1, q: undefined }) }));
  });

  it('sincroniza o preenchimento com o histórico de navegação após duas pesquisas', async () => {
    const user = userEvent.setup(); show(kind); await screen.findByRole('link', { name: code(kind) });
    const search = screen.getByRole('searchbox');
    await user.type(search, `${searchFor(kind, 1)}{Enter}`); await screen.findByRole('link', { name: code(kind, 1) });
    await user.clear(search); await user.type(search, `${searchFor(kind, 2)}{Enter}`); await screen.findByRole('link', { name: code(kind, 2) });
    await user.click(screen.getByRole('button', { name: 'Retornar histórico' }));
    await waitFor(() => expect(search).toHaveValue(searchFor(kind, 1)));
    expect(screen.getByRole('link', { name: code(kind, 1) })).toBeVisible(); expect(screen.queryByRole('link', { name: code(kind, 2) })).not.toBeInTheDocument();
  });

  it('apresenta página vazia sem substituir a página solicitada e oferece retorno explícito à primeira', async () => {
    const user = userEvent.setup(); show(kind, 'page=9');
    expect(await screen.findByRole('heading', { name: `Nenhuma ${kind === 'ats' ? 'AT' : 'PET'} encontrada` })).toBeVisible();
    expect(screen.getByRole('navigation', { name: `Paginação da consulta de ${label}` })).toHaveTextContent('página 9 de 3');
    await user.click(screen.getByRole('button', { name: 'Primeira página' }));
    expect(await screen.findByRole('link', { name: code(kind) })).toBeVisible();
  });
});
