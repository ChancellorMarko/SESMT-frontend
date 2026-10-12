import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { WorkersPage } from './WorkersPage';

vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({ me: null, unitId: 'unit-1', sessionKey: 'workers-list', can: permission => permission === 'workers.read', status: 'authenticated', sessionError: null, setUnitId: vi.fn(), login: vi.fn(), verifyMfa: vi.fn(), logout: vi.fn(), restore: vi.fn() });
  vi.mocked(api.get).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
});
function Harness() { const location = useLocation(); return <><output aria-label="Endereço atual">{location.search}</output><WorkersPage /></>; }
function show(query: string) { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[`/app/trabalhadores${query}`]}><Harness /></MemoryRouter></QueryClientProvider>); }

describe('paginação de trabalhadores', () => {
  it.each(['Infinity', 'NaN', '-1', '2.5', '9007199254740992'])('normaliza página inválida %s sem enviá-la para a API', async page => {
    show(`?page=${page}`);
    await screen.findByRole('heading', { name: 'Nenhum trabalhador cadastrado' });
    expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('page=1');
  });
  it('recupera página vazia mantendo busca e situação', async () => {
    show('?page=90&q=Ana&status=ACTIVE');
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar à primeira página' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/workers', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: 'Ana', status: 'ACTIVE' }) })));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=Ana&status=ACTIVE');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  });
});
