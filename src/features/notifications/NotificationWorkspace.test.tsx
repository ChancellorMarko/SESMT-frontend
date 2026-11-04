import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { NotificationDto } from '../../shared/contracts';
import { NotificationsPage } from './NotificationsPage';

const session = vi.hoisted(() => ({
  sessionKey: 'notification-workspace', unitId: 'unit-a',
  permissions: ['notifications.read', 'documents.read'],
}));
vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({ ...session, can: (permission: string) => session.permissions.includes(permission) }),
}));
vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), patch: vi.fn() },
}));

const notice: NotificationDto = {
  id: 'notice-unread', title: 'Revisar documento da equipe', summary: 'A conferência do registro está pendente.',
  type: 'DOCUMENT_DUE', resourceType: 'DOCUMENT', resourceId: 'document-a',
  createdAt: '2026-10-18T09:00:00Z', dueDate: '2026-10-20',
};
const readNotice: NotificationDto = {
  ...notice, id: 'notice-read', title: 'Prazo de documento acompanhado', resourceId: 'document-b',
  readAt: '2026-10-18T10:00:00Z',
};

function Location() {
  const location = useLocation();
  return <output aria-label="Endereço atual">{location.pathname}{location.search}</output>;
}
function show(search = '?unitId=unit-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/notificacoes${search}`]}>
    <Location /><Routes>
      <Route path="/app/notificacoes" element={<NotificationsPage />} />
      <Route path="/app/documentos/:id" element={<h1>Consulta do documento</h1>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()) };
}
function currentCriteria() {
  return new URL(screen.getByLabelText('Endereço atual').textContent!, 'https://ampara.test').searchParams;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.sessionKey = 'notification-workspace'; session.unitId = 'unit-a';
  session.permissions = ['notifications.read', 'documents.read'];
  vi.mocked(api.get).mockImplementation(async (_path, options) => {
    const read = options?.query?.read;
    return { items: read === false ? [notice] : read === true ? [readNotice] : [notice, readNotice], page: options?.query?.page, pageSize: 20, total: read === undefined ? 41 : 21 } as never;
  });
  vi.mocked(api.patch).mockResolvedValue({ ...notice, readAt: '2026-10-18T10:00:00Z' });
});

