import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { DocumentaryReadinessDto } from '../../shared/contracts/requirements';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { AppointmentDetailPage } from '../agenda/AppointmentDetailPage';
import { DocumentaryReadinessPage } from './DocumentaryReadinessPage';
import { AppQueryNavigationProvider } from '../../shared/lib/app-query-params';

const session = vi.hoisted(() => ({
  permissions: ['eligibility.read', 'eligibility.write', 'appointments.read'],
  unitId: 'unit-a' as string | undefined,
}));
vi.mock('../../shared/auth/SessionProvider', () => ({
  useSession: () => ({ sessionKey: 'session-workspace', unitId: session.unitId, can: (permission: string) => session.permissions.includes(permission) }),
}));
vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../agenda/EligibilityPanel', () => ({ EligibilityPanel: () => <div>Conferência documental do atendimento</div> }));

const readiness: DocumentaryReadinessDto = {
  generatedAt: '2026-10-18T09:00:00-03:00',
  rows: [{
    appointmentId: 'appointment', appointmentCode: 'AG-TESTE', teamId: 'team', teamName: 'Equipe teste',
    serviceTypeId: 'service', serviceLabel: 'Manutenção demonstrativa', location: 'Área de teste',
    startsAt: '2026-10-19T09:00:00-03:00', endsAt: '2026-10-19T10:00:00-03:00',
    eligibility: {
      appointmentId: 'appointment', unitId: 'unit-a', requirementVersion: 'DEMO-1', eligible: false,
      checkedAt: '2026-10-18T09:00:00-03:00',
      participants: [
        { workerId: 'worker-a', name: 'Bruno Teste', serviceFunction: 'Executante', eligible: false, items: [{ requirementId: 'requirement', label: 'Orientação', description: 'Demonstrativa', status: 'PENDING', restricted: false }] },
        { workerId: 'worker-b', name: 'Camila Teste', serviceFunction: 'Apoio', eligible: true, items: [{ requirementId: 'requirement', label: 'Orientação', description: 'Demonstrativa', status: 'APPROVED', restricted: false }] },
      ],
    },
  }],
};
const appointment: AppointmentDto = {
  id: 'appointment', unitId: 'unit-a', code: 'AG-TESTE', teamId: 'team', teamName: 'Equipe teste',
  serviceTypeId: 'service', serviceLabel: 'Manutenção demonstrativa', location: 'Área de teste',
  startsAt: '2026-10-19T09:00:00-03:00', endsAt: '2026-10-19T10:00:00-03:00',
  responsibleId: 'operator', responsibleName: 'Operador teste', participants: [], status: 'CONFIRMED',
  revision: 1, availableActions: [], history: [],
};
function Location() {
  const location = useLocation();
  return <><output aria-label="Endereço atual">{location.pathname}{location.search}</output><output aria-label="Contexto de navegação">{JSON.stringify(location.state)}</output></>;
}
function show(route = '/app/pendencias') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/app/pendencias" element={<DocumentaryReadinessPage />} />
    <Route path="/app/agenda/:id" element={<AppointmentDetailPage />} />
    <Route path="/app/agenda" element={<div>Lista da agenda</div>} />
  </Routes><Location /></MemoryRouter></QueryClientProvider>);
}
function currentFilters() {
  const address = screen.getByLabelText('Endereço atual').textContent!;
  return new URL(address, 'https://ampara.test').searchParams;
}
beforeEach(() => {
  vi.clearAllMocks();
  session.unitId = 'unit-a';
  session.permissions = ['eligibility.read', 'eligibility.write', 'appointments.read'];
  vi.mocked(api.get).mockImplementation(async path => path === '/documentary-readiness' ? structuredClone(readiness) : structuredClone(appointment));
});

