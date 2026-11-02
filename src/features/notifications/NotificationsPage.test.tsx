import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { NotificationDto, PageDto } from '../../shared/contracts';
import { NotificationsPage } from './NotificationsPage';

const state = vi.hoisted(() => ({ sessionKey: 'notice-session', unitId: 'unit' as string | undefined, permissions: ['notifications.read', 'documents.read', 'workers.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn() } }));
const notice: NotificationDto = { id: 'notice', title: 'Documento próximo do vencimento', summary: 'ASO de exemplo', type: 'DOCUMENT_DUE', resourceType: 'DOCUMENT', resourceId: 'document', dueDate: '2026-10-20', createdAt: '2026-10-11T12:00:00Z' };
const receipt = { ...notice, readAt: '2026-10-11T12:00:00Z' };
let navigateTo: ReturnType<typeof useNavigate>;
function Harness() { const location = useLocation(); navigateTo = useNavigate(); return <><output aria-label="Endereço atual">{location.search}</output><NotificationsPage /></>; }
function show(query = '', existingClient?: QueryClient) {
  const client = existingClient || new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/notificacoes${query}`]}><Harness /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { ...view, client, update: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.sessionKey = 'notice-session'; state.unitId = 'unit'; state.permissions = ['notifications.read', 'documents.read', 'workers.read'];
  vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: options?.query?.page === 1 ? [notice] : [], page: options?.query?.page, pageSize: 20, total: 1 }) as never);
  vi.mocked(api.patch).mockResolvedValue(receipt);
});

describe('consulta de notificações e critérios do endereço', () => {
  it.each(['Infinity', 'NaN', '1.5', '-3', '0', '9007199254740992', '', '01'])('bloqueia page=%s e só consulta a primeira página após correção explícita', async value => {
    show(`?read=false&page=${value}`);
    await screen.findByText(/A página do endereço é inválida/);
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`page=${value}`);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à primeira página' }));
    await screen.findByRole('article', { name: notice.title });
    expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: { unitId: 'unit', page: 1, pageSize: 20, read: false }, signal: expect.any(AbortSignal) }));
    expect(screen.getByLabelText('Leitura')).toHaveValue('false');
  });

  it('mantém um filtro de leitura desconhecido visível sem ampliar a consulta para Todas', async () => {
    show('?read=qualquer&page=Infinity');
    await screen.findByText(/O filtro de leitura do endereço é inválido/);
    expect(screen.getByLabelText('Leitura')).toHaveValue('qualquer'); expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('read=qualquer');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('article', { name: notice.title });
    expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: { unitId: 'unit', page: 1, pageSize: 20, read: undefined } }));
  });

  it.each(['read=false&read=true', 'page=1&page=2', 'unitId=unit&unitId=other', 'filtro=nao-suportado'])('bloqueia critérios ambíguos ou desconhecidos: %s', async query => {
    show(`?${query}`);
    await screen.findByText(/O endereço contém filtros/);
    expect(api.get).not.toHaveBeenCalled(); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('article', { name: notice.title });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('?unitId=unit');
  });

  it('inclui a unidade antes da primeira consulta e preserva paginação e leitura válidas', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: [notice], page: options?.query?.page, pageSize: 20, total: 21 }) as never);
    show('?read=false&page=2'); await screen.findByRole('article', { name: notice.title });
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: { unitId: 'unit', page: 2, pageSize: 20, read: false } }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit');
  });

  it('normaliza uma unidade antiga antes de consultar e reinicia a página preservando leitura', async () => {
    show('?unitId=other&page=2&read=false'); await screen.findByRole('article', { name: notice.title });
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: { unitId: 'unit', page: 1, pageSize: 20, read: false } }));
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
  });

  it('retorna à última página existente quando a página válida ultrapassa o total', async () => {
    show('?read=false&page=9'); await screen.findByRole('article', { name: notice.title });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
    expect(screen.getByLabelText('Leitura')).toHaveValue('false');
    expect(screen.getByText('1 notificação · página 1 de 1')).toBeInTheDocument();
  });

  it('limpa somente o filtro de leitura e retorna à primeira página', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: [notice], page: options?.query?.page, pageSize: 20, total: 40 }) as never);
    show('?read=false&page=2'); await screen.findByRole('article', { name: notice.title });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ query: { unitId: 'unit', page: 1, pageSize: 20, read: undefined } })));
    expect(screen.getByLabelText('Leitura')).toHaveValue('');
  });

  it('oferece nova tentativa após falha da consulta sem apagar critérios', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Conexão indisponível.'));
    show('?read=false'); fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
    expect(screen.getByLabelText('Leitura')).toHaveValue('false'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exibe timestamp incorreto sem quebrar a página e reavalia permissões dos links', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: [{ ...notice, createdAt: 'data incorreta' }], page: options?.query?.page, pageSize: 20, total: 1 }) as never);
    const view = show(); const article = await screen.findByRole('article', { name: notice.title });
    expect(within(article).getByText('Data inválida')).toBeInTheDocument(); expect(within(article).getByRole('link')).toBeInTheDocument();
    state.permissions = ['notifications.read']; view.update();
    expect(within(screen.getByRole('article', { name: notice.title })).queryByRole('link')).not.toBeInTheDocument();
  });

  it('codifica o identificador do recurso mantendo o destino dentro da aplicação', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: [{ ...notice, resourceId: 'a/b?redirect=https://externo.test' }], page: options?.query?.page, pageSize: 20, total: 1 }) as never);
    show(); expect(await screen.findByRole('link', { name: 'Abrir registro →' })).toHaveAttribute('href', '/app/documentos/a%2Fb%3Fredirect%3Dhttps%3A%2F%2Fexterno.test');
  });

  it.each(['permission', 'unit'] as const)('não consulta notificações sem %s', cause => {
    if (cause === 'permission') state.permissions = []; else state.unitId = undefined;
    show(); expect(screen.getByText(cause === 'permission' ? 'Seu acesso não permite consultar notificações.' : 'Selecione uma unidade')).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled();
  });
});

describe('validação e isolamento das respostas de notificações', () => {
  it.each(['items', 'page', 'pageSize', 'total', 'duplicate', 'title', 'resourceType'] as const)('recusa resposta com %s inválido sem exibir registros', async field => {
    const response: Record<string, unknown> = { items: [structuredClone(notice)], page: 1, pageSize: 20, total: 1 };
    if (field === 'items') response.items = null;
    if (field === 'page') response.page = 2;
    if (field === 'pageSize') response.pageSize = 100;
    if (field === 'total') response.total = -1;
    if (field === 'duplicate') { response.items = [notice, notice]; response.total = 2; }
    if (field === 'title') response.items = [{ ...notice, title: {} }];
    if (field === 'resourceType') response.items = [{ ...notice, resourceType: null }];
    vi.mocked(api.get).mockResolvedValue(response); show();
    await screen.findByText('A consulta retornou uma página inválida. Tente novamente.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByText(notice.summary)).not.toBeInTheDocument();
  });

  it.each([401, 403, 404])('omite texto restrito depois de negativa %s e não reutiliza outra página ou remount do cache', async status => {
    const otherNotice = { ...notice, id: 'other-notice', title: 'Título de outra página' };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: [options?.query?.page === 2 ? otherNotice : notice], page: options?.query?.page, pageSize: 20, total: 21 }) as never);
    const first = show('?unitId=unit', client); await screen.findByRole('article', { name: notice.title });
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' })); await screen.findByRole('article', { name: otherNotice.title });
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(status, { code: 'FORBIDDEN', message: `Erro com texto restrito: ${notice.summary}`, requestId: '' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByText(new RegExp(notice.summary))).not.toBeInTheDocument(); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    const calls = vi.mocked(api.get).mock.calls.length;
    act(() => navigateTo('/app/notificacoes?unitId=unit&page=1'));
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    first.unmount(); show('?unitId=unit&page=1', client);
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(api.get).toHaveBeenCalledTimes(calls);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
  });

  it('cancela GET antigo na mudança de unidade e ignora dados que chegam depois', async () => {
    let resolve!: (value: PageDto<NotificationDto>) => void; let signal!: AbortSignal;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      if (options?.query?.unitId === 'unit') { signal = options.signal!; return new Promise(done => { resolve = done; }) as never; }
      return { items: [{ ...notice, title: 'Aviso da unidade atual' }], page: options?.query?.page, pageSize: 20, total: 1 } as never;
    });
    const view = show('?unitId=unit&read=false&page=2'); await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
    state.unitId = 'unit-b'; view.update(); await screen.findByRole('article', { name: 'Aviso da unidade atual' });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ items: [notice], page: 2, pageSize: 20, total: 21 }));
    expect(screen.queryByRole('article', { name: notice.title })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Leitura')).toHaveValue('false'); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-b');
    expect(vi.mocked(api.get).mock.calls.filter(([, options]) => options?.query?.unitId === 'unit-b').every(([, options]) => options?.query?.page === 1)).toBe(true);
  });
});

describe('registro protegido de leitura das notificações', () => {
  it('confirma leitura e volta à página anterior quando a última não lida desaparece', async () => {
    let marked = false;
    vi.mocked(api.get).mockImplementation(async (_path, options) => ({ items: options?.query?.page === 2 && marked ? [] : [notice], page: options?.query?.page, pageSize: 20, total: marked ? 20 : 21 }) as never);
    vi.mocked(api.patch).mockImplementation(async () => { marked = true; return receipt as never; });
    show('?read=false&page=2'); fireEvent.click(await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` }));
    expect(await screen.findByText(/Leitura registrada:/)).toHaveTextContent('A pendência do registro continua sendo acompanhada.');
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1'));
    expect(api.patch).toHaveBeenCalledWith('/notifications/notice/read', {}, { signal: expect.any(AbortSignal), query: { unitId: 'unit' } });
    expect(await screen.findByText('20 notificações · página 1 de 1')).toBeInTheDocument(); expect(screen.getByLabelText('Leitura')).toHaveValue('false');
  });

  it('bloqueia cliques simultâneos com trava síncrona e mantém a notificação depois de falha transitória', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.patch).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    show(); const read = await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` });
    act(() => { fireEvent.click(read); fireEvent.click(read); });
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce()); expect(read).toBeDisabled(); expect(read).toHaveTextContent('Registrando leitura…');
    expect(screen.getByLabelText('Leitura')).toBeDisabled();
    await act(async () => reject(new Error('Não salvo.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível registrar a leitura.'); expect(read).toBeEnabled();
    expect(screen.getByText('Não lida')).toBeInTheDocument(); expect(screen.queryByText(/Leitura registrada:/)).not.toBeInTheDocument();
  });

  it.each(['id', 'resourceId', 'resourceType', 'readAt', 'readAt-day'] as const)('não confirma nem invalida consultas quando o recibo tem %s incompatível', async field => {
    const invalid: Record<string, unknown> = { ...receipt };
    if (field === 'id') invalid.id = 'other';
    if (field === 'resourceId') invalid.resourceId = 'other-document';
    if (field === 'resourceType') invalid.resourceType = 'WORKER';
    if (field === 'readAt') invalid.readAt = '';
    if (field === 'readAt-day') invalid.readAt = '2026-02-30T12:00:00Z';
    vi.mocked(api.patch).mockResolvedValue(invalid);
    const view = show(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` }));
    await screen.findByText('A consulta retornou uma página inválida. Tente novamente.');
    expect(screen.queryByText(/Leitura registrada:/)).not.toBeInTheDocument(); expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: notice.title })).toBeInTheDocument();
  });

  it('invalida somente notificações da sessão e unidade da leitura confirmada', async () => {
    const view = show(); await screen.findByRole('article', { name: notice.title });
    const same = ['notifications', 'notice-session', 'unit', 'fixture'], otherUnit = ['notifications', 'notice-session', 'other-unit', 'fixture'], otherSession = ['notifications', 'other-session', 'unit', 'fixture'];
    for (const key of [same, otherUnit, otherSession]) view.client.setQueryData(key, 'cached');
    fireEvent.click(screen.getByRole('button', { name: `Marcar como lida: ${notice.title}` })); await screen.findByText(/Leitura registrada:/);
    expect(view.client.getQueryState(same)?.isInvalidated).toBe(true); expect(view.client.getQueryState(otherUnit)?.isInvalidated).toBe(false); expect(view.client.getQueryState(otherSession)?.isInvalidated).toBe(false);
  });

  it.each(['unmount', 'unit', 'session', 'permission'] as const)('aborta a leitura e ignora sucesso tardio depois de %s', async cause => {
    let resolve!: (value: NotificationDto) => void; let signal!: AbortSignal;
    vi.mocked(api.patch).mockImplementation((_path, _body, options) => { signal = options!.signal!; return new Promise(done => { resolve = done; }); });
    const view = show(); const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    fireEvent.click(await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` })); await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    if (cause === 'unmount') view.unmount();
    else { if (cause === 'unit') state.unitId = 'unit-b'; if (cause === 'session') state.sessionKey = 'new-session'; if (cause === 'permission') state.permissions = []; view.update(); }
    expect(signal.aborted).toBe(true); await act(async () => resolve(receipt));
    expect(screen.queryByText(/Leitura registrada:/)).not.toBeInTheDocument(); expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([403, 404])('oculta avisos e mensagens antigas quando a API nega a marcação de leitura: %s', async status => {
    vi.mocked(api.patch).mockRejectedValue(new ApiError(status, { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', message: `Conteúdo restrito ${notice.summary}`, requestId: '' }));
    show(); fireEvent.click(await screen.findByRole('button', { name: `Marcar como lida: ${notice.title}` }));
    await screen.findByText(status === 403 ? 'Seu acesso não permite consultar notificações nesta unidade.' : 'Consulta de notificações indisponível nesta unidade.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByText(new RegExp(notice.summary))).not.toBeInTheDocument();
    expect(screen.queryByText(/Leitura registrada:/)).not.toBeInTheDocument();
  });
});