describe('notificações como área de acompanhamento', () => {
  it.each([['false', 'Não lidas'], ['true', 'Lidas']])('remove Leitura=%s da segunda página preservando unidade e devolvendo foco ao seletor', async (read, label) => {
    const user = userEvent.setup();
    show(`?unitId=unit-a&read=${read}&page=2`);
    await screen.findByRole('region', { name: 'Lista de notificações' });
    const applied = screen.getByRole('group', { name: 'Filtros aplicados' });
    const remove = within(applied).getByRole('button', { name: 'Remover filtro: Leitura' });
    expect(remove).toHaveTextContent(label);
    await user.click(remove);
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/notifications', expect.objectContaining({
      query: { unitId: 'unit-a', page: 1, pageSize: 20, read: undefined }, signal: expect.any(AbortSignal),
    })));
    expect([...currentCriteria()]).toEqual([['unitId', 'unit-a']]);
    expect(screen.getByRole('combobox', { name: 'Leitura' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Leitura' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Remover filtro: Leitura' })).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('filtra por leitura sem registrar leitura nem oferecer uma busca sem suporte na API', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('article', { name: notice.title });
    expect(screen.queryByRole('button', { name: 'Remover filtro: Leitura' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leitura' }), 'true');
    await waitFor(() => expect(screen.queryByRole('article', { name: notice.title })).not.toBeInTheDocument());
    expect(screen.getByRole('article', { name: readNotice.title })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remover filtro: Leitura' })).toHaveTextContent('Lidas');
    expect(api.get).toHaveBeenLastCalledWith('/notifications', expect.objectContaining({
      query: { unitId: 'unit-a', page: 1, pageSize: 20, read: true },
    }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.queryByText(`Leitura registrada: ${notice.title}. A pendência do registro continua sendo acompanhada.`)).not.toBeInTheDocument();
  });

  it('atualiza somente a consulta atual sem mudar leitura, página ou unidade', async () => {
    const user = userEvent.setup();
    show('?read=false&page=2&unitId=unit-a');
    await screen.findByRole('article', { name: notice.title });
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.get).toHaveBeenLastCalledWith('/notifications', expect.objectContaining({
      query: { unitId: 'unit-a', page: 2, pageSize: 20, read: false }, signal: expect.any(AbortSignal),
    }));
    expect([...currentCriteria()]).toEqual([['read', 'false'], ['page', '2'], ['unitId', 'unit-a']]);
    expect(screen.getByRole('combobox', { name: 'Leitura' })).toHaveValue('false');
    expect(screen.getByRole('button', { name: 'Remover filtro: Leitura' })).toHaveTextContent('Não lidas');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('distingue o total da consulta da quantidade exibida nesta página', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('article', { name: notice.title });
    const summary = screen.getByLabelText('Resumo da consulta');
    expect(within(summary).getByText('Na consulta')).toBeVisible();
    expect(within(summary).getByText('Nesta página')).toBeVisible();
    expect(within(summary).getByText('41')).toBeVisible();
    expect(within(summary).getByText('2')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Lista de notificações' })).getAllByRole('article')).toHaveLength(2);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Leitura' }), 'false');
    await waitFor(() => expect(within(screen.getByLabelText('Resumo da consulta')).getByText('21')).toBeVisible());
    expect(within(screen.getByLabelText('Resumo da consulta')).getByText('1')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Lista de notificações' })).getAllByRole('article')).toHaveLength(1);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('devolve o foco ao seletor quando a marcação explícita remove o aviso da consulta de não lidas', async () => {
    const user = userEvent.setup();
    let marked = false;
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({
      items: marked ? [] : [notice], page: options?.query?.page, pageSize: 20, total: marked ? 0 : 1,
    }) as never);
    vi.mocked(api.patch).mockImplementation(async () => {
      marked = true;
      return { ...notice, readAt: '2026-10-18T10:00:00Z' } as never;
    });
    show('?unitId=unit-a&read=false');
    await user.click(await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` }));
    expect(await screen.findByText(/Leitura registrada:/)).toHaveTextContent('A pendência do registro continua sendo acompanhada.');
    await waitFor(() => expect(screen.queryByRole('article', { name: notice.title })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Leitura' })).toHaveFocus());
    expect(screen.getByRole('combobox', { name: 'Leitura' })).toHaveValue('false');
    expect([...currentCriteria()]).toEqual([['unitId', 'unit-a'], ['read', 'false']]);
    expect(api.patch).toHaveBeenCalledOnce();
    expect(api.patch).toHaveBeenCalledWith('/notifications/notice-unread/read', {}, {
      query: { unitId: 'unit-a' }, signal: expect.any(AbortSignal),
    });
  });

  it('abre o registro sem marcar o aviso como lido nem afirmar que a pendência foi resolvida', async () => {
    const user = userEvent.setup();
    show('?unitId=unit-a&read=false&page=2');
    const article = await screen.findByRole('article', { name: notice.title });
    expect(within(article).getByRole('button', { name: `Marcar como lida: ${notice.title}` })).toBeEnabled();
    await user.click(within(article).getByRole('link', { name: 'Abrir registro →' }));
    expect(await screen.findByRole('heading', { name: 'Consulta do documento' })).toBeVisible();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('/app/documentos/document-a');
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Leitura registrada:/)).not.toBeInTheDocument();
  });

  it.each([
    ['DOCUMENT', 'documents.read', '/app/documentos/document-a'],
    ['WORKER', 'workers.read', '/app/trabalhadores/document-a'],
    ['WORK_PERMIT', 'permits.read', '/app/pts/document-a'],
    ['APPOINTMENT', 'appointments.read', '/app/agenda/document-a'],
  ])('expõe o destino %s apenas quando a permissão do recurso está presente', async (resourceType, permission, href) => {
    session.permissions = ['notifications.read'];
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({
      items: [{ ...notice, resourceType }], page: options?.query?.page, pageSize: 20, total: 1,
    }) as never);
    const view = show();
    const article = await screen.findByRole('article', { name: notice.title });
    expect(within(article).queryByRole('link')).not.toBeInTheDocument();
    expect(within(article).getByRole('button', { name: `Marcar como lida: ${notice.title}` })).toBeEnabled();
    session.permissions.push(permission); view.update();
    expect(within(screen.getByRole('article', { name: notice.title })).getByRole('link', { name: 'Abrir registro →' })).toHaveAttribute('href', href);
    session.permissions = ['notifications.read']; view.update();
    expect(within(screen.getByRole('article', { name: notice.title })).queryByRole('link')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
