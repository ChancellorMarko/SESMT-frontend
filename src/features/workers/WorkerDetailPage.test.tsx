import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { WorkerDetailPage } from './WorkerDetailPage';

vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: vi.fn() }));

const mockWorker = {
  id: 'worker-1',
  fullName: 'Juliana Costa',
  registration: 'MAT-888',
  companyId: 'comp-1',
  unitId: 'unit-1',
  sectorId: 'sec-1',
  employmentType: 'CLT',
  admissionDate: '2024-03-01',
  status: 'ACTIVE' as const,
  revision: 3,
  integrationStatus: 'INTEGRATED' as const,
  integratedAt: '2024-03-02',
  integrationValidUntil: '2025-03-02',
  integrationResponsibleName: 'Engenharia de Segurança',
  integrationEvidenceFileName: 'integracao_juliana.pdf',
  integrationHistory: [
    {
      id: 'int-1',
      workerId: 'worker-1',
      status: 'INTEGRATED' as const,
      integratedAt: '2024-03-02',
      validUntil: '2025-03-02',
      responsibleId: 'user-admin',
      responsibleName: 'Engenharia de Segurança',
      evidenceFileName: 'integracao_juliana.pdf',
      notes: 'Treinamento presencial na integração de novos contratados',
      registeredAt: '2024-03-02T10:00:00Z',
    },
  ],
  teams: [
    {
      teamId: 'team-1',
      teamName: 'Equipe Elétrica',
      serviceFunction: 'Eletricista Oficial',
      status: 'ACTIVE' as const,
      isChief: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    me: { id: 'user-admin', displayName: 'Admin' } as any,
    unitId: 'unit-1',
    sessionKey: 'worker-detail',
    can: permission => ['workers.read', 'workers.write', 'organization.read', 'documents.read'].includes(permission),
    status: 'authenticated',
    sessionError: null,
    setUnitId: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    logout: vi.fn(),
    restore: vi.fn(),
  });
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === '/workers/worker-1') return mockWorker;
    if (path === '/organization') {
      return {
        companies: [{ id: 'comp-1', name: 'Empresa Principal' }],
        establishments: [],
        units: [{ id: 'unit-1', name: 'Unidade Fabril', companyId: 'comp-1' }],
        sectors: [{ id: 'sec-1', name: 'Elétrica', unitId: 'unit-1' }],
        jobs: [],
        jobFunctions: [],
        workCenters: [],
      };
    }
    if (path === '/workers/worker-1/movements') {
      return { items: [], total: 0, page: 1, pageSize: 5 };
    }
    if (path === '/documents') {
      return { items: [], total: 0, page: 1, pageSize: 5 };
    }
    return null;
  });
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/trabalhadores/worker-1']}>
        <Routes>
          <Route path="/app/trabalhadores/:id" element={<WorkerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WorkerDetailPage', () => {
  it('exibe situação de integração administrativa e equipes vinculadas', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Juliana Costa' })).toBeInTheDocument();

    // Integration section
    expect(screen.getByRole('heading', { name: 'Integração administrativa' })).toBeInTheDocument();
    expect(screen.getAllByText('integracao_juliana.pdf').length).toBe(2);
    expect(screen.getAllByText('Engenharia de Segurança').length).toBe(2);
    expect(screen.getByText('Treinamento presencial na integração de novos contratados')).toBeInTheDocument();

    // Teams section
    expect(screen.getByRole('heading', { name: 'Equipes de trabalho vinculadas' })).toBeInTheDocument();
    expect(screen.getByText('Equipe Elétrica')).toBeInTheDocument();
    expect(screen.getByText('Eletricista Oficial')).toBeInTheDocument();
    expect(screen.getByText('Chefe da equipe')).toBeInTheDocument();
  });

  it('permite registrar nova integração com If-Match da revisão atual', async () => {
    const updated = {
      ...mockWorker,
      revision: 4,
      integrationStatus: 'INTEGRATED' as const,
      integratedAt: '2026-04-01',
      integrationValidUntil: '2027-04-01',
      integrationResponsibleName: 'SESMT Corporativo',
    };
    vi.mocked(api.post).mockResolvedValue(updated);

    renderPage();
    expect(await screen.findByRole('heading', { name: 'Juliana Costa' })).toBeInTheDocument();

    // Open form
    const newIntegrationBtn = screen.getByRole('button', { name: 'Registrar nova integração' });
    fireEvent.click(newIntegrationBtn);

    expect(screen.getByRole('heading', { name: 'Registrar nova integração' })).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByLabelText('Data de realização *'), { target: { value: '2026-04-01' } });
    fireEvent.change(screen.getByLabelText('Validade da integração'), { target: { value: '2027-04-01' } });
    fireEvent.change(screen.getByLabelText('Responsável pelo registro'), { target: { value: 'SESMT Corporativo' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/workers/worker-1/integration',
        expect.objectContaining({
          status: 'INTEGRATED',
          integratedAt: '2026-04-01',
          validUntil: '2027-04-01',
          responsibleName: 'SESMT Corporativo',
        }),
        { etag: '"3"' }
      );
    });

    expect(await screen.findByText('Integração administrativa registrada com sucesso.')).toBeInTheDocument();
  });
});
