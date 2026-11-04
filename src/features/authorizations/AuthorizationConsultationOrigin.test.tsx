import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import { AuthorizationDetailPage } from './AuthorizationDetailPage';
import { AuthorizationFormPage } from './AuthorizationFormPage';
import { AuthorizationPrintPage } from './AuthorizationPrintPage';
import { AT_SOURCE, createAuthorizationClosingChecks, createAuthorizationPreparation } from './model';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session-a', unitId: 'unit-a', me: { user: { id: 'operator', displayName: 'Operador de teste' }, roles: ['TECHNICIAN'] }, can: (permission: string) => ['at.read', 'at.write'].includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

const criteria = '?tab=ats&q=AT-DEMO&status=DRAFT&page=2&unitId=unit-a';
const origin = { fromConsulta: true, fromSearch: criteria, fromUnitId: 'unit-a' };
let record: WorkAuthorizationDto;
function example(): WorkAuthorizationDto {
  const appointment: AppointmentDto = { id: 'appointment', code: 'AGE-1', companyId: 'company', unitId: 'unit-a', teamId: 'team', teamName: 'Equipe de teste', serviceTypeId: 'service', serviceLabel: 'Manutenção', location: 'Área comum', startsAt: '2099-10-10T12:00:00Z', endsAt: '2099-10-10T20:00:00Z', responsibleId: 'operator', responsibleName: 'Operador de teste', participants: [], status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
  return { id: 'at', code: 'AT-DEMO-021', companyId: 'company', unitId: 'unit-a', revision: 1, status: 'DRAFT', sourceId: AT_SOURCE.sourceId, sourceRevision: AT_SOURCE.sourceRevision, sourceSha256: AT_SOURCE.sourceSha256, appointment, preparation: createAuthorizationPreparation(appointment), sciences: [], eligibility: { appointmentId: appointment.id, unitId: 'unit-a', checkedAt: '2026-10-10T12:00:00Z', eligible: true, requirementVersion: 'MATRIZ-1', participants: [] }, releases: [], closingChecks: createAuthorizationClosingChecks(), history: [], availableActions: ['EDIT'], createdAt: '2026-10-10T12:00:00Z', createdByName: 'Operador de teste' };
}
function LocationProbe() { const location = useLocation(); return <output aria-label="Endereço atual">{location.pathname}{location.search}</output>; }
function ConsultationResult() {
  const location = useLocation();
  return <><h1>Consulta de origem</h1><Link to="/app/ats/at" state={{ fromConsulta: true, fromSearch: location.search, fromUnitId: 'unit-a' }}>Consultar AT central</Link></>;
}
function show(path = `/app/consulta${criteria}`, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?').slice(1).join('?')}` : '', state }]}><LocationProbe /><Routes>
    <Route path="/app/consulta" element={<ConsultationResult />} /><Route path="/app/ats" element={<h1>Lista própria de ATs</h1>} />
    <Route path="/app/ats/:id" element={<AuthorizationDetailPage />} /><Route path="/app/ats/nova" element={<AuthorizationFormPage />} />
    <Route path="/app/ats/:id/editar" element={<AuthorizationFormPage />} /><Route path="/app/ats/:id/imprimir" element={<AuthorizationPrintPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks(); record = example();
  vi.mocked(api.get).mockImplementation(async path => path === '/authorization-options' ? { appointments: [{ appointment: structuredClone(record.appointment), permits: [] }] } as never : structuredClone(record) as never);
  vi.mocked(api.patch).mockImplementation(async (_path, input) => { record = { ...record, revision: record.revision + 1, preparation: input as WorkAuthorizationDto['preparation'] }; return structuredClone(record) as never; });
  vi.mocked(api.post).mockImplementation(async (_path, input) => { record = { ...record, id: 'created-at', preparation: input as WorkAuthorizationDto['preparation'] }; return structuredClone(record) as never; });
});

describe('origem central preservada nos fluxos da AT', () => {
  it('conserva aba, filtros e página da consulta depois de editar, salvar e imprimir', async () => {
    const user = userEvent.setup(); show();
    await user.click(screen.getByRole('link', { name: 'Consultar AT central' }));
    const back = await screen.findByRole('link', { name: 'Voltar à consulta' }); expect(back).toHaveAttribute('href', `/app/consulta${criteria}`);
    await user.click(screen.getByRole('link', { name: 'Editar rascunho' }));
    fireEvent.change(await screen.findByLabelText('Descrição da atividade'), { target: { value: 'Preparação corrigida conservando a origem da central.' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    expect(await screen.findByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${criteria}`);
    await user.click(screen.getByRole('link', { name: 'Imprimir AT' }));
    await screen.findByRole('article', { name: 'Registro imprimível da AT' });
    await user.click(screen.getByRole('link', { name: 'Voltar à AT' }));
    await user.click(await screen.findByRole('link', { name: 'Voltar à consulta' }));
    await screen.findByRole('heading', { name: 'Consulta de origem' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/consulta${criteria}`);
  });

  it('mantém a origem central após cancelar uma edição e confirmar o descarte local', async () => {
    const user = userEvent.setup(); show('/app/ats/at/editar', origin);
    fireEvent.change(await screen.findByLabelText('Descrição da atividade'), { target: { value: 'Alteração local que será descartada.' } });
    await user.click(screen.getByRole('link', { name: 'Cancelar preenchimento' }));
    await user.click(await screen.findByRole('button', { name: 'Descartar e sair' }));
    expect(await screen.findByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${criteria}`);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('preserva origem central ao salvar uma nova AT a partir do atendimento selecionado', async () => {
    const user = userEvent.setup(); show('/app/ats/nova?appointmentId=appointment', origin);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    expect(await screen.findByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${criteria}`);
    expect(api.post).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('/app/ats/created-at');
  });

  it('volta à consulta diretamente ao sair da criação sem atendimento selecionado', async () => {
    const user = userEvent.setup(); show('/app/ats/nova', origin);
    const back = await screen.findByRole('link', { name: 'Voltar' }); expect(back).toHaveAttribute('href', `/app/consulta${criteria}`);
    await user.click(back); await screen.findByRole('heading', { name: 'Consulta de origem' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/consulta${criteria}`);
  });

  it.each([
    { ...origin, fromUnitId: 'other-unit' },
    { ...origin, fromSearch: '?tab=pets&unitId=unit-a' },
    { ...origin, fromSearch: 'https://externo.invalid/' },
  ])('descarta origem de outra unidade, outro módulo ou destino externo: %j', async invalidOrigin => {
    show('/app/ats/at', invalidOrigin);
    expect(await screen.findByRole('link', { name: 'Voltar às ATs' })).toHaveAttribute('href', '/app/ats');
    expect(screen.queryByRole('link', { name: 'Voltar à consulta' })).not.toBeInTheDocument();
  });

  it('continua retornando à lista própria quando essa é a origem da AT', async () => {
    const user = userEvent.setup(); const ownSearch = '?q=AT-DEMO&status=DRAFT&page=2&unitId=unit-a';
    show('/app/ats/at', { fromPreparationList: 'ats', fromSearch: ownSearch, fromUnitId: 'unit-a' });
    await user.click(await screen.findByRole('link', { name: 'Imprimir AT' }));
    await screen.findByRole('article', { name: 'Registro imprimível da AT' });
    await user.click(screen.getByRole('link', { name: 'Voltar à AT' }));
    const back = await screen.findByRole('link', { name: 'Voltar às ATs' }); expect(back).toHaveAttribute('href', `/app/ats${ownSearch}`);
    await user.click(back); await screen.findByRole('heading', { name: 'Lista própria de ATs' });
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/ats${ownSearch}`);
  });
});
