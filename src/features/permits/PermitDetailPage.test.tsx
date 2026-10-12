import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { api } from '../../shared/api/client';
import { PermitDetailPage } from './PermitDetailPage';

const state = vi.hoisted(() => ({ permit: null as WorkPermitDto | null, role: 'operator' as 'operator' | 'engineer', unitId: 'unit' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, me: { user: { id: state.role === 'engineer' ? 'engineer' : 'technician', displayName: state.role === 'engineer' ? 'Engenheira Demo' : 'Técnico Demo' } }, can: (permission: string) => permission === 'permits.operate' ? state.role === 'operator' : permission === 'permits.review' && state.role === 'engineer' }) }));
vi.mock('../../shared/api/client', async original => {
  const actual = await original<typeof import('../../shared/api/client')>();
  return { ...actual, api: { get: vi.fn(async () => structuredClone(state.permit)), post: vi.fn(async () => structuredClone(state.permit)), patch: vi.fn(async () => structuredClone(state.permit)) } };
});

function example(): WorkPermitDto {
  return {
    id: 'permit', code: 'PT-TESTE', version: 1, revision: 4, templateVersion: 'Modelo escolar v1',
    appointment: { id: 'appointment', code: 'AG-TESTE', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo', serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração', startsAt: '2026-10-09T12:00:00Z', endsAt: '2026-10-09T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo' }], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'VERIFICATION', reviewStatus: 'NOT_SUBMITTED', checklist: [{ id: 'check', label: 'Conferência ilustrativa', required: true, answer: 'YES' }], sciences: [],
    eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-09T12:00:00Z', requirementVersion: 'Matriz escolar v1', participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo', eligible: true, items: [] }] },
    availableActions: ['RELEASE', 'COLLECT_SCIENCE'], snapshots: [], history: [],
  };
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/pts/permit']}><Routes><Route path="/app/pts/:id" element={<PermitDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => { state.permit = example(); state.role = 'operator'; state.unitId = 'unit'; vi.clearAllMocks(); });

describe('interações da PT em campo', () => {
  it('apresenta a pendência por participante e impede a liberação sem ciência', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Liberar execução' })).toBeDisabled();
    expect(screen.getByText(/Falta a ciência de José Demo/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('distingue o coletor, rejeita um declarante diferente e só registra após confirmação', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Registrar ciência de José Demo' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar ciência do participante' });
    expect(within(dialog).getByText('Técnico Demo')).toBeInTheDocument();
    const name = within(dialog).getByRole('textbox', { name: 'Nome de quem declara' });
    await user.clear(name); await user.type(name, 'Coletor diferente');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar ação' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/corresponder ao participante/);
    expect(api.post).not.toHaveBeenCalled();
    await user.clear(name); await user.type(name, 'José Demo');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar ação' }));
    expect(api.post).toHaveBeenCalledWith('/work-permits/permit/sciences', { workerId: 'worker', declarantName: 'José Demo', method: 'TYPED', representation: 'José Demo', confirmed: true }, { etag: '"4"' });
  });
  it('associa a própria representação à aprovação apenas depois da confirmação explícita', async () => {
    state.role = 'engineer';
    state.permit = { ...example(), operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', availableActions: ['REVIEW'], summary: 'Atendimento de demonstração concluído.' };
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar encerramento' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar aprovação' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Confirme sua decisão/);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar aprovação' }));
    expect(api.post).toHaveBeenCalledWith('/work-permits/permit/review', { decision: 'APPROVE', comment: '', signatureRepresentation: 'Engenheira Demo' }, { etag: '"4"' });
  });
  it('exige nova confirmação quando o participante altera nome ou forma da manifestação', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Registrar ciência de José Demo' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar ciência do participante' });
    const confirmation = within(dialog).getByRole('checkbox');
    await user.click(confirmation);
    await user.type(within(dialog).getByLabelText('Nome de quem declara'), ' ');
    expect(confirmation).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar ação' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/confirmada explicitamente/);
    await user.click(confirmation);
    await user.click(within(dialog).getByRole('radio', { name: 'Desenho' }));
    expect(confirmation).not.toBeChecked();
    expect(within(dialog).getByLabelText('Área para desenhar a manifestação')).toHaveAttribute('aria-disabled', 'false');
  });
  it('preserva os dados confirmados e bloqueia sua edição enquanto registra a ciência', async () => {
    let complete!: (value: WorkPermitDto) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise<WorkPermitDto>(resolve => { complete = resolve; }));
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Registrar ciência de José Demo' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar ciência do participante' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar ação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(within(dialog).getByLabelText('Nome de quem declara')).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: 'Desenho' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox')).toBeDisabled();
    await act(async () => { complete(structuredClone(state.permit!)); });
    expect(await screen.findByText(/Registrar ciência do participante: ação registrada/)).toBeInTheDocument();
  });
  it('abre a correção documental sem reabrir execução e aguarda as novas ciências para reapresentar', async () => {
    state.permit = { ...example(), version: 2, operationStatus: 'COMPLETED', reviewStatus: 'NOT_SUBMITTED', availableActions: ['EDIT_CHECKLIST', 'COLLECT_SCIENCE'], summary: 'Resumo da atividade já concluída.', snapshots: [{ version: 1, submittedAt: '2026-10-09T14:00:00Z', summary: 'Resumo anterior preservado.', checklist: example().checklist, sciences: [], decision: 'RETURN', comment: 'Completar as observações do registro.' }] };
    show();
    expect(await screen.findByRole('textbox', { name: 'Resumo do atendimento' })).toHaveValue('Resumo da atividade já concluída.');
    expect(screen.getByRole('button', { name: 'Reapresentar correção para revisão' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Registrar início da execução' })).not.toBeInTheDocument();
    expect(screen.getByText(/Versão 2 em correção documental/)).toBeInTheDocument();
    expect(screen.getByText(/A operação permanece concluída/)).toBeInTheDocument();
  });
  it('mantém a correção somente para consulta pelo engenheiro e rejeita a unidade divergente', async () => {
    state.role = 'engineer';
    state.permit = { ...example(), version: 2, operationStatus: 'COMPLETED', reviewStatus: 'NOT_SUBMITTED', availableActions: ['EDIT_CHECKLIST', 'COLLECT_SCIENCE'], summary: 'Resumo da atividade já concluída.', snapshots: [{ version: 1, submittedAt: '2026-10-09T14:00:00Z', summary: 'Resumo anterior preservado.', checklist: example().checklist, sciences: [], decision: 'RETURN' }] };
    show();
    expect(await screen.findByText('Resumo da atividade já concluída.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Resumo do atendimento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar checklist' })).not.toBeInTheDocument();
  });
  it('impede consultar conteúdo da PT no contexto de outra unidade selecionada', async () => {
    state.unitId = 'other-unit'; show();
    expect(await screen.findByRole('heading', { name: 'PT de outra unidade' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar execução' })).not.toBeInTheDocument();
  });
  it('interrompe a aprovação quando o registro muda enquanto a confirmação está aberta', async () => {
    state.role = 'engineer';
    state.permit = { ...example(), operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', availableActions: ['REVIEW'], summary: 'Atendimento de demonstração concluído.' };
    const user = userEvent.setup(); const client = show();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar encerramento' });
    await user.click(within(dialog).getByRole('checkbox'));
    await act(async () => { client.setQueryData(['work-permit', 'session', 'unit', 'permit'], { ...state.permit, revision: 5 }); });
    expect(await within(dialog).findByText(/O registro foi atualizado enquanto esta janela estava aberta/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmar aprovação' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
