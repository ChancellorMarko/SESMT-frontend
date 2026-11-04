import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { AppointmentDetailPage } from '../agenda/AppointmentDetailPage';
import type { PermitAgendaNavigation } from '../agenda/permit-agenda-navigation';
import { PermitDetailPage } from './PermitDetailPage';
import { PermitPrintPage } from './PermitPrintPage';

const access = vi.hoisted(() => ({ appointments: true, operate: false }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({
  sessionKey: 'session', unitId: 'unit', me: { user: { id: 'technician', displayName: 'Técnico Demo' } },
  can: (permission: string) => permission === 'appointments.read' ? access.appointments
    : permission === 'permits.operate' ? access.operate : ['permits.read', 'eligibility.read'].includes(permission),
}) }));
vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('./PermitPreparation', () => ({ PermitPreparation: () => null, SourceChecks: () => null }));
vi.mock('./PermitAttachments', () => ({ PermitAttachments: () => null }));
vi.mock('../designations', () => ({ DesignationCoveragePanel: () => null }));
vi.mock('../agenda/EligibilityPanel', () => ({ EligibilityPanel: () => null }));

const agendaSearch = '?unitId=unit&q=AG-TESTE&status=ATTENDANCE_OPENED&order=TEAM&view=calendar&calendarMode=week&calendarDate=2026-10-19&day=2026-10-19';
let permit: WorkPermitDto;

function fixture(): WorkPermitDto {
  return {
    id: 'permit', code: 'PT-TESTE', version: 2, revision: 4, templateVersion: 'Modelo demo v1',
    appointment: {
      id: 'appointment', code: 'AG-TESTE', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo',
      serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração',
      startsAt: '2026-10-19T12:00:00Z', endsAt: '2026-10-19T14:00:00Z',
      responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [],
      status: 'ATTENDANCE_OPENED', revision: 3, permitId: 'permit', availableActions: [], history: [],
    },
    operationStatus: 'COMPLETED', reviewStatus: 'NOT_SUBMITTED',
    checklist: [], sciences: [], summary: 'Resumo em correção.',
    eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-19T12:00:00Z', requirementVersion: 'Matriz demo v1', participants: [] },
    availableActions: [], history: [],
    snapshots: [{ version: 1, submittedAt: '2026-10-19T15:00:00Z', summary: 'Resumo preservado da versão anterior.', checklist: [], sciences: [], decision: 'RETURN', comment: 'Complementar registro.' }],
  };
}

function origin(changes: Partial<PermitAgendaNavigation['permitAgendaReturnTo']> = {}): PermitAgendaNavigation {
  return { permitAgendaReturnTo: {
    permitId: 'permit', appointmentId: 'appointment', unitId: 'unit', sessionKey: 'session',
    source: 'appointment', search: agendaSearch, ...changes,
  } };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</output>;
}
function currentLocation(): { pathname: string; search: string; state: unknown } {
  return JSON.parse(screen.getByTestId('location').textContent!);
}
function show(pathname: string, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname, state }]}>
    <Routes>
      <Route path="/app/pts/:id" element={<PermitDetailPage />} />
      <Route path="/app/pts/:id/imprimir" element={<PermitPrintPage />} />
      <Route path="/app/agenda/:id" element={<AppointmentDetailPage />} />
      <Route path="/app/agenda" element={<h1>Agenda de serviços</h1>} />
      <Route path="/app/pendencias" element={<h1>Pendências documentais</h1>} />
      <Route path="/app/consulta" element={<h1>Consulta de registros</h1>} />
      <Route path="/app/pts" element={<h1>Permissões de trabalho</h1>} />
    </Routes><LocationProbe />
  </MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { client, refreshAccess: () => view.rerender(tree()) };
}

beforeEach(() => {
  vi.clearAllMocks(); window.sessionStorage.clear(); access.appointments = true; access.operate = false;
  permit = fixture();
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === '/work-permits/permit') return structuredClone(permit);
    if (path === '/work-permits/permit/attachments') return [];
    if (path === '/appointments/appointment') return structuredClone(permit.appointment);
    if (path === '/teams/team') return { members: [] };
    if (path === '/designation-coverage') return {};
    throw new Error(`Consulta inesperada: ${path}`);
  });
});

