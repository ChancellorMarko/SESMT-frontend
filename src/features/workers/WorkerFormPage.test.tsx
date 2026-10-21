import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type RequestOptions } from '../../shared/api/client';
import type { AssigneeDto, OrganizationDto, WorkerDto } from '../../shared/contracts';
import { WorkerFormPage } from './WorkerFormPage';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['workers.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const organization: OrganizationDto = {
  companies: [{ id: 'company-a', name: 'Empresa A', status: 'ACTIVE', revision: 1 }], establishments: [],
  units: ['unit-a', 'unit-b'].map(id => ({ id, companyId: 'company-a', name: id, status: 'ACTIVE', revision: 1 })),
  sectors: ['unit-a', 'unit-b'].map((unitId, index) => ({ id: `sector-${index}`, unitId, name: `Setor ${index}`, status: 'ACTIVE', revision: 1 })),
  jobs: [], jobFunctions: [], workCenters: [],
};
const worker: WorkerDto = { id: 'worker', fullName: 'Pessoa de teste', registration: '001', employmentType: 'CLT', companyId: 'company-a', unitId: 'unit-a', sectorId: 'sector-0', admissionDate: '2024-01-01', status: 'ACTIVE', revision: 3 };
const managers: AssigneeDto[] = Array.from({ length: 125 }, (_, index) => ({ id: `manager-${index + 1}`, displayName: `Gestor ${String(index + 1).padStart(3, '0')}` }));
function managerPage(config?: RequestOptions, rows = managers) {
  const ids = String(config?.query?.ids || '').split(',').filter(Boolean), q = String(config?.query?.q || '').toLocaleLowerCase('pt-BR');
  const page = Number(config?.query?.page || 1), pageSize = Number(config?.query?.pageSize || 20);
  const filtered = rows.filter(item => (!ids.length || ids.includes(item.id)) && item.displayName.toLocaleLowerCase('pt-BR').includes(q));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}
