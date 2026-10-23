import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TerminologyGuide, TerminologyHelp } from './TerminologyGuide';

async function openGuide(related?: Parameters<typeof TerminologyHelp>[0]['related']) {
  const user = userEvent.setup();
  render(<TerminologyHelp related={related} />);
  const trigger = screen.getByRole('button', { name: 'Guia de siglas' });
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Guia de siglas' });
  const search = within(dialog).getByRole('searchbox', { name: 'Buscar sigla ou significado' });
  return { user, trigger, dialog, search };
}

describe('guia de siglas', () => {
  it('abre pelo acionador, prioriza a busca e explica os nomes completos', async () => {
    const { dialog, search, trigger } = await openGuide();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(search).toHaveFocus();
    expect(within(dialog).getByRole('status')).toHaveTextContent('9 siglas encontradas');
    expect(within(dialog).getByRole('article', { name: 'Atestado de Saúde Ocupacional' })).toBeVisible();
    expect(within(dialog).getByRole('article', { name: 'Serviços Especializados em Segurança e Medicina do Trabalho' })).toBeVisible();
    expect(within(dialog).getByText('O ASO é o documento; o exame é a avaliação que dá origem a ele.')).toBeVisible();
  });

  it.each([
    ['atestado', 'Atestado de Saúde Ocupacional'],
    ['protecao', 'Equipamento de Proteção Individual'],
    ['PTs', 'Permissão de Trabalho'],
    ['permissao entrada', 'Permissão de Entrada e Trabalho'],
  ])('encontra o significado pela busca "%s"', async (query, expected) => {
    const { user, dialog, search } = await openGuide();
    await user.type(search, query);
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 sigla encontrada');
    expect(within(dialog).getAllByRole('article')).toHaveLength(1);
    expect(within(dialog).getByRole('article', { name: expected })).toBeVisible();
    expect(search).toHaveFocus();
  });

  it('exibe primeiro as siglas da área sem omitir as demais referências', async () => {
    const { dialog } = await openGuide(['PET', 'AT']);
    const articles = within(dialog).getAllByRole('article');
    expect(articles).toHaveLength(9);
    expect(articles[0]).toHaveAccessibleName('Permissão de Entrada e Trabalho');
    expect(articles[1]).toHaveAccessibleName('Autorização de Trabalho');
    expect(within(dialog).getByText(/As siglas desta área aparecem primeiro\./)).toBeVisible();
  });

  it('mantém claras a autonomia da autorização e a condição de rascunho da PET', async () => {
    const { dialog } = await openGuide(['AT', 'PET']);
    const authorization = within(dialog).getByRole('article', { name: 'Autorização de Trabalho' });
    expect(authorization).toHaveTextContent('No Ampara, AT identifica a Autorização de Trabalho');
    expect(authorization).toHaveTextContent('Autorizar uma AT não libera uma PT.');
    const confinedSpace = within(dialog).getByRole('article', { name: 'Permissão de Entrada e Trabalho' });
    expect(confinedSpace).toHaveTextContent('a PET é um rascunho de preparação');
    expect(confinedSpace).toHaveTextContent('A entrada não está autorizada.');
    expect(within(dialog).getByRole('article', { name: 'Norma Regulamentadora' })).toHaveTextContent('A norma e o comprovante de treinamento têm funções diferentes.');
  });

  it('orienta uma busca sem resultado e permite limpar conservando o foco', async () => {
    const { user, dialog, search } = await openGuide();
    await user.type(search, 'siglainexistente');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Nenhuma sigla encontrada');
    expect(within(dialog).queryByRole('article')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Vamos tentar outro termo?' })).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Limpar busca de siglas' }));
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(within(dialog).getAllByRole('article')).toHaveLength(9);
    expect(within(dialog).queryByRole('button', { name: 'Limpar busca de siglas' })).not.toBeInTheDocument();
  });

  it('fecha por Escape, devolve o foco e reabre sem conservar uma busca antiga', async () => {
    const { user, trigger, search } = await openGuide();
    await user.type(search, 'ASO');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const reopenedSearch = screen.getByRole('searchbox', { name: 'Buscar sigla ou significado' });
    expect(reopenedSearch).toHaveValue('');
    expect(reopenedSearch).toHaveFocus();
    expect(screen.getAllByRole('article')).toHaveLength(9);
  });

  it('mantém o percurso por teclado no diálogo até o fechamento', async () => {
    const { user, dialog, search, trigger } = await openGuide();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Fechar janela' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('region', { name: 'Significados das siglas' })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Fechar janela' })).toHaveFocus();
    await user.tab();
    expect(search).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it('não renderiza conteúdo enquanto o guia está fechado', () => {
    render(<TerminologyGuide open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
