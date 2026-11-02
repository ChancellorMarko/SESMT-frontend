import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type RequestOptions } from '../../shared/api/client';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { PermitsPage } from './PermitsPage';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'filter-session', unitId: 'unit', can: (permission: string) => permission === 'permits.read' }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

function record(): WorkPermitDto {
  return {
    id: 'permit', code: 'PT-001', version: 2, revision: 4, templateVersion: 'Modelo demonstrativo',
    appointment: { id: 'appointment', code: 'AG-001', unitId: 'unit', teamId: 'team', teamName: 'Equipe demonstrativa', serviceTypeId: 'service', serviceLabel: 'Serviço demonstrativo', location: 'Local demonstrativo', startsAt: '2026-10-17T12:00:00Z', endsAt: '2026-10-17T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico demonstrativo', participants: [{ workerId: 'worker', name: 'Pessoa demonstrativa', serviceFunction: 'Executante' }], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', checklist: [], sciences: [{ id: 'science', workerId: 'worker', version: 1, declarantName: 'Pessoa demonstrativa', method: 'TYPED', representation: 'Pessoa demonstrativa', confirmed: true, collectedBy: 'technician', collectedByName: 'Técnico demonstrativo', collectedAt: '2026-10-17T12:30:00Z' }], eligibility: { appointmentId: 'appointment', checkedAt: '2026-10-17T12:00:00Z', requirementVersion: '1', eligible: true, participants: [] }, availableActions: [], snapshots: [], history: [],
  };
}

function Probe() {
  const location = useLocation();
  return <><output aria-label="Endereço da consulta">{location.search}</output><PermitsPage /></>;
}
function show(query: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/pts?unitId=unit&${query}`]}><Probe /></MemoryRouter></QueryClientProvider>);
}
function currentCriteria() { return new URLSearchParams(screen.getByLabelText('Endereço da consulta').textContent ?? ''); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_path, options?: RequestOptions) => ({ items: [record()], page: Number(options?.query?.page ?? 1), pageSize: 10, total: 21 }) as never);
});

describe('critérios visíveis da consulta de PTs', () => {
  it('remove só a busca aplicada, retorna à primeira página e conserva escopo, equipe e situações', async () => {
    show('q=PT&page=2&operationStatus=COMPLETED&reviewStatus=PENDING_REVIEW&teamId=team');
    await screen.findByRole('link', { name: 'PT-001' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar PT' }), { target: { value: 'Novo rascunho' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Busca' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ q: undefined, page: 1, unitId: 'unit', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', teamId: 'team' }) })));
    expect(currentCriteria().has('q')).toBe(false);
    expect(currentCriteria().has('page')).toBe(false);
    expect(screen.getByRole('searchbox', { name: 'Buscar PT' })).toHaveValue('');
    expect(screen.getByRole('searchbox', { name: 'Buscar PT' })).toHaveFocus();
  });

  it('preserva busca ainda não aplicada ao remover situações no mesmo ciclo, sem ressuscitar critérios', async () => {
    show('q=PT&page=2&operationStatus=COMPLETED&reviewStatus=PENDING_REVIEW&teamId=team');
    await screen.findByRole('link', { name: 'PT-001' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar PT' }), { target: { value: 'Rascunho não aplicado' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Situação operacional' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Revisão do encerramento' }));
    });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ page: 1, q: 'PT', operationStatus: undefined, reviewStatus: undefined, teamId: 'team' }) })));
    expect(currentCriteria().has('operationStatus')).toBe(false);
    expect(currentCriteria().has('reviewStatus')).toBe(false);
    expect(screen.getByRole('searchbox', { name: 'Buscar PT' })).toHaveValue('Rascunho não aplicado');
    expect(screen.getByText('Busca digitada ainda não aplicada à lista.')).toBeInTheDocument();
  });

  it('expõe operação e revisão separadas e conta somente ciências da versão atual', async () => {
    show('operationStatus=COMPLETED&reviewStatus=PENDING_REVIEW&teamId=team');
    const table = await screen.findByRole('table', { name: 'Permissões de trabalho' });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('Operação')).toBeInTheDocument();
    expect(within(row).getByText('Revisão')).toBeInTheDocument();
    expect(within(row).getByText('Atividade concluída')).toBeInTheDocument();
    expect(within(row).getByText('Aguardando revisão')).toBeInTheDocument();
    expect(within(row).getByText('Ciências 0/1')).toBeInTheDocument();
    expect(within(row).getByText('Versão 2 da PT')).toBeInTheDocument();
    expect(screen.getByText('Filtro de equipe aplicado')).toBeInTheDocument();
  });
});
