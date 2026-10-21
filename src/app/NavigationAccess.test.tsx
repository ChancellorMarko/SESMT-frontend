import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('../shared/auth/SessionProvider', () => ({ useSession: () => ({
  sessionKey: 'navigation-session', unitId: 'unit', status: 'authenticated',
  me: { user: { displayName: 'Marina Demo' }, roles: [], scope: { unitIds: ['unit'] } },
  can: (permission: string) => session.permissions.includes(permission),
}) }));
vi.mock('../features/auth/AuthPages', () => ({ LoginPage: () => null, RecoveryPage: () => null, ResetPasswordPage: () => null }));
vi.mock('../features/dashboard', () => ({ DashboardPage: () => <h1>Painel documental de teste</h1> }));
vi.mock('../features/dashboard/OperationsDashboardPage', () => ({ OperationsDashboardPage: () => <h1>Painel operacional de teste</h1> }));
vi.mock('../features/agenda', () => ({ AgendaPage: () => <h1>Agenda de teste</h1> }));
vi.mock('../features/documents', () => ({ DocumentsPage: () => <h1>Documentos de teste</h1> }));
vi.mock('../features/notifications', () => ({ NotificationsPage: () => <h1>Notificações de teste</h1> }));
vi.mock('./layouts/HeaderNotifications', () => ({ HeaderNotifications: () => null }));

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function show(path = '/app') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /><Location /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  session.permissions = [];
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('navegação inicial conforme permissões independentes', () => {
  it.each([
    { permissions: ['dashboard.read', 'appointments.read'], path: '/app/dashboard', heading: 'Painel operacional de teste' },
    { permissions: ['dashboard.read'], path: '/app/painel-documental', heading: 'Painel documental de teste' },
    { permissions: ['dashboard.read', 'documents.read'], path: '/app/painel-documental', heading: 'Painel documental de teste' },
    { permissions: ['appointments.read'], path: '/app/agenda', heading: 'Agenda de teste' },
    { permissions: ['documents.read'], path: '/app/documentos', heading: 'Documentos de teste' },
    { permissions: ['documents.read', 'appointments.read'], path: '/app/documentos', heading: 'Documentos de teste' },
    { permissions: ['notifications.read'], path: '/app/notificacoes', heading: 'Notificações de teste' },
  ])('abre $path com $permissions', async ({ permissions, path, heading }) => {
    session.permissions = permissions;
    show();
    await screen.findByRole('heading', { name: heading });
    expect(screen.getByTestId('location')).toHaveTextContent(path);
    expect(screen.queryByText('Esta área precisa de autorização.')).not.toBeInTheDocument();
  });

  it.each([
    { permissions: ['dashboard.read'], path: '/app/painel-documental', heading: 'Painel documental de teste' },
    { permissions: ['dashboard.read', 'appointments.read'], path: '/app/dashboard', heading: 'Painel operacional de teste' },
  ])('faz Visão geral abrir $path sem perder a navegação dos módulos', async ({ permissions, path, heading }) => {
    session.permissions = [...permissions, 'documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const overview = within(screen.getByRole('navigation', { name: 'Menu principal' })).getByRole('link', { name: 'Visão geral' });
    expect(overview).toHaveAttribute('href', path);
    fireEvent.click(overview);
    await screen.findByRole('heading', { name: heading });
    expect(screen.getByTestId('location')).toHaveTextContent(path);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navegação' })).not.toBeInTheDocument());
  });

  it('oferece somente relatórios no dock para quem tem acesso documental ao painel', async () => {
    session.permissions = ['dashboard.read'];
    const view = show();
    await screen.findByRole('heading', { name: 'Painel documental de teste' });
    const dock = within(screen.getByRole('navigation', { name: 'Acesso rápido' }));
    expect(dock.getByRole('link', { name: 'Relatórios' })).toHaveAttribute('href', '/app/painel-documental');
    for (const label of ['Dashboard', 'Inspeções', 'ASOs e NRs', 'EPIs']) expect(dock.queryByRole('link', { name: label })).not.toBeInTheDocument();
    expect(dock.getByRole('button', { name: 'Abrir navegação' })).toBeInTheDocument();

    session.permissions = ['dashboard.read', 'appointments.read'];
    view.update();
    for (const label of ['Dashboard', 'Inspeções', 'ASOs e NRs', 'EPIs']) expect(dock.getByRole('link', { name: label })).toBeInTheDocument();
    expect(dock.getAllByRole('link')).toHaveLength(5);

    session.permissions = ['dashboard.read'];
    view.update();
    expect(dock.getAllByRole('link')).toHaveLength(1);
    expect(dock.getByRole('link', { name: 'Relatórios' })).toHaveAttribute('aria-current', 'page');
  });

  it('mantém o menu e a agenda disponíveis sem oferecer painéis sem dashboard.read', async () => {
    session.permissions = ['appointments.read'];
    show();
    await screen.findByRole('heading', { name: 'Agenda de teste' });
    const dock = within(screen.getByRole('navigation', { name: 'Acesso rápido' }));
    expect(dock.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(dock.getByRole('button', { name: 'Abrir navegação' }));
    const modules = within(screen.getByRole('navigation', { name: 'Menu principal' }));
    expect(modules.getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', '/app/agenda');
    expect(modules.queryByRole('link', { name: 'Visão geral' })).not.toBeInTheDocument();
  });
});
