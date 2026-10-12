import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto } from '../../shared/contracts';
import { DocumentsPage } from './DocumentsPage';

vi.mock('../../shared/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
const unitId = '10000000-0000-4000-8000-000000000001';
const typeId = '20000000-0000-4000-8000-000000000001';
const responsibleId = '30000000-0000-4000-8000-000000000001';
const fixture: DocumentDto = { id: unitId, code: 'DOC-001', title: 'Documento filtrado', companyId: unitId, unitId, typeId, ownerId: responsibleId, accessClass: 'INTERNAL', issueDate: '2026-10-05', status: 'ACTIVE', activeVersionIds: [], availableActions: [], revision: 1, workerIds: [], responsibleIds: [], keywords: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockImplementation(() => ({ me: null, unitId, sessionKey: 'url-test', can: () => false, status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() }));
  vi.mocked(api.get).mockImplementation(async <T,>(path: string): Promise<T> => (path === '/documents' ? { items: [fixture], page: 3, pageSize: 10, total: 50 } : { items: [{ id: typeId, name: 'Procedimento' }], page: 1, pageSize: 100, total: 1 }) as T);
});

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
    expect(await screen.findByRole('heading', { name: 'Corrija o intervalo da consulta' })).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents')).toBe(false);
  });
  it.each(['2026-02-30','texto','2026-13-01'])('bloqueia data civil inválida %s recebida no endereço', async value => {
    show(`?validUntilTo=${value}`);
    expect(await screen.findByRole('heading',{name:'Corrija o intervalo da consulta'})).toBeVisible();
    expect(vi.mocked(api.get).mock.calls.some(([path])=>path==='/documents')).toBe(false);
  });
  it('normaliza uma página acima do limite de inteiros seguros', async () => {
    show('?page=9007199254740992');
    await screen.findByRole('link',{name:'Documento filtrado'});
    expect(api.get).toHaveBeenCalledWith('/documents',expect.objectContaining({query:expect.objectContaining({page:1})}));
  });
});
