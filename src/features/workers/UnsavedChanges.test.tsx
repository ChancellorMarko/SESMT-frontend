import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { UnsavedChanges } from './UnsavedChanges';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture(busy = false) {
  return render(<MemoryRouter initialEntries={['/form']}><Routes><Route path="/form" element={<><UnsavedChanges dirty busy={busy} /><h1>Formulário de trabalhador</h1><Link to="/workers">Sair do formulário</Link></>} /><Route path="/workers" element={<h1>Lista de trabalhadores</h1>} /></Routes></MemoryRouter>);
}
describe('saída de formulário com alterações', () => {
  it('mantém preenchimento até o usuário escolher descartar', () => {
    fixture();
    fireEvent.click(screen.getByRole('link', { name: 'Sair do formulário' }));
    expect(screen.getByRole('dialog', { name: 'Alterações não salvas' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar preenchendo' }));
    expect(screen.getByRole('heading', { name: 'Formulário de trabalhador' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Sair do formulário' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(screen.getByRole('heading', { name: 'Lista de trabalhadores' })).toBeTruthy();
  });
  it('não deixa um link interromper submissão em andamento', () => {
    fixture(true);
    fireEvent.click(screen.getByRole('link', { name: 'Sair do formulário' }));
    expect(screen.getByRole('heading', { name: 'Formulário de trabalhador' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it.each([false, true])('libera os links da próxima tela no mesmo commit da conclusão (envio=%s)', busy => {
    function Editor() {
      const navigate = useNavigate();
      return <><UnsavedChanges dirty busy={busy} /><button onClick={() => navigate('/saved')}>Concluir</button></>;
    }
    function Saved() {
      const back = useRef<HTMLAnchorElement>(null);
      // Exercise the newly committed link before passive cleanup can remove an
      // obsolete editor guard. The completed editor must no longer intercept it.
      useLayoutEffect(() => { back.current?.click(); }, []);
      return <Link ref={back} to="/workers">Voltar à lista</Link>;
    }
    render(<MemoryRouter initialEntries={['/form']}><Routes><Route path="/form" element={<Editor />} /><Route path="/saved" element={<Saved />} /><Route path="/workers" element={<h1>Lista de trabalhadores</h1>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(screen.getByRole('heading', { name: 'Lista de trabalhadores' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('protege uma troca de unidade e permite somente descarte confirmado', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter><UnsavedChanges protectContext dirty busy={false} /></MemoryRouter>);
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(false);
    confirm.mockReturnValue(true);
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it('bloqueia troca de unidade durante envio sem oferecer descarte', () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<MemoryRouter><UnsavedChanges protectContext dirty={false} busy /></MemoryRouter>);
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('não duplica confirmação quando a tela usa um guard próprio', () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<MemoryRouter><UnsavedChanges dirty busy={false} /></MemoryRouter>);
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('não pede descarte em formulário sem alterações', () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<MemoryRouter><UnsavedChanges protectContext dirty={false} busy={false} /></MemoryRouter>);
    expect(window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([
    { fromConsulta: true, fromSearch: '?tab=documents&q=relatorio', fromUnitId: 'unit-a' },
    { integrationReturnTo: { pathname: '/app/pts/pt-a', search: '?page=2', hash: '#equipe', unitId: 'unit-a' }, success: 'Cadastro atualizado.' },
  ])('preserva o contexto atual de retorno depois de confirmar descarte: %j', state => {
    function Destination() {
      const location = useLocation();
      return <output aria-label="Navegação confirmada">{JSON.stringify({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state })}</output>;
    }
    render(<MemoryRouter initialEntries={[{ pathname: '/form', state }]}><Routes><Route path="/form" element={<><UnsavedChanges dirty busy={false} /><Link to="/workers?page=3#cadastro" state={state}>Sair</Link></>} /><Route path="/workers" element={<Destination />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'Sair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(screen.getByLabelText('Navegação confirmada')).toHaveTextContent(JSON.stringify({ pathname: '/workers', search: '?page=3', hash: '#cadastro', state }));
  });
  it('não transforma um endereço externo em destino da confirmação', () => {
    render(<MemoryRouter><UnsavedChanges dirty busy={false} /><a href="https://outside.example.test/path" onClick={event => event.preventDefault()}>Site externo</a></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'Site externo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
