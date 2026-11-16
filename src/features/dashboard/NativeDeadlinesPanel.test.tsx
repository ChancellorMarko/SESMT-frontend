import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/client';
import { deadlinesFixture } from '../../../tests/connection-ui/fixtures/native-deadlines';

const state = vi.hoisted(() => ({ permissions: ['treinamento:ler', 'epi:ler'] as string[] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'deadlines-test', can: (p: string) => state.permissions.includes(p) }) }));
vi.mock('./native-deadlines', async original => ({ ...await original<typeof import('./native-deadlines')>(), requestNativeDeadlines: vi.fn() }));
import { requestNativeDeadlines } from './native-deadlines';
import { NativeDeadlinesPanel } from './NativeDeadlinesPanel';

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><NativeDeadlinesPanel/></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  state.permissions = ['treinamento:ler', 'epi:ler']; vi.clearAllMocks();
  vi.mocked(requestNativeDeadlines).mockImplementation(async days => ({ ...deadlinesFixture(), days }));
});

describe('painel de vencimentos', () => {
  it('mostra resumo, situação relativa, link para o módulo e as fontes fora do acesso', async () => {
    show();
    const table = await screen.findByRole('region', { name: 'Tabela de renovações' });
    expect(within(table).getByText('Vencido há 13 dias')).toBeVisible();
    expect(within(table).getByText('Vence hoje')).toBeVisible();
    expect(within(table).getByRole('link', { name: 'NR-35' })).toHaveAttribute('href', '/app/treinamentos?unitId=20000000-0000-0000-0000-000000000001&workerId=30000000-0000-0000-0000-000000000001');
    expect(within(table).getByRole('link', { name: 'Luva' })).toHaveAttribute('href', '/app/epis?unitId=20000000-0000-0000-0000-000000000001&workerId=30000000-0000-0000-0000-000000000002');
    expect(screen.getByLabelText('Resumo de renovações')).toHaveTextContent('Vencidos1');
    expect(screen.getByText(/não entram nesta lista: ASO/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Renovações' })).toBeVisible();
    expect(screen.getByText('Treinamentos, ASO e EPI · todas as unidades da sua conta')).toBeVisible();
    expect(screen.queryByText(/apto|aptidão confirmada|em dia/i)).not.toBeInTheDocument();
  });

  it('filtra por tipo sem nova consulta e troca a janela pela API', async () => {
    show(); await screen.findByRole('region', { name: 'Tabela de renovações' });
    fireEvent.click(screen.getByRole('button', { name: 'EPI' }));
    expect(screen.queryByRole('link', { name: 'NR-35' })).not.toBeInTheDocument();
    expect(requestNativeDeadlines).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '90 dias' }));
    expect(await screen.findByText('Vencem em até 90 dias')).toBeVisible();
    expect(vi.mocked(requestNativeDeadlines).mock.lastCall?.[0]).toBe(90);
  });

  it('não aparece nem consulta quando a conta não lê nenhuma fonte', () => {
    state.permissions = []; const { container } = show();
    expect(container).toBeEmptyDOMElement(); expect(requestNativeDeadlines).not.toHaveBeenCalled();
  });

  it('descarta resposta incoerente e explica recusa sem mostrar a mensagem da API', async () => {
    vi.mocked(requestNativeDeadlines).mockResolvedValueOnce({ ...deadlinesFixture(), total: 9 });
    const view = show(); expect(await screen.findByText(/Não foi possível conferir as renovações/)).toBeVisible();
    expect(screen.queryByText('Ana Lima')).not.toBeInTheDocument(); view.unmount();
    vi.mocked(requestNativeDeadlines).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'segredo', requestId: 'x' }));
    show(); expect(await screen.findByText(/não autorizou a consulta de renovações/)).toBeVisible();
    expect(screen.queryByText('segredo')).not.toBeInTheDocument();
  });
});