describe('consulta de pendências como área de trabalho', () => {
  it('sincroniza o serviço antes de abrir imediatamente o link de conferência', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    function ReturnContext() { return <output aria-label="Contexto de retorno">{JSON.stringify(useLocation().state)}</output>; }
    const router = createMemoryRouter([{ path: '*', element: <AppQueryNavigationProvider><Routes>
      <Route path="/app/pendencias" element={<DocumentaryReadinessPage />} />
      <Route path="/app/agenda/:id" element={<ReturnContext />} />
    </Routes></AppQueryNavigationProvider> }], { initialEntries: ['/app/pendencias?unitId=unit-a&q=Bruno&teamId=team'] });
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    let opened = false;
    const unsubscribe = router.subscribe(next => {
      if (opened || next.location.pathname !== '/app/pendencias' || new URLSearchParams(next.location.search).get('serviceTypeId') !== 'service') return;
      opened = true;
      screen.getByRole('link', { name: 'Abrir conferência de AG-TESTE' }).click();
    });
    try {
      await screen.findByRole('link', { name: 'Abrir conferência de AG-TESTE' });
      fireEvent.change(screen.getByRole('combobox', { name: 'Serviço' }), { target: { value: 'service' } });
      const returned = await screen.findByLabelText('Contexto de retorno');
      expect(JSON.parse(returned.textContent!)).toEqual({ readinessReturnTo: { unitId: 'unit-a', search: '?unitId=unit-a&q=Bruno&teamId=team&serviceTypeId=service' } });
    } finally { unsubscribe(); view.unmount(); router.dispose(); client.clear(); }
  });

  it.each([
    ['Busca', 'q'],
    ['Equipe', 'teamId'],
    ['Serviço', 'serviceTypeId'],
  ])('remove somente %s e preserva unidade e critérios restantes sem repetir a consulta', async (label, key) => {
    const user = userEvent.setup();
    const initial = new URLSearchParams({ unitId: 'unit-a', q: 'Teste', teamId: 'team', serviceTypeId: 'service', status: 'all' });
    show(`/app/pendencias?${initial}`);
    await screen.findByRole('heading', { name: 'Bruno Teste' });
    const applied = screen.getByRole('group', { name: 'Filtros aplicados' });
    expect(within(applied).getByRole('button', { name: `Remover filtro: ${label}` })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Equipe' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Serviço' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Situação documental' })).toBeVisible();
    await user.click(within(applied).getByRole('button', { name: `Remover filtro: ${label}` }));
    initial.delete(key);
    expect([...currentFilters()]).toEqual([...initial]);
    expect(screen.queryByRole('button', { name: `Remover filtro: ${label}` })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Camila Teste' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/documentary-readiness', expect.objectContaining({ query: { unitId: 'unit-a' }, signal: expect.any(AbortSignal) }));
    expect(screen.queryByRole('link', { name: 'Consultar matriz' })).not.toBeInTheDocument();
  });

  it('permite remover a situação padrão e passa a mostrar todas as situações sem reaplicar pendências', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'Bruno Teste' });
    expect(screen.queryByRole('heading', { name: 'Camila Teste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover filtro: Situação documental' })).toHaveTextContent('Com pendências');
    await user.click(screen.getByRole('button', { name: 'Remover filtro: Situação documental' }));
    expect(screen.getByRole('combobox', { name: 'Situação documental' })).toHaveValue('all');
    expect(currentFilters().get('status')).toBe('all');
    expect(currentFilters().get('unitId')).toBe('unit-a');
    expect(screen.queryByRole('button', { name: 'Remover filtro: Situação documental' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Camila Teste' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('limpa a consulta para o padrão de pendências mantendo a unidade ativa', async () => {
    const user = userEvent.setup();
    show('/app/pendencias?unitId=unit-a&q=Teste&teamId=team&serviceTypeId=service&status=all');
    await screen.findByRole('heading', { name: 'Camila Teste' });
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect([...currentFilters()]).toEqual([['unitId', 'unit-a']]);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Equipe' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Serviço' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Situação documental' })).toHaveValue('pending');
    expect(screen.getByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Camila Teste' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover filtro: Situação documental' })).toBeVisible();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('mantém os filtros no cliente e deixa a navegação indisponível para quem não pode consultar atendimentos', async () => {
    session.permissions = ['eligibility.read'];
    const user = userEvent.setup();
    show();
    await screen.findByRole('heading', { name: 'Bruno Teste' });
    await user.type(screen.getByRole('searchbox'), 'Camila');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Equipe' }), 'team');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Serviço' }), 'service');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Situação documental' }), 'ready');
    expect(screen.getByRole('heading', { name: 'Camila Teste' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remover filtro: Busca' })).toHaveTextContent('Camila');
    expect(screen.getByRole('button', { name: 'Remover filtro: Equipe' })).toHaveTextContent('Equipe teste');
    expect(screen.getByRole('button', { name: 'Remover filtro: Serviço' })).toHaveTextContent('Manutenção demonstrativa');
    expect(screen.getByRole('button', { name: 'Remover filtro: Situação documental' })).toHaveTextContent('Conferida');
    expect(screen.queryByRole('link', { name: /Abrir conferência|Consultar atendimento/ })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('leva somente a consulta normalizada da unidade ativa ao atendimento e permite voltar aos mesmos filtros', async () => {
    const user = userEvent.setup();
    show('/app/pendencias?unitId=unit-b&teamId=outside&serviceTypeId=outside&status=all&q=Teste');
    await user.click(await screen.findByRole('link', { name: 'Abrir conferência de AG-TESTE' }));
    expect(await screen.findByRole('link', { name: 'Voltar às pendências' })).toHaveAttribute('href', '/app/pendencias?unitId=unit-a&status=all&q=Teste');
    expect(JSON.parse(screen.getByLabelText('Contexto de navegação').textContent!)).toMatchObject({ readinessReturnTo: { unitId: 'unit-a', search: '?unitId=unit-a&status=all&q=Teste' } });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('/app/agenda/appointment');
    await user.click(screen.getByRole('link', { name: 'Voltar às pendências' }));
    expect(await screen.findByRole('heading', { name: 'Camila Teste' })).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('Teste');
    expect(screen.getByRole('combobox', { name: 'Situação documental' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'Equipe' })).toHaveValue('');
    expect(currentFilters().get('unitId')).toBe('unit-a');
  });

  it('oferece retorno à consulta completa mesmo quando o atendimento falha', async () => {
    vi.mocked(api.get).mockImplementation(async path => {
      if (path === '/documentary-readiness') return structuredClone(readiness);
      throw new Error('Falha ao consultar atendimento.');
    });
    const user = userEvent.setup();
    const search = '?unitId=unit-a&q=Teste&teamId=team&serviceTypeId=service&status=all';
    show(`/app/pendencias${search}`);
    await user.click(await screen.findByRole('link', { name: 'Abrir conferência de AG-TESTE' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao consultar atendimento.');
    expect(screen.getByRole('link', { name: 'Voltar às pendências' })).toHaveAttribute('href', `/app/pendencias${search}`);
    await user.click(screen.getByRole('link', { name: 'Voltar às pendências' }));
    expect(await screen.findByRole('heading', { name: 'Bruno Teste' })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/pendencias${search}`));
    expect(screen.getByRole('combobox', { name: 'Equipe' })).toHaveValue('team');
    expect(screen.getByRole('combobox', { name: 'Serviço' })).toHaveValue('service');
  });
});
