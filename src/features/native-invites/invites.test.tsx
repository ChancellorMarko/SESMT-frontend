import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { appointmentFixture, operationIds as ids, teamFixture } from '../../../tests/connection-ui/fixtures/native-operations';
import { checkedInviteContext, checkedInviteCreated, checkedInviteList } from './contracts';
import { NativeInvitePage } from './NativeInvitePage';
import { NativeTeamInvites } from './NativeTeamInvites';

const state = vi.hoisted(() => ({ grants: ['agenda:editar', 'equipe:ler'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'invite-test', unitId: ids.unit, can: (permission: string) => state.grants.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const token = 'tok_' + 'a'.repeat(39);
const invite = { id: '69000000-0000-4000-8000-000000000001', companyId: ids.company, teamId: ids.team, locationId: ids.unit, createdAt: '2026-11-09T12:00:00Z', expiresAt: '2099-11-10T12:00:00Z', revokedAt: null, status: 'ACTIVE', version: 1 };
const context = { companyId: ids.company, teamId: ids.team, locationId: ids.unit, teamName: 'Equipe de manutenção', participantIds: [ids.worker], expiresAt: '2099-11-10T12:00:00Z',
  allowedActions: ['REQUEST_APPOINTMENT', 'READ_OWN_REQUESTS'], locationName: 'Unidade principal', members: [{ id: ids.worker, name: 'Alice Trabalhadora' }], services: [{ id: ids.service, code: 'ALTURA', name: 'Trabalho em altura' }] };
const request = { ...appointmentFixture(), title: 'Pedido pelo link', requestedBy: null, requestedViaInviteId: invite.id };

function show(node: React.ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/convite/:token" element={node}/><Route path="*" element={node}/></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.post).mockReset(); vi.mocked(api.get).mockReset(); state.grants = ['agenda:editar', 'equipe:ler']; });

describe('contratos de convite', () => {
  it('extrai o token somente de um link /convite e recusa listagem com token', () => {
    expect(checkedInviteCreated({ id: invite.id, inviteUrl: `/convite/${token}`, expiresAt: invite.expiresAt, teamId: ids.team, version: 1 }, { teamId: ids.team, expiresAt: invite.expiresAt }).token).toBe(token);
    expect(() => checkedInviteCreated({ id: invite.id, inviteUrl: `https://outro.example/convite/${token}`, expiresAt: invite.expiresAt, teamId: ids.team, version: 1 }, { teamId: ids.team, expiresAt: invite.expiresAt })).toThrow();
    expect(() => checkedInviteList([{ ...invite, inviteUrl: `/convite/${token}` }], { companyId: ids.company, teamId: ids.team })).toThrow();
    expect(() => checkedInviteList([{ ...invite, teamId: ids.organization }], { companyId: ids.company, teamId: ids.team })).toThrow();
    expect(() => checkedInviteContext({ ...context, members: [{ id: ids.user, name: 'Fora da equipe' }] })).toThrow();
  });
});

describe('convites da equipe', () => {
  it('gera o convite com a validade escolhida e mostra o link uma única vez', async () => {
    vi.mocked(api.get).mockResolvedValue([invite] as never);
    vi.mocked(api.post).mockImplementation(async (_path, body) => ({ id: invite.id, inviteUrl: `/convite/${token}`, expiresAt: (body as { expiresAt: string }).expiresAt, teamId: ids.team, version: 1 }) as never);
    show(<NativeTeamInvites team={teamFixture() as never} onClose={() => {}}/>);
    expect(await screen.findByText('Ativo')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Validade do convite'), { target: { value: '72' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gerar convite' }));
    expect(await screen.findByLabelText('Link do convite')).toHaveValue(`${window.location.origin}/convite/${token}`);
    const [path, body] = vi.mocked(api.post).mock.calls[0] as [string, { expiresAt: string; locationId: string; companyId: string }];
    expect(path).toBe('/invites'); expect(body).toMatchObject({ companyId: ids.company, teamId: ids.team, locationId: ids.unit });
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(71 * 3600000);
    expect(api.get).toHaveBeenCalledWith('/invites', expect.objectContaining({ query: { companyId: ids.company, teamId: ids.team } }));
  });
  it('revoga com a versão listada e relê a lista', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([invite] as never).mockResolvedValue([{ ...invite, status: 'REVOKED', revokedAt: '2026-11-09T13:00:00Z', version: 2 }] as never);
    vi.mocked(api.post).mockResolvedValue(undefined as never);
    show(<NativeTeamInvites team={teamFixture() as never} onClose={() => {}}/>);
    fireEvent.click(await screen.findByRole('button', { name: /Revogar convite gerado em/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
    expect(await screen.findByText('Revogado')).toBeVisible();
    expect(api.post).toHaveBeenCalledWith(`/invites/${invite.id}/revoke`, { expectedVersion: 1 }, expect.anything());
    expect(screen.getByText(/deixou de aceitar solicitações/)).toBeVisible();
  });
});

describe('página pública do convite', () => {
  async function fill() {
    expect(await screen.findByText(/Unidade principal/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Pedido pelo link' } });
    fireEvent.change(screen.getByLabelText('Início (Brasília) *'), { target: { value: '2099-11-20T09:00' } });
    fireEvent.change(screen.getByLabelText('Término (Brasília) *'), { target: { value: '2099-11-20T10:00' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trabalho em altura' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice Trabalhadora' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Entendo que a solicitação/ }));
  }
  it('envia pelo token do link e repete com a mesma chave após resultado incerto', async () => {
    vi.mocked(api.get).mockResolvedValue(context as never);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Não foi possível conectar à API.')).mockResolvedValueOnce(request as never);
    show(<NativeInvitePage/>, `/convite/${token}`);
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    expect(await screen.findByText(/enviar de novo sem alterar o formulário/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitação' }));
    expect(await screen.findByRole('heading', { name: 'Pedido pelo link' })).toBeVisible();
    expect(api.get).toHaveBeenCalledWith('/invites/context', expect.objectContaining({ inviteToken: token }));
    const calls = vi.mocked(api.post).mock.calls;
    expect(calls[0][0]).toBe('/invites/appointments');
    expect(calls[0][1]).toEqual({ title: 'Pedido pelo link', startsAt: '2099-11-20T12:00:00.000Z', endsAt: '2099-11-20T13:00:00.000Z', serviceIds: [ids.service], participantIds: [ids.worker] });
    expect(calls[0][2]).toMatchObject({ inviteToken: token }); expect(calls[1][2]?.idempotencyKey).toBe(calls[0][2]?.idempotencyKey);
  });
  it('mostra convite inválido quando a API recusa o token, sem formulário', async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, { code: 'INVALID_INVITE', message: 'privado', requestId: 'test' }));
    show(<NativeInvitePage/>, `/convite/${token}`);
    expect(await screen.findByText('Convite inválido, expirado ou revogado')).toBeVisible();
    expect(screen.queryByLabelText('Título *')).not.toBeInTheDocument();
  });
  it('não consulta a API com um token malformado', async () => {
    show(<NativeInvitePage/>, '/convite/curto');
    expect(await screen.findByText('Convite inválido, expirado ou revogado')).toBeVisible();
    await waitFor(() => expect(api.get).not.toHaveBeenCalled());
  });
});
