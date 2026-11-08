import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { TeamDto } from '../../shared/contracts/work-permits';
import type { TeamInviteDto } from '../../shared/contracts/teams';
import { useSession } from '../../shared/auth/SessionProvider';
import { TeamsPage } from './TeamsPage';

vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));

const mockTeams: TeamDto[] = [
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

const mockInvites: TeamInviteDto[] = [
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
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: '2026-10-13T10:00:00Z',
    createdByName: 'Admin',
    membersCount: 1,
    serviceFunctions: ['Encarregado'],
    shareUrl: `${window.location.origin}/convite/tok-abc`,
  },
];
const context = { sessionKey: 'teams-test', unitId: 'unit-1' as string | undefined, permissions: ['teams.read', 'teams.write'] };

beforeEach(() => {
  vi.clearAllMocks();
  context.sessionKey = 'teams-test'; context.unitId = 'unit-1'; context.permissions = ['teams.read', 'teams.write'];
  vi.mocked(useSession).mockImplementation(() => ({
    me: { id: 'admin', displayName: 'Admin' } as any,
    unitId: context.unitId,
    sessionKey: context.sessionKey,
    can: permission => context.permissions.includes(permission),
    status: 'authenticated',
    sessionError: null,
    setUnitId: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
    restore: vi.fn(), reloadIdentity: vi.fn(),
  }));
  vi.mocked(api.get).mockReset().mockImplementation(((path: string, options?: { query?: { unitId?: string } }) => {
    if (path === '/teams') return Promise.resolve(mockTeams.filter(team => team.unitId === options?.query?.unitId));
    if (path === '/team-invites') return Promise.resolve(mockInvites);
    return Promise.resolve([]);
  }) as any);
  vi.mocked(api.patch).mockReset().mockImplementation(async (path, input) => {
    const team = mockTeams.find(item => path === `/teams/${item.id}`)!;
    return { ...team, ...(input as object), revision: team.revision + 1 } as never;
  });
  vi.mocked(api.post).mockReset().mockImplementation(async path => path === '/team-invites' ? { ...mockInvites[0], id: 'inv-created', token: 'created-token', shareUrl: `${window.location.origin}/convite/created-token` } as never : { ...mockInvites[0], status: 'REVOKED' } as never);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
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

function show(query = '', existingClient?: QueryClient) {
  const client = existingClient || new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/equipes${query}`]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}

async function openInvites() {
  fireEvent.click(await screen.findByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar link de convite' })).toBeEnabled());
  return screen.getByRole('dialog');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const responseError = 'A resposta não corresponde à equipe ou ao convite solicitado. Atualize a consulta antes de continuar.';

describe('TeamsPage', () => {
  it('distingue indisponibilidade temporária da revogação e abre o convite na instância da demonstração', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(mockTeams).mockResolvedValueOnce([{ ...mockInvites[0], status: 'REVOKED', unavailableReason: 'TEAM_INACTIVE' }]);
    show(); await screen.findByText('Equipe Operacional Ativa');
    fireEvent.click(screen.getByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' }));
    expect(await screen.findByText('Indisponível · equipe inativa')).toBeVisible();
    expect(screen.queryByText('Revogado')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Abrir convite' });
    expect(link).toHaveAttribute('href', '/convite/tok-abc');
    expect(link).not.toHaveAttribute('target', '_blank');
  });
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
        { etag: '"2"', signal: expect.any(AbortSignal) }
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
        { etag: '"5"', signal: expect.any(AbortSignal) }
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
    expect(await screen.findByDisplayValue(`${window.location.origin}/convite/tok-abc`)).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: 'Copiar link' });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/convite/tok-abc`);
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
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: '2026-10-13T10:00:00Z',
      createdByName: 'Admin',
      membersCount: 1,
      serviceFunctions: ['Encarregado'],
      shareUrl: `${window.location.origin}/convite/tok-xyz`,
    });

    show();
    await screen.findByText('Equipe Operacional Ativa');

    const inviteBtn = screen.getByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' });
    fireEvent.click(inviteBtn);

    await screen.findByRole('heading', { name: 'Convites da equipe: Equipe Operacional Ativa' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar link de convite' })).toBeEnabled());

    const select = screen.getByLabelText('Validade do link');
    fireEvent.change(select, { target: { value: '72' } });

    const submitBtn = screen.getByRole('button', { name: 'Gerar link de convite' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/team-invites', {
        teamId: 'team-active',
        validityHours: 72,
      }, { signal: expect.any(AbortSignal) });
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
      expect(api.post).toHaveBeenCalledWith('/team-invites/inv-1/revoke', {}, { signal: expect.any(AbortSignal) });
      expect(screen.getByText('Convite revogado com sucesso.')).toBeInTheDocument();
    });
  });

  it.each(['unit', 'session', 'permission'] as const)('aborta alteração de situação ao mudar %s e ignora resposta tardia', async change => {
    const pending = deferred<unknown>(); let signal: AbortSignal | undefined;
    vi.mocked(api.patch).mockImplementation(((_path: string, _input: unknown, options: { signal: AbortSignal }) => { signal = options.signal; return pending.promise; }) as any);
    const view = show(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Inativar equipe' }));
    const form = screen.getByRole('button', { name: 'Confirmar inativação' }).closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(api.patch).toHaveBeenCalledTimes(1);
    if (change === 'unit') context.unitId = 'unit-2';
    if (change === 'session') context.sessionKey = 'other-session';
    if (change === 'permission') context.permissions = ['teams.read'];
    view.update(); expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({ ...mockTeams[0], status: 'INACTIVE', revision: 3 }); await pending.promise; });
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText(/inativada com sucesso/)).not.toBeInTheDocument();
  });

  it.each(['id', 'unit', 'revision'] as const)('bloqueia recibo de situação com %s incorreto até conferir novamente', async mismatch => {
    const receipt = { ...mockTeams[0], status: 'INACTIVE', revision: 3 };
    if (mismatch === 'id') receipt.id = 'other-team';
    if (mismatch === 'unit') receipt.unitId = 'other-unit';
    if (mismatch === 'revision') receipt.revision = 2;
    vi.mocked(api.patch).mockResolvedValue(receipt as never);
    const view = show(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: 'Inativar equipe' }));
    fireEvent.change(screen.getByLabelText('Motivo da inativação (opcional)'), { target: { value: 'Conferir recebimento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar inativação' }));
    expect(await screen.findByText(responseError)).toBeVisible();
    expect(screen.getByLabelText('Motivo da inativação (opcional)')).toHaveValue('Conferir recebimento');
    expect(screen.getByRole('button', { name: 'Confirmar inativação' })).toBeDisabled();
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar equipes e conferir' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar inativação' })).toBeEnabled());
  });

  it.each(['create', 'revoke'] as const)('impede duplicidade de %s e aborta ao fechar o modal', async operation => {
    const pending = deferred<unknown>(); let signal: AbortSignal | undefined;
    vi.mocked(api.post).mockImplementation(((_path: string, _input: unknown, options: { signal: AbortSignal }) => { signal = options.signal; return pending.promise; }) as any);
    const view = show(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    const dialog = await openInvites();
    if (operation === 'create') {
      const form = within(dialog).getByRole('button', { name: 'Gerar link de convite' }).closest('form')!;
      act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    } else {
      const revoke = within(dialog).getByRole('button', { name: 'Revogar convite' });
      act(() => { fireEvent.click(revoke); fireEvent.click(revoke); });
    }
    expect(api.post).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar janela' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { pending.resolve({ ...mockInvites[0], status: operation === 'create' ? 'ACTIVE' : 'REVOKED' }); await pending.promise; });
    expect(invalidate).not.toHaveBeenCalled(); expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    { unitId: 'other-unit' }, { teamId: 'other-team' },
    { shareUrl: 'javascript:alert(1)' }, { shareUrl: 'https://external.example/convite/tok-abc' },
    { shareUrl: `${window.location.origin}/convite/other-token` },
  ])('recusa lista de convites fora do escopo ou com URL insegura: %j', async invalid => {
    vi.mocked(api.get).mockImplementation(((path: string) => Promise.resolve(path === '/teams' ? mockTeams : [{ ...mockInvites[0], ...invalid }])) as any);
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' }));
    expect(await screen.findByText(responseError)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /Link de convite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Abrir convite/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar link de convite' })).toBeDisabled();
  });

  it.each([{ unitId: 'other-unit' }, { teamId: 'other-team' }, { shareUrl: 'javascript:alert(1)' }, { expiresAt: '2020-01-01T00:00:00Z' }])('não copia nem invalida recibo de convite inválido: %j', async invalid => {
    vi.mocked(api.post).mockResolvedValue({ ...mockInvites[0], ...invalid } as never);
    const view = show(); const invalidate = vi.spyOn(view.client, 'invalidateQueries'); await openInvites();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de convite' }));
    expect(await screen.findByText(responseError)).toBeVisible();
    expect(invalidate).not.toHaveBeenCalled(); expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Novo link de convite gerado com sucesso!')).not.toBeInTheDocument();
  });

  it.each([403, 404])('não copia convite criado quando a conferência posterior retorna %s', async status => {
    show(); await openInvites();
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(status, { code: 'FORBIDDEN', message: 'Detalhe restrito do convite', requestId: 'test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de convite' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar carregar convites novamente' })).toBeEnabled());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByText('Novo link de convite gerado com sucesso!')).not.toBeInTheDocument();
    expect(screen.queryByText('Detalhe restrito do convite')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Link de convite/ })).not.toBeInTheDocument();
  });

  it('mantém convites previamente recusados ocultos ao reabrir até uma consulta válida', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    show('', client); const dialog = await openInvites();
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Restrito', requestId: 'test' }));
    await act(async () => { await client.refetchQueries({ queryKey: ['team-invites', 'teams-test', 'unit-1', 'team-active'], exact: true }); });
    await screen.findByRole('button', { name: 'Tentar carregar convites novamente' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar janela' }));
    fireEvent.click(screen.getByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' }));
    expect(screen.queryByRole('textbox', { name: /Link de convite/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar carregar convites novamente' }));
    expect(await screen.findByDisplayValue(mockInvites[0].shareUrl)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gerar link de convite' })).toBeEnabled());
  });

  it.each(['summary', 'inactiveReason'] as const)('recusa cache de equipes com %s inválido enquanto a rede está pendente', async invalid => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pending = deferred<unknown>();
    client.setQueryData(['teams', 'teams-test', 'unit-1'], [invalid === 'summary' ? { id: 'team-active', name: 'Resumo', unitId: 'unit-1', companyId: 'comp-1' } : { ...mockTeams[1], inactiveReason: {} }]);
    vi.mocked(api.get).mockImplementation((() => pending.promise) as any); show('', client);
    expect(await screen.findByText(responseError)).toBeVisible();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('não renderiza URL insegura em cache e libera o modal após resposta fresca válida', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const pending = deferred<unknown>();
    client.setQueryData(['team-invites', 'teams-test', 'unit-1', 'team-active'], [{ ...mockInvites[0], shareUrl: 'javascript:alert(1)' }]);
    vi.mocked(api.get).mockImplementation(((path: string) => path === '/teams' ? Promise.resolve(mockTeams) : pending.promise) as any);
    show('', client); fireEvent.click(await screen.findByRole('button', { name: 'Convites por link da equipe Equipe Operacional Ativa' }));
    expect(await screen.findByText(responseError)).toBeVisible();
    expect(screen.queryByRole('link', { name: /Abrir convite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Link de convite/ })).not.toBeInTheDocument();
    await act(async () => { pending.resolve(mockInvites); await pending.promise; });
    expect(await screen.findByDisplayValue(mockInvites[0].shareUrl)).toBeVisible();
  });

  it.each(['unit', 'read'] as const)('não consulta equipes sem %s', async missing => {
    if (missing === 'unit') context.unitId = undefined; else context.permissions = [];
    show(); expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Inativar equipe' })).not.toBeInTheDocument();
  });

  it('não oferece convites nem alteração de situação para consulta sem escrita', async () => {
    context.permissions = ['teams.read']; show(); await screen.findByText('Equipe Operacional Ativa');
    expect(screen.queryByRole('button', { name: /Convites por link da equipe/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Inativar equipe|Reativar equipe/ })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
  });
});
