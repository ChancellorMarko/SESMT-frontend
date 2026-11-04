import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { DocumentDto, DocumentTypeDto, WorkerDto } from '../../shared/contracts';
import { DocumentsPage } from './DocumentsPage';

const session = vi.hoisted(() => ({ sessionKey: 'document-options', unitId: 'unit-a', permissions: ['documents.read', 'documents.write', 'workers.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
const id = (group: number, index: number) => `${String(group).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const types = Array.from({ length: 125 }, (_, index) => ({ id: id(1, index + 1), name: `Tipo ${String(index + 1).padStart(3, '0')}`, code: `TYPE-${index + 1}` })) as DocumentTypeDto[];
const workers = Array.from({ length: 125 }, (_, index) => ({ id: id(2, index + 1), fullName: `Pessoa ${String(index + 1).padStart(3, '0')}`, registration: `REG-${index + 1}`, unitId: 'unit-a' })) as WorkerDto[];
const assignees = Array.from({ length: 125 }, (_, index) => ({ id: id(3, index + 1), displayName: `Responsável ${String(index + 1).padStart(3, '0')}` }));
const document: DocumentDto = { id: 'doc', code: 'DOC-ESCALA', title: 'Documento da busca', typeId: types[124].id, companyId: 'company-a', unitId: 'unit-a', ownerId: assignees[0].id, responsibleIds: [assignees[124].id], workerIds: [workers[124].id], accessClass: 'INTERNAL', issueDate: '2026-10-01', status: 'DRAFT', activeVersionIds: [], availableActions: [], keywords: [], revision: 1 };
let denied: string | undefined;
beforeEach(() => {
  vi.clearAllMocks(); denied = undefined; session.unitId = 'unit-a'; session.sessionKey = 'document-options'; session.permissions = ['documents.read', 'documents.write', 'workers.read'];
  vi.mocked(api.get).mockImplementation(async (path, options) => {
    if (path === denied) throw new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso às opções negado.', requestId: 'test' });
    const query = options?.query ?? {};
    if (path === '/documents') return { items: query.unitId === 'unit-a' ? [document] : [], total: query.unitId === 'unit-a' ? 1 : 0, page: query.page, pageSize: 10 } as never;
    const items = path === '/document-types' ? types : path === '/workers' ? workers : assignees;
    const ids = String(query.ids || '').split(',').filter(Boolean), term = String(query.q || '').toLocaleLowerCase('pt-BR');
    const filtered = items.filter(item => (!ids.length || ids.includes(item.id)) && (!term || JSON.stringify(item).toLocaleLowerCase('pt-BR').includes(term)));
    const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20);
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize } as never;
  });
});
function LocationProbe() { const location = useLocation(); return <output aria-label="Endereço atual">{location.search}</output>; }
function show(search = '', client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/documentos${search}`]}><LocationProbe /><DocumentsPage /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, view, update: () => view.rerender(tree()) };
}
const documentRequests = () => vi.mocked(api.get).mock.calls.filter(([path]) => path === '/documents');

