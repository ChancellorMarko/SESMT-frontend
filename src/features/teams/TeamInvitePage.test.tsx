import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { PublicTeamInviteDto } from '../../shared/contracts/teams';
import { TeamInvitePage } from './TeamInvitePage';

const session = vi.hoisted(() => ({ status: 'anonymous', sessionKey: 'anonymous' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => session }));

vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn() },
}));

const mockInvite: PublicTeamInviteDto = {
  token: 'tok-equipe-123',
  teamId: 'team-1',
  teamName: 'Equipe Civil Alpha',
  unitName: 'Unidade Mina Norte',
  companyName: 'Mineração Vale do Rio Doce',
  chiefName: 'Carlos Mestre',
  status: 'ACTIVE',
  expiresAt: '2026-10-20T18:00:00Z',
  members: [
    { name: 'Carlos Mestre', serviceFunction: 'Encarregado', isChief: true },
    { name: 'João Ajudante', serviceFunction: 'Apoio', isChief: false },
  ],
  operationalInstructions: 'Apresente-se ao encarregado e confira os EPIs antes da entrada no túnel.',
};

function renderInvite(token = 'tok-equipe-123', cachedInvite?: PublicTeamInviteDto) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cachedInvite) queryClient.setQueryData(['public-team-invite', session.sessionKey, token], cachedInvite);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/convite/${token}`]}>
        <Routes>
          <Route path="/convite/:token" element={<TeamInvitePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TeamInvitePage', () => {
  it('permite retirar seleções indisponíveis após atualização da equipe e preserva os outros dados', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let current: PublicTeamInviteDto = { ...mockInvite, expiresAt: new Date(Date.now() + 86400000).toISOString(), appointmentRequestsEnabled: true, services: [{ id: 'service-a', name: 'Serviço A' }, { id: 'service-b', name: 'Serviço B' }], members: mockInvite.members.map((member, index) => ({ ...member, memberId: `member-${index}` })) };
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/appointments') ? [] : structuredClone(current));
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/convite/tok-equipe-123']}><Routes><Route path="/convite/:token" element={<TeamInvitePage />} /></Routes></MemoryRouter></QueryClientProvider>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Serviço A' }));
    await user.click(screen.getByRole('checkbox', { name: 'Serviço B' }));
    await user.click(screen.getByRole('checkbox', { name: 'Carlos Mestre' }));
    await user.click(screen.getByRole('checkbox', { name: 'João Ajudante' }));
    fireEvent.change(screen.getByLabelText('Local do atendimento *'), { target: { value: 'Local preservado' } });
    fireEvent.change(screen.getByLabelText('Seu nome (autodeclarado) *'), { target: { value: 'Solicitante preservado' } });
    current = { ...current, services: current.services!.slice(1), members: current.members.slice(1) };
    await act(async () => { await client.invalidateQueries({ queryKey: ['public-team-invite'] }); });
    expect(await screen.findByText(/Seu preenchimento contém 1 participante\(s\) e 1 serviço\(s\) indisponível/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remover itens indisponíveis' }));
    expect(screen.queryByRole('button', { name: 'Remover itens indisponíveis' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'João Ajudante' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Serviço B' })).toBeChecked();
    expect(screen.getByLabelText('Local do atendimento *')).toHaveValue('Local preservado'); expect(screen.getByLabelText('Seu nome (autodeclarado) *')).toHaveValue('Solicitante preservado');
    expect(api.post).not.toHaveBeenCalled();
  });
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep invitation validity independent of the day CI runs, without faking async waits.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    session.status = 'anonymous';
  });

  it('aguarda a restauração de sessão antes de consultar o link público', async () => {
    session.status = 'restoring';
    renderInvite();
    expect(screen.getByText('Carregando dados do convite de equipe…')).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('confere a situação atual antes de mostrar um convite ativo mantido em cache', async () => {
    let resolve!: (invite: PublicTeamInviteDto) => void;
    vi.mocked(api.get).mockReturnValue(new Promise(done => { resolve = done; }));
    renderInvite('tok-equipe-123', mockInvite);
    expect(screen.getByText('Carregando dados do convite de equipe…')).toBeVisible();
    expect(screen.queryByText('João Ajudante')).not.toBeInTheDocument();
    await act(async () => resolve({ ...mockInvite, status: 'REVOKED' }));
    expect(await screen.findByText('Revogado')).toBeVisible();
    expect(screen.queryByText('João Ajudante')).not.toBeInTheDocument();
  });

  it('exibe dados completos do convite ativo, membros e instruções de segurança', async () => {
    vi.mocked(api.get).mockResolvedValue(mockInvite);

    renderInvite();

    expect(await screen.findByRole('heading', { name: 'Equipe Civil Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Mineração Vale do Rio Doce')).toBeInTheDocument();
    expect(screen.getByText('Unidade Mina Norte')).toBeInTheDocument();
    expect(screen.getAllByText('Carlos Mestre')).toHaveLength(2);
    expect(screen.getByText('Convite válido')).toBeInTheDocument();
    expect(screen.getByText('Participantes vinculados (2)')).toBeInTheDocument();
    expect(screen.getByText('João Ajudante')).toBeInTheDocument();
    expect(screen.getByText('Encarregado')).toBeInTheDocument();
    expect(screen.getByText('Apoio')).toBeInTheDocument();
    expect(screen.getByText('Apresente-se ao encarregado e confira os EPIs antes da entrada no túnel.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/team-invites/public/tok-equipe-123', expect.anything());
  });

  it('exibe alerta de convite expirado', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...mockInvite,
      status: 'EXPIRED',
      expiresAt: '2026-10-01T12:00:00Z',
    });

    renderInvite();

    expect(await screen.findByText('Expirado')).toBeInTheDocument();
    expect(screen.getByText(/A validade deste convite expirou em/)).toBeInTheDocument();
    expect(screen.queryByText('João Ajudante')).not.toBeInTheDocument();
    expect(screen.queryByText('Mineração Vale do Rio Doce')).not.toBeInTheDocument();
  });

  it('exibe alerta de convite revogado', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...mockInvite,
      status: 'REVOKED',
    });

    renderInvite();

    expect(await screen.findByText('Revogado')).toBeInTheDocument();
    expect(screen.getByText(/Este convite foi revogado pela administração e não é mais válido/)).toBeInTheDocument();
    expect(screen.queryByText('Carlos Mestre')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Participantes vinculados/ })).not.toBeInTheDocument();
  });

  it('explica indisponibilidade temporária da equipe sem anunciar uma revogação', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...mockInvite, status: 'REVOKED', unavailableReason: 'TEAM_INACTIVE' });
    renderInvite();
    expect(await screen.findByText('Equipe inativa')).toBeVisible();
    expect(screen.getByText(/O convite fica indisponível enquanto a equipe não for reativada/)).toBeVisible();
    expect(screen.queryByText(/revogado pela administração/)).not.toBeInTheDocument();
    expect(screen.queryByText('João Ajudante')).not.toBeInTheDocument();
  });

  it('exibe estado vazio/erro quando o convite não é encontrado ou inválido', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(404, { code: 'NOT_FOUND', message: 'Convite não encontrado.', requestId: 'test' }));

    renderInvite('tok-invalido');

    expect(await screen.findByText('Convite inválido ou não encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acessar plataforma Ampara' })).toBeInTheDocument();
  });

  it('não apresenta integrantes quando uma resposta ACTIVE já está vencida', async () => {
    vi.mocked(api.get).mockResolvedValue({ ...mockInvite, expiresAt: '2026-01-01T00:00:00Z' });
    renderInvite();
    expect(await screen.findByText('Expirado')).toBeVisible();
    expect(screen.queryByText('João Ajudante')).not.toBeInTheDocument();
    expect(screen.queryByText(/Apresente-se ao encarregado e confira/)).not.toBeInTheDocument();
  });

  it('retira os participantes ao vencer durante a consulta sem recarregar a página', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime('2026-10-13T12:00:00Z');
    vi.mocked(api.get).mockResolvedValue({ ...mockInvite, expiresAt: '2026-10-13T12:00:05Z' });
    renderInvite();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText('Convite válido')).toBeVisible();
    expect(screen.getByText('João Ajudante')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
    expect(screen.getByText('Expirado')).toBeVisible();
    expect(screen.queryByText('João Ajudante')).not.toBeInTheDocument();
  });

  it('distingue falha de rede de um link inválido e permite tentar novamente', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Rede indisponível.'));
    renderInvite();
    expect(await screen.findByRole('heading', { name: 'Não foi possível consultar o convite' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
    expect(screen.queryByText('Convite inválido ou não encontrado')).not.toBeInTheDocument();
  });
});
