import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { OperationsDashboardPage } from './OperationsDashboardPage';

const session = vi.hoisted(() => ({ sessionKey: 'ops-safe', unitId: 'unit' as string | undefined, permitted: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.permitted && ['appointments.read', 'permits.read', 'documents.read'].includes(permission), me: { user: { displayName: 'Pessoa Demo' } } }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('./SafetyOverview', async original => ({ ...await original<typeof import('./SafetyOverview')>(), SafetyOverview: () => null }));

const options = { teams: [{ id: 'team', name: 'Equipe permitida', unitId: 'unit' }], services: [{ id: 'service', name: 'Serviço permitido' }], responsibles: [] };
const appointment = { id: 'appointment', unitId: 'unit', code: 'AG-001', teamId: 'team', teamName: 'Equipe permitida', serviceTypeId: 'service', serviceLabel: 'Serviço conferido', location: 'Pátio', responsibleName: 'Pessoa responsável', startsAt: '2026-10-18T12:00:00Z', endsAt: '2026-10-18T14:00:00Z', status: 'CONFIRMED' };
const payload = () => ({ generatedAt: '2026-10-18T12:00:00Z', appointments: 1, activePermits: 0, blockedAppointments: 0, pendingReviews: 0, nextAppointments: [appointment], pendingPermits: [] });
const scope = ['permit-dashboard', 'ops-safe', 'unit'];
const key = (location = '') => [...scope, '', '', '', '', location];
const denialKey = [...scope, 'access-denial'];
function show(client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><OperationsDashboardPage /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
const dashboardCalls = () => vi.mocked(api.get).mock.calls.filter(([path]) => path === '/permit-dashboard');

beforeEach(() => {
  vi.clearAllMocks(); session.unitId = 'unit'; session.permitted = true;
  vi.mocked(api.get).mockImplementation(async path => (path === '/permit-options' ? options : payload()) as never);
});

describe.each(['resposta', 'cache'] as const)('dados operacionais conferidos na %s', source => {
  it.each(['unidade', 'data', 'contador'] as const)('não expõe indicadores nem nomes de um resultado com %s inválido', async fault => {
    const data = payload();
    if (fault === 'unidade') data.nextAppointments = [{ ...appointment, unitId: 'other-unit' }];
    if (fault === 'data') data.generatedAt = 'incorreto';
    if (fault === 'contador') data.activePermits = -1;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    if (source === 'cache') client.setQueryData(key(), data);
    vi.mocked(api.get).mockImplementation(async path => (path === '/permit-options' ? options : data) as never);
    show(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('dados operacionais inválidos');
    expect(screen.queryByRole('link', { name: /PTs em atendimento/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
    if (source === 'cache') expect(dashboardCalls()).toHaveLength(0);
  });
});

it('bloqueia período invertido e atualização sem apagar o preenchimento e recupera ao limpar', async () => {
  show(); await screen.findByText('Serviço conferido');
  fireEvent.change(screen.getByLabelText('Período de início'), { target: { value: '2026-10-18' } });
  await waitFor(() => expect(dashboardCalls().at(-1)?.[1]?.query?.from).toBe('2026-10-18'));
  const before = dashboardCalls().length;
  fireEvent.change(screen.getByLabelText('Período até'), { target: { value: '2026-10-01' } });
  expect(screen.getByText('A data final deve ser igual ou posterior à inicial.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Atualizar painel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: 'Consultar agenda' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /PTs em atendimento/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Período de início')).toHaveValue('2026-10-18');
  expect(dashboardCalls()).toHaveLength(before);
  vi.mocked(api.get).mockImplementation(async path => (path === '/permit-options' ? options : payload()) as never);
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  await screen.findByText('Serviço conferido');
  expect(screen.getByLabelText('Período até')).toHaveValue('');
});

it.each(['permissão', 'unidade'])('não consulta nem exibe dados do cache sem %s', reason => {
  if (reason === 'permissão') session.permitted = false; else session.unitId = undefined;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(key(), payload()); show(client);
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
  expect(screen.getByText(reason === 'permissão' ? 'Seu acesso não permite consultar o painel operacional.' : 'Selecione uma unidade')).toBeInTheDocument();
});

it('oculta referências de outra unidade e as oferece novamente apenas após nova leitura válida', async () => {
  vi.mocked(api.get).mockImplementation(async path => (path === '/permit-options' ? { ...options, teams: [{ ...options.teams[0], unitId: 'other-unit', name: 'Nome fora do alcance' }] } : payload()) as never);
  show();
  await screen.findByRole('button', { name: 'Tentar carregar filtros' });
  expect(screen.queryByRole('option', { name: 'Nome fora do alcance' })).not.toBeInTheDocument();
  expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
  vi.mocked(api.get).mockImplementation(async path => (path === '/permit-options' ? options : payload()) as never);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar filtros' }));
  await screen.findByRole('option', { name: 'Equipe permitida' });
  await screen.findByText('Serviço conferido');
});

it('uma tentativa cancelada não restaura indicadores anteriores à negativa de acesso', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(key(), payload());
  show(client); await screen.findByText('Serviço conferido');
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/permit-options') return options as never;
    throw new ApiError(403, { code: 'FORBIDDEN', message: 'Detalhes internos que não devem aparecer', requestId: 'denied' });
  });
  fireEvent.change(screen.getByLabelText('Local / Área'), { target: { value: 'Local negado' } });
  await screen.findByRole('button', { name: 'Tentar novamente' });
  await waitFor(() => expect(client.getQueryData(denialKey)).not.toBeNull());
  let retrySignal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementationOnce((_path, opts) => new Promise((_resolve, reject) => {
    retrySignal = opts?.signal;
    retrySignal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true });
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(retrySignal).toBeInstanceOf(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  await waitFor(() => expect(retrySignal?.aborted).toBe(true));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(client.getQueryData(denialKey)).not.toBeNull();
  expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
  expect(screen.queryByText('Detalhes internos que não devem aparecer')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /PTs em atendimento/ })).not.toBeInTheDocument();
  vi.mocked(api.get).mockResolvedValueOnce(payload() as never);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await screen.findByText('Serviço conferido');
  expect(client.getQueryData(denialKey)).toBeNull();
  expect(client.getQueryState(key())?.dataUpdateCount).toBe(2);
});

it('recuperar referências após 403 exige novo agregado antes de liberar dados antigos', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const optionsKey = ['permit-options', 'ops-safe', 'unit'];
  client.setQueryData(optionsKey, options);
  client.setQueryData(key(), payload());
  show(client); await screen.findByText('Serviço conferido');

  let finishStale!: (value: unknown) => void;
  let staleSignal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementationOnce((_path, opts) => new Promise(resolve => {
    staleSignal = opts?.signal;
    finishStale = value => resolve(value as never);
  }));
  act(() => { void client.refetchQueries({ queryKey: key(), exact: true }); });
  await waitFor(() => expect(staleSignal).toBeInstanceOf(AbortSignal));
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Referências restritas.', requestId: 'options-denied' }));
  await act(async () => { await client.refetchQueries({ queryKey: optionsKey, exact: true }); });
  await screen.findByRole('button', { name: 'Tentar carregar filtros' });
  await waitFor(() => expect(client.getQueryData(denialKey)).not.toBeNull());
  await waitFor(() => expect(staleSignal?.aborted).toBe(true));
  await act(async () => finishStale(payload()));
  expect(client.getQueryState(key())?.dataUpdateCount).toBe(1);
  expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
  let finish!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/permit-options') return { ...options, teams: [] } as never;
    return new Promise(resolve => { finish = value => resolve(value as never); });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar filtros' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /PTs em atendimento/ })).not.toBeInTheDocument();
  expect(client.getQueryData(denialKey)).not.toBeNull();

  await act(async () => finish({ ...payload(), appointments: 0, nextAppointments: [] }));
  await screen.findByRole('link', { name: /PTs em atendimento/ });
  expect(screen.queryByText('Serviço conferido')).not.toBeInTheDocument();
  expect(client.getQueryData(denialKey)).toBeNull();
  expect(client.getQueryState(key())?.dataUpdateCount).toBe(2);
});
