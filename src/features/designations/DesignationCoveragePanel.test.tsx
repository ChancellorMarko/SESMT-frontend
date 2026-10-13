import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { DesignationCoverageDto } from '../../shared/contracts/designations';
import { DesignationCoveragePanel } from './DesignationCoveragePanel';

const state = vi.hoisted(() => ({
  permissions: ['permits.read'],
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
  api: { get: vi.fn() },
}));

const coveredData: DesignationCoverageDto = {
  checkedAt: '2026-10-13T10:00:00Z',
  unitId: 'unit-a',
  fullyCovered: true,
  operationalWindowEnd: '2026-12-31',
  items: [
    {
      serviceTypeId: 'serv-1',
      serviceName: 'Trabalho em altura',
      covered: true,
      designationId: 'desig-1',
      responsibleId: 'resp-1',
      responsibleName: 'Diego Demo · técnico',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
    },
  ],
};

const blockedData: DesignationCoverageDto = {
  checkedAt: '2026-10-13T10:00:00Z',
  unitId: 'unit-a',
  fullyCovered: false,
  items: [
    {
      serviceTypeId: 'serv-1',
      serviceName: 'Trabalho em altura',
      covered: true,
      designationId: 'desig-1',
      responsibleId: 'resp-1',
      responsibleName: 'Diego Demo · técnico',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
    },
    {
      serviceTypeId: 'serv-2',
      serviceName: 'Espaço confinado',
      covered: false,
      expired: true,
      responsibleName: 'Felipe Demo · bombeiro',
      validUntil: '2026-09-30',
    },
    {
      serviceTypeId: 'serv-3',
      serviceName: 'Eletricidade',
      covered: false,
    },
  ],
};

function renderPanel(props: { unitId: string; serviceTypeIds: string[]; location?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DesignationCoveragePanel {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DesignationCoveragePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.permissions = ['permits.read'];
  });

  it('renderiza nada quando serviceTypeIds está vazio', () => {
    const { container } = renderPanel({ unitId: 'unit-a', serviceTypeIds: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('exibe cobertura completa e janela operacional quando todos os serviços estão cobertos', async () => {
    vi.mocked(api.get).mockResolvedValue(coveredData);
    renderPanel({ unitId: 'unit-a', serviceTypeIds: ['serv-1'], location: 'Área 1' });

    expect(await screen.findByText('Cobertura completa')).toBeInTheDocument();
    expect(screen.getByText('Trabalho em altura')).toBeInTheDocument();
    expect(screen.getByText(/Diego Demo · técnico/)).toBeInTheDocument();
    expect(screen.getByText(/Janela operacional vigente até/)).toBeInTheDocument();
  });

  it('exibe bloqueio e detalha serviços expirados e sem designação quando cobertura é incompleta', async () => {
    vi.mocked(api.get).mockResolvedValue(blockedData);
    renderPanel({ unitId: 'unit-a', serviceTypeIds: ['serv-1', 'serv-2', 'serv-3'] });

    expect(await screen.findByText('Bloqueio de designação')).toBeInTheDocument();
    expect(screen.getByText(/Operação bloqueada/)).toBeInTheDocument();
    expect(screen.getByText('Espaço confinado')).toBeInTheDocument();
    expect(screen.getByText('Expirada')).toBeInTheDocument();
    expect(screen.getByText('Eletricidade')).toBeInTheDocument();
    expect(screen.getByText('Sem designação')).toBeInTheDocument();
  });
});
