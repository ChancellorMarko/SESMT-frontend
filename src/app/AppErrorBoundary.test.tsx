import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppErrorBoundary } from './AppErrorBoundary';
function Broken():never { throw new Error('Detalhe interno que não deve aparecer na interface'); }
beforeEach(()=>{vi.spyOn(console,'error').mockImplementation(()=>{});});
describe('recuperação de falha de renderização',()=>{
  it('apresenta ações acessíveis e não expõe detalhes internos da falha',()=>{
    render(<MemoryRouter><AppErrorBoundary resetKey="route-1"><Broken/></AppErrorBoundary></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByRole('heading',{name:'Não foi possível exibir esta página.'})).toBeVisible();
    expect(screen.getByRole('link',{name:'Voltar ao início'})).toHaveAttribute('href','/app');
    expect(screen.getByRole('button',{name:'Recarregar aplicação'})).toBeVisible();
    expect(screen.queryByText(/Detalhe interno/)).not.toBeInTheDocument();
  });
  it('permite abrir outra rota ou contexto depois da falha',()=>{
    const view=render(<MemoryRouter><AppErrorBoundary resetKey="route-1"><Broken/></AppErrorBoundary></MemoryRouter>);
    view.rerender(<MemoryRouter><AppErrorBoundary resetKey="route-2"><h1>Outra página disponível</h1></AppErrorBoundary></MemoryRouter>);
    expect(screen.getByRole('heading',{name:'Outra página disponível'})).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
