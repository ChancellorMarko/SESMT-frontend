import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectedAccountPage } from './ConnectedAccountPage';

const session = vi.hoisted(() => ({ me: { user: { displayName: 'Administrador local', email: 'admin@example.invalid' }, roles: ['ADMIN'], permissions: [] as string[] }, logout: vi.fn() }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => session }));
beforeEach(() => { session.me.permissions = []; session.logout.mockReset(); });
const show = () => render(<MemoryRouter><ConnectedAccountPage /></MemoryRouter>);
it('mostra identidade confirmada e informa módulos pendentes sem atalhos sem permissão', () => {
  show();
  expect(screen.getByRole('heading', { name: 'Sua conta está conectada.' })).toBeVisible();
  expect(screen.getByText('admin@example.invalid')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Módulos não liberados' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Abrir meu espaço de trabalho' })).not.toBeInTheDocument();
});
it('oferece saída e só abre espaço de trabalho quando há permissões de módulos', async () => {
  session.me.permissions = ['documents.read']; show();
  expect(screen.getByRole('link', { name: 'Abrir meu espaço de trabalho' })).toHaveAttribute('href', '/app');
  await userEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
  expect(session.logout).toHaveBeenCalledOnce();
});
