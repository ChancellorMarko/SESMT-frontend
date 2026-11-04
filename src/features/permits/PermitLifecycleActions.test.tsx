import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import type { PermitLifecycleCommand } from '../../shared/contracts/permit-lifecycle';
import { PermitLifecycleActions } from './PermitLifecycleActions';

const state = vi.hoisted(() => ({ permit: null as WorkPermitDto | null, permissions: ['permits.read', 'permits.operate'], userId: 'technician' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({
  sessionKey: 'session', unitId: 'unit', me: { user: { id: state.userId, displayName: 'Técnico Demo' } },
  can: (permission: string) => state.permissions.includes(permission),
}) }));
vi.mock('../../shared/api/client', async original => ({
  ...await original<typeof import('../../shared/api/client')>(),
  api: { get: vi.fn(), post: vi.fn() },
}));

function example(): WorkPermitDto {
  return {
    id: 'permit', code: 'PT-TESTE', version: 1, revision: 4, templateVersion: 'Modelo escolar v1',
    appointment: { id: 'appointment', code: 'AG-TESTE', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo', serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração', startsAt: '2026-10-09T12:00:00Z', endsAt: '2026-10-09T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'EXECUTING', reviewStatus: 'NOT_SUBMITTED', checklist: [{ id: 'check', label: 'Conferência preservada', required: true, answer: 'YES' }], sciences: [],
    eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-09T12:00:00Z', requirementVersion: 'Matriz escolar v1', participants: [] },
    availableActions: ['SUSPEND'], snapshots: [], history: [],
  };
}
const keys = [
  ['consulta-permits', 'session', 'unit', 1, '', 'EXECUTING', '', ''],
  ['consulta-permits', 'session', 'unit', 3, 'PT', '', 'NOT_SUBMITTED', 'team'],
  ['consulta-permits', 'other-session', 'unit', 1, '', '', '', ''],
  ['consulta-permits', 'session', 'other-unit', 1, '', '', '', ''],
];
function Probe({ index }: { index: number }) {
  const query = useQuery({ queryKey: keys[index], staleTime: Infinity, queryFn: async () => structuredClone(state.permit!) });
  return <output data-testid={`consultation-${index}`}>{query.data && `${query.data.version}:${query.data.operationStatus}:${query.data.reviewStatus}`}</output>;
}
function Harness() {
  const query = useQuery({ queryKey: ['work-permit', 'session', 'unit', 'permit'], queryFn: async () => structuredClone(state.permit!), staleTime: Infinity });
  return <>{query.data && <PermitLifecycleActions permit={query.data} />}{keys.map((_, index) => <Probe key={index} index={index} />)}</>;
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  keys.forEach(key => client.setQueryData(key, structuredClone(state.permit!)));
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  state.permit = example(); state.permissions = ['permits.read', 'permits.operate']; state.userId = 'technician'; vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async () => structuredClone(state.permit));
  vi.mocked(api.post).mockImplementation(async path => {
    state.permit!.revision++;
    state.permit!.operationStatus = path.endsWith('/resume') ? 'EXECUTING' : path.endsWith('/suspend') ? 'SUSPENDED' : 'CANCELED';
    state.permit!.availableActions = state.permit!.operationStatus === 'SUSPENDED' ? ['RESUME', 'CANCEL'] : state.permit!.operationStatus === 'EXECUTING' ? ['SUSPEND'] : [];
    return structuredClone(state.permit);
  });
});

describe('consulta da PT após interrupção, retomada e cancelamento', () => {
  it.each([
    { command: 'suspend', label: 'Suspender operação', initial: 'EXECUTING', result: 'SUSPENDED', action: 'SUSPEND' },
    { command: 'resume', label: 'Retomar operação', initial: 'SUSPENDED', result: 'EXECUTING', action: 'RESUME' },
    { command: 'cancel', label: 'Cancelar PT', initial: 'VERIFICATION', result: 'CANCELED', action: 'CANCEL' },
  ] as const)('atualiza a consulta após $command confirmado e preserva o escopo de outros caches', async ({ command, label, initial, result, action }) => {
    state.permit = { ...example(), operationStatus: initial, availableActions: [action] };
    const initialSummary = `1:${initial}:NOT_SUBMITTED`;
    const preservedChecklist = structuredClone(state.permit.checklist);
    let complete!: () => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise<WorkPermitDto>(resolve => {
      complete = () => {
        state.permit = { ...state.permit!, revision: 5, operationStatus: result, availableActions: [] };
        resolve(structuredClone(state.permit));
      };
    }));
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: label }));
    const dialog = screen.getByRole('dialog', { name: label });
    await user.type(within(dialog).getByRole('textbox'), 'Condições de campo conferidas e registradas.');
    for (const checkbox of within(dialog).getAllByRole('checkbox')) await user.click(checkbox);
    await user.click(within(dialog).getByRole('button', { name: `Confirmar: ${label.toLocaleLowerCase('pt-BR')}` }));
    expect(api.post).toHaveBeenCalledWith(`/work-permits/permit/${command satisfies PermitLifecycleCommand}`, {
      reason: 'Condições de campo conferidas e registradas.', confirmed: true,
      ...(command === 'resume' ? { sameTeam: true, sameConditions: true } : {}),
    }, { etag: '"4"' });
    expect(screen.getByTestId('consultation-0')).toHaveTextContent(initialSummary);
    expect(screen.getByTestId('consultation-1')).toHaveTextContent(initialSummary);
    await act(async () => { complete(); });
    await waitFor(() => expect(screen.getByTestId('consultation-0')).toHaveTextContent(`1:${result}:NOT_SUBMITTED`));
    expect(screen.getByTestId('consultation-1')).toHaveTextContent(`1:${result}:NOT_SUBMITTED`);
    expect(screen.getByTestId('consultation-2')).toHaveTextContent(initialSummary);
    expect(screen.getByTestId('consultation-3')).toHaveTextContent(initialSummary);
    expect(state.permit!.version).toBe(1);
    expect(state.permit!.checklist).toEqual(preservedChecklist);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('mantém o estado consultado e o motivo local quando a suspensão não é confirmada pela API', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('A operação continua em execução. Tente novamente.'));
    const user = userEvent.setup(); const client = show();
    await user.click(await screen.findByRole('button', { name: 'Suspender operação' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspender operação' });
    await user.type(within(dialog).getByRole('textbox'), 'Interromper por alteração do ambiente.');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar: suspender operação' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A operação continua em execução. Tente novamente.');
    expect(within(dialog).getByRole('textbox')).toHaveValue('Interromper por alteração do ambiente.');
    expect(within(dialog).getByRole('checkbox')).toBeChecked();
    for (let index = 0; index < keys.length; index++) {
      expect(screen.getByTestId(`consultation-${index}`)).toHaveTextContent('1:EXECUTING:NOT_SUBMITTED');
      expect(client.getQueryState(keys[index])?.isInvalidated).toBe(false);
    }
  });
});

