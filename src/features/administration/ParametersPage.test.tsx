import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { DocumentTypeDto, PageDto } from '../../shared/contracts';
import { ParametersPage } from './ParametersPage';

const session = vi.hoisted(() => ({ sessionKey: 'session-a', unitId: 'unit-a', permissions: ['documents.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: (permission: string) => session.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

function policies(): DocumentTypeDto[] {
  return Array.from({ length: 125 }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return {
      id: `type-${number}`, name: `Política ${number}`, code: `TIPO-${number}`, category: 'Procedimentos', revision: 1,
      requiredFields: ['title', 'code'], allowedAccessClasses: ['INTERNAL', 'RESTRICTED'], defaultAccessClass: 'INTERNAL',
      maxFileSizeBytes: 8 * 1024 * 1024, allowedMimeTypes: ['application/pdf', 'image/png'],
      renewalPolicy: { enabled: true, periodMonths: 18, noticeDays: 45 },
      retentionPolicyReference: { code: 'GUARDA-DEMO', version: '2.0', source: 'Referência sintética aprovada para o teste' },
      workflow: { reviewRequired: true, signatureRequired: true, allowSelfApproval: false, allowMultipleActiveVersions: false },
    };
  });
}

function response(options?: Parameters<typeof api.get>[1], context = `${session.sessionKey}:${session.unitId}`): PageDto<DocumentTypeDto> {
  const query = options?.query ?? {};
  let rows = context === 'session-a:unit-a' ? policies() : [{ ...policies()[0], id: context, name: `Política do contexto ${context}` }];
  const term = String(query.q || '').toLocaleLowerCase('pt-BR');
  if (term) rows = rows.filter(row => `${row.name} ${row.code}`.toLocaleLowerCase('pt-BR').includes(term));
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length };
}

function show(client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  const tree = () => <QueryClientProvider client={client}><MemoryRouter><ParametersPage /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { client, view, rerender: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.sessionKey = 'session-a'; session.unitId = 'unit-a'; session.permissions = ['documents.read'];
  vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
});

describe('consulta paginada de políticas documentais', () => {
  it('alcança políticas depois do centésimo tipo em páginas de 20 sem truncar a consulta', async () => {
    const user = userEvent.setup(); show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    expect(screen.getAllByRole('article')).toHaveLength(20);
    expect(screen.queryByRole('article', { name: 'Política de Política 125' })).not.toBeInTheDocument();
    for (let page = 2; page <= 7; page++) {
      await user.click(screen.getByRole('button', { name: 'Próxima' }));
      await waitFor(() => expect(screen.getByRole('navigation', { name: 'Paginação das políticas' })).toHaveTextContent(`Página ${page} de 7`));
    }
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.getByRole('article', { name: 'Política de Política 125' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(api.get).toHaveBeenLastCalledWith('/document-types', expect.objectContaining({ query: { q: undefined, page: 7, pageSize: 20 }, signal: expect.any(AbortSignal) }));
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByRole('article', { name: 'Política de Política 101' })).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.every(([, options]) => options?.query?.pageSize === 20)).toBe(true);
  });

  it('busca por nome ou código somente ao enviar, retorna à primeira página e conserva todos os campos da política', async () => {
    const user = userEvent.setup(); show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('article', { name: 'Política de Política 021' });
    const search = screen.getByRole('searchbox', { name: 'Buscar política por nome ou código' });
    const calls = vi.mocked(api.get).mock.calls.length;
    await user.type(search, 'Política 125');
    expect(api.get).toHaveBeenCalledTimes(calls);
    await user.click(screen.getByRole('button', { name: 'Buscar políticas' }));
    const article = await screen.findByRole('article', { name: 'Política de Política 125' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(article).toHaveTextContent('18 meses'); expect(article).toHaveTextContent('45 dias — parâmetro do tipo');
    expect(article).toHaveTextContent('8 MB'); expect(article).toHaveTextContent('application/pdf, image/png');
    expect(article).toHaveTextContent('GUARDA-DEMO · versão 2.0'); expect(article).toHaveTextContent('Referência sintética aprovada para o teste');
    expect(article).toHaveTextContent('Revisão exigida; assinatura exigida; sem autoaprovação'); expect(article).toHaveTextContent('Uma vigente por escopo');
    expect(screen.getByRole('navigation', { name: 'Paginação das políticas' })).toHaveTextContent('Página 1 de 1');
    await user.clear(search); await user.type(search, 'TIPO-124{Enter}');
    expect(await screen.findByRole('article', { name: 'Política de Política 124' })).toBeVisible();
    expect(api.get).toHaveBeenLastCalledWith('/document-types', expect.objectContaining({ query: { q: 'TIPO-124', page: 1, pageSize: 20 } }));
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(await screen.findByRole('article', { name: 'Política de Política 001' })).toBeVisible();
    expect(search).toHaveValue('');
  });

  it.each([['documents.read'], ['documentTypes.write']])('permite a consulta com %s e só oferece gerenciamento ao perfil autorizado', async permission => {
    session.permissions = [permission]; show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    const manage = screen.queryByRole('link', { name: 'Gerenciar políticas nos tipos documentais →' });
    if (permission === 'documentTypes.write') expect(manage).toHaveAttribute('href', '/app/configuracoes/tipos-documentais');
    else expect(manage).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
  });

  it('não solicita nem revela políticas quando o perfil perde a permissão de consulta', async () => {
    const { rerender } = show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    const calls = vi.mocked(api.get).mock.calls.length;
    session.permissions = []; rerender();
    expect(screen.getByText('Seu acesso não permite consultar políticas documentais.')).toBeVisible();
    expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(calls);
  });

  it('retira nomes em cache após erro de atualização e recupera a página em uma nova tentativa', async () => {
    const user = userEvent.setup(); const { client } = show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, { code: 'UNAVAILABLE', message: 'Consulta temporariamente indisponível.', requestId: 'policy-error' }));
    await act(async () => { await client.invalidateQueries({ queryKey: ['document-types', session.sessionKey, session.unitId, 'policies'] }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulta temporariamente indisponível.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeDisabled();
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: 'Política de Política 001' })).toBeVisible();
  });

  it('não restaura nomes de uma página em cache ao remontar depois de 403, até uma resposta nova e autorizada', async () => {
    const user = userEvent.setup(); const { client, view } = show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    vi.mocked(api.get).mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso à política revogado.', requestId: 'policy-denial' }));
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Acesso à política revogado.');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    const calls = vi.mocked(api.get).mock.calls.length;
    view.unmount(); show(client);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('Política 001', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar políticas' })).toBeDisabled();
    expect(api.get).toHaveBeenCalledTimes(calls);
    vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: 'Política de Política 001' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(calls + 1);
  });

  it('reinicia busca e paginação ao trocar unidade ou sessão e ignora a resposta atrasada do contexto anterior', async () => {
    let finish!: () => void, oldSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const context = `${session.sessionKey}:${session.unitId}`;
      if (context === 'session-a:unit-a' && options?.query?.q === 'TIPO-125') return new Promise(resolve => {
        oldSignal = options.signal; finish = () => resolve(response(options, context) as never);
      });
      return response(options, context) as never;
    });
    const user = userEvent.setup(); const { rerender } = show();
    await screen.findByRole('article', { name: 'Política de Política 001' });
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('article', { name: 'Política de Política 021' });
    await user.type(screen.getByRole('searchbox'), 'TIPO-125{Enter}');
    await waitFor(() => expect(oldSignal).toBeDefined());
    session.unitId = 'unit-b'; rerender();
    expect(await screen.findByRole('article', { name: 'Política de Política do contexto session-a:unit-b' })).toBeVisible();
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('navigation', { name: 'Paginação das políticas' })).toHaveTextContent('Página 1 de 1');
    await act(async () => { finish(); });
    expect(screen.queryByRole('article', { name: 'Política de Política 125' })).not.toBeInTheDocument();
    session.sessionKey = 'session-b'; rerender();
    const current = await screen.findByRole('article', { name: 'Política de Política do contexto session-b:unit-b' });
    expect(within(current).getByRole('heading')).toHaveTextContent('session-b:unit-b');
    expect(screen.queryByRole('article', { name: 'Política de Política do contexto session-a:unit-b' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/document-types', expect.objectContaining({ query: { q: undefined, page: 1, pageSize: 20 } }));
  });
});
