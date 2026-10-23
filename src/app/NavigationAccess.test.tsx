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
    { query: 'PT', name: 'Permissões de trabalho', to: '/app/pts', permission: 'permits.read' },
    { query: 'AT', name: 'Autorizações de trabalho', to: '/app/ats', permission: 'at.read' },
    { query: 'PET', name: 'Permissões de entrada e trabalho (PET)', to: '/app/pets', permission: 'pet.read' },
  ])('encontra $name pela sigla $query sem expor o módulo quando a permissão é retirada', async ({ query, name, to, permission }) => {
    session.permissions = ['documents.read', permission];
    const view = show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const menu = within(screen.getByRole('dialog', { name: 'Navegação' }));
    fireEvent.change(menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }), { target: { value: query } });
    expect(menu.getByRole('link', { name })).toHaveAttribute('href', to);

    session.permissions = ['documents.read'];
    view.update();
    expect(menu.queryByRole('link', { name })).not.toBeInTheDocument();
  });

  it('foca a busca ao abrir pelo atalho e devolve o foco ao fechar', async () => {
    session.permissions = ['documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    const trigger = screen.getByRole('button', { name: 'Buscar módulos' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'k', ctrlKey: true });
    const search = within(screen.getByRole('dialog', { name: 'Navegação' })).getByRole('textbox', { name: 'Buscar módulos de navegação' });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('permite limpar uma busca sem resultados e continuar digitando no mesmo campo', async () => {
    session.permissions = ['documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const menu = within(screen.getByRole('dialog', { name: 'Navegação' }));
    const search = menu.getByRole('textbox', { name: 'Buscar módulos de navegação' });
    fireEvent.change(search, { target: { value: 'modulo inexistente' } });
    expect(menu.getByText('Nenhum módulo encontrado. Tente outro termo.')).toBeInTheDocument();
    const clear = menu.getByRole('button', { name: 'Limpar busca' });
    clear.focus();
    fireEvent.click(clear);
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(menu.getByRole('link', { name: 'Documentos' })).toBeInTheDocument();
    expect(menu.queryByText('Nenhum módulo encontrado. Tente outro termo.')).not.toBeInTheDocument();
  });

  it('mantém o Guia como único diálogo ao usar o atalho de busca dentro dele', async () => {
    session.permissions = ['documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Guia Ampara' }));
    const guide = screen.getByRole('dialog', { name: 'Guia Ampara' });
    expect(guide).toHaveFocus();
    fireEvent.keyDown(guide, { key: 'k', ctrlKey: true });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).not.toBeInTheDocument();
    expect(guide).toHaveFocus();
  });

  it('indica somente proteção individual como página atual no menu ao abrir essa área', async () => {
    session.permissions = ['dashboard.read', 'appointments.read'];
    show('/app/dashboard?area=epis');
    await screen.findByRole('heading', { name: 'Painel operacional de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const menu = within(screen.getByRole('dialog', { name: 'Navegação' }));
    expect(menu.getByRole('link', { name: 'Visão geral' })).not.toHaveAttribute('aria-current');
    expect(menu.getByRole('link', { name: 'Proteção individual' })).toHaveAttribute('aria-current', 'page');
    expect(menu.getByRole('link', { name: 'Saúde ocupacional' })).not.toHaveAttribute('aria-current');
  });

  it.each([
    { query: 'inspeção segurança', name: 'Inspeções de segurança', to: '/app/dashboard?area=inspecoes' },
    { query: 'renovar ASO', name: 'Saúde ocupacional', to: '/app/dashboard?area=saude&healthView=asos' },
    { query: 'atestado', name: 'Saúde ocupacional', to: '/app/dashboard?area=saude&healthView=asos' },
    { query: 'certificados NR', name: 'Capacitações', to: '/app/dashboard?area=saude&healthView=nrs' },
    { query: 'normas regulamentadoras', name: 'Capacitações', to: '/app/dashboard?area=saude&healthView=nrs' },
    { query: 'capacetes', name: 'Proteção individual', to: '/app/dashboard?area=epis' },
    { query: 'protecao individual', name: 'Proteção individual', to: '/app/dashboard?area=epis' },
  ])('encontra $name na busca por $query sem perder o destino específico', async ({ query, name, to }) => {
    session.permissions = ['dashboard.read', 'appointments.read'];
    show('/app/dashboard');
    await screen.findByRole('heading', { name: 'Painel operacional de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const menu = within(screen.getByRole('dialog', { name: 'Navegação' }));
    fireEvent.change(menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }), { target: { value: query } });
    const destination = menu.getByRole('link', { name });
    expect(destination).toHaveAttribute('href', to);
    fireEvent.click(destination);
    expect(screen.getByTestId('location')).toHaveTextContent(to);
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).not.toBeInTheDocument();
  });

  it('não expõe áreas operacionais na busca sem a permissão do painel', async () => {
    session.permissions = ['documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const menu = within(screen.getByRole('dialog', { name: 'Navegação' }));
    fireEvent.change(menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }), { target: { value: 'ASO' } });
    expect(menu.queryByRole('navigation', { name: 'Áreas de prevenção' })).not.toBeInTheDocument();
    expect(menu.getByText('Nenhum módulo encontrado. Tente outro termo.')).toBeInTheDocument();
  });
  it('indica a visão geral como destino ativo quando a área da URL não existe', async () => {
    session.permissions = ['dashboard.read', 'appointments.read'];
    show('/app/dashboard?area=desconhecida');
    await screen.findByRole('heading', { name: 'Painel operacional de teste' });
    const shortcuts = within(screen.getByRole('navigation', { name: 'Acesso rápido' }));
    expect(shortcuts.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(shortcuts.getByRole('link', { name: 'Inspeções' })).not.toHaveAttribute('aria-current');
  });

  it('abre o guia pelo menu e devolve o foco sem deixar modais sobrepostos', async () => {
    session.permissions = ['documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    const menuTrigger = screen.getByRole('button', { name: 'Abrir navegação' });
    menuTrigger.focus(); fireEvent.click(menuTrigger);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Navegação' })).getByRole('button', { name: 'Guia Ampara' }));
    const guide = screen.getByRole('dialog', { name: 'Guia Ampara' });
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).not.toBeInTheDocument();
    expect(guide).toHaveFocus();
    expect(within(guide).getByRole('link', { name: /Encontrar um documento/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(menuTrigger).toHaveFocus();
  });

  it.each([
    { source: 'menu', triggerName: 'Abrir navegação', dialogName: 'Navegação', actionName: 'Guia de siglas' },
    { source: 'Guia Ampara', triggerName: 'Abrir Guia Ampara', dialogName: 'Guia Ampara', actionName: /Entender as siglas/ },
  ])('abre as explicações de siglas pelo $source sem sobrepor diálogos', async ({ triggerName, dialogName, actionName }) => {
    session.permissions = ['documents.read'];
    show('/app/documentos');
    await screen.findByRole('heading', { name: 'Documentos de teste' });
    const trigger = screen.getByRole('button', { name: triggerName });
    trigger.focus(); fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole('dialog', { name: dialogName })).getByRole('button', { name: actionName }));
    const terminology = screen.getByRole('dialog', { name: 'Guia de siglas' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument();
    await waitFor(() => expect(within(terminology).getByRole('searchbox', { name: 'Buscar sigla ou significado' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

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
    for (const label of ['Dashboard', 'Inspeções', 'Saúde e capacitações', 'Equipamentos de proteção individual (EPI)']) expect(dock.queryByRole('link', { name: label })).not.toBeInTheDocument();
    expect(dock.getByRole('button', { name: 'Abrir navegação' })).toBeInTheDocument();

    session.permissions = ['dashboard.read', 'appointments.read'];
    view.update();
    for (const label of ['Dashboard', 'Inspeções', 'Saúde e capacitações', 'Equipamentos de proteção individual (EPI)']) expect(dock.getByRole('link', { name: label })).toBeInTheDocument();
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
