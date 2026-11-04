import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type RequestOptions } from '../../shared/api/client';
import type { PageDto } from '../../shared/contracts';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { consultationNavigation } from '../../shared/lib/consultation-navigation';
import { PermitsPage } from './PermitsPage';

const state = vi.hoisted(() => ({ sessionKey: 'permit-session', unitId: 'unit' as string | undefined, permissions: ['permits.read', 'appointments.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

function permit(number = 1, unitId = 'unit'): WorkPermitDto {
  const suffix = String(number).padStart(3, '0');
  return {
    id: `permit-${suffix}`, code: `PT-${suffix}`, version: 1, revision: 4, templateVersion: 'Modelo demonstrativo',
    appointment: { id: `appointment-${suffix}`, code: `AG-${suffix}`, unitId, teamId: 'team', teamName: 'Equipe ilustrativa', serviceTypeId: 'service', serviceLabel: `Serviço ${suffix}`, location: 'Área ilustrativa', startsAt: '2026-10-17T12:00:00Z', endsAt: '2026-10-17T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico ilustrativo', participants: [{ workerId: 'worker', name: 'Pessoa ilustrativa', serviceFunction: 'Executante' }], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', checklist: [], sciences: [], eligibility: { appointmentId: `appointment-${suffix}`, checkedAt: '2026-10-17T12:00:00Z', requirementVersion: '1', eligible: true, participants: [] }, availableActions: [], snapshots: [], history: [],
  };
}
let records: WorkPermitDto[];
function response(options?: RequestOptions): PageDto<WorkPermitDto> {
  const query = options?.query || {}, page = Number(query.page || 1), pageSize = Number(query.pageSize || 10);
  const q = String(query.q || '').toLowerCase();
  const items = records.filter(value => value.appointment.unitId === query.unitId
    && (!query.operationStatus || value.operationStatus === query.operationStatus) && (!query.reviewStatus || value.reviewStatus === query.reviewStatus)
    && (!query.teamId || value.appointment.teamId === query.teamId)
    && (!q || `${value.code} ${value.appointment.serviceLabel}`.toLowerCase().includes(q)));
  return { items: structuredClone(items.slice((page - 1) * pageSize, page * pageSize)), page, pageSize, total: items.length };
}
let navigateTo: ReturnType<typeof useNavigate>;
function DetailProbe() {
  const location = useLocation();
  const origin = consultationNavigation({ ...location.state, fromConsulta: true }, state.unitId);
  return <><output aria-label="Origem da PT">{JSON.stringify(location.state)}</output><Link to={`/app/pts${origin?.fromSearch || ''}`}>Voltar às PTs</Link></>;
}
function Harness() {
  const location = useLocation(); navigateTo = useNavigate();
  return <><output aria-label="Endereço atual">{location.pathname}{location.search}</output><Routes><Route path="/app/pts" element={<PermitsPage />} /><Route path="/app/pts/:id" element={<DetailProbe />} /></Routes></>;
}
function show(query = '', existingClient?: QueryClient) {
  const client = existingClient || new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/pts${query}`]}><Harness /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
const key = (page = 1, q = '', operation = '', review = '', teamId = '') => ['work-permits', 'permit-session', 'unit', page, q, operation, review, teamId];
const result = () => screen.getByRole('region', { name: 'Permissões de trabalho encontradas' });

beforeEach(() => {
  vi.clearAllMocks(); state.sessionKey = 'permit-session'; state.unitId = 'unit'; state.permissions = ['permits.read', 'appointments.read'];
  records = [permit()];
  vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
});

describe('consulta paginada das PTs', () => {
  it.each([false, true])('preserva os dois filtros alterados no mesmo ciclo, invertido=%s', async reverse => {
    records = Array.from({ length: 25 }, (_, index) => permit(index + 1)); show('?unitId=unit&page=2&q=PT');
    await screen.findByText('PT-011');
    const operation = () => fireEvent.change(screen.getByRole('combobox', { name: 'Situação operacional' }), { target: { value: 'COMPLETED' } });
    const review = () => fireEvent.change(screen.getByRole('combobox', { name: 'Revisão do encerramento' }), { target: { value: 'PENDING_REVIEW' } });
    act(() => { if (reverse) { review(); operation(); } else { operation(); review(); } });
    await screen.findByText('PT-001');
    expect(screen.getByRole('combobox', { name: 'Situação operacional' })).toHaveValue('COMPLETED');
    expect(screen.getByRole('combobox', { name: 'Revisão do encerramento' })).toHaveValue('PENDING_REVIEW');
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', q: 'PT', page: 1, operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW' }) }));
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
  });
  it('consulta somente dez das 125 PTs por página e preserva o total e os limites de navegação', async () => {
    records = Array.from({ length: 125 }, (_, index) => permit(index + 1)); show();
    await screen.findByText('PT-001');
    expect(within(screen.getByRole('table', { name: 'Permissões de trabalho' })).getAllByRole('row').slice(1)).toHaveLength(10);
    expect(screen.queryByText('PT-011')).not.toBeInTheDocument();
    expect(screen.getByText('125 atendimentos no seu alcance de acesso.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Paginação de PTs' })).toHaveTextContent('Página 1 de 13');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: { unitId: 'unit', page: 1, pageSize: 10, q: undefined, operationStatus: undefined, reviewStatus: undefined, teamId: undefined }, signal: expect.any(AbortSignal) }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText('PT-011'); expect(screen.queryByText('PT-001')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ page: 2, pageSize: 10 }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' })); await screen.findByText('PT-001');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
  });

  it('preserva o texto digitado ao aplicar filtros sucessivos e só pesquisa esse texto após confirmar', async () => {
    records = Array.from({ length: 25 }, (_, index) => permit(index + 1));
    show('?q=PT&page=2'); await screen.findByText('PT-011');
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar PT' }), { target: { value: 'PT-025' } });
    expect(api.get).toHaveBeenCalledTimes(calls);
    fireEvent.change(screen.getByLabelText('Situação operacional'), { target: { value: 'COMPLETED' } });
    await screen.findByText('PT-001');
    fireEvent.change(screen.getByLabelText('Revisão do encerramento'), { target: { value: 'PENDING_REVIEW' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ q: 'PT', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', page: 1 }) })));
    expect(screen.getByRole('searchbox', { name: 'Buscar PT' })).toHaveValue('PT-025');
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' })); await screen.findByText('PT-025');
    expect(within(screen.getByRole('table', { name: 'Permissões de trabalho' })).getAllByRole('row').slice(1)).toHaveLength(1);
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ q: 'PT-025', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', page: 1 }) }));
  });

  it('respeita a equipe recebida por link e permite remover apenas esse filtro', async () => {
    records = [permit(1), { ...permit(2), appointment: { ...permit(2).appointment, teamId: 'other-team' } }];
    show('?teamId=other-team&reviewStatus=PENDING_REVIEW'); await screen.findByText('PT-002');
    expect(screen.queryByText('PT-001')).not.toBeInTheDocument();
    expect(screen.getByText('Filtro de equipe aplicado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro de equipe' })); await screen.findByText('PT-001');
    expect(screen.getByLabelText('Revisão do encerramento')).toHaveValue('PENDING_REVIEW');
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ teamId: undefined, reviewStatus: 'PENDING_REVIEW', page: 1 }) }));
  });

  it('preserva página, filtros e unidade no estado dos dois links de detalhe e no retorno', async () => {
    records = Array.from({ length: 25 }, (_, index) => permit(index + 1));
    show('?unitId=unit&page=3&q=PT&operationStatus=COMPLETED&reviewStatus=PENDING_REVIEW&teamId=team');
    await screen.findByText('PT-021');
    fireEvent.click(within(result()).getAllByRole('link', { name: 'Consultar PT' })[0]);
    const origin = JSON.parse(screen.getByLabelText('Origem da PT').textContent || '{}');
    expect(origin).toEqual({ fromConsulta: false, fromUnitId: 'unit', fromSearch: '?unitId=unit&page=3&q=PT&operationStatus=COMPLETED&reviewStatus=PENDING_REVIEW&teamId=team' });
    fireEvent.click(screen.getByRole('link', { name: 'Voltar às PTs' })); await screen.findByText('PT-021');
    expect(screen.getByRole('navigation', { name: 'Paginação de PTs' })).toHaveTextContent('Página 3 de 3');
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    fireEvent.click(within(result()).getByRole('link', { name: 'PT-021' }));
    expect(JSON.parse(screen.getByLabelText('Origem da PT').textContent || '{}')).toEqual(origin);
  });

  it('ajusta a página que ultrapassou o total sem perder os filtros', async () => {
    records = Array.from({ length: 25 }, (_, index) => permit(index + 1));
    show('?q=PT&teamId=team&reviewStatus=PENDING_REVIEW&page=99'); await screen.findByText('PT-021');
    expect(within(screen.getByRole('table', { name: 'Permissões de trabalho' })).getAllByRole('row').slice(1)).toHaveLength(5);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=3');
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ page: 3, q: 'PT', teamId: 'team', reviewStatus: 'PENDING_REVIEW' }) }));
  });

  it.each(['permission', 'unit'] as const)('não consulta nem apresenta registros sem %s', cause => {
    if (cause === 'permission') state.permissions = []; else state.unitId = undefined;
    show('?unitId=unit'); expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
    expect(screen.getByText(cause === 'permission' ? 'Seu acesso não permite consultar permissões de trabalho.' : 'Selecione uma unidade')).toBeInTheDocument();
  });
});

describe('critérios recebidos no endereço da lista de PTs', () => {
  it.each(['Infinity', 'NaN', '-1', '0', '', '01', '1.5', '9007199254740992'])('não consulta page=%s até a correção explícita', async value => {
    show(`?unitId=unit&reviewStatus=PENDING_REVIEW&page=${value}`);
    await screen.findByText(/O endereço contém uma página de PTs inválida/);
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à primeira página' })); await screen.findByText('PT-001');
    expect(api.get).toHaveBeenCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ page: 1, reviewStatus: 'PENDING_REVIEW' }) }));
  });

  it.each(['operationStatus=OUTRO', 'reviewStatus=OUTRO', 'reviewStatus=constructor', 'teamId=a%2Fb', 'q=%00', `q=${'a'.repeat(201)}`, 'q=a&q=b', 'page=1&page=2', 'unitId=unit&unitId=other', 'status=COMPLETED'])('bloqueia critérios inválidos ou ambíguos sem ampliar resultados: %s', async query => {
    show(`?${query}`); await screen.findByRole('button', { name: 'Limpar filtros' });
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' })); await screen.findByText('PT-001');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('/app/pts?unitId=unit');
    expect(api.get).toHaveBeenCalledOnce();
  });

  it('inclui a unidade antes do primeiro GET e preserva página e critérios válidos', async () => {
    records = Array.from({ length: 15 }, (_, index) => permit(index + 1));
    show('?page=2&q=PT&operationStatus=COMPLETED'); await screen.findByText('PT-011');
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 2, q: 'PT', operationStatus: 'COMPLETED' }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit');
  });

  it('remove equipe e página de uma unidade antiga antes de consultar o contexto atual', async () => {
    show('?unitId=other&teamId=team-old&page=2&q=PT&reviewStatus=PENDING_REVIEW'); await screen.findByText('PT-001');
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 1, teamId: undefined, q: 'PT', reviewStatus: 'PENDING_REVIEW' }) }));
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('team-old');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
  });
});

describe('respostas verificadas, falhas e contexto da consulta de PTs', () => {
  it.each(['items', 'page', 'pageSize', 'total', 'duplicate', 'unit', 'date', 'appointment', 'science', 'service', 'filter'] as const)('recusa envelope ou cartão com %s inválido', async field => {
    const item = structuredClone(permit()) as unknown as Record<string, unknown>;
    const appointment = item.appointment as Record<string, unknown>;
    const received: Record<string, unknown> = { items: [item], page: 1, pageSize: 10, total: 1 };
    if (field === 'items') received.items = null;
    if (field === 'page') received.page = 2;
    if (field === 'pageSize') received.pageSize = 100;
    if (field === 'total') received.total = -1;
    if (field === 'duplicate') { received.items = [item, item]; received.total = 2; }
    if (field === 'unit') appointment.unitId = 'other';
    if (field === 'date') appointment.startsAt = 'incorreto';
    if (field === 'appointment') item.appointment = null;
    if (field === 'science') item.sciences = [{ workerId: 'other-worker', version: 1 }];
    if (field === 'service') appointment.serviceLabel = {};
    if (field === 'filter') item.operationStatus = 'VERIFICATION';
    vi.mocked(api.get).mockResolvedValue(received); show('?unitId=unit&operationStatus=COMPLETED');
    await screen.findByText('A consulta retornou uma página inválida. Tente novamente.');
    expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument(); expect(screen.queryByText('PT-001')).not.toBeInTheDocument();
  });

  it('valida também um cache fresco e só recupera os cartões após nova resposta válida', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(key(), { items: [permit(1, 'other')], page: 1, pageSize: 10, total: 1 });
    show('?unitId=unit', client); await screen.findByText('A consulta retornou uma página inválida. Tente novamente.');
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' })); await screen.findByText('PT-001');
    expect(api.get).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 404])('oculta cartões após negativa %s e não reexpõe outra página ou remount do cache', async status => {
    records = Array.from({ length: 11 }, (_, index) => permit(index + 1));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const first = show('?unitId=unit', client); await screen.findByText('PT-001');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' })); await screen.findByText('PT-011');
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(status, { code: 'FORBIDDEN', message: 'Resposta restrita: Técnico ilustrativo', requestId: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar PTs' })); await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument(); expect(screen.queryByText(/Resposta restrita/)).not.toBeInTheDocument();
    const calls = vi.mocked(api.get).mock.calls.length;
    act(() => navigateTo('/app/pts?unitId=unit'));
    expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    first.unmount(); show('?unitId=unit', client);
    expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    let complete!: (value: PageDto<WorkPermitDto>) => void;
    vi.mocked(api.get).mockImplementationOnce(async () => new Promise(resolve => { complete = resolve; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeDisabled());
    expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
    await act(async () => complete({ items: records.slice(0, 10), page: 1, pageSize: 10, total: 11 }));
    await screen.findByText('PT-001'); expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  it('permite repetir uma consulta após falha temporária sem apagar filtros', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(503, { code: 'UNAVAILABLE', message: 'Conexão temporariamente indisponível.', requestId: '' }));
    show('?q=PT-001&operationStatus=COMPLETED&reviewStatus=PENDING_REVIEW&teamId=team');
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' })); await screen.findByText('PT-001');
    expect(screen.getByRole('searchbox', { name: 'Buscar PT' })).toHaveValue('PT-001');
    expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: 'PT-001', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', teamId: 'team' }) }));
  });

  it('cancela a busca antiga na troca de unidade e descarta a resposta tardia', async () => {
    let complete!: (value: PageDto<WorkPermitDto>) => void, oldSignal!: AbortSignal;
    records = [permit(2, 'unit-b')];
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      if (options?.query?.unitId === 'unit') { oldSignal = options.signal!; return new Promise(resolve => { complete = resolve; }) as never; }
      return response(options) as never;
    });
    const view = show('?unitId=unit&page=2&teamId=team&q=PT'); await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
    state.unitId = 'unit-b'; view.update(); await screen.findByText('PT-002');
    expect(oldSignal.aborted).toBe(true);
    await act(async () => complete({ items: [permit()], page: 2, pageSize: 10, total: 11 }));
    expect(screen.queryByText('PT-001')).not.toBeInTheDocument(); expect(screen.getByRole('searchbox', { name: 'Buscar PT' })).toHaveValue('PT');
    expect(vi.mocked(api.get).mock.calls.filter(([, options]) => options?.query?.unitId === 'unit-b').every(([, options]) => options?.query?.page === 1 && options.query.teamId === undefined)).toBe(true);
  });

  it('remove os dados e cancela a consulta se a permissão mudar durante o carregamento', async () => {
    let complete!: (value: PageDto<WorkPermitDto>) => void, signal!: AbortSignal;
    vi.mocked(api.get).mockImplementation(async (_path, options) => { signal = options!.signal!; return new Promise(resolve => { complete = resolve; }) as never; });
    const view = show('?unitId=unit'); await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
    state.permissions = []; view.update(); expect(signal.aborted).toBe(true);
    await act(async () => complete({ items: [permit()], page: 1, pageSize: 10, total: 1 }));
    expect(screen.getByText('Seu acesso não permite consultar permissões de trabalho.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
  });
});

