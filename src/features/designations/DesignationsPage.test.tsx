import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { DesignationDto } from '../../shared/contracts/designations';
import { DesignationsPage } from './DesignationsPage';

const state = vi.hoisted(() => ({
  permissions: ['appointments.read', 'appointments.write'],
  unitId: 'unit-a',
}));

vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({
    sessionKey: 'session-demo',
    unitId: state.unitId,
    can: (p: string) => state.permissions.includes(p),
  }),
}));

vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn() },
}));

const sampleDesignations: DesignationDto[] = [
  {
    id: 'desig-1',
    unitId: 'unit-a',
    responsibleId: 'resp-1',
    responsibleName: 'Diego Demo · técnico',
    serviceTypeIds: ['serv-1'],
    serviceNames: ['Manutenção programada'],
    locationPattern: 'Área Geral',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    status: 'ACTIVE',
    createdAt: '2026-01-01T10:00:00Z',
    createdBy: 'user-1',
    createdByName: 'Marina Demo',
    revision: 1,
    history: [],
  },
  {
    id: 'desig-2',
    unitId: 'unit-a',
    responsibleId: 'resp-2',
    responsibleName: 'Felipe Demo · bombeiro',
    serviceTypeIds: ['serv-2'],
    serviceNames: ['Inspeção de área'],
    locationPattern: '',
    validFrom: '2025-01-01',
    validUntil: '2025-12-31',
    status: 'EXPIRED',
    createdAt: '2025-01-01T10:00:00Z',
    createdBy: 'user-1',
    createdByName: 'Marina Demo',
    revision: 1,
    history: [],
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DesignationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DesignationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.permissions = ['appointments.read', 'appointments.write'];
    state.unitId = 'unit-a';
    vi.mocked(api.get).mockResolvedValue(sampleDesignations);
  });

  it('exibe bloqueio quando usuário não tem permissão de leitura', () => {
    state.permissions = [];
    renderPage();
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument();
  });

  it('solicita seleção de unidade quando unitId é vazio', () => {
    state.unitId = '';
    renderPage();
    expect(screen.getByText('Selecione uma unidade')).toBeInTheDocument();
  });

  it('renderiza os cards de designações com nomes, serviços e situações', async () => {
    renderPage();
    expect(await screen.findByText('Diego Demo · técnico')).toBeInTheDocument();
    expect(screen.getByText('Felipe Demo · bombeiro')).toBeInTheDocument();
    expect(screen.getByText('Manutenção programada')).toBeInTheDocument();
    expect(screen.getByText('Inspeção de área')).toBeInTheDocument();
    expect(screen.getByText('Vigente')).toBeInTheDocument();
    expect(screen.getByText('Expirada')).toBeInTheDocument();
  });

  it('filtra designações pelo campo de busca', async () => {
    renderPage();
    await screen.findByText('Diego Demo · técnico');
    const searchInput = screen.getByLabelText('Buscar');
    fireEvent.change(searchInput, { target: { value: 'Diego' } });

    expect(screen.getByText('Diego Demo · técnico')).toBeInTheDocument();
    expect(screen.queryByText('Felipe Demo · bombeiro')).not.toBeInTheDocument();
  });

  it('exibe botão de Nova designação quando tem permissão de escrita', async () => {
    renderPage();
    await screen.findByText('Diego Demo · técnico');
    expect(screen.getByRole('link', { name: 'Nova designação' })).toBeInTheDocument();
  });
});
