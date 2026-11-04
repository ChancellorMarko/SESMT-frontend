import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { NotificationDto } from '../../shared/contracts';
import { NotificationsPage } from './NotificationsPage';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'notice-retry-session', unitId: 'unit', can: (permission: string) => ['notifications.read', 'documents.read'].includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn() } }));

const notice: NotificationDto = { id: 'cached-notice', title: 'Aviso anterior à negativa', summary: 'Resumo anterior', type: 'DOCUMENT_DUE', resourceType: 'DOCUMENT', resourceId: 'document', createdAt: '2026-10-18T12:00:00Z' };
const scope = ['notifications', 'notice-retry-session', 'unit'];
const denialKey = [...scope, 'access-denial'];
const page = { items: [notice], page: 1, pageSize: 20, total: 1 };
let navigateTo: ReturnType<typeof useNavigate>;
function Harness() {
  navigateTo = useNavigate();
  const location = useLocation();
  return <><output aria-label="Endereço atual">{location.search}</output><NotificationsPage /></>;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('nova tentativa de notificações durante navegação', () => {
  it('mantém a negativa quando a tentativa cancelada retorna o resultado de outra consulta em cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const cachedKey = [...scope, '', 1];
    client.setQueryData(cachedKey, page);
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Consulta negada.', requestId: 'notice-denial' }));
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/notificacoes?unitId=unit']}><Harness /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();

    act(() => navigateTo('/app/notificacoes?unitId=unit&read=false'));
    await screen.findByRole('button', { name: 'Tentar novamente' });
    await waitFor(() => expect(client.getQueryData(denialKey)).not.toBeNull());
    expect(api.get).toHaveBeenCalledOnce();

    let retrySignal: AbortSignal | undefined;
    let aborted = false;
    vi.mocked(api.get).mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      retrySignal = options?.signal;
      retrySignal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Consulta cancelada.', 'AbortError')); }, { once: true });
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(retrySignal).toBeInstanceOf(AbortSignal));
    expect(api.get).toHaveBeenCalledTimes(2);
    act(() => navigateTo(-1));
    await waitFor(() => expect(aborted).toBe(true));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?unitId=unit');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('read=');
    expect(client.getQueryData(denialKey)).not.toBeNull();
    expect(client.getQueryState(cachedKey)?.dataUpdateCount).toBe(1);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Resumo da consulta')).not.toBeInTheDocument();
    expect(screen.queryByText(notice.title)).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);

    vi.mocked(api.get).mockResolvedValueOnce(page);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenLastCalledWith('/notifications', expect.objectContaining({ query: { unitId: 'unit', read: undefined, page: 1, pageSize: 20 }, signal: expect.any(AbortSignal) }));
    expect(client.getQueryData(denialKey)).toBeNull();
    expect(client.getQueryState(cachedKey)?.dataUpdateCount).toBe(2);
  });
});
