import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { api } from '../../shared/api/client';
import type { DocumentDto, PageDto } from '../../shared/contracts';
import { ExpirationsPage } from './ExpirationsPage';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ unitId: 'unit-a', sessionKey: 'expiration-workspace', can: (permission: string) => permission === 'documents.read' }) }));
vi.mock('../../shared/lib/format', async original => ({ ...await original<typeof import('../../shared/lib/format')>(), dateOnly: () => '2026-10-18' }));

function response(options?: Parameters<typeof api.get>[1]): PageDto<DocumentDto> {
  const query = options?.query ?? {}, page = Number(query.page ?? 1);
  const rows: DocumentDto[] = Array.from({ length: 24 }, (_, index) => ({
    id: `doc-${index + 1}`, code: `DOC-${index + 1}`, title: `Documento ${index + 1}`, companyId: 'company-a', unitId: 'unit-a',
    typeId: 'type-a', ownerId: 'owner-a', accessClass: 'INTERNAL', issueDate: '2026-01-01', validUntil: '2026-10-18',
    status: query.status === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE', activeVersionIds: [], availableActions: [], revision: 1,
    workerIds: [], responsibleIds: [], keywords: [],
  }));
  return { items: rows.slice((page - 1) * 10, page * 10), total: rows.length, page, pageSize: 10 };
}

function Harness() {
  const location = useLocation();
  return <><output aria-label="Endereço atual">{location.search}</output><ExpirationsPage /></>;
}

