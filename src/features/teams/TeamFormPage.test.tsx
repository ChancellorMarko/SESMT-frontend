import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { TeamOptionsDto } from '../../shared/contracts/teams';
import type { TeamDto } from '../../shared/contracts/work-permits';
import { TeamFormPage } from './TeamFormPage';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['teams.read', 'teams.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const options: TeamOptionsDto = { unitId: 'unit-a', workers: [
  { id: 'worker-a', name: 'Camila Demo', unitId: 'unit-a', companyId: 'company-a' },
  { id: 'worker-b', name: 'Bruno Demo', unitId: 'unit-a', companyId: 'company-a' },
] };
const team: TeamDto = { id: 'team-a', name: 'Equipe Demo', unitId: 'unit-a', companyId: 'company-a', chiefId: 'worker-a', revision: 1, members: [{ workerId: 'worker-a', name: 'Camila Demo', serviceFunction: 'Executante' }] };
const conflict = () => new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Equipe alterada por outra pessoa.', requestId: '' });

function show(editing = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[editing ? '/app/equipes/team-a/editar' : '/app/equipes/nova']}><Routes>
    <Route path="/app/equipes/nova" element={<TeamFormPage />} /><Route path="/app/equipes/:id/editar" element={<TeamFormPage />} /><Route path="/app/equipes" element={<p>Lista de equipes</p>} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
async function fill() {
  const user = userEvent.setup();
  const name = await screen.findByLabelText('Nome da equipe *'); await user.click(name); await user.paste('Nova equipe Demo');
  await user.selectOptions(screen.getByLabelText('Trabalhador 1 *'), 'worker-a');
  return user;
}
beforeEach(() => {
  state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['teams.read', 'teams.write'];
  vi.mocked(api.get).mockReset().mockImplementation(path => Promise.resolve(structuredClone(path === '/team-options' ? { ...options, unitId: state.unitId, workers: options.workers.map(worker => ({ ...worker, unitId: state.unitId })) } : team)));
  vi.mocked(api.post).mockReset().mockResolvedValue({ ...team, id: 'new-team' });
  vi.mocked(api.patch).mockReset().mockResolvedValue({ ...team, revision: 2 });
});

