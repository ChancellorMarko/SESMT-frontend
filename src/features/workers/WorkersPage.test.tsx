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
  vi.mocked(useSession).mockReturnValue({
    me: null,
    unitId: 'unit-1',
    sessionKey: 'workers-list',
    can: permission => ['workers.read', 'organization.read', 'teams.read'].includes(permission),
    status: 'authenticated',
    sessionError: null,
    setUnitId: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
    restore: vi.fn(),
  });
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/organization') {
      return {
        companies: [{ id: 'comp-1', name: 'Empresa Alfa' }, { id: 'comp-2', name: 'Empresa Beta' }],
        establishments: [],
        units: [{ id: 'unit-1', name: 'Unidade Principal', companyId: 'comp-1' }],
        sectors: [{ id: 'sec-1', name: 'Manutenção', unitId: 'unit-1' }],
        jobs: [],
        jobFunctions: [],
        workCenters: [],
      };
    }
    if (path === '/teams') {
      return [
        { id: 'team-1', name: 'Equipe Civil', unitId: 'unit-1', companyId: 'comp-1', chiefId: 'w-1', members: [], status: 'ACTIVE', revision: 1 },
      ];
    }
    return { items: [], total: 0, page: 1, pageSize: 10 };
  });
});

function Harness() {
  const location = useLocation();
  return (
    <>
      <output aria-label="Endereço atual">{location.search}</output>
      <WorkersPage />
    </>
  );
}

function show(query = '') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/app/trabalhadores${query}`]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

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

describe('filtros e listagem avançada de trabalhadores', () => {
  it('exibe badges de integração e dados do trabalhador', async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === '/organization') {
        return {
          companies: [{ id: 'comp-1', name: 'Empresa Alfa' }],
          establishments: [],
          units: [{ id: 'unit-1', name: 'Unidade Principal', companyId: 'comp-1' }],
          sectors: [{ id: 'sec-1', name: 'Manutenção', unitId: 'unit-1' }],
          jobs: [],
          jobFunctions: [],
          workCenters: [],
        };
      }
      if (path === '/teams') return [];
      if (path === '/workers') {
        return {
          items: [
            {
              id: 'w-1',
              fullName: 'Carlos Mendes',
              registration: 'MAT-001',
              companyId: 'comp-1',
              unitId: 'unit-1',
              sectorId: 'sec-1',
              employmentType: 'CLT',
              admissionDate: '2025-01-15',
              status: 'ACTIVE',
              integrationStatus: 'INTEGRATED',
              integrationValidUntil: '2026-12-31',
              revision: 1,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        };
      }
      return { items: [], total: 0, page: 1, pageSize: 10 };
    });

    show();
    expect(await screen.findByText('Carlos Mendes')).toBeInTheDocument();
    expect(screen.getByText('MAT-001')).toBeInTheDocument();
    expect(screen.getByText('Empresa Alfa')).toBeInTheDocument();
    expect(screen.getAllByText('Integrado').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Até 31/12/2026')).toBeInTheDocument();
  });

  it('permite filtrar por situação de integração e equipe', async () => {
    show();
    await screen.findByRole('heading', { name: 'Nenhum trabalhador cadastrado' });

    // Filter by integration status
    const integrationSelect = screen.getByLabelText('Integração administrativa');
    fireEvent.change(integrationSelect, { target: { value: 'PENDING' } });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('integrationStatus=PENDING');

    // Filter by team
    const teamSelect = await screen.findByLabelText('Equipe operacional');
    fireEvent.change(teamSelect, { target: { value: 'team-1' } });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('teamId=team-1');
  });
});
