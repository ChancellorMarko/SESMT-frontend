import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { TeamsPage } from './TeamsPage';

vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));

const mockTeams = [
  {
    id: 'team-active',
    name: 'Equipe Operacional Ativa',
    companyId: 'comp-1',
    unitId: 'unit-1',
    chiefId: 'w-1',
    status: 'ACTIVE' as const,
    revision: 2,
    members: [
      { workerId: 'w-1', name: 'Carlos Chefe', serviceFunction: 'Encarregado' },
    ],
  },
  {
    id: 'team-inactive',
    name: 'Equipe Parada',
    companyId: 'comp-1',
    unitId: 'unit-1',
    chiefId: 'w-2',
    status: 'INACTIVE' as const,
    inactiveReason: 'Desmobilizada temporariamente pela gerência',
    revision: 5,
    members: [
      { workerId: 'w-2', name: 'Roberto Operador', serviceFunction: 'Soldador' },
    ],
  },
];

const mockInvites = [
  {
    id: 'inv-1',
    token: 'tok-abc',
    teamId: 'team-active',
    teamName: 'Equipe Operacional Ativa',
    unitId: 'unit-1',
    unitName: 'Unidade 1',
    companyId: 'comp-1',
    companyName: 'Empresa 1',
    status: 'ACTIVE' as const,
    expiresAt: '2026-10-25T18:00:00Z',
    createdAt: '2026-10-13T10:00:00Z',
    createdByName: 'Admin',
    membersCount: 1,
    serviceFunctions: ['Encarregado'],
    shareUrl: 'http://localhost:5173/convite/tok-abc',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    me: { id: 'admin', displayName: 'Admin' } as any,
    unitId: 'unit-1',
    sessionKey: 'teams-test',
    can: permission => ['teams.read', 'teams.write'].includes(permission),
    status: 'authenticated',
    sessionError: null,
    setUnitId: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
    restore: vi.fn(),
  });
  vi.mocked(api.get).mockImplementation(((path: string) => {
    if (path === '/teams') return Promise.resolve(mockTeams);
    if (path === '/team-invites') return Promise.resolve(mockInvites);
    return Promise.resolve([]);
  }) as any);
});

function Harness() {
  const location = useLocation();
  return (
    <>
      <output aria-label="Endereço atual">{location.search}</output>
      <TeamsPage />
    </>
  );
}

function show(query = '') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/app/equipes${query}`]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TeamsPage', () => {
  it('exibe equipes ativas e inativas com badges e motivo', async () => {
    show();
    expect(await screen.findByText('Equipe Operacional Ativa')).toBeInTheDocument();
    expect(screen.getByText('Equipe Parada')).toBeInTheDocument();

    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('Inativa')).toBeInTheDocument();
    expect(screen.getByText('Motivo da inativação: Desmobilizada temporariamente pela gerência')).toBeInTheDocument();
  });

  it('permite filtrar por situação da equipe', async () => {
    show();
    await screen.findByText('Equipe Operacional Ativa');

    const select = screen.getByLabelText('Situação');
    fireEvent.change(select, { target: { value: 'INACTIVE' } });

    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('status=INACTIVE');
    expect(screen.queryByText('Equipe Operacional Ativa')).not.toBeInTheDocument();
    expect(screen.getByText('Equipe Parada')).toBeInTheDocument();
  });

  it('inativa equipe com motivo enviando If-Match da revisão atual', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      ...mockTeams[0],
      status: 'INACTIVE',
      inactiveReason: 'Fim do contrato de terceirização',
      revision: 3,
    });

    show();
    await screen.findByText('Equipe Operacional Ativa');

    const inactivateBtn = screen.getByRole('button', { name: 'Inativar equipe' });
    fireEvent.click(inactivateBtn);

    expect(screen.getByRole('heading', { name: 'Inativar equipe: Equipe Operacional Ativa' })).toBeInTheDocument();

    const input = screen.getByLabelText('Motivo da inativação (opcional)');
    fireEvent.change(input, { target: { value: 'Fim do contrato de terceirização' } });

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar inativação' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/teams/team-active',
        {
          status: 'INACTIVE',
          inactiveReason: 'Fim do contrato de terceirização',
        },
        { etag: '"2"' }
      );
    });
  });

  it('reativa equipe inativa enviando If-Match da revisão atual', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      ...mockTeams[1],
      status: 'ACTIVE',
      revision: 6,
    });

    show();
    await screen.findByText('Equipe Parada');

    const reactivateBtn = screen.getByRole('button', { name: 'Reativar equipe' });
    fireEvent.click(reactivateBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/teams/team-inactive',
        { status: 'ACTIVE' },
        { etag: '"5"' }
      );
    });
  });

  it('abre modal de convites, exibe links e permite cópia com 1 clique', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    show();
    await screen.findByText('Equipe Operacional Ativa');

    const inviteBtn = screen.getByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' });
    fireEvent.click(inviteBtn);

    expect(await screen.findByRole('heading', { name: 'Convites da equipe: Equipe Operacional Ativa' })).toBeInTheDocument();
    expect(screen.getByText('Links gerados para esta equipe')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('http://localhost:5173/convite/tok-abc')).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: 'Copiar link' });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('http://localhost:5173/convite/tok-abc');
      expect(screen.getByText('Copiado!')).toBeInTheDocument();
    });
  });

  it('permite gerar novo convite por link com validade selecionada', async () => {
    vi.mocked(api.post).mockResolvedValue({
      id: 'inv-2',
      token: 'tok-xyz',
      teamId: 'team-active',
      teamName: 'Equipe Operacional Ativa',
      unitId: 'unit-1',
      unitName: 'Unidade 1',
      companyId: 'comp-1',
      companyName: 'Empresa 1',
      status: 'ACTIVE',
      expiresAt: '2026-10-30T10:00:00Z',
      createdAt: '2026-10-13T10:00:00Z',
      createdByName: 'Admin',
      membersCount: 1,
      serviceFunctions: ['Encarregado'],
      shareUrl: 'http://localhost:5173/convite/tok-xyz',
    });

    show();
    await screen.findByText('Equipe Operacional Ativa');

    const inviteBtn = screen.getByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' });
    fireEvent.click(inviteBtn);

    await screen.findByRole('heading', { name: 'Convites da equipe: Equipe Operacional Ativa' });

    const select = screen.getByLabelText('Validade do link');
    fireEvent.change(select, { target: { value: '72' } });

    const submitBtn = screen.getByRole('button', { name: 'Gerar link de convite' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/team-invites', {
        teamId: 'team-active',
        validityHours: 72,
      });
      expect(screen.getByText('Novo link de convite gerado com sucesso!')).toBeInTheDocument();
    });
  });

  it('permite revogar convite ativo', async () => {
    vi.mocked(api.post).mockResolvedValue({
      ...mockInvites[0],
      status: 'REVOKED',
    });

    show();
    await screen.findByText('Equipe Operacional Ativa');

    const inviteBtn = screen.getByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' });
    fireEvent.click(inviteBtn);

    await screen.findByRole('heading', { name: 'Convites da equipe: Equipe Operacional Ativa' });

    const revokeBtn = await screen.findByRole('button', { name: 'Revogar convite' });
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/team-invites/inv-1/revoke', {});
      expect(screen.getByText('Convite revogado com sucesso.')).toBeInTheDocument();
    });
  });
});
