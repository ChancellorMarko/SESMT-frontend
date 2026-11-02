import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { DesignationDto } from '../../shared/contracts/designations';
import { DesignationDetailPage } from './DesignationDetailPage';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['appointments.read', 'appointments.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const designation: DesignationDto = { id: 'designation', unitId: 'unit-a', responsibleId: 'responsible', responsibleName: 'Técnico Demo', serviceTypeIds: ['service'], serviceNames: ['Trabalho em altura'], locationPattern: 'Galpão de teste', validFrom: '2026-10-01', validUntil: '2026-12-31', status: 'ACTIVE', createdAt: '2026-10-13T12:00:00Z', createdBy: 'engineer', createdByName: 'Engenheira Demo', revision: 1, history: [] };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/designacoes/designation']}><Routes><Route path="/app/designacoes/:id" element={<DesignationDetailPage />} /><Route path="/app/designacoes" element={<p>Lista de designações</p>} /></Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
beforeEach(() => {
  state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['appointments.read', 'appointments.write'];
  vi.mocked(api.get).mockReset().mockResolvedValue(structuredClone(designation)); vi.mocked(api.post).mockReset();
});

describe('revogação protegida de designações', () => {
  it('não apresenta dados ou revogação do registro de outra unidade', async () => {
    state.unitId = 'unit-b'; show();
    expect(await screen.findByRole('heading', { name: 'Designação de outra unidade' })).toBeInTheDocument();
    expect(screen.queryByText('Técnico Demo')).not.toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
  });
  it('mantém o motivo e bloqueia confirmação após refetch mudar a revisão', async () => {
    const user = userEvent.setup(); const view = show(); await user.click(await screen.findByRole('button', { name: 'Revogar designação' }));
    const dialog = screen.getByRole('dialog'); await user.type(within(dialog).getByLabelText('Motivo da revogação *'), 'Alteração do responsável da operação.');
    await act(async () => { view.client.setQueryData(['designation', 'session-a', 'unit-a', 'designation'], { ...designation, revision: 2 }); });
    expect(within(dialog).getByLabelText('Motivo da revogação *')).toHaveValue('Alteração do responsável da operação.');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirmar revogação' })).toBeDisabled());
    expect(within(dialog).getByText(/designação foi atualizada enquanto esta janela/)).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Revogar designação' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar revogação' })).toBeEnabled();
  });
  it('mantém modal e motivo imutáveis durante envio, impedindo Escape, fechamento e troca de contexto', async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const user = userEvent.setup(); show(); await user.click(await screen.findByRole('button', { name: 'Revogar designação' }));
    const dialog = screen.getByRole('dialog'); await user.type(within(dialog).getByLabelText('Motivo da revogação *'), 'Responsável substituído após revisão de escala.');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar revogação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenCalledWith('/designations/designation/revoke', { reason: 'Responsável substituído após revisão de escala.' }, { etag: '"1"', signal: expect.any(AbortSignal) });
    expect(within(dialog).getByLabelText('Motivo da revogação *')).toBeDisabled();
    await user.keyboard('{Escape}'); await user.click(within(dialog).getByRole('button', { name: 'Fechar janela' }));
    expect(screen.getByRole('dialog', { name: 'Revogar designação' })).toBeInTheDocument();
    const event = new Event('sesmt:before-context-change', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await act(async () => { complete({ ...designation, status: 'REVOKED', revision: 2 }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('não aplica resposta pendente da conta antiga ao trocar o contexto forçadamente', async () => {
    let complete!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _body, settings) => { signal = settings!.signal!; return new Promise(resolve => { complete = resolve; }); });
    const user = userEvent.setup(); const view = show(); await user.click(await screen.findByRole('button', { name: 'Revogar designação' }));
    await user.type(screen.getByLabelText('Motivo da revogação *'), 'Ajustar designação da operação.'); await user.click(screen.getByRole('button', { name: 'Confirmar revogação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce()); state.sessionKey = 'other-session'; state.unitId = 'unit-b'; view.update();
    await screen.findByRole('heading', { name: 'Designação de outra unidade' }); expect(signal.aborted).toBe(true);
    await act(async () => { complete({ ...designation, status: 'REVOKED', revision: 2 }); });
    expect(view.client.getQueryData(['designation', 'other-session', 'unit-b', 'designation'])).toEqual(designation);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
