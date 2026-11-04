import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { DashboardPage } from './DashboardPage';

const state = vi.hoisted(() => ({ permitted: true, unitId: 'unit' as string | undefined }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, can: () => state.permitted }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
function show(query = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/painel-documental${query}`]}><DashboardPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); state.permitted = true; state.unitId = 'unit';
  vi.mocked(api.get).mockImplementation(async (_path, options) => ({ generatedAt: '2026-10-11T12:00:00Z', filters: options?.query, indicators: [], pendingItems: [] }) as never);
});

describe('painel documental e período da consulta', () => {
  it.each(['from=2026-02-30', 'to=amanha', 'from=2026-2-01', 'to=2026-13-01', 'from=2026-12-31&to=2026-01-01'])('impede consulta e atualização de período inválido: %s', async query => {
    show(`?${query}`);
    expect(screen.getByText('O intervalo na URL é inválido. Corrija as datas para consultar o painel.')).toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: 'Atualizar' });
    expect(refresh).toBeDisabled(); fireEvent.click(refresh);
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('Nenhuma pendência retornada')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/dashboard', expect.objectContaining({ query: { unitId: 'unit', from: undefined, to: undefined } }));
  });

  it('consulta ano bissexto e mantém período e unidade nos atalhos dos indicadores', async () => {
    vi.mocked(api.get).mockResolvedValue({ generatedAt: '2026-10-11T12:00:00Z', filters: { unitId: 'unit', from: '2024-02-29', to: '2026-10-11' }, indicators: [{ code: 'DOCUMENTS_ACTIVE', label: 'Documentos vigentes', value: 1, formula: 'Contagem', source: 'Teste', period: 'Período selecionado', updatedAt: '2026-10-11T12:00:00Z', targetFilter: { unitId: 'unit', issueDateFrom: '2024-02-29', status: 'ACTIVE', unexpected: 'ignored' } }], pendingItems: [] });
    show('?from=2024-02-29&to=2026-10-11');
    const link = await screen.findByRole('link', { name: 'Consultar documentos →' });
    const target = new URL(link.getAttribute('href')!, window.location.origin);
    expect(target.searchParams.get('unitId')).toBe('unit');
    expect(target.searchParams.get('issueDateFrom')).toBe('2024-02-29');
    expect(target.searchParams.get('issueDateTo')).toBe('2026-10-11');
    expect(target.searchParams.has('unexpected')).toBe(false);
    expect(api.get).toHaveBeenCalledWith('/dashboard', expect.objectContaining({ query: { unitId: 'unit', from: '2024-02-29', to: '2026-10-11' } }));
  });

  it('não consulta sem unidade e informa como recuperar o contexto', () => {
    state.unitId = undefined; show();
    expect(screen.getByText('Selecione uma unidade para consultar o painel documental.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('não consulta sem permissão', () => {
    state.permitted = false; show();
    expect(screen.getByText('Seu acesso não permite consultar este painel.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('recupera falha de conexão com os mesmos filtros', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha na conexão.'));
    show('?from=2026-10-01');
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nenhuma pendência retornada')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/dashboard', expect.objectContaining({ query: { unitId: 'unit', from: '2026-10-01', to: undefined } }));
  });

  it.each(['from=2026-10-01&from=2026-10-02', 'to=2026-10-11&to=2026-10-12', 'companyId=other', 'page=2'])('rejeita filtros ambíguos ou não suportados sem consultar: %s', async query => {
    show(`?${query}`);
    expect(screen.getByRole('alert')).toHaveTextContent('Os filtros na URL são inválidos.');
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeDisabled();
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText('Nenhuma pendência retornada')).toBeInTheDocument();
  });

  it('atualiza o período aplicado preservando as datas ainda não enviadas', async () => {
    show('?from=2026-10-01');
    await screen.findByText('Nenhuma pendência retornada');
    fireEvent.change(screen.getByLabelText('Período inicial'), { target: { value: '2026-09-01' } });
    expect(screen.getByText('Há alterações no período ainda não aplicadas ao painel.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(screen.getByLabelText('Período inicial')).toHaveValue('2026-09-01');
    expect(api.get).toHaveBeenLastCalledWith('/dashboard', expect.objectContaining({ query: { unitId: 'unit', from: '2026-10-01', to: undefined } }));
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar período' }));
    await screen.findByText('Nenhuma pendência retornada');
    expect(api.get).toHaveBeenLastCalledWith('/dashboard', expect.objectContaining({ query: { unitId: 'unit', from: '2026-09-01', to: undefined } }));
    expect(screen.queryByText('Há alterações no período ainda não aplicadas ao painel.')).not.toBeInTheDocument();
  });
});
