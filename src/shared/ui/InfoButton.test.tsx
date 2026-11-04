import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { InfoButton, PageHeader } from './index';

describe('informação complementar sob demanda', () => {
  it('abre pelo teclado, fecha com Escape e devolve o foco ao ponto de leitura', async () => {
    const user = userEvent.setup();
    render(<InfoButton title="Vigência"><p>Critério e fonte da contagem.</p></InfoButton>);
    expect(screen.queryByText('Critério e fonte da contagem.')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Mais informações: Vigência' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Vigência' });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText('Critério e fonte da contagem.')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('preserva título e ação principal sem repetir a descrição na tela inicial', async () => {
    const user = userEvent.setup();
    render(<PageHeader title="Documentos" eyebrow="REPOSITÓRIO CONTROLADO" description="Vigências e versões da unidade." actions={<button>Novo documento</button>} />);
    expect(screen.getByRole('heading', { name: 'Documentos', level: 1 })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Novo documento' })).toBeVisible();
    expect(screen.queryByText('REPOSITÓRIO CONTROLADO')).not.toBeInTheDocument();
    expect(screen.queryByText('Vigências e versões da unidade.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mais informações: Documentos' }));
    expect(within(screen.getByRole('dialog')).getByText('Vigências e versões da unidade.')).toBeVisible();
  });
});
