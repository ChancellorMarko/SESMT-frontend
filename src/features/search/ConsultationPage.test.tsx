import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import { makeFixtures } from '../../mocks/fixtures';
import { ConsultationPage } from './ConsultationPage';

const session = vi.hoisted(() => ({ permissions: ['documents.read', 'permits.read', 'workers.read'], unitId: 'unit-a' as string | undefined }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: session.unitId, can: (permission: string) => session.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const fixtures = makeFixtures();
function lookupPage<T extends { id: string }>(items: T[], options: Parameters<typeof api.get>[1], searchable: (item: T) => string) {
  const ids = typeof options?.query?.ids === 'string' ? options.query.ids.split(',') : [];
  const term = String(options?.query?.q || '').toLocaleLowerCase('pt-BR');
  const filtered = items.filter(item => (!ids.length || ids.includes(item.id)) && (!term || searchable(item).toLocaleLowerCase('pt-BR').includes(term)));
  const page = Number(options?.query?.page || 1);
  const pageSize = Number(options?.query?.pageSize || 20);
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
}
function Where() { return <output aria-label="Endereço atual">{useLocation().search}</output>; }
function show(path = '/app/consulta') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><ConsultationPage /><Where /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks(); session.permissions = ['documents.read', 'permits.read', 'workers.read']; session.unitId = 'unit-a';
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    const page = Number(options?.query?.page || 1);
    if (path === '/documents') return { items: page === 1 ? [fixtures.documents[0]] : [], total: 1, page, pageSize: 10 };
    if (path === '/document-types') return lookupPage(fixtures.documentTypes, options, type => `${type.code} ${type.name}`);
    if (path === '/workers') return lookupPage(fixtures.workers, options, worker => `${worker.fullName} ${worker.registration}`);
    if (path === '/permit-options') return { teams: [], services: [] };
    return { items: [], total: 0, page: 1, pageSize: 10 };
  });
});

