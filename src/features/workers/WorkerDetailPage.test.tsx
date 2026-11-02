import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    if (path === '/workers/worker-1/integration/options') return { policy: { version: 'DEMO-1', evidenceRequired: true, allowNotApplicable: false, maxFileSizeBytes: 10 * 1024 * 1024, allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'], description: 'Política administrativa de demonstração.' }, documents: [] };
    if (path === '/workers/worker-1/integration/evidences') return [];
    if (path === '/documents') {
      return { items: [], total: 0, page: 1, pageSize: 5 };
    }
    return null;
  });
});

afterEach(() => vi.restoreAllMocks());

function ReturnDestination() {
  const location = useLocation();
  return <p>Destino: {location.pathname}{location.search}{location.hash}</p>;
}

function renderPage(options: { state?: unknown; hash?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/app/trabalhadores/worker-1', hash: options.hash, state: options.state }]}>
        <Routes>
          <Route path="/app/trabalhadores/:id" element={<WorkerDetailPage />} />
          <Route path="/app/agenda/:id" element={<ReturnDestination />} />
          <Route path="/app/pendencias" element={<ReturnDestination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...view, client };
}

describe('WorkerDetailPage', () => {
  it('recusa a identidade de outra pessoa antes de consultar documentos ou histórico', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/workers/worker-1' ? { ...mockWorker, id: 'worker-2' } : original(path, options));
    renderPage();
    await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByRole('heading', { name: mockWorker.fullName })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.some(([path]) => path === '/documents' || path.endsWith('/movements'))).toBe(false);
  });
  it('não cria links para documentos de outro trabalhador', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    const document = { id: 'doc-other', code: 'DOC-OUTRO', title: 'Arquivo de outra pessoa', typeId: 'type-a', unitId: 'unit-1', issueDate: '2026-10-01', status: 'ACTIVE', activeVersionIds: [], revision: 1, workerIds: ['worker-2'] };
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/documents' ? { items: [document], page: 1, pageSize: 5, total: 1 } : original(path, options));
    renderPage();
    const region = await screen.findByRole('region', { name: 'Documentos vinculados' });
    await within(region).findByRole('button', { name: 'Tentar novamente' });
    expect(within(region).queryByRole('link', { name: document.title })).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Próximos documentos' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: mockWorker.fullName })).toBeVisible();
  });
  it('confere a página restaurada dos documentos e conserva o retorno à lista', async () => {
    const original = vi.mocked(api.get).getMockImplementation()!;
    const doc = { id: 'doc-a', code: 'DOC-1', title: 'Documento da segunda página', typeId: 'type-a', companyId: 'comp-1', unitId: 'unit-1', issueDate: '2026-10-01', status: 'ACTIVE', activeVersionIds: [], revision: 1, workerIds: ['worker-1'] };
    vi.mocked(api.get).mockImplementation(async (path, options) => path === '/documents' ? { items: [doc], page: options?.query?.page, pageSize: 5, total: 6 } : original(path, options));
    renderPage({ state: { workerDocumentPageReturnTo: { workerId: 'worker-1', unitId: 'unit-1', sessionKey: 'worker-detail', page: 2 }, workerListReturnTo: { unitId: 'unit-1', sessionKey: 'worker-detail', search: '?unitId=unit-1&q=Juliana&page=3', draftSearch: 'Ainda não pesquisar' } } });
    expect(await screen.findByRole('link', { name: doc.title })).toHaveAttribute('href', '/app/documentos/doc-a');
    expect(screen.getByRole('region', { name: 'Documentos vinculados' })).toHaveTextContent('Página 2');
    expect(screen.getByRole('link', { name: 'Voltar à lista' })).toHaveAttribute('href', '/app/trabalhadores?unitId=unit-1&q=Juliana&page=3');
    expect(api.get).toHaveBeenCalledWith('/documents', expect.objectContaining({ query: expect.objectContaining({ workerId: 'worker-1', unitId: 'unit-1', page: 2 }) }));
  });
  it('preserva a consulta validada nos retornos e nas ações da ficha', async () => {
    const search = '?unitId=unit-1&q=Juliana&status=ACTIVE&page=2';
    renderPage({ state: { workerListReturnTo: { unitId: 'unit-1', sessionKey: 'worker-detail', search } } });
    expect(await screen.findByRole('link', { name: 'Voltar à lista' })).toHaveAttribute('href', `/app/trabalhadores${search}`);
    expect(screen.getByRole('link', { name: 'Editar cadastro' })).toHaveAttribute('href', '/app/trabalhadores/worker-1/editar');
    const navigation = screen.getByRole('navigation', { name: 'Seções da ficha do trabalhador' });
    fireEvent.click(within(navigation).getByRole('link', { name: 'Histórico' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Histórico de movimentações' })).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Voltar à lista' })).toHaveAttribute('href', `/app/trabalhadores${search}`);
    expect(within(navigation).getByRole('link', { name: 'Histórico' })).toHaveAttribute('aria-current', 'location');
  });
  it('não oferece atalho de equipe sem leitura do módulo', async () => {
    renderPage(); await screen.findByRole('heading', { name: 'Juliana Costa' });
    expect(screen.queryByRole('link', { name: /Ver equipe/ })).not.toBeInTheDocument();
    expect(screen.getByText('Consulta da equipe não habilitada')).toBeInTheDocument();
  });
  it('exibe situação de integração administrativa e equipes vinculadas', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Juliana Costa' })).toBeInTheDocument();

    // Integration section
    expect(screen.getByRole('heading', { name: 'Integração administrativa' })).toBeInTheDocument();
    expect(screen.getAllByText('integracao_juliana.pdf').length).toBe(2);
    expect(screen.getByText('Engenharia de Segurança')).toBeInTheDocument();
    expect(screen.getByText(/Responsável: Engenharia de Segurança/)).toBeInTheDocument();
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
    const newIntegrationBtn = await screen.findByRole('button', { name: 'Registrar nova integração' });
    await waitFor(() => expect(newIntegrationBtn).toBeEnabled());
    fireEvent.click(newIntegrationBtn);

    expect(screen.getByRole('heading', { name: 'Registrar nova integração' })).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByLabelText('Data de realização *'), { target: { value: '2026-04-01' } });
    fireEvent.change(screen.getByLabelText('Validade da integração'), { target: { value: '2027-04-01' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Salvar integração' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/workers/worker-1/integration',
        expect.objectContaining({
          status: 'PENDING',
          integratedAt: '2026-04-01',
          validUntil: '2027-04-01',
          policyVersion: 'DEMO-1',
        }),
        expect.objectContaining({ etag: '"3"', signal: expect.any(AbortSignal), idempotencyKey: expect.any(String) })
      );
    });

    expect(await screen.findByText(/Integração administrativa registrada\. A execução continua/)).toBeInTheDocument();
  });

  it('retorna ao atendimento de origem preservando filtros e seção', async () => {
    renderPage({ state: { integrationReturnTo: { pathname: '/app/agenda/appointment-1', search: '?tab=equipe&status=SCHEDULED', hash: '#participantes', unitId: 'unit-1' } } });
    const returnLink = await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    expect(returnLink).toHaveAttribute('href', '/app/agenda/appointment-1?tab=equipe&status=SCHEDULED#participantes');
    expect(screen.getByRole('link', { name: 'Voltar à lista' })).toHaveAttribute('href', '/app/trabalhadores');

    fireEvent.click(returnLink);
    expect(await screen.findByText('Destino: /app/agenda/appointment-1?tab=equipe&status=SCHEDULED#participantes')).toBeInTheDocument();
  });

  it('retorna às pendências com a busca e o filtro que originaram a navegação', async () => {
    renderPage({ state: { integrationReturnTo: { pathname: '/app/pendencias', search: '?q=Juliana&status=PENDING&page=2', unitId: 'unit-1' } } });
    const returnLink = await screen.findByRole('link', { name: 'Voltar às pendências' });
    expect(returnLink).toHaveAttribute('href', '/app/pendencias?q=Juliana&status=PENDING&page=2');

    fireEvent.click(returnLink);
    expect(await screen.findByText('Destino: /app/pendencias?q=Juliana&status=PENDING&page=2')).toBeInTheDocument();
  });

  it.each([
    ['URL externa', { pathname: 'https://example.com/app/pendencias', search: '', unitId: 'unit-1' }],
    ['URL relativa a protocolo', { pathname: '//example.com/app/pendencias', search: '', unitId: 'unit-1' }],
    ['protocolo javascript', { pathname: 'javascript:alert(1)', search: '', unitId: 'unit-1' }],
    ['barras duplicadas', { pathname: '/app//pendencias', search: '', unitId: 'unit-1' }],
    ['travessia de diretórios', { pathname: '/app/agenda/../pendencias', search: '', unitId: 'unit-1' }],
    ['travessia codificada', { pathname: '/app/agenda/%2e%2e', search: '', unitId: 'unit-1' }],
    ['barra codificada', { pathname: '/app/agenda/appointment%2F1', search: '', unitId: 'unit-1' }],
    ['rota fora do fluxo', { pathname: '/app/documentos', search: '', unitId: 'unit-1' }],
    ['outra unidade', { pathname: '/app/pendencias', search: '', unitId: 'unit-2' }],
    ['unidade ausente', { pathname: '/app/pendencias', search: '' }],
    ['busca fora de formato', { pathname: '/app/pendencias', search: '//example.com', unitId: 'unit-1' }],
    ['fragmento na busca', { pathname: '/app/pendencias', search: '?status=PENDING#injetado', unitId: 'unit-1' }],
    ['controle na busca', { pathname: '/app/pendencias', search: '?q=teste\n', unitId: 'unit-1' }],
    ['fragmento fora de formato', { pathname: '/app/pendencias', search: '', hash: '//example.com', unitId: 'unit-1' }],
    ['separador invertido', { pathname: '/app/pendencias', search: '', hash: '#\\example.com', unitId: 'unit-1' }],
    ['objeto inválido', 'https://example.com'],
  ])('descarta retorno com %s e mantém o retorno à lista', async (_description, integrationReturnTo) => {
    renderPage({ state: { integrationReturnTo } });
    expect(await screen.findByRole('heading', { name: 'Juliana Costa' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Voltar ao atendimento|Voltar às pendências/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à lista' })).toHaveAttribute('href', '/app/trabalhadores');
  });

  it('oculta o cadastro e o retorno contextual se o vínculo não corresponder à unidade ativa', async () => {
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (...args) => args[0] === '/workers/worker-1' ? { ...mockWorker, unitId: 'unit-2' } : originalGet(...args));
    renderPage({ state: { integrationReturnTo: { pathname: '/app/pendencias', search: '', unitId: 'unit-1' } } });

    await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByRole('heading', { name: 'Juliana Costa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voltar às pendências' })).not.toBeInTheDocument();
  });

  it('foca a integração após carregar o cadastro sem tomar o foco novamente ao atualizar seus dados', async () => {
    const { client } = renderPage({ hash: '#integracao' });
    const panel = await screen.findByRole('region', { name: 'Integração administrativa do trabalhador' });
    await waitFor(() => expect(panel).toHaveFocus());
    expect(panel).toHaveAttribute('id', 'integracao');
    expect(panel).toHaveAttribute('tabindex', '-1');

    const returnLink = screen.getByRole('link', { name: 'Voltar à lista' });
    returnLink.focus();
    act(() => client.setQueryData(['worker', 'worker-detail', 'unit-1', 'worker-1'], { ...mockWorker, revision: 4 }));
    expect(returnLink).toHaveFocus();
  });

  it('preserva o foco inicial quando não há âncora de integração', async () => {
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Integração administrativa do trabalhador' });
    expect(panel).not.toHaveFocus();
  });
});
