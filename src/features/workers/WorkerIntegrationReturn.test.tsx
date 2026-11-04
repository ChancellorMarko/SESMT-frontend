import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { AppointmentDetailPage } from '../agenda/AppointmentDetailPage';
import { WorkerDetailPage } from './WorkerDetailPage';
import { WorkerIntegrationLink } from './WorkerIntegrationLink';

const session = vi.hoisted(() => ({ permissions: ['workers.read', 'appointments.read', 'eligibility.read'], unitId: 'unit-a' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'readiness-relay', unitId: session.unitId, can: (permission: string) => session.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('../agenda/EligibilityPanel', () => ({ EligibilityPanel: () => <WorkerIntegrationLink workerId="worker-a" workerName="Ana Teste" /> }));
vi.mock('./WorkerIntegrationPanel', () => ({ WorkerIntegrationPanel: () => <div>Integração administrativa</div> }));

const appointment: AppointmentDto = {
  id: 'appointment-a', unitId: 'unit-a', code: 'AG-TESTE', teamId: 'team-a', teamName: 'Equipe teste',
  serviceTypeId: 'service-a', serviceLabel: 'Serviço demonstrativo', location: 'Área teste',
  startsAt: '2026-10-19T09:00:00-03:00', endsAt: '2026-10-19T10:00:00-03:00',
  responsibleId: 'operator', responsibleName: 'Responsável teste', participants: [], status: 'CONFIRMED',
  revision: 1, availableActions: [], history: [],
};
const search = '?unitId=unit-a&q=Ana+Teste&teamId=team-a&serviceTypeId=service-a&status=pending';
const readinessReturnTo = { unitId: 'unit-a', search };
const integrationOrigin = (readiness: unknown = readinessReturnTo) => ({
  integrationReturnTo: { pathname: '/app/agenda/appointment-a', search: '?tab=equipe', hash: '#participantes', unitId: 'unit-a', readinessReturnTo: readiness, untrusted: 'não propagar' },
});
function Location() {
  const location = useLocation();
  return <><output aria-label="Endereço">{location.pathname}{location.search}{location.hash}</output><output aria-label="Estado">{JSON.stringify(location.state)}</output></>;
}
function show(options: { pathname?: string; state?: unknown } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: options.pathname ?? '/app/agenda/appointment-a', state: options.state ?? { readinessReturnTo, untrusted: 'não propagar', fromSearch: '?calendarMode=week' } }]}><Routes>
    <Route path="/app/agenda/:id" element={<AppointmentDetailPage />} />
    <Route path="/app/trabalhadores/:id" element={<WorkerDetailPage />} />
    <Route path="/app/pendencias" element={<div>Consulta documental original</div>} />
    <Route path="/app/agenda" element={<div>Lista da agenda</div>} />
  </Routes><Location /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); session.permissions = ['workers.read', 'appointments.read', 'eligibility.read']; session.unitId = 'unit-a';
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/appointments/appointment-a') return structuredClone(appointment);
    if (path === '/workers/worker-a') return { id: 'worker-a', fullName: 'Ana Teste', registration: 'DEMO-1', unitId: 'unit-a', companyId: 'company-a', sectorId: 'sector-a', employmentType: 'CLT', admissionDate: '2025-01-01', status: 'ACTIVE', revision: 1, teams: [], integrationStatus: 'PENDING', integrationHistory: [] };
    return { items: [], total: 0, page: 1, pageSize: 5 };
  });
});

describe('retorno às pendências após consultar a integração no atendimento', () => {
  it('preserva a origem documental validada durante todo o desvio sem propagar estado arbitrário', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('link', { name: 'Consultar integração de Ana Teste' }));
    await screen.findByRole('heading', { name: 'Ana Teste' });
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!)).toEqual({ integrationReturnTo: { pathname: '/app/agenda/appointment-a', search: '', hash: '', unitId: 'unit-a', readinessReturnTo } });
    await user.click(screen.getByRole('link', { name: 'Voltar ao atendimento' }));
    const back = await screen.findByRole('link', { name: 'Voltar às pendências' });
    expect(back).toHaveAttribute('href', `/app/pendencias${search}`);
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!)).toEqual({ readinessReturnTo });
    await user.click(back);
    expect(await screen.findByText('Consulta documental original')).toBeVisible();
    expect(screen.getByLabelText('Endereço')).toHaveTextContent(`/app/pendencias${search}`);
  });

  it('mantém busca e seção do atendimento ao devolver a origem documental', async () => {
    const user = userEvent.setup(); show({ pathname: '/app/trabalhadores/worker-a', state: integrationOrigin() });
    const back = await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    expect(back).toHaveAttribute('href', '/app/agenda/appointment-a?tab=equipe#participantes');
    await user.click(back);
    expect(await screen.findByRole('link', { name: 'Voltar às pendências' })).toHaveAttribute('href', `/app/pendencias${search}`);
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!)).toEqual({ readinessReturnTo });
  });

  it.each([
    { unitId: 'unit-b', search: '?unitId=unit-b&status=all' },
    { unitId: 'unit-a', search: '?unitId=unit-a&unknown=value' },
    { unitId: 'unit-a', search: '?unitId=unit-a&status=all&status=pending' },
    { unitId: 'unit-a', search: 'https://example.test/?unitId=unit-a' },
  ])('descarta a origem documental inválida na ida e na volta: %j', async invalid => {
    const user = userEvent.setup(); const first = show({ state: { readinessReturnTo: invalid } });
    await user.click(await screen.findByRole('link', { name: 'Consultar integração de Ana Teste' }));
    await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!).integrationReturnTo).not.toHaveProperty('readinessReturnTo');
    first.unmount();
    show({ pathname: '/app/trabalhadores/worker-a', state: integrationOrigin(invalid) });
    await user.click(await screen.findByRole('link', { name: 'Voltar ao atendimento' }));
    expect(await screen.findByRole('link', { name: 'Voltar à agenda' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Voltar às pendências' })).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!)).toBeNull();
  });

  it('não encaminha a origem documental sem permissão de leitura', async () => {
    session.permissions = ['workers.read', 'appointments.read'];
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('link', { name: 'Consultar integração de Ana Teste' }));
    await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!).integrationReturnTo).not.toHaveProperty('readinessReturnTo');
  });

  it('confere novamente a permissão ao devolver o atendimento', async () => {
    const user = userEvent.setup(); const view = show({ pathname: '/app/trabalhadores/worker-a', state: integrationOrigin() });
    await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    session.permissions = ['workers.read', 'appointments.read']; view.update();
    await user.click(screen.getByRole('link', { name: 'Voltar ao atendimento' }));
    expect(await screen.findByRole('link', { name: 'Voltar à agenda' })).toBeVisible();
    expect(JSON.parse(screen.getByLabelText('Estado').textContent!)).toBeNull();
  });

  it('não oferece retorno de integração após mudar para outra unidade', async () => {
    const view = show({ pathname: '/app/trabalhadores/worker-a', state: integrationOrigin() });
    await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    session.unitId = 'unit-b'; view.update();
    await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByRole('heading', { name: 'Ana Teste' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voltar ao atendimento' })).not.toBeInTheDocument();
  });
});
