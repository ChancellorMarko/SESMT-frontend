import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto } from '../../shared/contracts';
import { DocumentsPage } from './DocumentsPage';

const runtime = vi.hoisted(() => ({ mode: 'demo' }));
vi.mock('../../shared/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../shared/api/client')>(), get API_MODE() { return runtime.mode; }, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
const unitId = '10000000-0000-4000-8000-000000000001';
const typeId = '20000000-0000-4000-8000-000000000001';
const responsibleId = '30000000-0000-4000-8000-000000000001';
const fixture: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Documento filtrado', companyId: unitId, unitId, typeId, ownerId: responsibleId, accessClass: 'INTERNAL', issueDate: '2026-10-05', status: 'ACTIVE', activeVersionIds: [], availableActions: [], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };

beforeEach(() => {
  runtime.mode = 'demo';
  vi.clearAllMocks();
  vi.mocked(useSession).mockImplementation(() => ({ me: null, unitId, sessionKey: 'url-test', can: permission => permission === 'documents.read', status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() }));
  vi.mocked(api.get).mockImplementation(async <T,>(path: string, options?: Parameters<typeof api.get>[1]): Promise<T> => (path === '/documents' ? { items: [fixture], page: options?.query?.page ?? 1, pageSize: 10, total: 50 } : { items: [{ id: typeId, name: 'Procedimento' }], page: 1, pageSize: 100, total: 1 }) as T);
});
afterEach(() => vi.unstubAllEnvs());

