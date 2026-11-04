import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { EquipmentDashboard } from './EquipmentDashboard';

const mode = vi.hoisted(() => ({ value: 'demo' }));
vi.mock('../../shared/api/client', () => ({ get API_MODE() { return mode.value; } }));
beforeEach(() => { mode.value = 'demo'; });

it('distribui os oito registros pendentes em categorias e acompanha sem aprovar comprovantes', () => {
  render(<MemoryRouter><EquipmentDashboard can={() => true} /></MemoryRouter>);
  const counts = screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuetext'));
  expect(counts).toEqual(['40 de 43 registros', '30 de 33 registros', '22 de 24 registros']);
  const trigger = screen.getByRole('button', { name: 'Ver conferência: Capacetes' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('button', { name: 'Acompanhar' }));
  expect(dialog.getByRole('status')).toHaveTextContent('Lote em acompanhamento.');
  fireEvent.click(dialog.getByRole('button', { name: /^Fechar$/ }));
  expect(trigger).toHaveFocus();
  expect(within(trigger.closest('article')!).getByText('Em acompanhamento', { exact: true })).toBeInTheDocument();
  expect(screen.getAllByText('3 a conferir')).toHaveLength(2);
  expect(screen.getByText('2 a conferir')).toBeInTheDocument();
});

it('permite retirar o acompanhamento sem alterar pendências, comprovantes ou foco', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><EquipmentDashboard can={() => true} /></MemoryRouter>);
  const trigger = screen.getByRole('button', { name: 'Ver conferência: Capacetes' });
  const counts = screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuetext'));
  await user.click(trigger);
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Acompanhar' }));
  const remove = dialog.getByRole('button', { name: 'Retirar acompanhamento' });
  expect(remove).toBeEnabled();
  await user.click(remove);
  expect(dialog.getByRole('status')).toHaveTextContent('Conferência pendente.');
  expect(dialog.getByRole('button', { name: 'Acompanhar' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(within(trigger.closest('article')!).queryByText('Em acompanhamento', { exact: true })).not.toBeInTheDocument();
  expect(screen.getAllByText('3 a conferir')).toHaveLength(2);
  expect(screen.getByText('2 a conferir')).toBeInTheDocument();
  expect(screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuetext'))).toEqual(counts);
});

it('explica o acompanhamento vazio e permite voltar aos lotes sem perder o foco', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><EquipmentDashboard can={() => true} /></MemoryRouter>);
  const filters = within(screen.getByRole('group', { name: 'Filtrar lotes de EPIs' }));
  const following = filters.getByRole('button', { name: 'Em acompanhamento' });
  await user.click(following);
  expect(following).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Nenhum lote em acompanhamento' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Ver conferência:/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ver todos os lotes' }));
  const all = filters.getByRole('button', { name: 'Todos os lotes' });
  expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(all).toHaveFocus();
  expect(screen.getAllByRole('button', { name: /^Ver conferência:/ })).toHaveLength(3);
});

it('filtra os lotes acompanhados e devolve o foco ao filtro se o lote deixar de pertencer à lista', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><EquipmentDashboard can={() => true} /></MemoryRouter>);
  const counts = screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuetext'));
  await user.click(screen.getByRole('button', { name: 'Ver conferência: Capacetes' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Acompanhar' }));
  await user.keyboard('{Escape}');
  const filter = within(screen.getByRole('group', { name: 'Filtrar lotes de EPIs' })).getByRole('button', { name: 'Em acompanhamento' });
  await user.click(filter);
  expect(screen.getAllByRole('button', { name: /^Ver conferência:/ })).toHaveLength(1);
  const trigger = screen.getByRole('button', { name: 'Ver conferência: Capacetes' });
  await user.click(trigger);
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Retirar acompanhamento' }));
  expect(trigger).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(filter).toHaveFocus();
  expect(screen.getByRole('heading', { name: 'Nenhum lote em acompanhamento' })).toBeInTheDocument();
  expect(screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuetext'))).toEqual(counts);
});

it('não cria índices, filas ou links restritos quando não há integração nem permissão', () => {
  mode.value = 'api';
  render(<MemoryRouter><EquipmentDashboard can={() => false} /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Sem entregas disponíveis' })).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText('92%')).not.toBeInTheDocument();
});
