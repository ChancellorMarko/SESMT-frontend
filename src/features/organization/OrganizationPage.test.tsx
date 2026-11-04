import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, type RequestOptions } from '../../shared/api/client';
import type { AssigneeDto, OrganizationDto } from '../../shared/contracts';
import { OrganizationPage } from './OrganizationPage';

const context = vi.hoisted(() => ({ sessionKey: 'session-a', unitId: 'unit-a', write: true }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...context, can: (permission: string) => permission !== 'organization.write' || context.write }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const seed: OrganizationDto = {
  companies: [{ id: 'company-a', name: 'Empresa Alfa', status: 'ACTIVE', revision: 1 }, { id: 'company-b', name: 'Empresa Beta', status: 'ACTIVE', revision: 1 }],
  units: [{ id: 'unit-a', name: 'Unidade Alfa', companyId: 'company-a', status: 'ACTIVE', revision: 1, responsibleIds: ['person-a'] }, { id: 'unit-b', name: 'Unidade Beta', companyId: 'company-b', status: 'ACTIVE', revision: 1, responsibleIds: [] }],
  sectors: [{ id: 'sector-a', name: 'Setor Alfa', unitId: 'unit-a', status: 'ACTIVE', revision: 1 }],
  establishments: [], jobs: [], jobFunctions: [], workCenters: [],
};
let organization: OrganizationDto;
const eligiblePeople: AssigneeDto[] = Array.from({ length: 125 }, (_, index) => ({ id: `person-${index + 1}`, displayName: `Responsável ${String(index + 1).padStart(3, '0')}` }));
function responsiblePage(options?: RequestOptions, rows: AssigneeDto[] = [{ id: 'person-a', displayName: 'Pessoa elegível' }]) {
  const query = options?.query ?? {}, ids = String(query.ids || '').split(',').filter(Boolean), q = String(query.q || '').toLocaleLowerCase('pt-BR');
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20);
  const filtered = rows.filter(item => (!ids.length || ids.includes(item.id)) && item.displayName.toLocaleLowerCase('pt-BR').includes(q));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length };
}
const selectedResponsibleIds = () => Array.from((screen.getByLabelText('Responsáveis elegíveis') as HTMLSelectElement).selectedOptions, option => option.value);
beforeEach(() => {
  context.sessionKey = 'session-a'; context.unitId = 'unit-a'; context.write = true;
  organization = structuredClone(seed); vi.clearAllMocks();
  vi.mocked(api.get).mockReset().mockImplementation(async (path, options) => path === '/organization' ? structuredClone(organization) as never : responsiblePage(options) as never);
  vi.mocked(api.post).mockReset(); vi.mocked(api.patch).mockReset();
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => <QueryClientProvider client={client}><OrganizationPage /></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
async function createUnit() {
  const user = userEvent.setup(); await screen.findByRole('heading', { name: 'Cadastros organizacionais' });
  await user.click(screen.getByRole('button', { name: 'Cadastrar unidade' }));
  fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Unidade em preparação' } });
  return user;
}
describe('cadastros organizacionais no contexto autorizado', () => {
  it('descarta contexto antigo e aborta a gravação sem entregar sucesso ao novo editor', async () => {
    let finish!: (value: unknown) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _payload, options) => { signal = options!.signal!; return new Promise(resolve => { finish = resolve; }); });
    const view = show(), user = await createUnit();
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Nome *')).toBeDisabled();
    const event = new Event('sesmt:before-context-change', { cancelable: true }); act(() => window.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true);
    context.sessionKey = 'session-b'; context.unitId = 'unit-b'; view.update();
    expect(signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Cadastrar unidade' }));
    expect(screen.getByLabelText('Nome *')).toHaveValue(''); expect(screen.getByLabelText('Empresa *')).toHaveValue('company-b');
    await act(async () => { finish({ id: 'old-unit' }); });
    expect(screen.getByRole('dialog', { name: 'Cadastrar unidade' })).toBeInTheDocument();
    expect(screen.queryByText('Cadastro organizacional salvo.')).not.toBeInTheDocument();
  });
  it('encerra o editor e aborta pedido quando a autorização de escrita é retirada', async () => {
    let signal!: AbortSignal; vi.mocked(api.post).mockImplementation((_path, _payload, options) => { signal = options!.signal!; return new Promise(() => {}); });
    const view = show(), user = await createUnit(); await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce()); context.write = false; view.update();
    expect(signal.aborted).toBe(true); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cadastrar unidade' })).not.toBeInTheDocument();
  });
  it('preserva campos e revisão de intenção após conflito e atualiza somente a lista', async () => {
    const view = show(), user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' }));
    await screen.findByRole('option', { name: 'Pessoa elegível' }); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Minha edição preservada' } });
    organization.units[0] = { ...organization.units[0], name: 'Alterado por outra pessoa', revision: 2 };
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Outra pessoa alterou este cadastro.', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByText(/Outra pessoa alterou este cadastro\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Nome *')).toHaveValue('Minha edição preservada');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar Alterado por outra pessoa' })).toBeInTheDocument());
    expect(api.patch).toHaveBeenCalledWith('/units/unit-a', expect.objectContaining({ name: 'Minha edição preservada', responsibleIds: ['person-a'] }), expect.objectContaining({ etag: '"1"' }));
    vi.spyOn(window, 'confirm').mockReturnValue(true); await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Editar Alterado por outra pessoa' }));
    expect(screen.getByLabelText('Nome *')).toHaveValue('Alterado por outra pessoa');
    view.unmount();
  });
  it('bloqueia confirmação desatualizada e reinicia intenção em outra unidade', async () => {
    const view = show(), user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Setores/ }));
    await user.click(screen.getByRole('button', { name: 'Inativar Setor Alfa' }));
    organization.sectors[0].revision = 2;
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['organization'] }); });
    expect(await screen.findByText(/cadastro foi atualizado enquanto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled(); expect(api.patch).not.toHaveBeenCalled();
    context.unitId = 'unit-b'; view.update();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('aborta inativação pendente e ignora resposta tardia do contexto anterior', async () => {
    let finish!: (value: unknown) => void, signal!: AbortSignal;
    vi.mocked(api.patch).mockImplementation((_path, _payload, options) => { signal = options!.signal!; return new Promise(resolve => { finish = resolve; }); });
    const view = show(), user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Inativar Unidade Alfa' })); await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    await user.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeInTheDocument();
    context.unitId = 'unit-b'; view.update(); expect(signal.aborted).toBe(true);
    await act(async () => { finish({ ...seed.units[0], status: 'INACTIVE', revision: 2 }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cadastro inativado/)).not.toBeInTheDocument();
  });
  it('aguarda responsáveis e permite retirar vínculo que deixou de ser elegível', async () => {
    const finishers: (() => void)[] = [];
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/organization' ? structuredClone(organization) as never : new Promise(resolve => { finishers.push(() => resolve(responsiblePage(options, []))); }) as never);
    show(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' }));
    expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    await act(async () => { finishers.forEach(finish => finish()); });
    await screen.findByText('Alguns itens selecionados não estão disponíveis neste contexto. Confira os vínculos antes de salvar.');
    expect(selectedResponsibleIds()).toEqual(['person-a']); expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cadastro' }).closest('form')!);
    expect(await screen.findByText(/Remova os responsáveis/)).toBeInTheDocument(); expect(api.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remover person-a' })); vi.mocked(api.patch).mockResolvedValue({ ...seed.units[0], responsibleIds: [], revision: 2 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ responsibleIds: [] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('preserva edição em falha de consulta e evita salvar vínculos sem confirmação atual', async () => {
    const view = show(), user = await createUnit();
    vi.mocked(api.get).mockRejectedValue(new Error('Consulta indisponível.'));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['organization'] }); });
    expect(screen.getByLabelText('Nome *')).toHaveValue('Unidade em preparação');
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled());
    expect(api.post).not.toHaveBeenCalled();
  });
  it('resolve responsáveis fora da primeira centena sem baixar o catálogo inteiro e preserva seleção entre páginas e buscas', async () => {
    organization.units[0].responsibleIds = ['person-1', 'person-125'];
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === '/organization') return structuredClone(organization) as never;
      return responsiblePage(options, eligiblePeople) as never;
    });
    show(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(selectedResponsibleIds()).toEqual(expect.arrayContaining(['person-1', 'person-125'])); expect(screen.getByRole('option', { name: 'Responsável 125' })).toBeInTheDocument();
    const initialCalls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/assignees');
    expect(initialCalls).toHaveLength(2); expect(initialCalls.filter(([, options]) => !options?.query?.ids)).toHaveLength(1);
    expect(initialCalls.find(([, options]) => !options?.query?.ids)?.[1]?.query).toEqual({ unitId: 'unit-a', purpose: 'UNIT_RESPONSIBLE', q: undefined, page: 1, pageSize: 20 });
    expect(initialCalls.find(([, options]) => options?.query?.ids)?.[1]?.query).toMatchObject({ ids: 'person-1,person-125', page: 1, pageSize: 100 });
    await user.click(screen.getByRole('button', { name: 'Próxima: responsáveis da unidade' })); await screen.findByRole('option', { name: 'Responsável 021' });
    await user.selectOptions(screen.getByLabelText('Responsáveis elegíveis'), 'person-21'); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(selectedResponsibleIds()).toEqual(expect.arrayContaining(['person-1', 'person-21', 'person-125']));
    const search = screen.getByLabelText('Buscar responsáveis da unidade'); await user.type(search, 'Responsável 124');
    expect(api.get).not.toHaveBeenCalledWith('/assignees', expect.objectContaining({ query: expect.objectContaining({ q: 'Responsável 124' }) })); expect(api.patch).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Enter' }); await screen.findByRole('option', { name: 'Responsável 124' }); expect(api.patch).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Responsáveis elegíveis'), 'person-124'); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(selectedResponsibleIds()).toHaveLength(4);
    vi.mocked(api.patch).mockResolvedValue({ ...organization.units[0], revision: 2 });
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ responsibleIds: expect.arrayContaining(['person-1', 'person-21', 'person-124', 'person-125']) });
  });
  it('bloqueia envio enquanto revalida responsáveis em cache sem apagar a edição', async () => {
    const view = show(), user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled()); fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Minha edição durante a consulta' } });
    const finishers: (() => void)[] = [];
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/organization' ? structuredClone(organization) as never : new Promise(resolve => { finishers.push(() => resolve(responsiblePage(options))); }) as never);
    let refresh!: Promise<void>; act(() => { refresh = view.client.invalidateQueries({ queryKey: ['assignees'] }); });
    await waitFor(() => expect(screen.getByLabelText('Responsáveis elegíveis')).toBeDisabled()); expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cadastro' }).closest('form')!); await screen.findByText('Aguarde a consulta dos responsáveis elegíveis antes de salvar.'); expect(api.patch).not.toHaveBeenCalled();
    await act(async () => { finishers.forEach(finish => finish()); await refresh; });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled()); expect(screen.getByLabelText('Nome *')).toHaveValue('Minha edição durante a consulta'); expect(selectedResponsibleIds()).toEqual(['person-a']);
  });
  it.each([403, 503])('oculta nomes após erro %s, mantém IDs e campos e recupera mediante nova consulta', async status => {
    let failed = false; organization.units[0].responsibleIds = ['person-125'];
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === '/organization') return structuredClone(organization) as never;
      if (failed) throw new ApiError(status, { code: 'UNAVAILABLE', message: 'Opções restritas.', requestId: 'test' });
      return responsiblePage(options, eligiblePeople) as never;
    });
    const view = show(), user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Edição preservada após falha' } });
    failed = true; await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); }); await screen.findByRole('button', { name: 'Tentar carregar responsáveis da unidade novamente' });
    expect(screen.queryByText('Responsável 125')).not.toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'Responsável 001' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome *')).toHaveValue('Edição preservada após falha'); expect(selectedResponsibleIds()).toEqual(['person-125']); expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cadastro' }).closest('form')!); await screen.findByText('Aguarde a consulta dos responsáveis elegíveis antes de salvar.'); expect(api.patch).not.toHaveBeenCalled();
    failed = false; await user.click(screen.getByRole('button', { name: 'Tentar carregar responsáveis da unidade novamente' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Responsável 125' })).toBeInTheDocument(); expect(screen.getByLabelText('Nome *')).toHaveValue('Edição preservada após falha'); expect(selectedResponsibleIds()).toEqual(['person-125']);
  });
  it('mantém a negativa de acesso ao reabrir o mesmo editor com páginas em cache até reconfirmar', async () => {
    let failed = false;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === '/organization') return structuredClone(organization) as never;
      if (failed) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Sem acesso.', requestId: 'test' });
      return responsiblePage(options) as never;
    });
    const view = show(), user = userEvent.setup(); view.client.setQueryDefaults(['assignees'], { staleTime: Infinity, gcTime: Infinity });
    await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    failed = true; await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignees'] }); }); await screen.findByRole('button', { name: 'Tentar carregar responsáveis da unidade novamente' });
    await user.click(screen.getByRole('button', { name: 'Cancelar' })); await user.click(screen.getByRole('button', { name: 'Editar Unidade Alfa' }));
    await screen.findByRole('button', { name: 'Tentar carregar responsáveis da unidade novamente' }); expect(screen.queryByRole('option', { name: 'Pessoa elegível' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar carregar responsáveis da unidade novamente' })).toBeEnabled());
    failed = false; await user.click(screen.getByRole('button', { name: 'Tentar carregar responsáveis da unidade novamente' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled()); expect(screen.getByRole('option', { name: 'Pessoa elegível' })).toBeInTheDocument();
  });
  it('usa a unidade editada para elegibilidade e cancela resposta atrasada ao trocar o contexto do shell', async () => {
    organization.units[1].responsibleIds = ['person-b']; let searching = false, oldSignal!: AbortSignal, finish!: () => void;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === '/organization') return structuredClone(organization) as never;
      if (options?.query?.unitId === 'unit-b' && options.query.q === 'aguardando') { searching = true; oldSignal = options.signal!; return new Promise(resolve => { finish = () => resolve(responsiblePage({ ...options, query: { ...options.query, q: undefined } }, [{ id: 'person-b-old', displayName: 'Pessoa antiga da unidade Beta' }])); }) as never; }
      return responsiblePage(options, options?.query?.unitId === 'unit-b' ? [{ id: 'person-b', displayName: 'Pessoa da unidade Beta' }, ...eligiblePeople] : [{ id: 'person-a', displayName: 'Pessoa atual da unidade Alfa' }]) as never;
    });
    const view = show(), user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Editar Unidade Beta' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(context.unitId).toBe('unit-a'); expect(selectedResponsibleIds()).toEqual(['person-b']); expect(screen.getByRole('option', { name: 'Pessoa da unidade Beta' })).toBeInTheDocument();
    const initialCalls = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/assignees'); expect(initialCalls.every(([, options]) => options?.query?.unitId === 'unit-b' && options.query.purpose === 'UNIT_RESPONSIBLE')).toBe(true);
    await user.type(screen.getByLabelText('Buscar responsáveis da unidade'), 'aguardando'); await user.click(screen.getByRole('button', { name: 'Pesquisar responsáveis da unidade' })); await waitFor(() => expect(searching).toBe(true));
    context.sessionKey = 'session-b'; context.unitId = 'unit-b'; view.update(); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(oldSignal.aborted).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'Editar Unidade Alfa' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled());
    expect(screen.getByRole('option', { name: 'Pessoa atual da unidade Alfa' })).toBeInTheDocument(); expect(screen.queryByLabelText('Buscar responsáveis da unidade')).not.toBeInTheDocument();
    await act(async () => { finish(); }); expect(screen.queryByRole('option', { name: 'Pessoa antiga da unidade Beta' })).not.toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'Pessoa da unidade Beta' })).not.toBeInTheDocument();
  });
  it('marca alteração somente de responsáveis como rascunho e não consulta elegibilidade de unidade ainda nova', async () => {
    const view = show(), user = await createUnit(); expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/assignees')).toBe(false);
    vi.spyOn(window, 'confirm').mockReturnValue(true); await user.click(screen.getByRole('button', { name: 'Cancelar' })); await user.click(screen.getByRole('button', { name: 'Editar Unidade Alfa' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar cadastro' })).toBeEnabled()); await user.click(screen.getByRole('button', { name: 'Remover Pessoa elegível' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); await user.click(screen.getByRole('button', { name: 'Cancelar' })); expect(confirm).toHaveBeenCalled(); expect(screen.getByRole('dialog', { name: 'Editar unidade' })).toBeInTheDocument(); expect(selectedResponsibleIds()).toEqual([]); expect(api.patch).not.toHaveBeenCalled(); view.unmount();
  });
  it('exige escolher a classificação da nova empresa sem presumir pelo nome', async () => {
    show(); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Empresas/ }));
    await user.click(screen.getByRole('button', { name: 'Cadastrar empresa' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Empresa interna no nome' } });
    fireEvent.change(screen.getByLabelText('CNPJ *'), { target: { value: '12.345.678/0001-99' } });
    expect(screen.getByLabelText('Classificação da empresa *')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    expect(await screen.findByText('Selecione se a empresa é interna ou prestadora de serviços.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Classificação da empresa *'), 'SERVICE_PROVIDER');
    vi.mocked(api.post).mockResolvedValue({ id: 'new-company', name: 'Empresa interna no nome', classification: 'SERVICE_PROVIDER', status: 'ACTIVE', revision: 1 });
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(vi.mocked(api.post).mock.calls[0][0]).toBe('/companies');
    expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({ name: 'Empresa interna no nome', taxId: '12345678000199', classification: 'SERVICE_PROVIDER' });
  });
  it('mostra Não informada para o legado e exige uma decisão ao salvar sua edição', async () => {
    organization.companies[0].taxId = '12345678000199';
    show(); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Empresas/ }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: /Empresa Alfa/ })).toHaveTextContent('Não informada');
    await user.click(screen.getByRole('button', { name: 'Editar Empresa Alfa' }));
    expect(screen.getByLabelText('Classificação da empresa *')).toHaveValue('');
    expect(screen.getByText(/Este cadastro ainda não informa a classificação/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await screen.findByText('Selecione se a empresa é interna ou prestadora de serviços.'); expect(api.patch).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Classificação da empresa *'), 'INTERNAL');
    vi.mocked(api.patch).mockResolvedValue({ ...organization.companies[0], classification: 'INTERNAL', revision: 2 });
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(vi.mocked(api.patch).mock.calls[0]).toMatchObject(['/companies/company-a', { classification: 'INTERNAL' }, { etag: '"1"' }]);
  });
  it('filtra internas, prestadoras e legado combinando busca e situação sem esconder outros cadastros', async () => {
    organization.companies[0].classification = 'INTERNAL'; organization.companies[1].classification = 'SERVICE_PROVIDER';
    organization.companies.push({ id: 'legacy', name: 'Empresa Legada', revision: 1, status: 'INACTIVE' });
    show(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: /Empresas/ }));
    const filter = screen.getByLabelText('Filtrar empresas por classificação');
    await user.selectOptions(filter, 'INTERNAL');
    expect(screen.getByRole('button', { name: 'Editar Empresa Alfa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Empresa Beta' })).not.toBeInTheDocument();
    await user.selectOptions(filter, 'SERVICE_PROVIDER');
    expect(screen.getByRole('button', { name: 'Editar Empresa Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Empresa Alfa' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar em empresas'), { target: { value: 'Alfa' } });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar em empresas'), { target: { value: '' } });
    await user.selectOptions(filter, 'UNSPECIFIED');
    expect(screen.queryByRole('button', { name: 'Editar Empresa Legada' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Mostrar inativos'));
    expect(screen.getByRole('button', { name: 'Editar Empresa Legada' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('row', { name: /Empresa Legada/ })).toHaveTextContent('Não informada');
    await user.click(screen.getByRole('button', { name: /Unidades/ }));
    expect(screen.getByRole('button', { name: 'Editar Unidade Beta' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Filtrar empresas por classificação')).not.toBeInTheDocument();
  });
  it('preserva a escolha de classificação e a revisão original quando outra pessoa altera a empresa', async () => {
    organization.companies[0] = { ...organization.companies[0], taxId: '12345678000199', classification: 'SERVICE_PROVIDER' };
    show(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: /Empresas/ }));
    await user.click(screen.getByRole('button', { name: 'Editar Empresa Alfa' }));
    await user.selectOptions(screen.getByLabelText('Classificação da empresa *'), 'INTERNAL');
    organization.companies[0] = { ...organization.companies[0], name: 'Empresa Alfa atualizada', revision: 2 };
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Classificação alterada por outra pessoa.', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar cadastro' }));
    await screen.findByText(/Classificação alterada por outra pessoa\./);
    expect(screen.getByLabelText('Classificação da empresa *')).toHaveValue('INTERNAL');
    expect(screen.getByLabelText('Nome *')).toHaveValue('Empresa Alfa');
    expect(vi.mocked(api.patch).mock.calls[0][2]).toMatchObject({ etag: '"1"' });
    await screen.findByRole('button', { name: 'Editar Empresa Alfa atualizada' });
  });
  it('protege a mudança isolada de classificação como edição não salva', async () => {
    organization.companies[0] = { ...organization.companies[0], taxId: '12345678000199', classification: 'INTERNAL' };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    show(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: /Empresas/ }));
    await user.click(screen.getByRole('button', { name: 'Editar Empresa Alfa' }));
    await user.selectOptions(screen.getByLabelText('Classificação da empresa *'), 'SERVICE_PROVIDER');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText('Classificação da empresa *')).toHaveValue('SERVICE_PROVIDER');
    expect(api.patch).not.toHaveBeenCalled();
  });
});
