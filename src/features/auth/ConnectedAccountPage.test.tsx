import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectedAccountPage } from './ConnectedAccountPage';
import { hasPermission } from '../../shared/auth/permissions';

const session = vi.hoisted(() => ({ me: { user: { displayName: 'Administrador local', email: 'admin@example.invalid' }, roles: ['ADMIN'], permissions: [] as string[] }, logout: vi.fn(), restore: vi.fn(), can: (permission: string): boolean => hasPermission(session.me.permissions, permission) }));
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
  expect(screen.getByRole('link', { name: 'Abrir meu espaço de trabalho' })).toHaveAttribute('href', '/app/documentos');
  await userEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
  expect(session.logout).toHaveBeenCalledOnce();
});
it('não cria um atalho circular quando a API envia somente permissões de outro recurso', async () => {
  session.me.permissions = ['recurso_novo:consultar']; show();
  expect(screen.getByRole('heading', { name: 'Nenhum módulo disponível para estes acessos' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Abrir meu espaço de trabalho' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mais informações: Permissões da conta' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('recurso_novo:consultar');
});
it('reconhece a leitura nativa e permite solicitar uma nova identidade após alteração de acesso', async () => {
  session.me.permissions = ['documento:ler']; show();
  expect(screen.getByRole('link', { name: 'Abrir meu espaço de trabalho' })).toHaveAttribute('href', '/app/documentos');
  await userEvent.click(screen.getByRole('button', { name: 'Atualizar acesso' }));
  expect(session.restore).toHaveBeenCalledOnce();
});
