import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { AuditPage } from './AuditPage';

const state = vi.hoisted(() => ({ permitted: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'audit-session', unitId: 'unit', can: () => state.permitted }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const event = { id: 'event', actorId: 'actor', action: 'DOCUMENT_CREATED', resourceType: 'DOCUMENT', resourceId: 'document', occurredAt: '2026-10-11T12:00:00Z', requestId: 'trace', outcome: 'DEMO' };
function Harness() { const location = useLocation(); return <><output aria-label="Endereço atual">{location.search}</output><AuditPage /></>; }
function show(query = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/auditoria${query}`]}><Harness /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); state.permitted = true;
  vi.mocked(api.get).mockResolvedValue({ items: [event], page: 1, pageSize: 20, total: 1 });
});

describe('consulta e filtros de auditoria', () => {
  it.each(['Infinity', 'NaN', '1.5', '-1', '0', '9007199254740992'])('normaliza page=%s antes de consultar a trilha', async value => {
    show(`?page=${value}`);
    await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
  });
  it.each(['from=2026-02-30', 'to=amanha', 'from=2026-2-01', 'to=2026-13-01', 'from=2026-12-31&to=2026-01-01'])('bloqueia período inválido do endereço: %s', async query => {
    show(`?${query}`);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Eventos de auditoria' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByRole('region', { name: 'Eventos de auditoria' })).toBeInTheDocument();
  });
  it('mantém filtros recebidos no endereço, incluindo um código de ação da API ainda desconhecido', async () => {
    show('?action=EVENTO_NOVO&from=2024-02-29&to=2026-10-11');
    await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(screen.getByLabelText('Ação')).toHaveValue('EVENTO_NOVO');
    expect(screen.getByLabelText('De')).toHaveValue('2024-02-29');
    expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'EVENTO_NOVO', from: '2024-02-29', to: '2026-10-11' }) }));
  });
  it('permite filtrar os códigos realmente emitidos pelos documentos e traduz os resultados', async () => {
    show();
    await screen.findByRole('region', { name: 'Eventos de auditoria' });
    expect(screen.getByRole('cell', { name: 'Documento cadastrado' })).toBeInTheDocument();
    expect(screen.getByText('Demonstração')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ação'), { target: { value: 'DOCUMENT_VIEWED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'DOCUMENT_VIEWED', page: 1 }) })));
  });
  it('recupera uma página sem resultados além do total', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: options?.query?.page === 1 ? [event] : [], page: options?.query?.page, pageSize: 20, total: 1 }) as never);
    show('?page=99');
    await screen.findByRole('cell', { name: 'Documento cadastrado' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });
  it('oferece recuperação da conexão sem permitir escrita nos eventos', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta indisponível.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('cell', { name: 'Documento cadastrado' })).toBeInTheDocument();
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir|Editar/ })).not.toBeInTheDocument();
  });
  it('mantém a consulta acessível quando um evento da API tem timestamp inválido', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [{ ...event, occurredAt: 'inválido', outcome: 'DENIED' }], page: 1, pageSize: 20, total: 1 });
    show();
    expect(await screen.findByRole('cell', { name: 'Data inválida' })).toBeInTheDocument();
    expect(screen.getByText('Negado')).toBeInTheDocument();
  });
  it('não consulta trilha sem a permissão de auditoria', () => {
    state.permitted = false; show();
    expect(screen.getByText('Seu acesso não permite consultar auditoria.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