describe('confirmações de suspensão e retomada', () => {
  it('exige motivo e confirmação explícita antes de suspender com a revisão capturada', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Suspender operação' }));
    const modal = within(screen.getByRole('dialog', { name: 'Suspender operação' }));
    const confirm = modal.getByRole('button', { name: 'Confirmar: suspender operação' });
    await user.click(confirm); expect(modal.getByRole('alert')).toHaveTextContent(/pelo menos 5 caracteres/);
    await user.type(modal.getByLabelText('Motivo da suspensão *'), 'Condição imprevista identificada em campo.');
    await user.click(confirm); expect(modal.getByRole('alert')).toHaveTextContent(/Confirme explicitamente/); expect(api.post).not.toHaveBeenCalled();
    await user.click(modal.getByRole('checkbox')); await user.click(confirm);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/work-permits/permit/suspend', { reason: 'Condição imprevista identificada em campo.', confirmed: true }, { etag: '"4"' }));
  });
  it('bloqueia retomada até confirmar equipe, condições e decisão', async () => {
    state.permit!.operationStatus = 'SUSPENDED'; state.permit!.availableActions = ['RESUME', 'CANCEL'];
    state.permit!.lifecycle = { suspendedFrom: 'EXECUTING', suspensionReason: 'Interrupção do acesso ao local.', suspendedAt: '2026-10-10T12:30:00Z', suspendedByName: 'Técnico Demo' };
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Retomar operação' }));
    const modal = within(screen.getByRole('dialog', { name: 'Retomar operação' }));
    await user.type(modal.getByLabelText('Conferência para retomada *'), 'Acesso restabelecido e condições conferidas.');
    await user.click(modal.getByRole('checkbox', { name: /Confirmo a conferência/ }));
    await user.click(modal.getByRole('button', { name: 'Confirmar: retomar operação' }));
    expect(modal.getByRole('alert')).toHaveTextContent(/mesma equipe e condições conferidas/); expect(api.post).not.toHaveBeenCalled();
    await user.click(modal.getByRole('checkbox', { name: /A equipe e os participantes/ }));
    await user.click(modal.getByRole('checkbox', { name: /Conferi as condições do local/ }));
    await user.click(modal.getByRole('button', { name: 'Confirmar: retomar operação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/work-permits/permit/resume', { reason: 'Acesso restabelecido e condições conferidas.', confirmed: true, sameTeam: true, sameConditions: true }, { etag: '"4"' }));
  });
  it('preserva motivo após conflito e solicita nova confirmação da revisão atual', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Suspender operação' }));
    const modal = within(screen.getByRole('dialog', { name: 'Suspender operação' }));
    await user.type(modal.getByLabelText('Motivo da suspensão *'), 'Interromper para conferir condição observada.');
    await user.click(modal.getByRole('checkbox'));
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'A PT mudou.', requestId: 'conflict' }));
    await user.click(modal.getByRole('button', { name: 'Confirmar: suspender operação' }));
    expect(await modal.findByRole('button', { name: 'Atualizar PT e preservar motivo' })).toBeInTheDocument();
    expect(modal.getByLabelText('Motivo da suspensão *')).toHaveValue('Interromper para conferir condição observada.');
    state.permit!.revision = 8;
    await user.click(modal.getByRole('button', { name: 'Atualizar PT e preservar motivo' }));
    await waitFor(() => expect(modal.getByRole('button', { name: 'Confirmar: suspender operação' })).toBeEnabled());
    expect(modal.getByRole('checkbox')).not.toBeChecked();
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('button', { name: 'Confirmar: suspender operação' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/work-permits/permit/suspend', { reason: 'Interromper para conferir condição observada.', confirmed: true }, { etag: '"8"' }));
  });
  it('apresenta suspensão para consulta sem oferecer operação ao revisor', async () => {
    state.permissions = ['permits.read', 'permits.review']; state.userId = 'engineer';
    state.permit!.operationStatus = 'SUSPENDED'; state.permit!.availableActions = ['RESUME', 'CANCEL'];
    state.permit!.lifecycle = { suspendedFrom: 'EXECUTING', suspensionReason: 'Acesso interrompido durante a execução.', suspendedAt: '2026-10-10T12:30:00Z', suspendedByName: 'Técnico Demo' };
    show();
    expect(await screen.findByText('Operação suspensa.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retomar operação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar PT' })).not.toBeInTheDocument();
  });
});