describe('continuidade entre atendimento, PT e impressão', () => {
  it('preserva a consulta da agenda ao acompanhar a PT, imprimir outra versão e retornar pelo atendimento', async () => {
    const user = userEvent.setup();
    show('/app/agenda/appointment', { fromSearch: agendaSearch, unrelated: 'não encaminhar' });
    await user.click(await screen.findByRole('link', { name: /Acompanhar PT/ }));
    expect(currentLocation()).toEqual({ pathname: '/app/pts/permit', search: '', state: origin() });
    const print = await screen.findByRole('link', { name: 'Visualizar / imprimir PT' });
    expect(screen.getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', `/app/agenda${agendaSearch}`);
    await user.click(print);
    await user.selectOptions(await screen.findByLabelText('Versão do registro'), '1');
    expect(currentLocation()).toEqual({ pathname: '/app/pts/permit/imprimir', search: '?version=1', state: origin() });
    expect(screen.getByText('Resumo preservado da versão anterior.')).toBeVisible();
    expect(screen.queryByText('Resumo em correção.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Voltar à PT' }));
    expect(currentLocation()).toEqual({ pathname: '/app/pts/permit', search: '', state: origin() });
    await user.click(await screen.findByRole('link', { name: 'Voltar ao atendimento' }));
    expect(currentLocation()).toEqual({ pathname: '/app/agenda/appointment', search: '', state: { fromSearch: agendaSearch } });
    await user.click(await screen.findByRole('link', { name: 'Voltar à agenda' }));
    expect(currentLocation()).toEqual({ pathname: '/app/agenda', search: agendaSearch, state: null });
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
  });

  it('volta diretamente à agenda quando a PT foi acessada da própria lista ou calendário', async () => {
    const user = userEvent.setup();
    show('/app/pts/permit', { ...origin({ source: 'agenda' }), arbitraryDestination: '/app/externo' });
    await user.click(await screen.findByRole('link', { name: 'Visualizar / imprimir PT' }));
    expect(currentLocation().state).toEqual(origin({ source: 'agenda' }));
    await user.click(await screen.findByRole('link', { name: 'Voltar à PT' }));
    await user.click(await screen.findByRole('link', { name: 'Voltar à agenda' }));
    expect(currentLocation()).toEqual({ pathname: '/app/agenda', search: agendaSearch, state: null });
  });

  it('mantém a origem de pendências dentro do atendimento após consultar e imprimir a PT', async () => {
    const user = userEvent.setup();
    const readinessReturnTo = { unitId: 'unit', search: '?unitId=unit&q=Equipe&status=pending&teamId=team' };
    show('/app/agenda/appointment', { fromSearch: agendaSearch, readinessReturnTo });
    await user.click(await screen.findByRole('link', { name: /Acompanhar PT/ }));
    await user.click(await screen.findByRole('link', { name: 'Visualizar / imprimir PT' }));
    await user.selectOptions(await screen.findByLabelText('Versão do registro'), '1');
    expect(currentLocation().state).toEqual(origin({ readinessReturnTo }));
    await user.click(screen.getByRole('link', { name: 'Voltar à PT' }));
    await user.click(await screen.findByRole('link', { name: 'Voltar ao atendimento' }));
    expect(currentLocation().state).toEqual({ fromSearch: agendaSearch, readinessReturnTo });
    await user.click(await screen.findByRole('link', { name: 'Voltar às pendências' }));
    expect(currentLocation()).toEqual({ pathname: '/app/pendencias', search: readinessReturnTo.search, state: null });
  });

  it('encaminha a origem ao abrir uma nova PT a partir de um atendimento confirmado', async () => {
    access.operate = true;
    permit.appointment = { ...permit.appointment, status: 'CONFIRMED', permitId: undefined, availableActions: ['OPEN_PERMIT'] };
    vi.mocked(api.post).mockResolvedValue(structuredClone(permit));
    const user = userEvent.setup();
    show('/app/agenda/appointment', { fromSearch: agendaSearch });
    await user.click(await screen.findByRole('button', { name: 'Abrir atendimento em campo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir atendimento em campo' }));
    await screen.findByRole('link', { name: 'Voltar ao atendimento' });
    expect(currentLocation()).toEqual({ pathname: '/app/pts/permit', search: '', state: origin() });
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/appointments/appointment/open-permit', {}, { etag: '"3"' });
  });

  it('oferece retorno à PT quando a impressão não consegue carregar o registro', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha de conexão da impressão'));
    const user = userEvent.setup();
    show('/app/pts/permit/imprimir', origin());
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de conexão da impressão');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Voltar à PT' }));
    expect(await screen.findByRole('link', { name: 'Voltar ao atendimento' })).toHaveAttribute('href', '/app/agenda/appointment');
    expect(currentLocation().state).toEqual(origin());
  });

  it.each([
    ['sessão anterior', { sessionKey: 'other-session' }],
    ['outra unidade', { unitId: 'other-unit' }],
    ['outro atendimento', { appointmentId: 'other-appointment' }],
  ] as const)('descarta uma origem de %s antes de encaminhar a impressão', async (_, invalid) => {
    const user = userEvent.setup();
    show('/app/pts/permit', origin(invalid));
    await screen.findByRole('link', { name: 'Visualizar / imprimir PT' });
    expect(screen.getByRole('link', { name: 'Voltar às PTs' })).toHaveAttribute('href', '/app/pts');
    expect(screen.queryByRole('link', { name: 'Agenda' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voltar ao atendimento' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Visualizar / imprimir PT' }));
    await user.selectOptions(await screen.findByLabelText('Versão do registro'), '1');
    expect(currentLocation().state).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Voltar à PT' }));
    expect(await screen.findByRole('link', { name: 'Voltar às PTs' })).toHaveAttribute('href', '/app/pts');
  });

  it('revalida o acesso à agenda se a permissão é retirada enquanto a impressão está aberta', async () => {
    const user = userEvent.setup();
    const view = show('/app/pts/permit', origin());
    await user.click(await screen.findByRole('link', { name: 'Visualizar / imprimir PT' }));
    await screen.findByLabelText('Versão do registro');
    access.appointments = false;
    await act(async () => { view.refreshAccess(); });
    await user.selectOptions(screen.getByLabelText('Versão do registro'), '1');
    expect(currentLocation().state).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Voltar à PT' }));
    await screen.findByRole('link', { name: 'Voltar às PTs' });
    expect(screen.queryByRole('link', { name: /Agenda|Atendimento AG-TESTE|Consultar pendências e evidências|AG-TESTE/ })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'consulta', fromConsulta: true, search: '?unitId=unit&tab=permits&q=PT&reviewStatus=RETURNED', pathname: '/app/consulta', backLabel: 'Voltar à consulta' },
    { label: 'lista de PTs', fromConsulta: false, search: '?unitId=unit&q=PT&operationStatus=COMPLETED', pathname: '/app/pts', backLabel: 'Voltar às PTs' },
  ])('preserva os filtros da $label depois de imprimir uma versão histórica', async ({ fromConsulta, search, pathname, backLabel }) => {
    const user = userEvent.setup();
    const state = { fromConsulta, fromSearch: search, fromUnitId: 'unit' };
    show('/app/pts/permit', { ...state, unrelated: 'descartar' });
    await user.click(await screen.findByRole('link', { name: 'Visualizar / imprimir PT' }));
    await user.selectOptions(await screen.findByLabelText('Versão do registro'), '1');
    expect(currentLocation().state).toEqual(state);
    await user.click(screen.getByRole('link', { name: 'Voltar à PT' }));
    await user.click(await screen.findByRole('link', { name: backLabel }));
    await waitFor(() => expect(currentLocation()).toEqual({ pathname, search, state: null }));
  });
});
