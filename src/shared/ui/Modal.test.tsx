import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './index';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Abrir edição</button><Modal open={open} title="Editar registro" onClose={() => { onClose(); setOpen(false); }}><label>Nome<input /></label><button>Confirmar</button></Modal></>;
}
function StackedHarness() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  return <><button onClick={() => setParentOpen(true)}>Abrir janela principal</button>
    <Modal open={parentOpen} title="Janela principal" onClose={() => setParentOpen(false)}><button onClick={() => setChildOpen(true)}>Abrir confirmação</button><button>Última ação principal</button></Modal>
    <Modal open={childOpen} title="Confirmação superior" onClose={() => setChildOpen(false)}><button onClick={() => setParentOpen(false)}>Remover janela inferior</button><button>Última ação superior</button></Modal>
  </>;
}

describe('modal acessível', () => {
  it('fecha com Escape e devolve o foco ao acionador', async () => {
    const user = userEvent.setup(); const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Abrir edição' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Editar registro' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('mantém a navegação por Tab e Shift+Tab dentro do diálogo', async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir edição' }));
    const close = screen.getByRole('button', { name: 'Fechar janela' });
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    await user.tab(); expect(close).toHaveFocus();
    await user.tab({ shift: true }); expect(confirm).toHaveFocus();
    await user.tab(); expect(close).toHaveFocus();
    await user.tab(); expect(screen.getByLabelText('Nome')).toHaveFocus();
  });

  it('uma nova identidade de callback não rouba o foco do campo e Escape usa o callback atual', () => {
    const firstClose = vi.fn(); const nextClose = vi.fn();
    const { rerender } = render(<Modal open title="Editar registro" onClose={firstClose}><label>Nome<input /></label></Modal>);
    const input = screen.getByLabelText('Nome'); input.focus();
    fireEvent.change(input, { target: { value: 'Nome em edição' } });
    rerender(<Modal open title="Editar registro" onClose={nextClose}><label>Nome<input /></label></Modal>);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Nome em edição');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(nextClose).toHaveBeenCalledTimes(1);
    expect(firstClose).not.toHaveBeenCalled();
  });
  it('ignora campos ocultos, tabindex negativo e controles de fieldset desabilitado', async () => {
    const user=userEvent.setup();
    render(<Modal open title="Controles disponíveis" onClose={()=>{}}><input type="hidden"/><button tabIndex={-1}>Fora da sequência</button><div hidden><button>Oculto</button></div><div style={{display:'none'}}><button>Oculto por estilo</button></div><fieldset disabled><button>Desabilitado por grupo</button></fieldset><button>Último disponível</button></Modal>);
    await user.tab({shift:true});
    expect(screen.getByRole('button',{name:'Último disponível'})).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button',{name:'Fechar janela'})).toHaveFocus();
  });
  it('Escape fecha apenas o topo e preserva foco e scroll até fechar a última janela', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'scroll';
    render(<StackedHarness />);
    const trigger = screen.getByRole('button', { name: 'Abrir janela principal' });
    await user.click(trigger);
    const childTrigger = screen.getByRole('button', { name: 'Abrir confirmação' });
    await user.click(childTrigger);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(screen.getByRole('dialog', { name: 'Confirmação superior' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Última ação superior' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Confirmação superior' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Janela principal' })).toBeInTheDocument();
    expect(childTrigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
  it('remover o diálogo inferior conserva o bloqueio e o foco na janela superior', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<StackedHarness />);
    await user.click(screen.getByRole('button', { name: 'Abrir janela principal' }));
    await user.click(screen.getByRole('button', { name: 'Abrir confirmação' }));
    const remove = screen.getByRole('button', { name: 'Remover janela inferior' });
    await user.click(remove);
    expect(screen.queryByRole('dialog', { name: 'Janela principal' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Confirmação superior' })).toBeInTheDocument();
    expect(remove).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Última ação superior' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });
});
