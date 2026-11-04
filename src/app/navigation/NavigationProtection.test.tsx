import { createContext, useContext, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { NavigationProtection, useNavigationGuard, useProtectedLogout } from './NavigationProtection';

type GuardConfiguration = {
  contextKey: string;
  dirty: boolean;
  busy: boolean;
  secondGuard: boolean;
  secondDirty: boolean;
  secondBusy: boolean;
};
type Entry = string | { pathname: string; search?: string; hash?: string; state?: unknown };

const defaults: GuardConfiguration = {
  contextKey: 'session-a:unit-a', dirty: true, busy: false,
  secondGuard: false, secondDirty: false, secondBusy: false,
};
const Configuration = createContext(defaults);
const previous = { pathname: '/before', search: '?page=3&q=Jo%C3%A3o', hash: '#lista', state: { origin: 'workers', nested: { page: 3 } } };
const current = { pathname: '/form', search: '?mode=edit', hash: '#cadastro', state: { returnTo: '/before?page=3', unitId: 'unit-a' } };
const next = { pathname: '/after', search: '?view=calendar&day=2026-10-19', hash: '#agenda', state: { calendarMode: 'week' } };

function ExtraGuard() {
  const configuration = useContext(Configuration);
  useNavigationGuard({ dirty: configuration.secondDirty, busy: configuration.secondBusy });
  return <p>Segundo formulário aberto</p>;
}

function Form() {
  const configuration = useContext(Configuration);
  const [draft, setDraft] = useState('Nome ainda não salvo');
  useNavigationGuard({ dirty: configuration.dirty, busy: configuration.busy });
  return <>
    <h1>Cadastro em preenchimento</h1>
    <label>Nome<input value={draft} onChange={event => setDraft(event.target.value)} /></label>
    {configuration.secondGuard && <ExtraGuard />}
  </>;
}

function Controls({ logout }: { logout: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const protectedLogout = useProtectedLogout();
  return <nav aria-label="Controles do teste">
    <button onClick={() => navigate(-1)}>Voltar no histórico</button>
    <button onClick={() => navigate(1)}>Avançar no histórico</button>
    <Link to="/saved?result=ok#resumo" state={{ saved: true }}>Salvar e avançar</Link>
    <button onClick={() => navigate('/saved?result=ok#resumo', { replace: true, state: { saved: true } })}>Salvar substituindo rota</button>
    <Link to={{ pathname: location.pathname, search: location.search, hash: '#detalhes' }}>Ir à seção</Link>
    <button onClick={() => protectedLogout(logout)}>Sair da plataforma</button>
  </nav>;
}

function Shell({ logout }: { logout: () => void }) {
  const configuration = useContext(Configuration);
  const location = useLocation();
  return <NavigationProtection contextKey={configuration.contextKey}>
    <Controls logout={logout} />
    <Outlet />
    <output aria-label="Localização atual">{JSON.stringify({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state })}</output>
  </NavigationProtection>;
}

function show(overrides: Partial<GuardConfiguration> = {}, entries: Entry[] = [previous, current, next], initialIndex = 1) {
  let configuration = { ...defaults, ...overrides };
  const logout = vi.fn();
  const router = createMemoryRouter([{
    element: <Shell logout={logout} />,
    children: [
      { path: '/form', element: <Form /> },
      { path: '*', element: <h1>Destino de navegação</h1> },
    ],
  }], { initialEntries: entries, initialIndex });
  const tree = () => <Configuration.Provider value={configuration}><RouterProvider router={router} /></Configuration.Provider>;
  const view = render(tree());
  return {
    router, logout,
    update: (changes: Partial<GuardConfiguration>) => {
      configuration = { ...configuration, ...changes };
      view.rerender(tree());
    },
  };
}

function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function dialog() { return screen.getByRole('dialog', { name: 'Alterações não salvas' }); }

describe('proteção compartilhada do histórico e da saída da plataforma', () => {
  it('mantém os hooks utilizáveis fora do provider sem bloquear a ação', () => {
    const logout = vi.fn();
    function Standalone() {
      useNavigationGuard({ dirty: true, busy: true });
      const protectedLogout = useProtectedLogout();
      return <button onClick={() => protectedLogout(logout)}>Sair sem provider</button>;
    }
    render(<Standalone />);
    click('Sair sem provider');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('permite histórico e logout imediatamente quando não há alteração ou envio', async () => {
    const { logout } = show({ dirty: false });
    click('Sair da plataforma');
    expect(logout).toHaveBeenCalledTimes(1);
    click('Voltar no histórico');
    await screen.findByRole('heading', { name: 'Destino de navegação' });
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(previous));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancela o voltar mantendo o texto digitado e o contexto exato do formulário', async () => {
    show();
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome' }), { target: { value: 'Preenchimento preservado' } });
    click('Voltar no histórico');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(current));
    click('Continuar preenchendo');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('Preenchimento preservado');
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(current));
  });

  it('confirma o voltar preservando query, hash e estado original da entrada do histórico', async () => {
    show();
    click('Voltar no histórico');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    click('Descartar e sair');
    await screen.findByRole('heading', { name: 'Destino de navegação' });
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(previous));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('protege também o avançar do histórico e mantém seu destino completo', async () => {
    show();
    click('Avançar no histórico');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    click('Descartar e sair');
    await screen.findByRole('heading', { name: 'Destino de navegação' });
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(next));
  });

  it('protege POP que muda somente os parâmetros da mesma página', async () => {
    const older = { pathname: '/form', search: '?mode=create', hash: '#inicio', state: { revision: 1 } };
    show({}, [older, current]);
    click('Voltar no histórico');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    click('Descartar e sair');
    await waitFor(() => expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(older)));
  });

  it('permite POP entre seções e estados da mesma página sem pedir descarte', async () => {
    const section = { ...current, hash: '#outra-secao', state: { source: 'section' } };
    show({}, [section, current]);
    click('Voltar no histórico');
    await waitFor(() => expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(section)));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('Nome ainda não salvo');
  });

  it('permite PUSH de conclusão e links de seção sem bloquear uma gravação concluída', async () => {
    show();
    fireEvent.click(screen.getByRole('link', { name: 'Ir à seção' }));
    await waitFor(() => expect(screen.getByLabelText('Localização atual')).toHaveTextContent('"hash":"#detalhes"'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Salvar e avançar' }));
    await screen.findByRole('heading', { name: 'Destino de navegação' });
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify({ pathname: '/saved', search: '?result=ok', hash: '#resumo', state: { saved: true } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('permite REPLACE de conclusão preservando o estado da navegação', async () => {
    show();
    click('Salvar substituindo rota');
    await screen.findByRole('heading', { name: 'Destino de navegação' });
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify({ pathname: '/saved', search: '?result=ok', hash: '#resumo', state: { saved: true } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('executa o logout somente após confirmar e permite cancelar sem perder o formulário', async () => {
    const { logout } = show();
    click('Sair da plataforma');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    expect(logout).not.toHaveBeenCalled();
    click('Continuar preenchendo');
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveValue('Nome ainda não salvo');
    expect(logout).not.toHaveBeenCalled();
    click('Sair da plataforma');
    click('Descartar e sair');
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('agrega dois guards e dá prioridade ao envio em andamento para histórico e logout', async () => {
    const { logout } = show({ secondGuard: true, secondBusy: true });
    click('Voltar no histórico');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog()).getByText(/aguarde/i)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Descartar e sair' })).toBeDisabled();
    click('Continuar preenchendo');
    click('Sair da plataforma');
    expect(within(dialog()).getByRole('button', { name: 'Descartar e sair' })).toBeDisabled();
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(current));
  });

  it('atualiza o modal após terminar o envio sem descartar automaticamente o preenchimento', async () => {
    const { update, logout } = show({ busy: true });
    click('Sair da plataforma');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    expect(within(dialog()).getByRole('button', { name: 'Descartar e sair' })).toBeDisabled();
    update({ busy: false });
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'Descartar e sair' })).toBeEnabled());
    expect(logout).not.toHaveBeenCalled();
    click('Descartar e sair');
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it('invalida um POP pendente quando muda a sessão ou unidade de contexto', async () => {
    const { router, update } = show();
    click('Voltar no histórico');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    update({ contextKey: 'session-a:unit-b', dirty: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Localização atual')).toHaveTextContent(JSON.stringify(current));
    await act(async () => { await router.navigate('/saved'); });
    expect(screen.getByRole('heading', { name: 'Destino de navegação' })).toBeInTheDocument();
  });

  it('invalida logout pendente após trocar o contexto e não reaproveita a ação antiga', async () => {
    const { update, logout } = show();
    click('Sair da plataforma');
    await screen.findByRole('dialog', { name: 'Alterações não salvas' });
    update({ contextKey: 'session-b:unit-a', dirty: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(logout).not.toHaveBeenCalled();
    click('Sair da plataforma');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
