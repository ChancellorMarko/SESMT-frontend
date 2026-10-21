import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { OperationsDashboardPage } from './OperationsDashboardPage';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({
  sessionKey: 'access-session', unitId: 'unit', can: (permission: string) => session.permissions.includes(permission),
  me: { user: { displayName: 'Pessoa Demo' } },
}) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('./SafetyOverview', async original => ({ ...await original<typeof import('./SafetyOverview')>(), SafetyOverview: () => null }));

const appointment = { id: 'appointment', unitId: 'unit', code: 'AG-001', teamId: 'team', teamName: 'Equipe', serviceTypeId: 'service', serviceLabel: 'Serviço próximo', location: 'Pátio', responsibleName: 'Pessoa responsável', startsAt: '2026-10-18T12:00:00Z', endsAt: '2026-10-18T14:00:00Z', status: 'CONFIRMED' };
const payload = {
  generatedAt: '2026-10-18T12:00:00Z', appointments: 1, activePermits: 2, blockedAppointments: 1, pendingReviews: 1,
  nextAppointments: [appointment],
  pendingPermits: [{ id: 'permit', code: 'PT-PARA-REVISAO', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', version: 1, revision: 1,
    appointment: { ...appointment, id: 'closed-appointment', status: 'ATTENDANCE_OPENED', permitId: 'permit' } }],
};

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/dashboard']}><OperationsDashboardPage /><Location /></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { update: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  session.permissions = ['dashboard.read', 'appointments.read', 'permits.read', 'eligibility.read', 'documents.read'];
  vi.mocked(api.get).mockImplementation(async path => (path === '/permit-options' ? { teams: [], services: [], responsibles: [] } : payload) as never);
});

describe('destinos do painel conforme as capacidades do usuário', () => {
  it('oferece somente agenda para uma concessão operacional sem acesso aos demais módulos', async () => {
    session.permissions = ['dashboard.read', 'appointments.read'];
    show(); await screen.findByText('Serviço próximo');
    expect(screen.getByRole('link', { name: /Serviços na agenda/ })).toHaveAttribute('href', '/app/agenda');
    expect(screen.getByLabelText('Pesquisar em')).toHaveValue('agenda');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /PTs em atendimento|Pendências documentais|Encerramentos para revisão/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Revisão e correções')).not.toBeInTheDocument();
    expect(screen.queryByText('PT-PARA-REVISAO')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').every(link => link.getAttribute('href')?.startsWith('/app/agenda'))).toBe(true);
  });

  it('não oferece prontidão nem agenda bloqueada sem eligibility.read', async () => {
    session.permissions = session.permissions.filter(value => value !== 'eligibility.read');
    show(); await screen.findByText('PT-PARA-REVISAO');
    expect(screen.queryByRole('link', { name: /Pendências documentais|Conferir requisitos por participante/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Consultar painel documental' })).toHaveAttribute('href', '/app/painel-documental');
  });

  it('mantém a agenda bloqueada e a central de requisitos sem oferecer PTs não autorizadas', async () => {
    session.permissions = session.permissions.filter(value => value !== 'permits.read');
    show(); await screen.findByText('Serviço próximo');
    expect(screen.getByRole('link', { name: /Pendências documentais/ })).toHaveAttribute('href', '/app/agenda?eligibility=blocked');
    expect(screen.getByRole('link', { name: 'Conferir requisitos por participante' })).toHaveAttribute('href', '/app/pendencias?unitId=unit&status=pending');
    expect(screen.queryByText('PT-PARA-REVISAO')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Permissões de trabalho' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').some(link => link.getAttribute('href')?.startsWith('/app/pts'))).toBe(false);
  });

  it.each(['pts', 'documentos'])('retorna à busca da agenda quando o acesso à categoria %s é retirado', async category => {
    const view = show(); await screen.findByText('Serviço próximo');
    fireEvent.change(screen.getByLabelText('Pesquisar em'), { target: { value: category } });
    fireEvent.change(screen.getByLabelText('Pesquisar na plataforma'), { target: { value: 'AG-001' } });
    session.permissions = session.permissions.filter(value => value !== (category === 'pts' ? 'permits.read' : 'documents.read'));
    view.update();
    expect(screen.getByLabelText('Pesquisar em')).toHaveValue('agenda');
    expect(screen.getByLabelText('Pesquisar na plataforma')).toHaveValue('AG-001');
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/app/agenda?q=AG-001');
  });
});
