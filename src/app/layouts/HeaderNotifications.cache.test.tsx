import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { HeaderNotifications } from './HeaderNotifications';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'header-cache-session', unitId: 'unit', can: () => true }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

const queryKey = ['notifications', 'header-cache-session', 'unit', 'header-unread'];
const valid = { items: [{ id: 'notice', title: 'Conteúdo não exposto pelo cabeçalho' }], page: 1, pageSize: 1, total: 3 };
function show(payload: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKey, payload);
  render(<QueryClientProvider client={client}><MemoryRouter><HeaderNotifications /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.clearAllMocks(); });

describe('contagem do cabeçalho proveniente do cache', () => {
  it.each([
    { ...valid, items: null },
    { ...valid, items: 'cached text' },
    { ...valid, items: [{ id: 'notice', readAt: '2026-10-18T12:00:00Z' }] },
    { ...valid, items: [{ id: 'invalid/id' }] },
    { ...valid, page: 2 },
    { ...valid, pageSize: 20 },
    { ...valid, total: -1 },
  ])('oculta total de página inválida mesmo quando o cache está fresco', payload => {
    show(payload);
    expect(screen.getByRole('link', { name: 'Abrir notificações' })).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('revalida mudanças no cache sem expor conteúdo nem iniciar outra consulta', async () => {
    const client = show(valid);
    const link = screen.getByRole('link', { name: 'Abrir notificações' });
    expect(link).toHaveAccessibleDescription('3 notificações não lidas.');
    expect(screen.queryByText(valid.items[0].title)).not.toBeInTheDocument();
    await act(async () => { client.setQueryData(queryKey, { ...valid, items: null }); });
    await waitFor(() => expect(link).not.toHaveAttribute('aria-describedby'));
    await act(async () => { client.setQueryData(queryKey, { ...valid, total: 1 }); });
    await waitFor(() => expect(link).toHaveAccessibleDescription('1 notificação não lida.'));
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
