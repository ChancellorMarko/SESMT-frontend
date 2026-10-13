import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { PublicTeamInviteDto } from '../../shared/contracts/teams';
import { TeamInvitePage } from './TeamInvitePage';

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

function renderInvite(token = 'tok-equipe-123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('exibe alerta de convite revogado', async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...mockInvite,
      status: 'REVOKED',
    });

    renderInvite();

    expect(await screen.findByText('Revogado')).toBeInTheDocument();
    expect(screen.getByText(/Este convite foi revogado pela administração e não é mais válido/)).toBeInTheDocument();
  });

  it('exibe estado vazio/erro quando o convite não é encontrado ou inválido', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('NOT_FOUND'));

    renderInvite('tok-invalido');

    expect(await screen.findByText('Convite inválido ou não encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acessar plataforma Ampara' })).toBeInTheDocument();
  });
});
