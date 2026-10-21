import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { NotificationDto } from '../../shared/contracts';
import { NotificationsPage } from './NotificationsPage';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'notice-cache-session', unitId: 'unit', can: (permission: string) => ['notifications.read', 'documents.read'].includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn() } }));

const notice: NotificationDto = { id: 'notice', title: 'Aviso validado', summary: 'Resumo validado', type: 'DOCUMENT_DUE', resourceType: 'DOCUMENT', resourceId: 'document', createdAt: '2026-10-18T12:00:00Z' };
const queryKey = (read = '', page = 1) => ['notifications', 'notice-cache-session', 'unit', read, page];
const payload = (item: unknown = notice, page = 1) => ({ items: [item], page, pageSize: 20, total: page === 1 ? 1 : 21 });
function clientWithCached(value: unknown, read = '', page = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKey(read, page), value);
  return client;
}
let navigateTo: ReturnType<typeof useNavigate>;
function Harness() {
  const location = useLocation(); navigateTo = useNavigate();
  return <><output aria-label="Endereço da consulta">{location.search}</output><NotificationsPage /></>;
}
function show(client: QueryClient, search = '?unitId=unit') {
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/notificacoes${search}`]}><Harness /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_path, options) => payload(options?.query?.read === true ? { ...notice, readAt: '2026-10-18T13:00:00Z' } : notice, Number(options?.query?.page)) as never);
});

describe('cache verificado antes de exibir notificações', () => {
  it('bloqueia lista corrompida fresca sem consultar e recupera somente após nova tentativa', async () => {
    const client = clientWithCached({ ...payload(), items: null });
    show(client);
    expect(await screen.findByText('A consulta retornou uma página inválida. Tente novamente.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText(notice.title)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('não entrega título não textual ao React nem expõe outros campos de um aviso inválido', async () => {
    const secret = 'Resumo que não pode aparecer';
    const client = clientWithCached(payload({ ...notice, title: { text: 'Objeto indevido' }, summary: secret }));
    show(client);
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.queryByText('Objeto indevido')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([
    { read: 'true', item: notice },
    { read: 'false', item: { ...notice, readAt: '2026-10-18T13:00:00Z' } },
  ])('recusa aviso do cache incompatível com o filtro read=$read', async ({ read, item }) => {
    const client = clientWithCached(payload(item), read);
    show(client, `?unitId=unit&read=${read}`);
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Leitura')).toHaveValue(read);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText(notice.title)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar como lida:/ })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('mantém a negativa ao navegar ou remontar uma página válida do cache até revalidar com a API', async () => {
    const client = clientWithCached({ ...payload(), items: null });
    const otherNotice = { ...notice, id: 'other-notice', title: 'Aviso de outra página' };
    client.setQueryData(queryKey('', 2), payload(otherNotice, 2));
    const view = show(client);
    await screen.findByRole('button', { name: 'Tentar novamente' });
    await waitFor(() => expect(client.getQueryData(['notifications', 'notice-cache-session', 'unit', 'access-denial'])).not.toBeNull());
    act(() => navigateTo('/app/notificacoes?unitId=unit&page=2'));
    await waitFor(() => expect(screen.getByLabelText('Endereço da consulta')).toHaveTextContent('page=2'));
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText(otherNotice.title)).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    view.unmount();
    show(client, '?unitId=unit&page=2');
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    vi.mocked(api.get).mockResolvedValueOnce(payload(otherNotice, 2));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: otherNotice.title })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledOnce();
  });
});
