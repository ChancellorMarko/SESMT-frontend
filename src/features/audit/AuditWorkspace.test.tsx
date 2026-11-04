import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { AuditLogDto, PageDto } from '../../shared/contracts';
import { AuditPage } from './AuditPage';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'workspace-session', unitId: 'unit', can: (permission: string) => permission === 'audit.read' }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));

const rows: AuditLogDto[] = [
  ...Array.from({ length: 43 }, (_, index) => ({ id: `created-${index}`, actorId: `actor-created-${index}`, action: 'DOCUMENT_CREATED', resourceType: 'DOCUMENT', resourceId: `document-created-${index}`, occurredAt: '2026-10-11T12:00:00Z', requestId: `trace-created-${index}`, outcome: 'DEMO' })),
  ...Array.from({ length: 22 }, (_, index) => ({ id: `viewed-${index}`, actorId: `actor-viewed-${index}`, action: 'DOCUMENT_VIEWED', resourceType: 'DOCUMENT', resourceId: `document-viewed-${index}`, occurredAt: '2026-10-11T12:00:00Z', requestId: `trace-viewed-${index}`, outcome: 'DEMO' })),
];
function response(options?: Parameters<typeof api.get>[1]): PageDto<AuditLogDto> {
  const query = options?.query ?? {}, page = Number(query.page ?? 1);
  const filtered = rows.filter(item => (!query.action || item.action === query.action)
    && (!query.from || item.occurredAt.slice(0, 10) >= String(query.from))
    && (!query.to || item.occurredAt.slice(0, 10) <= String(query.to)));
  return { items: filtered.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: filtered.length };
}
function Harness() {
  const location = useLocation(), navigate = useNavigate();
  return <><output aria-label="Endereço atual">{location.search}</output><button onClick={() => navigate(-1)}>Voltar no histórico</button><AuditPage /></>;
}
function show(query = '?unitId=unit&action=DOCUMENT_CREATED&from=2026-10-01&to=2026-10-31') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/auditoria${query}`]}><Harness /></MemoryRouter></QueryClientProvider>);
  return client;
}
function currentSearch() { return new URLSearchParams(screen.getByLabelText('Endereço atual').textContent ?? ''); }
function editDraft() {
  fireEvent.change(screen.getByLabelText('Ação'), { target: { value: 'DOCUMENT_VIEWED' } });
  fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-02' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_path, options) => response(options) as never);
});

describe('espaço de consulta da auditoria', () => {
  it('distingue o rascunho da consulta aplicada e só envia os novos critérios ao filtrar', async () => {
    show('?unitId=unit&action=DOCUMENT_CREATED&from=2026-10-01&to=2026-10-31&page=2');
    await screen.findByRole('cell', { name: 'actor-created-20' });
    const calls = vi.mocked(api.get).mock.calls.length;
    editDraft();
    expect(screen.getByText('Alterações ainda não aplicadas à consulta.')).toBeVisible();
    const applied = screen.getByRole('group', { name: 'Filtros aplicados' });
    expect(within(applied).getByRole('button', { name: 'Remover filtro: Ação' })).toHaveTextContent('Documento cadastrado');
    await act(async () => {});
    expect(api.get).toHaveBeenCalledTimes(calls);
    expect(currentSearch().get('action')).toBe('DOCUMENT_CREATED');
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await screen.findByRole('cell', { name: 'actor-viewed-0' });
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', action: 'DOCUMENT_VIEWED', from: '2026-10-02', to: '2026-10-31', page: 1 }) }));
    expect(currentSearch().has('page')).toBe(false);
    expect(screen.queryByText('Alterações ainda não aplicadas à consulta.')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });

  it('preserva alterações locais ao paginar a consulta que continua aplicada', async () => {
    show(); await screen.findByRole('cell', { name: 'actor-created-0' });
    editDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByRole('cell', { name: 'actor-created-20' });
    expect(screen.getByLabelText('Ação')).toHaveValue('DOCUMENT_VIEWED');
    expect(screen.getByLabelText('De')).toHaveValue('2026-10-02');
    expect(screen.getByText('Alterações ainda não aplicadas à consulta.')).toBeVisible();
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'DOCUMENT_CREATED', from: '2026-10-01', page: 2 }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByRole('cell', { name: 'actor-created-0' });
    expect(screen.getByLabelText('Ação')).toHaveValue('DOCUMENT_VIEWED');
  });

  it.each([['Ação', 'action'], ['De', 'from'], ['Até', 'to']])('remove somente %s e a página, mantém os outros critérios e descarta o rascunho visivelmente', async (label, key) => {
    show('?unitId=unit&action=DOCUMENT_CREATED&from=2026-10-01&to=2026-10-31&page=2');
    await screen.findByRole('cell', { name: 'actor-created-20' }); editDraft();
    fireEvent.click(screen.getByRole('button', { name: `Remover filtro: ${label}` }));
    await screen.findByRole('cell', { name: 'actor-created-0' });
    const expected: Record<string, string> = { unitId: 'unit', action: 'DOCUMENT_CREATED', from: '2026-10-01', to: '2026-10-31' };
    delete expected[key];
    expect(Object.fromEntries(currentSearch())).toEqual(expected);
    expect(screen.getByLabelText('Ação')).toHaveValue(expected.action ?? '');
    expect(screen.getByLabelText('De')).toHaveValue(expected.from ?? '');
    expect(screen.getByLabelText('Até')).toHaveValue(expected.to ?? '');
    expect(screen.queryByText('Alterações ainda não aplicadas à consulta.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Ação')).toHaveFocus());
  });

  it('limpa critérios aplicados e preenchimento local mantendo somente a unidade', async () => {
    show(); await screen.findByRole('cell', { name: 'actor-created-0' }); editDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(Object.fromEntries(currentSearch())).toEqual({ unitId: 'unit' }));
    await screen.findByRole('cell', { name: 'actor-created-0' });
    expect(screen.getByLabelText('Ação')).toHaveValue(''); expect(screen.getByLabelText('De')).toHaveValue(''); expect(screen.getByLabelText('Até')).toHaveValue('');
    expect(screen.queryByRole('group', { name: 'Filtros aplicados' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alterações ainda não aplicadas à consulta.')).not.toBeInTheDocument();
  });

  it('sincroniza o formulário com os critérios recuperados no histórico', async () => {
    show(); await screen.findByRole('cell', { name: 'actor-created-0' });
    editDraft(); fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await screen.findByRole('cell', { name: 'actor-viewed-0' });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar no histórico' }));
    await screen.findByRole('cell', { name: 'actor-created-0' });
    expect(screen.getByLabelText('Ação')).toHaveValue('DOCUMENT_CREATED');
    expect(screen.getByLabelText('De')).toHaveValue('2026-10-01'); expect(screen.getByLabelText('Até')).toHaveValue('2026-10-31');
    expect(screen.queryByText('Alterações ainda não aplicadas à consulta.')).not.toBeInTheDocument();
  });

  it('mantém o rascunho durante atualização da mesma consulta e informa totais da consulta e da página', async () => {
    show(); await screen.findByRole('cell', { name: 'actor-created-0' });
    let summary = screen.getByRole('status', { name: 'Resumo da consulta' });
    expect(within(summary).getByText('Na consulta')).toBeVisible(); expect(within(summary).getByText('43')).toBeVisible();
    expect(within(summary).getByText('Nesta página')).toBeVisible(); expect(within(summary).getByText('20')).toBeVisible();
    editDraft();
    const calls = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(calls + 1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled());
    expect(screen.getByLabelText('Ação')).toHaveValue('DOCUMENT_VIEWED'); expect(screen.getByLabelText('De')).toHaveValue('2026-10-02');
    expect(api.get).toHaveBeenLastCalledWith('/audit-logs', expect.objectContaining({ query: expect.objectContaining({ action: 'DOCUMENT_CREATED', from: '2026-10-01' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar eventos' }));
    await screen.findByRole('cell', { name: 'actor-viewed-0' });
    summary = screen.getByRole('status', { name: 'Resumo da consulta' });
    expect(within(summary).getByText('22')).toBeVisible(); expect(within(summary).getByText('20')).toBeVisible();
  });
});
