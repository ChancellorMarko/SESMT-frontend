import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
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
});
