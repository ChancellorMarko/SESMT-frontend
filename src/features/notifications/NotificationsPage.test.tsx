import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { NotificationDto } from '../../shared/contracts';
import { NotificationsPage } from './NotificationsPage';

const state = vi.hoisted(() => ({ permissions: ['notifications.read', 'documents.read', 'workers.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'notice-session', unitId: 'unit', can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn() } }));
const notice: NotificationDto = { id: 'notice', title: 'Documento próximo do vencimento', summary: 'ASO de exemplo', type: 'DOCUMENT_DUE', resourceType: 'DOCUMENT', resourceId: 'document', dueDate: '2026-10-20', createdAt: '2026-10-11T12:00:00Z' };
function Harness() { const location = useLocation(); return <><output aria-label="Endereço atual">{location.search}</output><NotificationsPage /></>; }
function show(query = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/notificacoes${query}`]}><Harness /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks(); state.permissions = ['notifications.read', 'documents.read', 'workers.read'];
  vi.mocked(api.get).mockResolvedValue({ items: [notice], page: 1, pageSize: 20, total: 1 });
  vi.mocked(api.patch).mockResolvedValue({ ...notice, readAt: '2026-10-11T12:00:00Z' });
});

describe('consulta de notificações', () => {
  it.each(['Infinity', 'NaN', '1.5', '-3', '0', '9007199254740992'])('normaliza page=%s sem mandar paginação inválida à API', async value => {
    show(`?page=${value}`);
    await screen.findByRole('article', { name: notice.title });
    expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });
  it('corrige um filtro de leitura desconhecido e mantém a consulta como Todas', async () => {
    show('?read=qualquer&page=Infinity');
    await screen.findByRole('article', { name: notice.title });
    expect(screen.getByLabelText('Leitura')).toHaveValue('');
    expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: expect.objectContaining({ read: undefined }) }));
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('read=');
  });
  it('retorna à última página existente quando o endereço aponta além do total', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: options?.query?.page === 1 ? [notice] : [], total: 1, page: options?.query?.page, pageSize: 20 }) as never);
    show('?page=9');
    await screen.findByRole('article', { name: notice.title });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
    expect(screen.getByText('1 notificações · página 1 de 1')).toBeInTheDocument();
  });
  it('limpa o filtro e retorna à primeira página ao alterar leitura', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [notice], page: 2, pageSize: 20, total: 40 });
    show('?read=false&page=2');
    await screen.findByRole('article', { name: notice.title });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: expect.objectContaining({ read: undefined, page: 1 }) })));
    expect(screen.getByLabelText('Leitura')).toHaveValue('');
  });
  it('oferece nova tentativa após falha da consulta', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Conexão indisponível.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('exibe data inválida sem quebrar a página e só permite links com acesso ao recurso', async () => {
    state.permissions = ['notifications.read'];
    vi.mocked(api.get).mockResolvedValue({ items: [{ ...notice, createdAt: 'data incorreta' }], page: 1, pageSize: 20, total: 1 });
    show();
    const article = await screen.findByRole('article', { name: notice.title });
    expect(within(article).getByText('Data inválida')).toBeInTheDocument();
    expect(within(article).queryByRole('link')).not.toBeInTheDocument();
  });
  it('codifica o identificador do recurso no link e mantém o destino dentro da aplicação', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [{ ...notice, resourceId: 'a/b?redirect=https://externo.test' }], page: 1, pageSize: 20, total: 1 });
    show();
    expect(await screen.findByRole('link', { name: 'Abrir registro →' })).toHaveAttribute('href', '/app/documentos/a%2Fb%3Fredirect%3Dhttps%3A%2F%2Fexterno.test');
  });
  it('não consulta notificações quando não há permissão', () => {
    state.permissions = []; show();
    expect(screen.getByText('Seu acesso não permite consultar notificações.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('registro de leitura das notificações', () => {
  it('confirma a leitura e volta à página anterior quando a última não lida desaparece', async () => {
    let marked = false;
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: options?.query?.page === 2 && marked ? [] : [notice], page: options?.query?.page, pageSize: 20, total: marked ? 20 : 21 }) as never);
    vi.mocked(api.patch).mockImplementation(async () => { marked = true; return { ...notice, readAt: '2026-10-11T12:00:00Z' } as never; });
    show('?read=false&page=2');
    fireEvent.click(await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` }));
    expect(await screen.findByText(/Leitura registrada:/)).toHaveTextContent('A pendência do registro continua sendo acompanhada.');
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1'));
    expect(api.patch).toHaveBeenCalledWith('/notifications/notice/read', {});
    expect(await screen.findByText('20 notificações · página 1 de 1')).toBeInTheDocument();
  });
  it('bloqueia novos cliques durante gravação e conserva a notificação após erro', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.patch).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    show();
    const read = await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` });
    fireEvent.click(read);
    await waitFor(() => expect(read).toBeDisabled());
    expect(read).toHaveTextContent('Registrando leitura…');
    expect(screen.getByLabelText('Leitura')).toBeDisabled();
    reject(new Error('Não salvo.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível registrar a leitura.');
    expect(read).toBeEnabled();
    expect(screen.getByText('Não lida')).toBeInTheDocument();
    expect(screen.queryByText(/Leitura registrada:/)).not.toBeInTheDocument();
  });
});
