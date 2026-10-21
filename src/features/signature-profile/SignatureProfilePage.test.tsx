import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { SignatureRepresentationDto } from '../../shared/contracts/signature-representation';
import { SignatureProfilePage } from './SignatureProfilePage';

const state = vi.hoisted(() => ({ profile: null as SignatureRepresentationDto | null, allowed: true, unitId: 'unit-a', sessionKey: 'engineer-session' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: state.sessionKey, unitId: state.unitId, me: { user: { id: 'engineer', displayName: 'Engenheira Demo' } }, can: () => state.allowed }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(async () => structuredClone(state.profile)), put: vi.fn(async (_path, payload) => { state.profile = { ...payload, id: 'profile', userId: 'engineer', version: (state.profile?.version || 0) + 1, revision: (state.profile?.revision || 0) + 1, updatedAt: '2026-10-14T12:00:00Z' }; return structuredClone(state.profile); }), post: vi.fn() } }));
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const saved = (): SignatureRepresentationDto => ({ id: 'profile', userId: 'engineer', version: 1, revision: 1, method: 'IMAGE', representation: 'Engenheira Demo', image, updatedAt: '2026-10-14T12:00:00Z' });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = <QueryClientProvider client={client}><MemoryRouter><SignatureProfilePage /></MemoryRouter></QueryClientProvider>;
  return { client, tree, ...render(tree), refresh: () => <QueryClientProvider client={client}><MemoryRouter><SignatureProfilePage /></MemoryRouter></QueryClientProvider> };
}
beforeEach(() => { state.profile = null; state.allowed = true; state.unitId = 'unit-a'; state.sessionKey = 'engineer-session'; vi.clearAllMocks(); });
describe('representação pessoal reutilizável', () => {
  it('bloqueia o editor e a troca de contexto durante recarga explícita para evitar sobrescrever alterações', async () => {
    state.profile = saved(); const user = userEvent.setup(); show();
    await screen.findByAltText('Prévia da representação pessoal');
    let finish!: (value: SignatureRepresentationDto) => void;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Carregar perfil atual' }));
    expect(screen.getByRole('radio', { name: 'Nome digitado' })).toBeDisabled();
    expect(screen.getByLabelText('Imagem da representação pessoal')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar representação pessoal' })).toBeDisabled();
    const context = new Event('sesmt:before-context-change', { cancelable: true }); fireEvent(window, context); expect(context.defaultPrevented).toBe(true);
    await act(async () => { finish({ ...saved(), revision: 2, version: 2 }); });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Nome digitado' })).not.toBeDisabled());
    expect(screen.getByText(/Perfil salvo · versão 2/)).toBeInTheDocument(); expect(api.put).not.toHaveBeenCalled();
  });
  it('exige confirmação explícita e salva somente perfil, sem aprovar PT', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Salvar representação pessoal' }));
    expect(api.put).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent(/Confirme o salvamento/);
    await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Salvar representação pessoal' }));
    await screen.findByText(/Nenhuma PT foi aprovada por esta ação/);
    expect(api.put).toHaveBeenCalledWith('/me/signature-representation', { method: 'TYPED', representation: 'Engenheira Demo', confirmed: true }, expect.objectContaining({ etag: '"0"' }));
    expect(api.post).not.toHaveBeenCalled(); expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('não carrega perfil sem permissão nem mostra imagem de outro usuário', async () => {
    state.allowed = false; const view = show();
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
    state.allowed = true; state.profile = { ...saved(), userId: 'another' }; view.rerender(view.refresh());
    await screen.findByText(/não pertence ao usuário autenticado/); expect(screen.queryByAltText('Prévia da representação pessoal')).not.toBeInTheDocument();
  });
  it('rejeita dados falsos de imagem e troca de método elimina a representação anterior', async () => {
    state.profile = saved(); const user = userEvent.setup(); show();
    expect(await screen.findByAltText('Prévia da representação pessoal')).toHaveAttribute('src', image);
    await user.upload(screen.getByLabelText('Imagem da representação pessoal'), new File(['arquivo falso'], 'falsa.png', { type: 'image/png' }));
    await screen.findByText(/Não foi possível ler uma imagem PNG ou JPEG válida/);
    expect(screen.queryByAltText('Prévia da representação pessoal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Nome digitado' }));
    await user.click(screen.getByRole('radio', { name: 'Upload de imagem' }));
    await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Salvar representação pessoal' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Selecione uma imagem/); expect(api.put).not.toHaveBeenCalled();
  });
  it('mantém preenchimento diante de revisão concorrente e bloqueia salvamento desatualizado', async () => {
    state.profile = saved(); const user = userEvent.setup(); const view = show();
    await screen.findByAltText('Prévia da representação pessoal');
    await user.click(screen.getByRole('radio', { name: 'Nome digitado' })); await user.click(screen.getByRole('checkbox'));
    state.profile = { ...saved(), revision: 2, version: 2 };
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['signature-representation'] }); });
    await user.click(screen.getByRole('button', { name: 'Salvar representação pessoal' }));
    expect(api.put).not.toHaveBeenCalled(); expect(screen.getByRole('radio', { name: 'Nome digitado' })).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent(/Seu preenchimento foi preservado/);
  });
  it('bloqueia mudança de contexto durante envio e ignora resposta após desmontagem', async () => {
    const user = userEvent.setup(); const view = show();
    let finish!: (profile: SignatureRepresentationDto) => void;
    vi.mocked(api.put).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await user.click(await screen.findByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Salvar representação pessoal' }));
    await screen.findByRole('button', { name: 'Salvando…' });
    const before = new Event('sesmt:before-context-change', { cancelable: true }); fireEvent(window, before); expect(before.defaultPrevented).toBe(true);
    const signal = vi.mocked(api.put).mock.calls[0][2]?.signal;
    view.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => { finish(saved()); });
    expect(view.client.getQueryData(['signature-representation', state.sessionKey, state.unitId])).toBeNull();
  });
});
