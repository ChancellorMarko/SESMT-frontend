import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDashboardPage } from './NativeDashboardPage';
import { ApiError } from '../../shared/api/client';
import { nativeDashboardFixture, emptyNativeDashboard, dashboardUnit } from '../../../tests/connection-ui/fixtures/native-dashboard';

const state = vi.hoisted(() => ({ me: true, sessionKey: 'dashboard-test', unitId: undefined as string | undefined }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, me: state.me ? { user: { id: 'test' } } : null }) }));
vi.mock('./native-dashboard', async original => ({ ...await original<typeof import('./native-dashboard')>(), requestNativeDashboard: vi.fn() }));
import { nativeDashboardQuery, requestNativeDashboard } from './native-dashboard';

function show(path = '/app/dashboard') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><NativeDashboardPage/></MemoryRouter></QueryClientProvider>), client };
}
beforeEach(() => {
  state.me = true; state.unitId = undefined; vi.clearAllMocks();
  vi.mocked(requestNativeDashboard).mockImplementation(async criteria => { const query = nativeDashboardQuery(criteria); return nativeDashboardFixture(query.from, query.to); });
});
describe('dashboard operacional no contrato nativo', () => {
  it('mostra contadores reais, cinco linhas por página, pendências e detalhes sem navegar para contratos antigos', async () => {
    show('/app/dashboard?from=2026-01-01&to=2026-12-31');
    expect(await screen.findByRole('region', { name: 'Atividades no período' })).toBeVisible();
    const activities = screen.getByRole('region', { name: 'Atividades no período' });
    expect(within(activities).getAllByRole('row')).toHaveLength(6);
    expect(within(activities).getByText('Inspeção da caldeira')).toBeVisible();
    fireEvent.click(within(activities).getByRole('button', { name: 'Próxima' }));
    expect(within(activities).getByText('Atividade 6')).toBeVisible();
    expect(within(activities).getByText('Sem PT vinculada')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Revisões (1)' }));
    expect(screen.getByRole('columnheader', { name: 'Encerramento' })).toBeVisible();
    expect(screen.queryByRole('link', { name: /PT|Agendar|Agenda/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mais informações: Movimentações de PT' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Uma mesma PT pode gerar mais de uma movimentação');
  });
  it('não consulta antes da autenticação nem com parâmetros inválidos do endereço', () => {
    state.me = false; const view = show(); expect(requestNativeDashboard).not.toHaveBeenCalled(); view.unmount();
    state.me = true; show('/app/dashboard?from=2026-02-30&to=2026-03-01');
    expect(screen.getByRole('status')).toHaveTextContent('não são compatíveis'); expect(requestNativeDashboard).not.toHaveBeenCalled();
  });
  it('exibe vazio somente com uma resposta válida e evita afirmar conformidade', async () => {
    vi.mocked(requestNativeDashboard).mockImplementation(async criteria => { const query = nativeDashboardQuery(criteria); return emptyNativeDashboard(query.from, query.to); });
    show(); expect(await screen.findByRole('heading', { name: 'Nenhuma atividade encontrada' })).toBeVisible();
    expect(screen.queryByText(/tudo em dia|100%|conforme/i)).not.toBeInTheDocument();
  });
  it('uma recusa posterior oculta o painel inteiro, incluindo indicadores e conteúdo antes consultado', async () => {
    const { client } = show(); await screen.findByRole('region', { name: 'Atividades no período' });
    vi.mocked(requestNativeDashboard).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'segredo', requestId: 'test' }));
    await act(async () => { await client.invalidateQueries({ queryKey: ['native-dashboard', state.sessionKey] }); });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Atividades no período' })).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('A API não autorizou'); expect(screen.getByRole('alert')).not.toHaveTextContent('segredo');
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
  });
  it('aplica a abrangência de unidade apenas no envio e recusa períodos maiores que 36 meses', async () => {
    state.unitId = dashboardUnit; show(); await screen.findByRole('region', { name: 'Atividades no período' });
    const calls = vi.mocked(requestNativeDashboard).mock.calls.length;
    fireEvent.change(screen.getByLabelText('Abrangência'), { target: { value: 'unit' } });
    expect(requestNativeDashboard).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(vi.mocked(requestNativeDashboard).mock.lastCall?.[0].localId).toBe(dashboardUnit));
    fireEvent.change(screen.getByLabelText('De (UTC)'), { target: { value: '2020-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByRole('status')).toHaveTextContent('até 36 meses');
  });
});
