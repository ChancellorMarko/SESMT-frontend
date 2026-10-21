import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { HeaderNotifications } from './HeaderNotifications';

const state = vi.hoisted(() => ({ sessionKey: 'header-session', unitId: 'unit' as string | undefined, allowed: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: () => state.allowed }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

function show(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><HeaderNotifications /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { ...view, client, update: () => view.rerender(tree()) };
}
const page = (total = 3) => ({ items: total > 0 ? [{ id: 'notification' }] : [], page: 1, pageSize: 1, total });
beforeEach(() => {
  vi.clearAllMocks(); state.sessionKey = 'header-session'; state.unitId = 'unit'; state.allowed = true;
  vi.mocked(api.get).mockResolvedValue(page());
});

describe('notificações verificadas no cabeçalho', () => {
  it('consulta somente não lidas da unidade e expõe o total sem conteúdo das notificações', async () => {
    show();
    const link = screen.getByRole('link', { name: 'Abrir notificações' });
    await waitFor(() => expect(link).toHaveAccessibleDescription('3 notificações não lidas.'));
    expect(api.get).toHaveBeenCalledWith('/notifications', { query: { unitId: 'unit', page: 1, pageSize: 1, read: false }, signal: expect.any(AbortSignal) });
    expect(link).toHaveAttribute('href', '/app/notificacoes');
    expect(screen.queryByText('notification')).not.toBeInTheDocument();
  });

  it.each(['permission', 'unit'] as const)('não consulta ou mostra contagem sem %s', cause => {
    if (cause === 'permission') state.allowed = false; else state.unitId = undefined;
    show();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByText(/notificações não lidas/)).not.toBeInTheDocument();
    if (cause === 'permission') expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('oculta a contagem e não consulta quando a unidade tem recusa de acesso compartilhada', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['notifications', state.sessionKey, state.unitId, 'header-unread'], page());
    client.setQueryData(['notifications', state.sessionKey, state.unitId, 'access-denial'], { error: new Error('Acesso recusado'), revisions: {} });
    show(client);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Abrir notificações' })).not.toHaveAttribute('aria-describedby');
  });

  it.each([
    { ...page(), total: -1 },
    { ...page(), total: '3' },
    { ...page(), pageSize: 20 },
    { ...page(), items: [{ id: 'notification', readAt: '2026-10-17T12:00:00Z' }] },
  ])('não mostra contagem para resposta inválida ou já lida', async payload => {
    vi.mocked(api.get).mockResolvedValue(payload);
    const { client } = show();
    await waitFor(() => expect(client.getQueryState(['notifications', state.sessionKey, state.unitId, 'header-unread'])?.status).toBe('error'));
    expect(screen.getByRole('link', { name: 'Abrir notificações' })).not.toHaveAttribute('aria-describedby');
  });

  it('atualiza o badge quando marcar leitura invalida o prefixo das notificações', async () => {
    const { client } = show();
    const link = screen.getByRole('link', { name: 'Abrir notificações' });
    await waitFor(() => expect(link).toHaveAccessibleDescription('3 notificações não lidas.'));
    vi.mocked(api.get).mockResolvedValue(page(0));
    await act(async () => { await client.invalidateQueries({ queryKey: ['notifications', state.sessionKey, state.unitId] }); });
    await waitFor(() => expect(link).toHaveAccessibleDescription('Nenhuma notificação não lida.'));
  });

  it('remove a contagem anterior se uma atualização falhar', async () => {
    const { client } = show();
    const link = screen.getByRole('link', { name: 'Abrir notificações' });
    await waitFor(() => expect(link).toHaveAccessibleDescription('3 notificações não lidas.'));
    vi.mocked(api.get).mockRejectedValue(new Error('Indisponível'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['notifications', state.sessionKey, state.unitId] }); });
    await waitFor(() => expect(link).not.toHaveAttribute('aria-describedby'));
  });
});
