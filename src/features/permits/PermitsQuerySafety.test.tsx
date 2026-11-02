import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { PermitsPage } from './PermitsPage';

vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'pt-safety-session', unitId: 'unit', can: (permission: string) => permission === 'permits.read' }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn() } }));

const record: WorkPermitDto = {
  id: 'permit', code: 'PT-001', version: 1, revision: 2, templateVersion: 'Modelo demonstrativo',
  appointment: { id: 'appointment', code: 'AG-001', unitId: 'unit', teamId: 'team', teamName: 'Equipe elétrica', serviceTypeId: 'service', serviceLabel: 'Manutenção preventiva', location: 'Área técnica', startsAt: '2026-10-18T12:00:00Z', endsAt: '2026-10-18T14:00:00Z', responsibleId: 'technician', responsibleName: 'Responsável ilustrativo', participants: [], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
  operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', checklist: [], sciences: [], eligibility: { appointmentId: 'appointment', checkedAt: '2026-10-18T12:00:00Z', requirementVersion: '1', eligible: true, participants: [] }, availableActions: [], snapshots: [], history: [],
};
const scope = ['work-permits', 'pt-safety-session', 'unit'];
const queryKey = (q = '', page = 1) => [...scope, page, q, '', '', ''];
const denialKey = [...scope, 'access-denial'];
const resultPage = { items: [record], page: 1, pageSize: 10, total: 1 };
let navigateTo: ReturnType<typeof useNavigate>;
function Harness() {
  navigateTo = useNavigate();
  const location = useLocation();
  return <><output aria-label="Endereço atual">{location.search}</output><PermitsPage /></>;
}
function show(q = '', client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })) {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/pts?unitId=unit${q ? `&q=${encodeURIComponent(q)}` : ''}`]}><Harness /></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => vi.clearAllMocks());

describe.each(['resposta', 'cache'] as const)('critérios textuais verificados na %s da lista de PTs', source => {
  it.each(['termo ausente', 'responsavel ilustrativo'])('oculta a página inteira quando um registro não corresponde a %s', async q => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    if (source === 'cache') client.setQueryData(queryKey(q), resultPage);
    vi.mocked(api.get).mockResolvedValue(resultPage as never);
    show(q, client);
    expect(await screen.findByRole('alert')).toHaveTextContent('página inválida');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(record.code)).not.toBeInTheDocument();
    if (source === 'cache') expect(api.get).not.toHaveBeenCalled();
  });

  it.each(['pt-001', 'EQUIPE ELETRICA', '  area   TECNICA  ', 'MANUTENCAO preventiva'])('aceita o campo pesquisável normalizado %s', async q => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    if (source === 'cache') client.setQueryData(queryKey(q), resultPage);
    vi.mocked(api.get).mockResolvedValue(resultPage as never);
    show(q, client);
    expect(await screen.findByRole('link', { name: record.code })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

it('não libera cache anterior à negativa ao voltar no histórico durante uma tentativa cancelada', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKey(), resultPage);
  vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Consulta negada.', requestId: 'pt-denial' }));
  show('', client);
  await screen.findByRole('link', { name: record.code });
  act(() => navigateTo('/app/pts?unitId=unit&page=2'));
  await screen.findByRole('button', { name: 'Tentar novamente' });
  await waitFor(() => expect(client.getQueryData(denialKey)).not.toBeNull());

  let signal: AbortSignal | undefined;
  vi.mocked(api.get).mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
    signal = options?.signal;
    signal?.addEventListener('abort', () => reject(new DOMException('Consulta cancelada.', 'AbortError')), { once: true });
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  act(() => navigateTo(-1));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

  expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=');
  expect(client.getQueryState(queryKey())?.dataUpdateCount).toBe(1);
  expect(client.getQueryData(denialKey)).not.toBeNull();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText(record.code)).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(2);

  vi.mocked(api.get).mockResolvedValueOnce(resultPage as never);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByRole('link', { name: record.code })).toBeInTheDocument();
  expect(client.getQueryData(denialKey)).toBeNull();
  expect(client.getQueryState(queryKey())?.dataUpdateCount).toBe(2);
  expect(api.get).toHaveBeenLastCalledWith('/work-permits', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit', page: 1, q: undefined }) }));
});
