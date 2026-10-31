import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { DashboardPage } from './DashboardPage';

const session = vi.hoisted(() => ({ unitId: 'unit' as string | undefined, permissions: [] as string[] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({
  sessionKey: 'document-safe', unitId: session.unitId, can: (permission: string) => session.permissions.includes(permission),
}) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

function payload() {
  return { generatedAt: '2026-10-18T12:00:00Z', filters: { unitId: 'unit' },
    indicators: [{ code: 'DOCUMENTS_ACTIVE', label: 'Documentos vigentes', value: 3, formula: 'Contagem sintética', period: 'Todo o período', source: 'Teste', updatedAt: '2026-10-18T12:00:00Z' }],
    pendingItems: [{ id: 'pending', title: 'Pendência sintética visível', resourceType: 'DOCUMENT', resourceId: 'document', status: 'EXPIRED', dueDate: '2026-10-01' }],
  };
}
const key = ['dashboard', 'document-safe', 'unit', '', ''];
const denialKey = ['dashboard', 'document-safe', 'unit', 'access-denial'];
function show(client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/painel-documental']}><DashboardPage /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, update: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.clearAllMocks(); session.unitId = 'unit'; session.permissions = ['dashboard.read', 'documents.read'];
  vi.mocked(api.get).mockResolvedValue(payload() as never);
});

describe.each(['resposta', 'cache'] as const)('painel documental verifica %s', source => {
  it.each(['unidade', 'contador', 'data'] as const)('oculta dados e consultas quando a %s não corresponde ao contrato', async fault => {
    const data = payload();
    if (fault === 'unidade') data.filters.unitId = 'another-unit';
    if (fault === 'contador') data.indicators[0].value = -1;
    if (fault === 'data') data.pendingItems[0].dueDate = '2026-02-30';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    if (source === 'cache') client.setQueryData(key, data);
    vi.mocked(api.get).mockResolvedValue(data as never); show(client);
    expect(await screen.findByRole('alert')).toHaveTextContent('inválid');
    expect(screen.queryByText('Pendência sintética visível')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consultar documentos →' })).not.toBeInTheDocument();
    if (source === 'cache') expect(api.get).not.toHaveBeenCalled();
  });
});

it.each(['permissão', 'unidade'] as const)('não consulta nem mostra dados do cache sem %s', async reason => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(key, payload());
  if (reason === 'permissão') session.permissions = []; else session.unitId = undefined;
  show(client);
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByText('Pendência sintética visível')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('mantém os indicadores sem atalhos de documentos quando o perfil só pode consultar o painel', async () => {
  session.permissions = ['dashboard.read']; show();
  await screen.findByText('Pendência sintética visível');
  expect(screen.getByText('Documentos vigentes')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText('Consulta indisponível')).toBeInTheDocument();
});

it('não transforma indicador de vencimento sem janela fornecida em consulta genérica', async () => {
  const data = payload(); data.indicators[0].code = 'DOCUMENTS_EXPIRING'; data.indicators[0].label = 'A vencer em 30 dias';
  vi.mocked(api.get).mockResolvedValue(data as never); show();
  await screen.findByRole('heading', { name: 'A vencer' });
  fireEvent.click(screen.getByRole('button', { name: 'Mais informações: A vencer em 30 dias' }));
  expect(screen.getByRole('dialog', { name: 'A vencer em 30 dias' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Consultar documentos →' })).not.toBeInTheDocument();
  expect(screen.getByText('Consulta detalhada indisponível para este indicador.')).toBeInTheDocument();
});

it('uma tentativa cancelada após acesso negado não restaura o painel antigo ao limpar o período', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(key, payload());
  show(client); await screen.findByText('Pendência sintética visível');
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Detalhes internos omitidos', requestId: 'denied' }));
  fireEvent.change(screen.getByLabelText('Período inicial'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar período' }));
  await screen.findByRole('button', { name: 'Tentar novamente' });
  expect(screen.getByRole('alert')).not.toHaveTextContent('Detalhes internos omitidos');
  await waitFor(() => expect(client.getQueryData(denialKey)).not.toBeNull());
  let retrySignal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
    retrySignal = options?.signal;
    retrySignal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true });
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(retrySignal).toBeInstanceOf(AbortSignal));
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  await waitFor(() => expect(retrySignal?.aborted).toBe(true));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(client.getQueryData(denialKey)).not.toBeNull();
  expect(screen.queryByText('Pendência sintética visível')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Consultar documentos →' })).not.toBeInTheDocument();
  vi.mocked(api.get).mockResolvedValueOnce(payload() as never);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await screen.findByText('Pendência sintética visível');
  expect(client.getQueryData(denialKey)).toBeNull();
  expect(client.getQueryState(key)?.dataUpdateCount).toBe(2);
});