function show(edit = false, cachedWorker?: WorkerDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedWorker) client.setQueryData(['worker', state.sessionKey, state.unitId, 'worker'], cachedWorker);
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[edit ? '/app/trabalhadores/worker/editar' : '/app/trabalhadores/novo']}><Routes><Route path="/app/trabalhadores/novo" element={<WorkerFormPage />} /><Route path="/app/trabalhadores/:id/editar" element={<WorkerFormPage />} /><Route path="/app/trabalhadores/:id" element={<p>Cadastro salvo</p>} /><Route path="/app/trabalhadores" element={<p>Lista de trabalhadores</p>} /></Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
async function fill() {
  const user = userEvent.setup();
  const name = await screen.findByLabelText('Nome completo *'); await user.click(name); await user.paste(worker.fullName);
  await user.click(screen.getByLabelText('Matrícula *')); await user.paste('001');
  await user.click(screen.getByLabelText('Tipo de vínculo *')); await user.paste('CLT');
  await user.selectOptions(screen.getByLabelText('Setor *'), 'sector-0');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled()); return user;
}
beforeEach(() => {
  state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['workers.write'];
  vi.mocked(api.get).mockReset().mockImplementation(async path => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? { items: [{ id: 'manager-a', displayName: 'Gestor A' }], total: 1, page: 1, pageSize: 100 } : structuredClone(worker));
  vi.mocked(api.post).mockReset(); vi.mocked(api.patch).mockReset();
});
describe('cadastro protegido de trabalhadores', () => {
  it('aguarda a leitura inicial atual antes de preencher uma edição com cadastro antigo em cache', async () => {
    let finish!: (value: WorkerDto) => void;
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/workers/worker' ? new Promise(resolve => { finish = resolve as (value: WorkerDto) => void; }) : originalGet(path, options));
    const latest = { ...worker, fullName: 'Cadastro atualizado no serviço', revision: 4 };
    vi.mocked(api.patch).mockResolvedValue({ ...latest, revision: 5 });
    show(true, worker);
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.queryByLabelText('Nome completo *')).not.toBeInTheDocument();
    await act(async () => finish(latest));
    expect(await screen.findByLabelText('Nome completo *')).toHaveValue(latest.fullName);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await screen.findByText('Cadastro salvo');
    expect(api.patch).toHaveBeenCalledWith('/workers/worker', expect.objectContaining({ fullName: latest.fullName }), expect.objectContaining({ etag: '"4"' }));
  });
  it('mantém chave para retry do mesmo cadastro e gera outra quando o usuário corrige o payload', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Falha temporária.'));
    show(); const user = await fill(); const save = () => user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await save(); await screen.findByRole('alert'); const first = vi.mocked(api.post).mock.calls[0][2]!.idempotencyKey;
    await save(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.post).mock.calls[1][2]!.idempotencyKey).toBe(first);
    await user.clear(screen.getByLabelText('Matrícula *')); await user.paste('002'); await save(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.post).mock.calls[2][2]!.idempotencyKey).not.toBe(first); expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName);
  });
  it('bloqueia edição e troca de unidade durante envio e ignora resposta antiga após mudança forçada de sessão', async () => {
    let resolve!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _payload, settings) => { signal = settings!.signal!; return new Promise(done => { resolve = done; }); });
    const view = show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce()); expect(screen.getByLabelText('Nome completo *')).toBeDisabled();
    const event = new Event('sesmt:before-context-change', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    state.unitId = 'unit-b'; state.sessionKey = 'session-b'; view.update(); expect(await screen.findByLabelText('Nome completo *')).toHaveValue(''); expect(signal.aborted).toBe(true);
    await act(async () => resolve(worker)); expect(screen.queryByText('Cadastro salvo')).not.toBeInTheDocument(); expect(screen.getByLabelText('Unidade *')).toHaveValue('unit-b');
  });
  it('preserva rascunho em falha de consulta e volta a habilitar o envio depois de confirmar os dados', async () => {
    const view = show(); const user = await fill();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta indisponível.'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['organization'] }); });
    expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Atualizar dados' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName); expect(api.post).not.toHaveBeenCalled();
  });
  it('oculta dados em cache quando a API retira acesso ao cadastro', async () => {
    const view = show(true); expect(await screen.findByLabelText('Nome completo *')).toHaveValue(worker.fullName);
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('Acesso removido.'), { status: 403 }));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['worker'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/não tem permissão/); expect(screen.queryByLabelText('Nome completo *')).not.toBeInTheDocument();
  });
  it('mantém alterações após conflito e só recarrega o cadastro quando o descarte é confirmado', async () => {
    vi.mocked(api.patch).mockRejectedValue(Object.assign(new Error('Outro usuário editou.'), { status: 412 }));
    show(true); const user = userEvent.setup(); const name = await screen.findByLabelText('Nome completo *');
    await user.clear(name); await user.paste('Nome corrigido'); await user.click(screen.getByRole('button', { name: 'Salvar cadastro' })); await screen.findByRole('alert');
    expect(api.patch).toHaveBeenCalledWith('/workers/worker', expect.objectContaining({ fullName: 'Nome corrigido', managerId: null }), expect.objectContaining({ etag: '"3"', signal: expect.any(AbortSignal) }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); await user.click(screen.getByRole('button', { name: 'Recarregar cadastro' })); expect(name).toHaveValue('Nome corrigido');
    confirm.mockReturnValue(true); await user.click(screen.getByRole('button', { name: 'Recarregar cadastro' })); await waitFor(() => expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName));
  });
  it('recusa um gestor removido da lista após seleção sem apagar os demais campos', async () => {
    const view = show(); const user = await fill(); await user.selectOptions(screen.getByLabelText('Gestor'), 'manager-a');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    vi.mocked(api.get).mockImplementation(async path => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? { items: [], total: 0, page: 1, pageSize: 20 } : structuredClone(worker));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); });
    await screen.findByRole('option', { name: 'Selecionado; identificação indisponível: manager-a' });
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cadastro' }).closest('form')!);
    expect(await screen.findByText('Selecione um gestor disponível na unidade.')).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled(); expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName);
  });
  it('busca e pagina 125 gestores, preservando seleção fora da página e salvando seu ID', async () => {
    vi.mocked(api.get).mockImplementation(async (path, config) => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? managerPage(config) : structuredClone(worker));
    vi.mocked(api.post).mockImplementation(async (_path, input) => ({ ...structuredClone(worker), ...input as object }));
    show(); const user = await fill(); const search = await screen.findByLabelText('Buscar gestores');
    await user.type(search, 'Gestor 125'); expect(api.get).not.toHaveBeenCalledWith('/assignees', expect.objectContaining({ query: expect.objectContaining({ q: 'Gestor 125' }) })); expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Pesquisar gestores' })); await screen.findByRole('option', { name: 'Gestor 125' });
    await user.selectOptions(screen.getByLabelText('Gestor'), 'manager-125'); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    await user.clear(search); await user.click(screen.getByRole('button', { name: 'Pesquisar gestores' })); await screen.findByRole('option', { name: 'Gestor 001' });
    expect(screen.getByRole('option', { name: 'Gestor 125' })).toBeInTheDocument(); expect(screen.getByLabelText('Gestor')).toHaveValue('manager-125');
    await user.click(screen.getByRole('button', { name: 'Próxima: gestores' })); await screen.findByRole('option', { name: 'Gestor 021' });
    expect(screen.getByLabelText('Gestor')).toHaveValue('manager-125'); expect(screen.getByRole('option', { name: 'Gestor 125' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Salvar cadastro' })); await screen.findByText('Cadastro salvo');
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ managerId: 'manager-125' });
    const calls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/assignees');
    expect(calls.some(([, config]) => config?.query?.ids === 'manager-125' && config.query.pageSize === 100)).toBe(true);
    expect(calls.filter(([, config]) => !config?.query?.ids).every(([, config]) => config?.query?.pageSize === 20)).toBe(true);
  });
  it('resolve gestor já vinculado além dos primeiros 100 e permite edição administrativa após acesso negado sem nomes antigos', async () => {
    let denied = false; const original = { ...structuredClone(worker), managerId: 'manager-125' };
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      if (path === '/organization') return structuredClone(organization);
      if (path === '/assignees') { if (denied) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Sem acesso.', requestId: 'test' }); return managerPage(config); }
      return structuredClone(original);
    });
    vi.mocked(api.patch).mockResolvedValue({ ...original, fullName: 'Nome atualizado' });
    const view = show(true); const user = userEvent.setup(); await screen.findByRole('option', { name: 'Gestor 125' });
    expect(screen.getByLabelText('Gestor')).toHaveValue('manager-125'); await user.clear(screen.getByLabelText('Nome completo *')); await user.paste('Nome atualizado');
    denied = true; await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); }); await screen.findByRole('button', { name: 'Tentar carregar gestores novamente' });
    expect(screen.queryByRole('option', { name: 'Gestor 125' })).not.toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'Gestor 001' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Selecionado; identificação indisponível: manager-125' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled(); await user.click(screen.getByRole('button', { name: 'Salvar cadastro' })); await screen.findByText('Cadastro salvo');
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ fullName: 'Nome atualizado', managerId: 'manager-125' });
  });
  it('preserva demais campos e bloqueia gestor novo após 403 até recuperação explícita', async () => {
    let denied = false;
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      if (path === '/organization') return structuredClone(organization);
      if (path === '/assignees') { if (denied) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Sem acesso.', requestId: 'test' }); return managerPage(config); }
      return structuredClone(worker);
    });
    const view = show(); const user = await fill(); await user.selectOptions(screen.getByLabelText('Gestor'), 'manager-1'); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    denied = true; await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); }); await screen.findByRole('button', { name: 'Tentar carregar gestores novamente' });
    expect(screen.queryByRole('option', { name: 'Gestor 001' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName); expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cadastro' }).closest('form')!); await screen.findByText('Selecione um gestor disponível na unidade.'); expect(api.post).not.toHaveBeenCalled();
    denied = false; await user.click(screen.getByRole('button', { name: 'Tentar carregar gestores novamente' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Gestor 001' })).toBeInTheDocument(); expect(screen.getByLabelText('Gestor')).toHaveValue('manager-1'); expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName);
  });
  it('cancela a busca antiga ao trocar destino e não mistura gestores ou critérios de outra unidade', async () => {
    let complete!: (value: ReturnType<typeof managerPage>) => void; let oldSignal!: AbortSignal;
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      if (path === '/organization') return structuredClone(organization);
      if (path === '/assignees') {
        if (config?.query?.unitId === 'unit-a' && config.query.q === 'aguardando') { oldSignal = config.signal!; return new Promise(resolve => { complete = resolve; }); }
        return managerPage(config, config?.query?.unitId === 'unit-b' ? [{ id: 'manager-b', displayName: 'Gestor da unidade B' }] : managers);
      }
      return structuredClone(worker);
    });
    show(); const user = await fill(); await user.type(await screen.findByLabelText('Buscar gestores'), 'aguardando'); await user.click(screen.getByRole('button', { name: 'Pesquisar gestores' }));
    await waitFor(() => expect(oldSignal).toBeDefined()); await user.selectOptions(screen.getByLabelText('Unidade *'), 'unit-b'); await screen.findByRole('option', { name: 'Gestor da unidade B' });
    expect(oldSignal.aborted).toBe(true); expect(screen.getByLabelText('Gestor')).toHaveValue(''); expect(screen.queryByLabelText('Buscar gestores')).not.toBeInTheDocument();
    await act(async () => complete(managerPage(undefined, [{ id: 'manager-a-late', displayName: 'Gestor antigo da unidade A' }])));
    expect(screen.queryByRole('option', { name: 'Gestor antigo da unidade A' })).not.toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Gestor da unidade B' })).toBeInTheDocument(); expect(screen.getByLabelText('Nome completo *')).toHaveValue(worker.fullName);
  });
});