function Harness() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output aria-label="Endereço atual">{location.search}</output><button onClick={() => navigate(-1)}>Voltar no teste</button><DocumentsPage /></>;
}
function show(query: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/documentos${query}`]}><Harness /></MemoryRouter></QueryClientProvider>);
}

describe('filtros documentais no endereço', () => {
  it('consome filtros de painel e paginação da URL, mantendo os controles sincronizados', async () => {
    show(`?q=DOC-001&status=ACTIVE&typeId=${typeId}&responsibleId=${responsibleId}&validUntilFrom=2026-10-01&validUntilTo=2026-12-31&issueDateFrom=2026-01-01&page=3`);
    await screen.findByRole('link', { name: 'Documento filtrado' });
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ unitId, q: 'DOC-001', status: 'ACTIVE', typeId, responsibleId, validUntilFrom: '2026-10-01', validUntilTo: '2026-12-31', issueDateFrom: '2026-01-01', page: 3 }) }));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('DOC-001');
    expect(screen.getByLabelText('Situação')).toHaveValue('ACTIVE');
    expect(screen.getByLabelText('Tipo documental')).toHaveValue(typeId);
    expect(screen.getByLabelText('Emissão a partir de')).toHaveValue('2026-01-01');
  });
  it('aplicar nova busca retorna à primeira página e Voltar restaura o filtro anterior', async () => {
    show('?q=DOC-001&status=ACTIVE&page=3');
    await screen.findByRole('link', { name: 'Documento filtrado' });
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Novo termo' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'DRAFT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: 'Novo termo', status: 'DRAFT' }) })));
    expect(screen.getByLabelText('Endereço atual').textContent).not.toContain('page=3');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no teste' }));
    await waitFor(() => expect(screen.getByLabelText('Situação')).toHaveValue('ACTIVE'));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('DOC-001');
    expect(screen.getByLabelText('Endereço atual').textContent).toContain('page=3');
  });
  it('não consulta a API com um intervalo inválido recebido no endereço', async () => {
    show('?validUntilFrom=2026-12-31&validUntilTo=2026-01-01');
    expect(await screen.findByRole('heading', { name: 'Corrija os filtros da consulta' })).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents')).toBe(false);
  });
  it('abre critérios avançados recebidos por URL e remove apenas um filtro sem perder o escopo', async () => {
    show(`?q=DOC-001&status=ACTIVE&validUntilFrom=2026-10-01&page=3&unitId=${unitId}`);
    await screen.findByRole('link', { name: 'Documento filtrado' });
    expect(screen.getByRole('button', { name: /Mais filtros/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Vencimento a partir de' }));
    await waitFor(() => {
      const address = screen.getByLabelText('Endereço atual').textContent!;
      expect(address).toContain(`unitId=${unitId}`);
      expect(address).toContain('status=ACTIVE');
      expect(address).toContain('q=DOC-001');
      expect(address).not.toContain('validUntilFrom');
      expect(address).not.toContain('page=3');
    });
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveFocus();
    expect(screen.getByLabelText('Vencimento a partir de')).toHaveValue('');
  });
  it('limpa alterações ainda não aplicadas mesmo quando a URL já está sem filtros', async () => {
    show('');
    await screen.findByRole('link', { name: 'Documento filtrado' });
    expect(screen.getByRole('button', { name: /Mais filtros/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Busca não aplicada' } });
    fireEvent.click(screen.getByRole('button', { name: /Mais filtros/ }));
    fireEvent.change(screen.getByLabelText('Vencimento a partir de'), { target: { value: '2026-11-01' } });
    expect(screen.getByText('Alterações ainda não aplicadas à lista.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('');
    expect(screen.getByLabelText('Vencimento a partir de')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Mais filtros/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Alterações ainda não aplicadas à lista.')).not.toBeInTheDocument();
  });
  it.each(['2026-02-30','texto','2026-13-01'])('bloqueia data civil inválida %s recebida no endereço', async value => {
    show(`?validUntilTo=${value}`);
    expect(await screen.findByRole('heading',{name:'Corrija os filtros da consulta'})).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.some(([path])=>path==='/documents')).toBe(false);
  });
  it('bloqueia uma página acima do limite de inteiros seguros antes da requisição', async () => {
    show('?page=9007199254740992');
    await screen.findByRole('heading', { name: 'Corrija os filtros da consulta' });
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents')).toBe(false);
  });

  it.each(['?q=primeiro&q=segundo', '?page=01', '?page=0', '?companyId=outra-empresa', '?workerId=..%2Ffora', `?q=${'a'.repeat(201)}`])('não executa critérios ambíguos ou incompatíveis: %s', async query => {
    show(query);
    await screen.findByRole('heading', { name: 'Corrija os filtros da consulta' });
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('link', { name: 'Documento filtrado' });
    expect(screen.getByLabelText('Endereço atual').textContent).toBe(`?unitId=${unitId}`);
  });

  it('atualiza os resultados com os filtros aplicados preservando o rascunho', async () => {
    show('?q=DOC-001&status=ACTIVE&page=3');
    await screen.findByRole('link', { name: 'Documento filtrado' });
    fireEvent.change(screen.getByLabelText('Buscar por título ou código'), { target: { value: 'Ainda não pesquisar' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'DRAFT' } });
    const before = vi.mocked(api.get).mock.calls.filter(([path]) => path === '/documents').length;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/documents')).toHaveLength(before + 1));
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ q: 'DOC-001', status: 'ACTIVE', page: 3 }) }));
    expect(screen.getByLabelText('Buscar por título ou código')).toHaveValue('Ainda não pesquisar');
    expect(screen.getByLabelText('Situação')).toHaveValue('DRAFT');
  });

  it('oculta a lista se a resposta atualizada contiver documento de outra unidade', async () => {
    show('');
    await screen.findByRole('link', { name: 'Documento filtrado' });
    vi.mocked(api.get).mockResolvedValue({ items: [{ ...fixture, unitId: 'outra-unidade', title: 'Documento de outra unidade' }], page: 1, pageSize: 10, total: 1 } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByRole('link', { name: 'Documento filtrado' })).not.toBeInTheDocument();
    expect(screen.queryByText('Documento de outra unidade')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Paginação de documentos' })).not.toBeInTheDocument();
  });

  it('permite remover um filtro não suportado pela API de navegador antes de consultar', async () => {
    runtime.mode = 'api'; vi.stubEnv('VITE_API_BROWSER_PREFIX', '/browser');
    show(`?responsibleId=${responsibleId}`);
    await screen.findByText(/O filtro por responsável não está disponível/);
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Responsável' }));
    await screen.findByRole('link', { name: 'Documento filtrado' });
    expect(screen.getByLabelText('Endereço atual').textContent).not.toContain('responsibleId');
  });
});
