import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { AppLayout } from '../../app/layouts/AppLayout';
import { ConsultationPage } from './ConsultationPage';

const session = vi.hoisted(() => ({ permissions: ['at.read'], unitId: 'unit-a', sessionKey: 'session-a' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.permissions.includes(permission), logout: vi.fn(), setUnitId: vi.fn() }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
function Probe() { return <output aria-label="Endereço atual">{useLocation().search}</output>; }
function show(path = '/app/consulta', shell = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{shell ? <Routes><Route path="/app" element={<AppLayout />}><Route path="consulta" element={<><ConsultationPage /><Probe /></>} /></Route></Routes> : <><ConsultationPage /><Probe /></>}</MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return () => view.rerender(tree());
}
beforeEach(() => {
  vi.clearAllMocks(); session.permissions = ['at.read']; session.unitId = 'unit-a'; session.sessionKey = 'session-a';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.mocked(api.get).mockImplementation(async (path, options) => path === '/permit-options' ? { teams: [], services: [] } as never : { items: [], total: 0, page: Number(options?.query?.page || 1), pageSize: 10 } as never);
});

describe('acesso e contexto das quatro consultas', () => {
  it.each([
    ['at.read', 'ats', '/work-authorizations', 'Nenhuma AT encontrada'],
    ['pet.read', 'pets', '/confined-space-permits', 'Nenhuma PET encontrada'],
    ['permits.read', 'permits', '/work-permits', 'Nenhuma PT disponível'],
  ])('permite entrar pelo menu só com %s e consulta apenas o recurso próprio', async (permission, tab, path, empty) => {
    session.permissions = [permission]; show('/app/consulta', true);
    expect(await screen.findByRole('heading', { name: empty })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    expect(within(screen.getByRole('dialog', { name: 'Navegação' })).getByRole('link', { name: 'Consulta central' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`tab=${tab}&unitId=unit-a`);
    const paths = vi.mocked(api.get).mock.calls.map(([resource]) => resource);
    expect(paths).toContain(path);
    expect(paths.every(resource => resource === path || tab === 'permits' && resource === '/permit-options')).toBe(true);
  });
  it('descarta filtros de uma aba sem acesso antes de consultar o recurso autorizado', async () => {
    session.permissions = ['pet.read']; show('/app/consulta?tab=ats&status=CANCELED&q=restrito&page=4');
    await screen.findByRole('heading', { name: 'Nenhuma PET encontrada' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?tab=pets&unitId=unit-a');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/confined-space-permits', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: undefined }) }));
  });
  it('conecta as quatro abas e reinicia os filtros incompatíveis ao navegar pelo teclado', async () => {
    session.permissions = ['documents.read', 'permits.read', 'at.read', 'pet.read'];
    const user = userEvent.setup(); show('/app/consulta?tab=ats&unitId=unit-a&status=CANCELED&page=3&q=AT');
    await screen.findByRole('heading', { name: 'Nenhuma AT encontrada' });
    const at = screen.getByRole('tab', { name: 'Autorizações de trabalho (ATs)' }), pet = screen.getByRole('tab', { name: 'PETs de espaços confinados' });
    at.focus(); await user.keyboard('{ArrowRight}');
    expect(pet).toHaveFocus(); expect(pet).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', pet.id);
    await screen.findByRole('heading', { name: 'Nenhuma PET encontrada' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?tab=pets&unitId=unit-a');
    await user.keyboard('{Home}'); expect(screen.getByRole('tab', { name: 'Documentos controlados' })).toHaveFocus();
    await user.keyboard('{End}'); expect(pet).toHaveFocus();
    await user.keyboard('{ArrowRight}'); expect(screen.getByRole('tab', { name: 'Documentos controlados' })).toHaveFocus();
  });
  it.each(['tab=other', 'tab=ats&tab=pets', 'tab=ats&unitId=unit-a&unitId=unit-b'])('suspende consulta com contexto inválido (%s) e permite reiniciar', async criteria => {
    const user = userEvent.setup(); show(`/app/consulta?${criteria}`);
    expect(screen.getByRole('alert')).toHaveTextContent('aba ou unidade inválida ou repetida');
    expect(api.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reiniciar consulta' }));
    await screen.findByRole('heading', { name: 'Nenhuma AT encontrada' });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
  it('espera normalizar a unidade antes de consultar e remove a página da unidade anterior', async () => {
    const rerender = show('/app/consulta?tab=ats&unitId=unit-a&page=2&q=Manutencao');
    await screen.findByRole('heading', { name: 'Nenhuma AT encontrada' });
    session.unitId = 'unit-b'; rerender();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/work-authorizations', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b', page: 1, q: 'Manutencao' }) })));
    expect(vi.mocked(api.get).mock.calls.some(([, options]) => options?.query?.unitId === 'unit-b' && options.query.page === 2)).toBe(false);
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  });
  it('não reutiliza a consulta quando o recurso perde a permissão', async () => {
    const rerender = show('/app/consulta?tab=ats&unitId=unit-a');
    await screen.findByRole('heading', { name: 'Nenhuma AT encontrada' });
    const count = vi.mocked(api.get).mock.calls.length;
    session.permissions = []; rerender();
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(count);
  });
});