function renderWorkspace(query: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/vencimentos${query}`]}><Harness /></MemoryRouter></QueryClientProvider>);
}

async function show(query: string) {
  renderWorkspace(query);
  await screen.findByRole('link', { name: new URLSearchParams(query).get('page') === '2' ? 'Documento 11' : 'Documento 1' });
}

function address() { return new URLSearchParams(screen.getByLabelText('Endereço atual').textContent ?? ''); }
function searchInput() { return screen.getByLabelText('Buscar por título ou código'); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
});

describe('espaço de consulta de vencimentos', () => {
  it('remove a busca aplicada e a página, preservando consulta, antecedência e unidade, e limpa o rascunho explicitamente', async () => {
    await show('?unitId=unit-a&view=expired&days=90&q=PGR&page=2');
    fireEvent.change(searchInput(), { target: { value: 'Rascunho para depois' } });
    expect(screen.getByText(/^Busca ainda não aplicada\.?$/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Busca' }));

    await waitFor(() => expect(address().has('q')).toBe(false));
    expect(address().has('page')).toBe(false);
    expect(address().get('view')).toBe('expired');
    expect(address().get('days')).toBe('90');
    expect(address().get('unitId')).toBe('unit-a');
    expect(searchInput()).toHaveValue('');
    expect(searchInput()).toHaveFocus();
    expect(screen.queryByText(/^Busca ainda não aplicada\.?$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover filtro: Busca' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'EXPIRED' } })));
  });

  it('remove a consulta de vencidos e retoma o período guardado sem apagar a busca em edição', async () => {
    await show('?unitId=unit-a&view=expired&days=90&q=PGR&page=2');
    fireEvent.change(searchInput(), { target: { value: 'ASO em edição' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Consulta' }));

    await waitFor(() => expect(address().has('view')).toBe(false));
    expect(address().has('page')).toBe(false);
    expect(address().get('days')).toBe('90');
    expect(address().get('q')).toBe('PGR');
    expect(address().get('unitId')).toBe('unit-a');
    expect(screen.getByLabelText('Consultar')).toHaveValue('upcoming');
    expect(screen.getByLabelText('Antecedência')).toHaveValue('90');
    expect(screen.getByRole('button', { name: 'Remover filtro: Antecedência' })).toBeVisible();
    expect(searchInput()).toHaveValue('ASO em edição');
    expect(screen.getByText(/^Busca ainda não aplicada\.?$/)).toBeVisible();
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'ACTIVE', q: 'PGR', validUntilFrom: '2026-10-18', validUntilTo: '2027-01-16' } })));
  });

  it('remove a antecedência escolhida e volta a 30 dias, mantendo a busca aplicada e o rascunho', async () => {
    await show('?unitId=unit-a&view=upcoming&days=90&q=PGR&page=2');
    fireEvent.change(searchInput(), { target: { value: 'Texto não enviado' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Antecedência' }));

    await waitFor(() => expect(address().has('days')).toBe(false));
    expect(address().has('page')).toBe(false);
    expect(address().get('view')).toBe('upcoming');
    expect(address().get('q')).toBe('PGR');
    expect(address().get('unitId')).toBe('unit-a');
    expect(screen.getByLabelText('Antecedência')).toHaveValue('30');
    expect(screen.queryByRole('button', { name: 'Remover filtro: Antecedência' })).not.toBeInTheDocument();
    expect(searchInput()).toHaveValue('Texto não enviado');
    expect(screen.getByText(/^Busca ainda não aplicada\.?$/)).toBeVisible();
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'ACTIVE', q: 'PGR', validUntilFrom: '2026-10-18', validUntilTo: '2026-11-17' } })));
  });

  it('mantém a antecedência inativa fora dos filtros aplicados em vencidos e a recupera ao consultar a vencer', async () => {
    await show('?unitId=unit-a&view=expired&days=90');
    expect(screen.queryByLabelText('Antecedência')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover filtro: Antecedência' })).not.toBeInTheDocument();
    expect(address().get('days')).toBe('90');
    expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'EXPIRED' } }));

    fireEvent.change(screen.getByLabelText('Consultar'), { target: { value: 'upcoming' } });

    expect(await screen.findByRole('button', { name: 'Remover filtro: Antecedência' })).toBeVisible();
    expect(screen.getByLabelText('Antecedência')).toHaveValue('90');
    expect(address().get('days')).toBe('90');
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ status: 'ACTIVE', validUntilTo: '2027-01-16' }) })));
  });

  it('identifica o rascunho sem consultar enquanto se digita e aplica somente ao enviar a busca', async () => {
    await show('?unitId=unit-a&days=7&q=PGR');
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.change(searchInput(), { target: { value: '  ASO ocupacional  ' } });

    expect(screen.getByText(/^Busca ainda não aplicada\.?$/)).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(address().get('q')).toBe('PGR');
    expect(screen.getByRole('button', { name: 'Remover filtro: Busca' })).toHaveAttribute('title', 'Busca: PGR');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ q: 'ASO ocupacional', validUntilTo: '2026-10-25' }) })));
    expect(address().get('q')).toBe('ASO ocupacional');
    expect(screen.queryByText(/^Busca ainda não aplicada\.?$/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover filtro: Busca' })).toHaveAttribute('title', 'Busca: ASO ocupacional');
  });

  it('conserva o rascunho ao alterar período e consulta, sem enviá-lo junto com os filtros', async () => {
    await show('?unitId=unit-a&days=7&q=PGR');
    fireEvent.change(searchInput(), { target: { value: 'Rascunho de ASO' } });

    fireEvent.change(screen.getByLabelText('Antecedência'), { target: { value: '90' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ q: 'PGR', validUntilTo: '2027-01-16' }) })));
    expect(searchInput()).toHaveValue('Rascunho de ASO');
    fireEvent.change(screen.getByLabelText('Consultar'), { target: { value: 'expired' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'EXPIRED', q: 'PGR' } })));

    expect(searchInput()).toHaveValue('Rascunho de ASO');
    expect(screen.getByText(/^Busca ainda não aplicada\.?$/)).toBeVisible();
    expect(address().get('q')).toBe('PGR');
    expect(address().get('days')).toBe('90');
  });

  it('limpa todos os critérios e o rascunho, preservando somente a unidade', async () => {
    await show('?unitId=unit-a&view=expired&days=90&q=PGR&page=2');
    fireEvent.change(searchInput(), { target: { value: 'Outro texto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    await waitFor(() => expect(Array.from(address().entries())).toEqual([['unitId', 'unit-a']]));
    expect(searchInput()).toHaveValue('');
    expect(screen.getByLabelText('Consultar')).toHaveValue('upcoming');
    expect(screen.getByLabelText('Antecedência')).toHaveValue('30');
    expect(screen.queryByText(/^Busca ainda não aplicada\.?$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover filtro: Busca' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover filtro: Antecedência' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'ACTIVE', validUntilFrom: '2026-10-18', validUntilTo: '2026-11-17' } })));
  });

  it.each([
    ['sem data de vencimento', undefined],
    ['antes do início do período', '2026-10-17'],
    ['após o fim do período', '2026-10-26'],
  ])('recusa a página a vencer %s sem expor dados nem atalho ao repositório', async (_label, validUntil) => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const value = response(options);
      value.items = value.items.map(item => ({ ...item, title: 'Título fora do período solicitado', validUntil }));
      return value as never;
    });
    renderWorkspace('?unitId=unit-a&days=7');

    expect(await screen.findByRole('alert')).toHaveTextContent('página inválida');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Título fora do período solicitado')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Abrir no repositório/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
  });

  it.each(['2026-10-18', '2026-10-25'])('aceita a data inclusiva %s nos limites do período', async validUntil => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const value = response(options);
      value.items = value.items.map(item => ({ ...item, validUntil }));
      return value as never;
    });
    await show('?unitId=unit-a&days=7');

    expect(screen.getByRole('link', { name: 'Documento 1' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Abrir no repositório/ })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('aceita vencidos pelo status documental informado, inclusive sem data, sem inferir uma nova situação', async () => {
    vi.mocked(api.get).mockImplementation(async (_path, options) => {
      const value = response(options);
      value.items = value.items.map(item => ({ ...item, validUntil: undefined }));
      return value as never;
    });
    await show('?unitId=unit-a&view=expired&days=90');

    expect(screen.getByRole('link', { name: 'Documento 1' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Abrir no repositório/ })).toBeVisible();
    expect(screen.getAllByText('Sem data informada')).toHaveLength(10);
    expect(api.get).toHaveBeenLastCalledWith('/documents', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, status: 'EXPIRED' } }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
