import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type RequestOptions } from '../../shared/api/client';
import type { AssigneeDto, OrganizationDto, WorkerDto } from '../../shared/contracts';
import { WorkerMovementPage } from './WorkerMovementPage';
import { todayCivil } from './support';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['workers.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn() } }));
const organization: OrganizationDto = {
  companies: [{ id: 'company-a', name: 'Empresa A', status: 'ACTIVE', revision: 1 }], establishments: [],
  units: ['unit-a', 'unit-b'].map(id => ({ id, companyId: 'company-a', name: id, status: 'ACTIVE', revision: 1 })),
  sectors: ['unit-a', 'unit-b'].map((unitId, index) => ({ id: `sector-${index}`, unitId, name: `Setor ${index}`, status: 'ACTIVE', revision: 1 })),
  jobs: [{ id: 'job', companyId: 'company-a', name: 'Cargo A', status: 'ACTIVE', revision: 1 }],
  jobFunctions: [{ id: 'function', companyId: 'company-a', jobId: 'job', name: 'Função A', status: 'ACTIVE', revision: 1 }],
  workCenters: [{ id: 'center', unitId: 'unit-a', sectorId: 'sector-0', name: 'Centro A', status: 'ACTIVE', revision: 1 }],
};
const worker: WorkerDto = { id: 'worker', fullName: 'Pessoa de teste', registration: '001', employmentType: 'CLT', companyId: 'company-a', unitId: 'unit-a', sectorId: 'sector-0', jobId: 'job', jobFunctionId: 'function', workCenterId: 'center', managerId: 'manager-a', admissionDate: '2024-01-01', status: 'ACTIVE', revision: 3 };
const managers: AssigneeDto[] = Array.from({ length: 125 }, (_, index) => ({ id: `manager-${index + 1}`, displayName: `Gestor ${String(index + 1).padStart(3, '0')}` }));
function managerPage(config?: RequestOptions, rows = managers) {
  const ids = String(config?.query?.ids || '').split(',').filter(Boolean), q = String(config?.query?.q || '').toLocaleLowerCase('pt-BR');
  const page = Number(config?.query?.page || 1), pageSize = Number(config?.query?.pageSize || 20);
  const filtered = rows.filter(item => (!ids.length || ids.includes(item.id)) && item.displayName.toLocaleLowerCase('pt-BR').includes(q));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}
function show(cachedWorker?: WorkerDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedWorker) client.setQueryData(['worker', state.sessionKey, state.unitId, 'worker'], cachedWorker);
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/trabalhadores/worker/movimentacoes/nova']}><Routes><Route path="/app/trabalhadores/:id/movimentacoes/nova" element={<WorkerMovementPage />} /><Route path="/app/trabalhadores/:id" element={<p>Movimentação salva</p>} /></Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
async function fill() {
  const user = userEvent.setup(); const reason = await screen.findByLabelText('Motivo / justificativa *');
  await user.click(reason); await user.paste('Mudança de equipe.'); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeEnabled()); return user;
}
beforeEach(() => {
  state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['workers.write'];
  vi.mocked(api.get).mockReset().mockImplementation(async path => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? { items: [{ id: 'manager-a', displayName: 'Gestor A' }], total: 1, page: 1, pageSize: 100 } : structuredClone(worker));
  vi.mocked(api.post).mockReset();
});
describe('movimentação protegida de trabalhadores', () => {
  it('usa a revisão recebida na abertura da movimentação mesmo com vínculo antigo em cache', async () => {
    let finish!: (value: WorkerDto) => void;
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/workers/worker' ? new Promise(resolve => { finish = resolve as (value: WorkerDto) => void; }) : originalGet(path, options));
    const latest = { ...worker, revision: 4 };
    vi.mocked(api.post).mockResolvedValue({ movement: {}, worker: { ...latest, revision: 5 }, createdPendingItems: 0 });
    show(worker);
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.queryByLabelText('Motivo / justificativa *')).not.toBeInTheDocument();
    await act(async () => finish(latest));
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' }));
    await screen.findByText('Movimentação salva');
    expect(api.post).toHaveBeenCalledWith('/workers/worker/movements', expect.anything(), expect.objectContaining({ etag: '"4"' }));
  });
  it('envia null para remover cargo, função, centro e gestor do novo vínculo e preserva a revisão', async () => {
    vi.mocked(api.post).mockResolvedValue({ movement: {}, worker, createdPendingItems: 0 });
    show(); const user = await fill(); await user.selectOptions(screen.getByLabelText('Cargo'), '');
    await user.selectOptions(screen.getByLabelText('Centro de trabalho'), ''); await user.selectOptions(screen.getByLabelText('Gestor'), '');
    await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' })); await screen.findByText('Movimentação salva');
    expect(api.post).toHaveBeenCalledWith('/workers/worker/movements', {
      type: 'TRANSFER', effectiveDate: todayCivil(), reason: 'Mudança de equipe.',
      newAssignment: { companyId: 'company-a', unitId: 'unit-a', sectorId: 'sector-0', jobId: null, jobFunctionId: null, workCenterId: null, managerId: null },
    }, expect.objectContaining({ etag: '"3"', idempotencyKey: expect.any(String), signal: expect.any(AbortSignal) }));
  });
  it('limita tipos conforme a situação e rejeita data anterior à admissão sem chamar a API', async () => {
    show(); const user = await fill();
    expect(within(screen.getByLabelText('Tipo de movimentação *')).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['TRANSFER', 'LEAVE', 'TERMINATION']);
    fireEvent.change(screen.getByLabelText('Data efetiva *'), { target: { value: '2023-12-31' } }); await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' }));
    expect(await screen.findByText('A data efetiva deve estar entre a admissão e hoje.')).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
  });
  it('envia afastamento sem o vínculo oculto e limita opções de um trabalhador afastado', async () => {
    vi.mocked(api.get).mockImplementation(async path => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? { items: [], total: 0, page: 1, pageSize: 100 } : { ...worker, status: 'ON_LEAVE' });
    vi.mocked(api.post).mockResolvedValue({ movement: {}, worker: { ...worker, status: 'ACTIVE' }, createdPendingItems: 0 });
    show(); const user = await fill(); expect(screen.queryByLabelText('Cargo')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Tipo de movimentação *')).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['RETURN', 'TERMINATION']);
    await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' })); await screen.findByText('Movimentação salva');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ type: 'RETURN', effectiveDate: todayCivil(), reason: 'Mudança de equipe.' });
  });
  it('preserva justificativa após conflito e gera nova chave apenas quando o payload muda', async () => {
    vi.mocked(api.post).mockRejectedValue(Object.assign(new Error('Vínculo alterado.'), { status: 412 }));
    show(); const user = await fill(); const save = () => user.click(screen.getByRole('button', { name: 'Confirmar movimentação' }));
    await save(); await screen.findByRole('alert'); const key = vi.mocked(api.post).mock.calls[0][2]!.idempotencyKey;
    await save(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2)); expect(vi.mocked(api.post).mock.calls[1][2]!.idempotencyKey).toBe(key);
    await user.selectOptions(screen.getByLabelText('Tipo de movimentação *'), 'LEAVE'); await save(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.post).mock.calls[2][2]!.idempotencyKey).not.toBe(key); expect(screen.getByLabelText('Motivo / justificativa *')).toHaveValue('Mudança de equipe.');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); await user.click(screen.getByRole('button', { name: 'Recarregar vínculo' })); expect(confirm).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Tipo de movimentação *')).toHaveValue('LEAVE');
  });
  it('aborta envio antigo após troca forçada de contexto sem navegar no contexto novo', async () => {
    let resolve!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _payload, settings) => { signal = settings!.signal!; return new Promise(done => { resolve = done; }); });
    const view = show(); const user = await fill(); await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' })); await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Motivo / justificativa *')).toBeDisabled();
    const event = new Event('sesmt:before-context-change', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    state.unitId = 'unit-b'; state.sessionKey = 'session-b'; view.update(); expect(await screen.findByLabelText('Motivo / justificativa *')).toHaveValue(''); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ movement: {}, worker, createdPendingItems: 0 })); expect(screen.queryByText('Movimentação salva')).not.toBeInTheDocument();
  });
  it('preserva a justificativa após falha de refetch e oculta o formulário quando o acesso é revogado', async () => {
    const view = show(); await fill();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta indisponível.'));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['worker'] }); });
    expect(screen.getByLabelText('Motivo / justificativa *')).toHaveValue('Mudança de equipe.'); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeDisabled());
    vi.mocked(api.get).mockRejectedValueOnce(Object.assign(new Error('Cadastro indisponível.'), { status: 404 }));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['worker'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Registro não encontrado/); expect(screen.queryByLabelText('Motivo / justificativa *')).not.toBeInTheDocument();
  });
  it('preserva cargo selecionado removido do catálogo e exige correção explícita antes de movimentar', async () => {
    const view = show(); const user = await fill();
    vi.mocked(api.get).mockResolvedValueOnce({ ...organization, jobs: [] });
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['organization'] }); });
    await waitFor(() => expect(view.client.getQueryData<OrganizationDto>(['organization', 'session-a', 'unit-a'])?.jobs).toHaveLength(0));
    expect(screen.getByLabelText('Cargo')).toHaveValue('job');
    await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cargo não pertence/); expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Motivo / justificativa *')).toHaveValue('Mudança de equipe.');
  });
  it('resolve gestor vinculado além dos primeiros 100 e mantém seleção ao paginar e buscar outro gestor', async () => {
    const original = { ...structuredClone(worker), managerId: 'manager-125' };
    vi.mocked(api.get).mockImplementation(async (path, config) => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? managerPage(config) : structuredClone(original));
    vi.mocked(api.post).mockResolvedValue({ movement: {}, worker: original, createdPendingItems: 0 });
    show(); const user = await fill(); expect(screen.getByLabelText('Gestor')).toHaveValue('manager-125'); expect(screen.getByRole('option', { name: 'Gestor 125' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima: gestores' })); await screen.findByRole('option', { name: 'Gestor 021' });
    expect(screen.getByLabelText('Gestor')).toHaveValue('manager-125'); expect(screen.getByRole('option', { name: 'Gestor 125' })).toBeInTheDocument();
    const search = screen.getByLabelText('Buscar gestores'); await user.type(search, 'Gestor 124');
    expect(api.get).not.toHaveBeenCalledWith('/assignees', expect.objectContaining({ query: expect.objectContaining({ q: 'Gestor 124' }) })); expect(api.post).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Enter' }); await screen.findByRole('option', { name: 'Gestor 124' }); expect(api.post).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Gestor'), 'manager-124'); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeEnabled());
    await user.clear(search); await user.click(screen.getByRole('button', { name: 'Pesquisar gestores' })); await screen.findByRole('option', { name: 'Gestor 001' });
    expect(screen.getByRole('option', { name: 'Gestor 124' })).toBeInTheDocument(); expect(screen.getByLabelText('Gestor')).toHaveValue('manager-124');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' })); await screen.findByText('Movimentação salva');
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ newAssignment: { managerId: 'manager-124' } });
    const calls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/assignees'); expect(calls.some(([, config]) => config?.query?.ids === 'manager-125')).toBe(true);
    expect(calls.every(([, config]) => config?.query?.purpose === 'WORKER_MANAGER' && config.query.unitId === 'unit-a')).toBe(true);
    expect(calls.filter(([, config]) => !config?.query?.ids).every(([, config]) => config?.query?.pageSize === 20)).toBe(true);
  });
  it.each([403, 503])('preserva justificativa e bloqueia destino após erro %s até revalidar gestor', async status => {
    const original = { ...structuredClone(worker), managerId: 'manager-125' }; let failed = false;
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      if (path === '/organization') return structuredClone(organization);
      if (path === '/assignees') { if (failed) throw new ApiError(status, { code: 'UNAVAILABLE', message: 'Opções indisponíveis.', requestId: 'test' }); return managerPage(config); }
      return structuredClone(original);
    });
    const view = show(); const user = await fill(); failed = true; await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); }); await screen.findByRole('button', { name: 'Tentar carregar gestores novamente' });
    expect(screen.getByLabelText('Motivo / justificativa *')).toHaveValue('Mudança de equipe.'); expect(screen.getByLabelText('Gestor')).toHaveValue('manager-125');
    expect(screen.queryByRole('option', { name: 'Gestor 125' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Confirmar movimentação' }).closest('form')!); await screen.findByText('Selecione um gestor disponível na unidade.'); expect(api.post).not.toHaveBeenCalled();
    failed = false; await user.click(screen.getByRole('button', { name: 'Tentar carregar gestores novamente' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Gestor 125' })).toBeInTheDocument(); expect(screen.getByLabelText('Motivo / justificativa *')).toHaveValue('Mudança de equipe.');
  });
  it('não exige lookup de gestor para afastamento e não envia o vínculo oculto depois de acesso negado', async () => {
    const original = { ...structuredClone(worker), managerId: 'manager-125' }; let failed = false;
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      if (path === '/organization') return structuredClone(organization);
      if (path === '/assignees') { if (failed) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Sem acesso.', requestId: 'test' }); return managerPage(config); }
      return structuredClone(original);
    });
    vi.mocked(api.post).mockResolvedValue({ movement: {}, worker: { ...original, status: 'ON_LEAVE' }, createdPendingItems: 0 });
    const view = show(); const user = await fill(); failed = true; await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); }); await screen.findByRole('button', { name: 'Tentar carregar gestores novamente' });
    expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeDisabled(); await user.selectOptions(screen.getByLabelText('Tipo de movimentação *'), 'LEAVE');
    expect(screen.queryByLabelText('Gestor')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Confirmar movimentação' })); await screen.findByText('Movimentação salva');
    expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ type: 'LEAVE', effectiveDate: todayCivil(), reason: 'Mudança de equipe.' });
  });
  it('mantém ID indisponível visível sem aceitar como gestor de destino apenas por ser o vínculo anterior', async () => {
    vi.mocked(api.get).mockImplementation(async (path, config) => path === '/organization' ? structuredClone(organization) : path === '/assignees' ? managerPage(config) : { ...structuredClone(worker), managerId: 'manager-removed' });
    show(); const user = userEvent.setup(); await screen.findByRole('option', { name: 'Selecionado; identificação indisponível: manager-removed' }); await user.type(screen.getByLabelText('Motivo / justificativa *'), 'Mudança com gestor removido.');
    expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeDisabled(); fireEvent.submit(screen.getByRole('button', { name: 'Confirmar movimentação' }).closest('form')!);
    await screen.findByText('Selecione um gestor disponível na unidade.'); expect(api.post).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Gestor'), 'manager-1'); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar movimentação' })).toBeEnabled());
  });
  it('cancela resposta antiga após troca de destino, reinicia critérios e mantém a justificativa', async () => {
    let complete!: (value: ReturnType<typeof managerPage>) => void; let oldSignal!: AbortSignal;
    vi.mocked(api.get).mockImplementation(async (path, config) => {
      if (path === '/organization') return structuredClone(organization);
      if (path === '/assignees') {
        if (config?.query?.unitId === 'unit-a' && config.query.q === 'aguardando') { oldSignal = config.signal!; return new Promise(resolve => { complete = resolve; }); }
        return managerPage(config, config?.query?.unitId === 'unit-b' ? [{ id: 'manager-b', displayName: 'Gestor do destino B' }] : managers);
      }
      return { ...structuredClone(worker), managerId: 'manager-125' };
    });
    show(); const user = await fill(); await user.type(screen.getByLabelText('Buscar gestores'), 'aguardando'); await user.click(screen.getByRole('button', { name: 'Pesquisar gestores' })); await waitFor(() => expect(oldSignal).toBeDefined());
    await user.selectOptions(screen.getByLabelText('Unidade *'), 'unit-b'); await screen.findByRole('option', { name: 'Gestor do destino B' }); expect(oldSignal.aborted).toBe(true);
    expect(screen.getByLabelText('Gestor')).toHaveValue(''); expect(screen.queryByLabelText('Buscar gestores')).not.toBeInTheDocument(); expect(screen.getByLabelText('Motivo / justificativa *')).toHaveValue('Mudança de equipe.');
    await act(async () => complete(managerPage(undefined, [{ id: 'manager-late', displayName: 'Gestor da unidade antiga' }])));
    expect(screen.queryByRole('option', { name: 'Gestor da unidade antiga' })).not.toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Gestor do destino B' })).toBeInTheDocument();
  });
});