describe('seletores dos filtros documentais', () => {
  it('resolve o tipo dos resultados sem apresentá-lo como seleção atual do filtro', async () => {
    show('?unitId=unit-a');
    await waitFor(() => expect(within(screen.getByRole('table')).getByText(types[124].name)).toBeInTheDocument());
    expect(screen.getByLabelText('Tipo documental')).toHaveValue('');
    expect(screen.queryByRole('option', { name: types[124].name })).not.toBeInTheDocument();
  });
  it('identifica filtros e o tipo dos resultados além da primeira centena', async () => {
    show(`?typeId=${types[124].id}&workerId=${workers[124].id}&responsibleId=${assignees[124].id}&unitId=unit-a`);
    await screen.findByRole('link', { name: document.title });
    await screen.findByRole('option', { name: types[124].name });
    expect(screen.getByLabelText('Tipo documental')).toHaveValue(types[124].id);
    expect(await screen.findByRole('option', { name: 'Pessoa 125 · REG-125' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: assignees[124].displayName })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText(types[124].name)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/document-types', expect.objectContaining({ query: expect.objectContaining({ ids: types[124].id }) }));
  });

  it('pesquisa e pagina opções sem aplicar filtros e mantém seleções fora da página', async () => {
    const user = userEvent.setup(); show(`?workerId=${workers[124].id}&unitId=unit-a`);
    await screen.findByRole('option', { name: 'Pessoa 125 · REG-125' });
    const address = screen.getByLabelText('Endereço atual').textContent, initialRequests = documentRequests().length;
    await user.click(screen.getByRole('button', { name: 'Próxima: trabalhadores' }));
    await screen.findByRole('option', { name: 'Pessoa 021 · REG-21' });
    expect(screen.getByLabelText('Trabalhador')).toHaveValue(workers[124].id);
    await user.type(screen.getByLabelText('Buscar trabalhadores'), 'Pessoa 101{Enter}');
    await screen.findByRole('option', { name: 'Pessoa 101 · REG-101' });
    await user.selectOptions(screen.getByLabelText('Trabalhador'), workers[100].id);
    await screen.findByRole('option', { name: 'Pessoa 101 · REG-101' });
    expect(documentRequests()).toHaveLength(initialRequests);
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(address!);
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(documentRequests().at(-1)?.[1]?.query).toMatchObject({ workerId: workers[100].id, page: 1 }));
  });

  it.each([
    ['/document-types', 'document-types', 'tipos documentais', types[124].name],
    ['/workers', 'workers', 'trabalhadores', 'Pessoa 125 · REG-125'],
    ['/assignees', 'assignees', 'responsáveis', assignees[124].displayName],
  ])('esconde rótulos negados e permite nova tentativa sem apagar critérios: %s', async (path, key, noun, label) => {
    const user = userEvent.setup(); const { client } = show(`?typeId=${types[124].id}&workerId=${workers[124].id}&responsibleId=${assignees[124].id}&unitId=unit-a`);
    await screen.findByRole('option', { name: label }); denied = path;
    await act(async () => { await client.refetchQueries({ queryKey: [key] }); });
    const retry = await screen.findByRole('button', { name: `Tentar carregar ${noun} novamente` });
    expect(screen.queryByRole('option', { name: label })).not.toBeInTheDocument();
    const address = screen.getByLabelText('Endereço atual').textContent;
    denied = undefined; await user.click(retry);
    expect(await screen.findByRole('option', { name: label })).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(address!);
  });

  it('não consulta opções sem a permissão correspondente e não consulta documentos sem acesso', async () => {
    session.permissions = ['documents.read']; const first = show(); await screen.findByRole('link', { name: document.title });
    expect(screen.queryByLabelText('Trabalhador')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/workers' || path === '/assignees')).toBe(false);
    first.view.unmount(); vi.clearAllMocks(); session.permissions = []; show();
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
  });

  it('ignora a resposta antiga de opções ao trocar a unidade e limpa vínculos do endereço', async () => {
    const user = userEvent.setup(); const view = show(`?workerId=${workers[124].id}&unitId=unit-a`);
    await screen.findByRole('option', { name: 'Pessoa 125 · REG-125' });
    let resolve!: (result: unknown) => void; let oldSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementationOnce((_path, options) => { oldSignal = options?.signal; return new Promise(done => { resolve = done; }) as never; });
    await user.click(screen.getByRole('button', { name: 'Próxima: trabalhadores' }));
    session.unitId = 'unit-b'; act(() => view.update());
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-b'));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolve({ items: [{ ...workers[124], fullName: 'Nome antigo tardio' }], total: 1, page: 2, pageSize: 20 }));
    expect(screen.queryByRole('option', { name: /Nome antigo tardio/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual').textContent).not.toContain('workerId');
  });

  it('não executa situação inválida e permite limpar os filtros sem perder a unidade', async () => {
    const user = userEvent.setup(); show('?status=UNKNOWN&page=3&unitId=unit-a');
    await screen.findByText('Corrija os filtros da consulta'); expect(documentRequests()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('link', { name: document.title });
    expect(documentRequests().at(-1)?.[1]?.query).toMatchObject({ unitId: 'unit-a', page: 1 });
    expect(screen.getByLabelText('Endereço atual').textContent).not.toContain('status=');
  });
});
