import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { AuditLogDto } from '../../shared/contracts';
import { AuditPage } from './AuditPage';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'audit-criteria-session', unitId: 'unit', can: (permission: string) => permission === 'audit.read' }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

const event: AuditLogDto = {
  id: 'event', actorId: 'actor-outside-query', action: 'DOCUMENT_CREATED', resourceType: 'DOCUMENT', resourceId: 'document',
  occurredAt: '2026-10-11T12:00:00Z', requestId: 'trace', outcome: 'DEMO',
};

function show(source: 'resposta' | 'cache', query: string, item: AuditLogDto) {
  const params = new URLSearchParams(query);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const value = { items: [item], page: 1, pageSize: 20, total: 1 };
  vi.mocked(api.get).mockResolvedValue(value as never);
  if (source === 'cache') client.setQueryData(['audit', 'audit-criteria-session', 'unit', 1, params.get('action') ?? '', params.get('from') ?? '', params.get('to') ?? ''], value);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/auditoria?unitId=unit${query ? `&${query}` : ''}`]}><AuditPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

function HistoryHarness() {
  const location = useLocation(), navigate = useNavigate();
  return <><output aria-label="Endereço atual">{location.search}</output><button onClick={() => navigate(-1)}>Voltar no histórico</button><AuditPage /></>;
}

it('não libera a página antiga em cache ao voltar no histórico durante uma nova tentativa', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const scope = ['audit', 'audit-criteria-session', 'unit'];
  const cached = { items: [event], page: 1, pageSize: 20, total: 21 };
  client.setQueryData([...scope, 1, '', '', ''], cached);
  vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Trilha restrita.', requestId: 'denied' }));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/auditoria?unitId=unit', '/app/auditoria?unitId=unit&page=2']} initialIndex={1}><HistoryHarness /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Seu acesso não permite consultar auditoria');
  await waitFor(() => expect(client.getQueryData([...scope, 'access-denial'])).not.toBeNull());

  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementation(async (_path, options) => {
    signal = options?.signal;
    return new Promise(resolve => { finish = value => resolve(value as never); });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' }));
  await waitFor(() => expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2'));
  await act(async () => {});
  expect(signal?.aborted).toBe(true);
  expect(client.getQueryData([...scope, 'access-denial'])).not.toBeNull();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('actor-outside-query')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);

  await act(async () => { finish({ ...cached, page: 2 }); });
  expect(client.getQueryData([...scope, 'access-denial'])).not.toBeNull();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  vi.mocked(api.get).mockResolvedValue(cached as never);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('cell', { name: 'actor-outside-query' })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(3);
  expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 1 }) }));
  expect(client.getQueryData([...scope, 'access-denial'])).toBeNull();
});

describe.each(['resposta', 'cache'] as const)('critérios conferidos na %s de auditoria', source => {
  it.each([
    ['ação diferente', 'action=DOCUMENT_VIEWED', event],
    ['antes do início', 'from=2026-10-12', event],
    ['após o final', 'to=2026-10-10', event],
    ['instante UTC pertencente ao dia anterior', 'from=2026-10-11&to=2026-10-11', { ...event, occurredAt: '2026-10-11T01:00:00Z' }],
    ['timestamp não verificável no período', 'from=2026-10-01', { ...event, occurredAt: 'inválido' }],
  ] as const)('oculta registros fora da consulta: %s', async (_description, query, item) => {
    show(source, query, item);
    expect(await screen.findByRole('alert')).toHaveTextContent('página inválida');
    expect(screen.queryByText('actor-outside-query')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    if (source === 'cache') expect(api.get).not.toHaveBeenCalled();
    else expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('aceita o instante UTC no período inclusivo de São Paulo', async () => {
    show(source, 'action=DOCUMENT_CREATED&from=2026-10-10&to=2026-10-10', { ...event, occurredAt: '2026-10-11T01:00:00Z' });
    expect(await screen.findByRole('cell', { name: 'actor-outside-query' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('mantém a indicação de timestamp inválido na consulta sem período', async () => {
    show(source, 'action=DOCUMENT_CREATED', { ...event, occurredAt: 'inválido' });
    expect(await screen.findByRole('cell', { name: 'Data inválida' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