describe('Central de consulta', () => {
  it('ignora a aba de PT na URL quando o perfil só pode ler documentos', async () => {
    session.permissions = ['documents.read']; show('/app/consulta?tab=permits');
    expect(await screen.findByRole('link', { name: fixtures.documents[0].title })).toBeVisible();
    expect(screen.queryByRole('tab', { name: /Permissões de trabalho/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'Buscar PT' })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/work-permits')).toBe(false);
  });
  it('seleciona PT quando é a única aba permitida e não consulta documentos', async () => {
    session.permissions = ['permits.read']; show();
    expect(await screen.findByRole('heading', { name: 'Nenhuma PT disponível' })).toBeVisible();
    expect(screen.getByRole('tab', { name: /Permissões de trabalho/ })).toHaveAttribute('aria-selected', 'true');
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents')).toBe(false);
  });
  it('não consulta registros sem permissão ou unidade', () => {
    session.permissions = []; show();
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('não consulta registros antes da seleção da unidade', () => {
    session.unitId = undefined; show();
    expect(screen.getByRole('heading', { name: 'Selecione uma unidade' })).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('conecta abas e painel e permite navegar por setas, Home e End', async () => {
    const user = userEvent.setup(); show();
    const docs = screen.getByRole('tab', { name: 'Documentos controlados' });
    const permits = screen.getByRole('tab', { name: /Permissões de trabalho/ });
    expect(document.getElementById(permits.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
    docs.focus(); await user.keyboard('{ArrowRight}');
    expect(permits).toHaveFocus(); expect(permits).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', permits.id);
    await user.keyboard('{Home}'); expect(docs).toHaveFocus();
    await user.keyboard('{End}'); expect(permits).toHaveFocus();
    await user.keyboard('{ArrowRight}'); expect(docs).toHaveFocus();
  });
  it('permite voltar de uma página vazia e mantém os filtros na URL', async () => {
    const user = userEvent.setup(); show('/app/consulta?tab=documents&q=Invent%C3%A1rio&status=ACTIVE&page=99');
    expect(await screen.findByRole('heading', { name: 'Nenhum documento encontrado' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByRole('link', { name: fixtures.documents[0].title })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Buscar título ou código' })).toHaveValue('Inventário');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('status=ACTIVE');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  });
  it('rejeita intervalo invertido sem consultar ou alterar os filtros aplicados', async () => {
    const user = userEvent.setup(); show('/app/consulta?tab=documents&q=Invent%C3%A1rio');
    await screen.findByRole('link', { name: fixtures.documents[0].title });
    await user.type(screen.getByLabelText('Vencimento a partir de'), '2030-12-31');
    await user.type(screen.getByLabelText('Vencimento até'), '2030-01-01');
    const before = vi.mocked(api.get).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Pesquisar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A data final deve ser igual ou posterior à data inicial.');
    expect(vi.mocked(api.get).mock.calls).toHaveLength(before);
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('validUntil');
  });
  it('respeita pageSize informado pela API na paginação de PTs', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/work-permits' ? { items: [], total: 3, page: 2, pageSize: 2 } : original(path, options));
    show('/app/consulta?tab=permits&page=2');
    expect(await screen.findByText('3 PT(s) encontrado(s) · Página 2 de 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
  });
  it('preserva critérios no link de detalhe para o retorno à consulta', async () => {
    show('/app/consulta?tab=documents&status=ACTIVE&page=1');
    expect(await screen.findByRole('link', { name: fixtures.documents[0].title })).toHaveAttribute('href', `/app/documentos/${fixtures.documents[0].id}`);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ page: 1, pageSize: 10, status: 'ACTIVE', unitId: 'unit-a' }) })));
  });

  it.each([
    ['documents', 'status=INVALID', '/documents', 'Selecione uma situação documental válida.'],
    ['documents', 'validUntilFrom=2026-02-30', '/documents', 'Data inicial de vencimento inválida.'],
    ['documents', 'validUntilTo=invalid', '/documents', 'Data final de vencimento inválida.'],
    ['documents', 'validUntilFrom=2030-12-31&validUntilTo=2030-01-01', '/documents', 'A data final deve ser igual ou posterior à data inicial.'],
    ['permits', 'operationStatus=INVALID', '/work-permits', 'Selecione uma situação operacional válida.'],
    ['permits', 'reviewStatus=INVALID', '/work-permits', 'Selecione uma revisão do encerramento válida.'],
    ['permits', 'operationStatus=constructor', '/work-permits', 'Selecione uma situação operacional válida.'],
  ])('não consulta %s com filtros inválidos da URL (%s) e recupera ao limpar', async (tab, filters, resource, message) => {
    const user = userEvent.setup(); show(`/app/consulta?tab=${tab}&${filters}`);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === resource)).toBe(false);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([path]) => path === resource)).toBe(true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`?tab=${tab}`);
  });

  it('permite corrigir situação inválida sem ampliar silenciosamente a consulta', async () => {
    const user = userEvent.setup(); show('/app/consulta?tab=documents&status=INVALID&q=Inventario');
    expect(screen.getByRole('combobox', { name: 'Situação' })).toHaveValue('INVALID');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Situação' }), 'ACTIVE');
    await user.click(screen.getByRole('button', { name: 'Pesquisar' }));
    await screen.findByRole('table');
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ status: 'ACTIVE', q: 'Inventario' }) }));
  });

  it('mantém o trabalhador da URL visível sem enumerar pessoas sem permissão', async () => {
    session.permissions = ['documents.read']; show('/app/consulta?workerId=worker-selected');
    await screen.findByRole('table');
    expect(screen.getByRole('combobox', { name: 'Trabalhador vinculado' })).toHaveValue('worker-selected');
    expect(screen.getByRole('option', { name: 'Trabalhador selecionado: worker-selected' })).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/workers')).toBe(false);
  });

  it('não considera ausência de validade como documento que nunca expira', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/documents'
      ? { items: [{ ...fixtures.documents[0], validUntil: undefined }], total: 1, page: 1, pageSize: 10 }
      : original(path, options));
    show();
    expect(await screen.findByRole('cell', { name: 'Não informada' })).toBeVisible();
    expect(screen.queryByText('Não expira')).not.toBeInTheDocument();
  });

  it.each([
    { tab: 'documents', resource: '/document-types', label: 'Tipo documental', filter: 'typeId', id: fixtures.documentTypes[0].id, name: fixtures.documentTypes[0].name, retry: 'Tentar carregar tipos novamente', key: ['document-types', 'session'] },
    { tab: 'documents', resource: '/workers', label: 'Trabalhador vinculado', filter: 'workerId', id: fixtures.workers[0].id, name: `${fixtures.workers[0].fullName} (${fixtures.workers[0].registration})`, retry: 'Tentar carregar trabalhadores novamente', key: ['workers', 'consulta-filter', 'session', 'unit-a'] },
    { tab: 'permits', resource: '/permit-options', label: 'Equipe operacional', filter: 'teamId', id: 'team-a', name: 'Equipe autorizada', retry: 'Tentar carregar equipes novamente', key: ['permit-options', 'session', 'unit-a'] },
  ])('oculta opções antigas de $resource após 403 e permite recuperar o filtro aplicado', async ({ tab, resource, label, filter, id, name, retry, key }) => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    let forbidden = false;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === resource && forbidden) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso indisponível.', requestId: 'test' });
      if (path === '/permit-options') return { teams: [{ id: 'team-a', name: 'Equipe autorizada' }], services: [] };
      return original(path, options);
    });
    const user = userEvent.setup(); const client = show(`/app/consulta?tab=${tab}&${filter}=${id}`);
    expect(await screen.findByRole('option', { name })).toBeInTheDocument();
    forbidden = true;
    await act(async () => { await client.invalidateQueries({ queryKey: key }); });
    await screen.findByRole('button', { name: retry });
    expect(screen.queryByRole('option', { name })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: label })).toHaveValue(id);
    expect(screen.getByRole('option', { name: new RegExp(`selecionad[oa].*: ${id}`, 'i') })).toBeInTheDocument();
    forbidden = false;
    await user.click(screen.getByRole('button', { name: retry }));
    expect(await screen.findByRole('option', { name })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: label })).toHaveValue(id);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`${filter}=${id}`);
  });

  it.each([['documents', '/documents', 'Tentar consultar documentos novamente'], ['permits', '/work-permits', 'Tentar consultar PTs novamente']])('recupera erro inicial na consulta de %s sem perder critérios', async (tab, resource, retry) => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    let failed = true;
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === resource && failed) throw new Error('Falha de rede');
      return original(path, options);
    });
    const user = userEvent.setup(); show(`/app/consulta?tab=${tab}&q=consulta`);
    await screen.findByRole('button', { name: retry });
    failed = false;
    await user.click(screen.getByRole('button', { name: retry }));
    await waitFor(() => expect(screen.queryByRole('button', { name: retry })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=consulta');
    expect(api.get).toHaveBeenLastCalledWith(resource, expect.objectContaining({ query: expect.objectContaining({ q: 'consulta' }) }));
  });

  it('alcança tipos após os primeiros 100 e pesquisa as opções sem alterar a consulta aplicada', async () => {
    const types = Array.from({ length: 125 }, (_, index) => ({ ...fixtures.documentTypes[0], id: `type-${index + 1}`, code: `TIP-${index + 1}`, name: `Tipo de escala ${String(index + 1).padStart(3, '0')}` }));
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/document-types' ? lookupPage(types, options, type => `${type.name} ${type.code}`) : original(path, options));
    const user = userEvent.setup(); show('/app/consulta?tab=documents&q=Inventario');
    await screen.findByRole('table');
    const before = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/documents').length;
    for (let page = 2; page <= 7; page++) {
      const next = await screen.findByRole('button', { name: 'Próxima: tipos' });
      await waitFor(() => expect(next).toBeEnabled());
      await user.click(next);
      await screen.findByRole('option', { name: types[(page - 1) * 20].name });
    }
    const selector = screen.getByRole('combobox', { name: 'Tipo documental' });
    await user.selectOptions(selector, 'type-125');
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Buscar tipos' })).toBeEnabled());
    await user.type(screen.getByRole('searchbox', { name: 'Buscar tipos' }), 'escala 001');
    await user.click(screen.getByRole('button', { name: 'Pesquisar tipos' }));
    expect(await screen.findByRole('option', { name: 'Tipo de escala 001' })).toBeInTheDocument();
    expect(selector).toHaveValue('type-125');
    expect(screen.getByRole('option', { name: 'Tipo de escala 125' })).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/documents')).toHaveLength(before);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?tab=documents&q=Inventario');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('typeId=');
    await user.click(screen.getByRole('button', { name: 'Pesquisar' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ q: 'Inventario', typeId: 'type-125' }) })));
  });

  it('resolve trabalhadores e tipos selecionados fora da página e preserva a seleção ao pesquisar e paginar opções', async () => {
    const types = Array.from({ length: 125 }, (_, index) => ({ ...fixtures.documentTypes[0], id: `type-${index + 1}`, name: `Tipo escala ${index + 1}` }));
    const workers = Array.from({ length: 125 }, (_, index) => ({ ...fixtures.workers[0], id: `worker-${index + 1}`, fullName: `Pessoa escala ${index + 1}`, registration: `ESC-${index + 1}` }));
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/document-types' ? lookupPage(types, options, type => type.name) : path === '/workers' ? lookupPage(workers, options, worker => worker.fullName) : original(path, options));
    const user = userEvent.setup(); show('/app/consulta?tab=documents&typeId=type-125&workerId=worker-125');
    expect(await screen.findByRole('option', { name: 'Tipo escala 125' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Pessoa escala 125 (ESC-125)' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Buscar trabalhadores' }), 'Pessoa escala');
    await user.click(screen.getByRole('button', { name: 'Pesquisar trabalhadores' }));
    const next = await screen.findByRole('button', { name: 'Próxima: trabalhadores' });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    expect(await screen.findByRole('option', { name: 'Pessoa escala 21 (ESC-21)' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Trabalhador vinculado' })).toHaveValue('worker-125');
    expect(screen.getByRole('combobox', { name: 'Tipo documental' })).toHaveValue('type-125');
    expect(screen.getByRole('option', { name: 'Pessoa escala 125 (ESC-125)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('typeId=type-125&workerId=worker-125');
    expect(vi.mocked(api.get).mock.calls.some(([path, options]) => path === '/workers' && options?.query?.ids === 'worker-125')).toBe(true);
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/documents')).toHaveLength(1);
  });

  it('descarta a resposta antiga da busca de trabalhadores ao trocar a unidade', async () => {
    let resolveOld!: (value: unknown) => void;
    const original = vi.mocked(api.get).getMockImplementation()!;
    const currentWorker = { ...fixtures.workers[0], id: 'current-worker', fullName: 'Pessoa da unidade atual', registration: 'ATUAL' };
    const oldWorkers = Array.from({ length: 125 }, (_, index) => ({ ...fixtures.workers[0], id: `worker-a-${index}`, fullName: `Pessoa inicial ${index}`, registration: `ANT-${index}` }));
    const newWorkers = [currentWorker, ...Array.from({ length: 124 }, (_, index) => ({ ...currentWorker, id: `worker-b-${index}`, fullName: `Pessoa atual ${index}`, registration: `AT-${index}` }))];
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path !== '/workers') return original(path, options);
      if (options?.query?.unitId === 'unit-b') return lookupPage(newWorkers, options, worker => worker.fullName);
      if (options?.query?.q === 'Pessoa antiga') return new Promise(resolve => { resolveOld = resolve; });
      return lookupPage(oldWorkers, options, worker => worker.fullName);
    });
    function ContextFixture() {
      const [, rerender] = useState(0);
      return <><button onClick={() => { session.unitId = 'unit-b'; rerender(value => value + 1); }}>Trocar unidade</button><ConsultationPage /><Where /></>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/consulta?tab=documents']}><ContextFixture /></MemoryRouter></QueryClientProvider>);
    const user = userEvent.setup();
    await screen.findByRole('table');
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar trabalhadores' }), 'Pessoa antiga');
    await user.click(screen.getByRole('button', { name: 'Pesquisar trabalhadores' }));
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    await user.click(screen.getByRole('button', { name: 'Trocar unidade' }));
    expect(await screen.findByRole('option', { name: 'Pessoa da unidade atual (ATUAL)' })).toBeInTheDocument();
    await act(async () => { resolveOld({ items: [{ ...currentWorker, id: 'old-worker', fullName: 'Pessoa antiga restrita' }], total: 1, page: 1, pageSize: 20 }); });
    expect(screen.queryByRole('option', { name: /Pessoa antiga restrita/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pessoa da unidade atual (ATUAL)' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar trabalhadores' })).toHaveValue('');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?tab=documents');
  });
});