describe('cadastro protegido de equipes', () => {
  it('seleciona chefe automaticamente e impede incluir a mesma pessoa duas vezes', async () => {
    show(); const user = await fill(); expect(screen.getByLabelText('Chefe da equipe *')).toHaveValue('worker-a');
    await user.click(screen.getByRole('button', { name: 'Adicionar participante' }));
    expect(within(screen.getByLabelText('Trabalhador 2 *')).queryByRole('option', { name: 'Camila Demo' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Trabalhador 2 *'), 'worker-b');
    await user.selectOptions(screen.getByLabelText('Chefe da equipe *'), 'worker-b');
    await user.click(screen.getByRole('button', { name: 'Remover participante 2' }));
    expect(screen.getByLabelText('Chefe da equipe *')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' }));
    expect(await screen.findByText('Selecione o cadastro.')).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
  });
  it('preserva preenchimento e bloqueia salvamento quando uma pessoa deixou de estar ativa', async () => {
    const view = show(); const user = await fill();
    vi.mocked(api.get).mockResolvedValue({ ...options, workers: [options.workers[1]] });
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['team-options'] }); });
    expect(screen.getByLabelText('Nome da equipe *')).toHaveValue('Nova equipe Demo');
    expect(screen.getByLabelText('Trabalhador 1 *')).toHaveValue('worker-a');
    expect(await screen.findByText(/sem vínculo ativo disponível/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar equipe' })).toBeDisabled();
    // A programmatic submit receives the same check as the disabled button.
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar equipe' }).closest('form')!);
    expect(await screen.findByText('Selecione um trabalhador ativo e disponível nesta unidade e empresa.')).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Trabalhador 1 *'), 'worker-b');
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); expect(await screen.findByText('Lista de equipes')).toBeInTheDocument();
  });
  it('preserva os campos e exige atualização após falha na consulta de opções', async () => {
    const view = show(); const user = await fill();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta indisponível.'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['team-options'] }); });
    expect(screen.getByLabelText('Nome da equipe *')).toHaveValue('Nova equipe Demo'); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar equipe' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Atualizar opções' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar equipe' })).toBeEnabled());
  });
  it('bloqueia edição e saída durante envio e ignora a resposta de contexto anterior', async () => {
    let finish!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _payload, settings) => { signal = settings!.signal!; return new Promise(resolve => { finish = resolve; }); });
    const view = show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Nome da equipe *')).toBeDisabled();
    const event = new Event('sesmt:before-context-change', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Voltar às equipes' })); expect(screen.queryByText('Lista de equipes')).not.toBeInTheDocument();
    state.unitId = 'unit-b'; state.sessionKey = 'session-b'; view.update();
    expect(await screen.findByLabelText('Nome da equipe *')).toHaveValue(''); expect(signal.aborted).toBe(true);
    await act(async () => { finish({ ...team, id: 'old-context' }); });
    expect(screen.queryByText('Lista de equipes')).not.toBeInTheDocument(); expect(view.client.getQueryData(['team', 'session-b', 'unit-b', 'old-context'])).toBeUndefined();
  });
  it('reutiliza idempotência na repetição do mesmo envio e muda a chave após corrigir dados', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Conexão indisponível.'));
    show(); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); expect(await screen.findByRole('alert')).toHaveTextContent('Conexão indisponível.');
    const first = vi.mocked(api.post).mock.calls[0][2]!.idempotencyKey;
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls[1][2]!.idempotencyKey).toBe(first);
    await user.click(screen.getByLabelText('Nome da equipe *')); await user.paste(' corrigida');
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.post).mock.calls[2][2]!.idempotencyKey).not.toBe(first);
  });
  it('preserva revisão aberta após refetch e só usa revisão nova após comparação explícita', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(conflict());
    const view = show(true); const user = userEvent.setup(); await user.click(await screen.findByLabelText('Nome da equipe *')); await user.paste(' corrigida');
    const latest = { ...team, name: 'Alterada no servidor', revision: 5 };
    vi.mocked(api.get).mockImplementation(path => Promise.resolve(path === '/team-options' ? options : latest));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['team'] }); });
    expect(screen.getByLabelText('Nome da equipe *')).toHaveValue('Equipe Demo corrigida');
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); expect(await screen.findByRole('button', { name: 'Conferir versão atual' })).toBeInTheDocument();
    expect(vi.mocked(api.patch).mock.calls[0][2]!.etag).toBe('"1"');
    await user.click(screen.getByRole('button', { name: 'Conferir versão atual' })); expect(await screen.findByText('Cadastro atual · revisão 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usar revisão atual e manter meu preenchimento' }));
    vi.mocked(api.patch).mockResolvedValue({ ...latest, name: 'Equipe Demo corrigida', revision: 6 });
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); expect(await screen.findByText('Lista de equipes')).toBeInTheDocument();
    expect(vi.mocked(api.patch).mock.calls[1][2]!.etag).toBe('"5"');
  });
  it('recusa resposta de outra unidade sem apagar os campos nem alterar caches de outras sessões', async () => {
    const view = show(); view.client.setQueryData(['team', 'other-session', 'unit-a', 'new-team'], { name: 'Cadastro protegido' });
    vi.mocked(api.post).mockResolvedValue({ ...team, id: 'new-team', unitId: 'unit-b' });
    const user = await fill(); await user.click(screen.getByRole('button', { name: 'Salvar equipe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('outro contexto'); expect(screen.getByLabelText('Nome da equipe *')).toHaveValue('Nova equipe Demo');
    expect(view.client.getQueryData(['team', 'other-session', 'unit-a', 'new-team'])).toEqual({ name: 'Cadastro protegido' });
  });
  it('mantém o conflito e permite repetir a consulta após falha ao conferir a versão', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(conflict()); show(true); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Salvar equipe' }));
    await screen.findByRole('button', { name: 'Conferir versão atual' });
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha ao conferir versão.'));
    await user.click(screen.getByRole('button', { name: 'Conferir versão atual' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao conferir versão.');
    expect(screen.getByRole('button', { name: 'Salvar equipe' })).toBeDisabled();
    vi.mocked(api.get).mockResolvedValueOnce({ ...team, revision: 4 });
    await user.click(screen.getByRole('button', { name: 'Conferir versão atual' })); expect(await screen.findByText('Cadastro atual · revisão 4')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(api.patch).toHaveBeenCalledOnce();
  });
  it('mantém edição de equipe inativa sem sugerir reativação e preserva status enviado pelo servidor', async () => {
    vi.mocked(api.get).mockImplementation(path => Promise.resolve(path === '/team-options' ? options : { ...team, status: 'INACTIVE' }));
    vi.mocked(api.patch).mockResolvedValue({ ...team, status: 'INACTIVE', revision: 2 });
    show(true); const user = userEvent.setup(); expect(await screen.findByText(/Alterar o cadastro não a reativa/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar equipe' })); expect(await screen.findByText('Lista de equipes')).toBeInTheDocument();
    expect(vi.mocked(api.patch).mock.calls[0][1]).not.toHaveProperty('status');
  });
});
