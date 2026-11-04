import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { OperationsDashboardPage } from './OperationsDashboardPage';

const session = vi.hoisted(() => ({ sessionKey: 'session', unitId: 'unit-a' as string | undefined }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...session, can: () => true, me: { user: { displayName: 'Marina Demo' } } }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));
vi.mock('./SafetyOverview', async original => ({ ...await original<typeof import('./SafetyOverview')>(), SafetyOverview: () => null }));

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function show(query = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/dashboard${query}`]}><OperationsDashboardPage /><Location /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { ...view, update: () => view.rerender(tree()) };
}

async function applyContext() {
  await screen.findByRole('option', { name: 'Equipe Alfa' }, { timeout: 3000 });
  fireEvent.change(screen.getByLabelText('Período de início'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Período até'), { target: { value: '2026-10-31' } });
  fireEvent.change(screen.getByLabelText('Equipe operacional'), { target: { value: 'team-a' } });
  fireEvent.change(screen.getByLabelText('Tipo de serviço'), { target: { value: 'service-a' } });
  fireEvent.change(screen.getByLabelText('Local / Área'), { target: { value: '  Pátio & Silo  ' } });
  await screen.findByRole('link', { name: /Permissões em atendimento/ });
}

function target(name: RegExp | string) {
  return new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
}

beforeEach(() => {
  vi.clearAllMocks(); session.sessionKey = 'session'; session.unitId = 'unit-a';
  vi.mocked(api.get).mockImplementation(async (path, options) => path === '/permit-options' ? {
    teams: options?.query?.unitId === 'unit-b' ? [{ id: 'team-b', name: 'Equipe Beta', unitId: 'unit-b' }] : [{ id: 'team-a', name: 'Equipe Alfa', unitId: 'unit-a' }],
    services: [{ id: 'service-a', name: 'Trabalho em altura' }], responsibles: [],
  } : { generatedAt: '2026-10-18T12:00:00Z', appointments: 7, activePermits: 2, blockedAppointments: 3, pendingReviews: 1, nextAppointments: [], pendingPermits: [] });
});

describe('atalhos contextuais do painel operacional', () => {
  it.each(['inspecoes', 'saude', 'epis'])('mantém o painel %s independente das consultas e filtros operacionais gerais', area => {
    show(`?area=${area}`);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Operação da unidade selecionada' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Pesquisar na plataforma')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('abre a agenda com o período, equipe, serviço e local usados no painel', async () => {
    show(); await applyContext();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/permit-dashboard', expect.objectContaining({ query: {
      unitId: 'unit-a', from: '2026-10-01', to: '2026-10-31', teamId: 'team-a', serviceId: 'service-a', location: 'Pátio & Silo',
    } })));
    for (const name of ['Consultar agenda', /Serviços na agenda/, 'Ver agenda →']) {
      const url = target(name);
      expect(url.pathname).toBe('/app/agenda');
      expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31', teamId: 'team-a', serviceTypeId: 'service-a', location: 'Pátio & Silo' });
    }
    fireEvent.click(screen.getByRole('link', { name: 'Consultar agenda' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/app/agenda?');
    expect(screen.getByTestId('location')).not.toHaveTextContent('serviceId=');
  });

  it('leva às PTs e pendências somente os critérios aceitos por cada destino', async () => {
    show(); await applyContext();
    expect(Object.fromEntries(target(/Permissões em atendimento/).searchParams)).toEqual({ unitId: 'unit-a', teamId: 'team-a' });
    expect(Object.fromEntries(target('Ver PTs →').searchParams)).toEqual({ unitId: 'unit-a', teamId: 'team-a' });
    expect(Object.fromEntries(target(/Encerramentos para revisão/).searchParams)).toEqual({ unitId: 'unit-a', teamId: 'team-a', reviewStatus: 'PENDING_REVIEW' });
    expect(target(/Pendências documentais/).pathname).toBe('/app/agenda');
    expect(Object.fromEntries(target(/Pendências documentais/).searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31', teamId: 'team-a', serviceTypeId: 'service-a', location: 'Pátio & Silo', eligibility: 'blocked' });
    expect(Object.fromEntries(target('Conferir requisitos por participante').searchParams)).toEqual({ unitId: 'unit-a', teamId: 'team-a', serviceTypeId: 'service-a', status: 'pending' });
  });

  it.each(['agenda', 'pts', 'documentos'])('preserva apenas o contexto compatível na busca rápida de %s', async category => {
    show(); await applyContext();
    fireEvent.change(screen.getByLabelText('Pesquisar em'), { target: { value: category } });
    fireEvent.change(screen.getByLabelText('Pesquisar na plataforma'), { target: { value: '  Código & revisão  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar' }));
    const url = new URL(screen.getByTestId('location').textContent!, window.location.origin);
    expect(url.pathname).toBe(`/app/${category}`);
    const expected = category === 'agenda'
      ? { from: '2026-10-01', to: '2026-10-31', teamId: 'team-a', serviceTypeId: 'service-a', location: 'Pátio & Silo', q: 'Código & revisão' }
      : category === 'pts' ? { unitId: 'unit-a', teamId: 'team-a', q: 'Código & revisão' } : { q: 'Código & revisão' };
    expect(Object.fromEntries(url.searchParams)).toEqual(expected);
  });

  it('retira os critérios dos atalhos ao limpar o contexto', async () => {
    show(); await applyContext();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(target('Consultar agenda').search).toBe('');
    expect(Object.fromEntries(target(/Permissões em atendimento/).searchParams)).toEqual({ unitId: 'unit-a' });
    expect(Object.fromEntries(target(/Pendências documentais/).searchParams)).toEqual({ eligibility: 'blocked' });
    expect(Object.fromEntries(target('Conferir requisitos por participante').searchParams)).toEqual({ unitId: 'unit-a', status: 'pending' });
    expect(Object.fromEntries(target(/Encerramentos para revisão/).searchParams)).toEqual({ unitId: 'unit-a', reviewStatus: 'PENDING_REVIEW' });
  });

  it.each(['unidade', 'sessão'] as const)('descarta a equipe antes da primeira consulta e dos atalhos ao trocar a %s', async context => {
    const view = show(); await applyContext();
    const beforeChange = vi.mocked(api.get).mock.calls.length;
    if (context === 'unidade') session.unitId = 'unit-b'; else session.sessionKey = 'another-session';
    view.update();

    // This link is available even while the options and metrics for the new scope are loading.
    expect(Object.fromEntries(target('Consultar agenda').searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31', serviceTypeId: 'service-a', location: 'Pátio & Silo' });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.slice(beforeChange).some(([path]) => path === '/permit-dashboard')).toBe(true));
    const calls = vi.mocked(api.get).mock.calls.slice(beforeChange).filter(([path]) => path === '/permit-dashboard');
    expect(calls.every(([, options]) => {
      const query = options?.query;
      return query !== undefined && query.unitId === session.unitId && query.teamId === undefined
        && query.from === '2026-10-01' && query.to === '2026-10-31';
    })).toBe(true);
    const teamSelect = await screen.findByLabelText('Equipe operacional');
    expect(teamSelect).toHaveValue('');
    await screen.findByRole('link', { name: /Permissões em atendimento/ });
    expect(Object.fromEntries(target(/Permissões em atendimento/).searchParams)).toEqual({ unitId: session.unitId });
    expect(Object.fromEntries(target(/Encerramentos para revisão/).searchParams)).toEqual({ unitId: session.unitId, reviewStatus: 'PENDING_REVIEW' });
    expect(Object.fromEntries(target(/Pendências documentais/).searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-31', serviceTypeId: 'service-a', location: 'Pátio & Silo', eligibility: 'blocked' });
    expect(Object.fromEntries(target('Conferir requisitos por participante').searchParams)).toEqual({ unitId: session.unitId, serviceTypeId: 'service-a', status: 'pending' });
    expect(screen.getByLabelText('Período de início')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Período até')).toHaveValue('2026-10-31');
  });

  it.each([false, true])('não restaura a equipe anterior ao voltar à unidade original, com nova seleção=%s', async selectNewTeam => {
    const view = show(); await applyContext();
    session.unitId = 'unit-b'; view.update();
    await screen.findByRole('option', { name: 'Equipe Beta' });
    if (selectNewTeam) {
      fireEvent.change(screen.getByLabelText('Equipe operacional'), { target: { value: 'team-b' } });
      await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/permit-dashboard', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b', teamId: 'team-b' }) })));
    }
    const beforeReturn = vi.mocked(api.get).mock.calls.length;
    session.unitId = 'unit-a'; view.update();
    expect(target('Consultar agenda').searchParams.has('teamId')).toBe(false);
    await waitFor(() => expect(screen.getByLabelText('Equipe operacional')).toHaveValue(''));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.slice(beforeReturn).some(([path]) => path === '/permit-dashboard')).toBe(true));
    expect(vi.mocked(api.get).mock.calls.slice(beforeReturn).filter(([path]) => path === '/permit-dashboard').every(([, options]) => options?.query?.teamId === undefined)).toBe(true);
    expect(screen.getByLabelText('Período de início')).toHaveValue('2026-10-01');
  });
});
