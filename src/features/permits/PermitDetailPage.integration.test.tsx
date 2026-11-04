import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import type { PermitSourceCheckDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import { PermitDetailPage } from './PermitDetailPage';

const state = vi.hoisted(() => ({ permit: null as WorkPermitDto | null }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: 'unit', me: { user: { id: 'technician', displayName: 'Técnico Demo' } }, can: (permission: string) => ['permits.read', 'permits.operate'].includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
function example(): WorkPermitDto {
  return { id: 'permit', code: 'PT-TESTE', version: 1, revision: 4, templateVersion: 'Modelo escolar v1',
    appointment: { id: 'appointment', code: 'AG-TESTE', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo', serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração', startsAt: '2026-10-10T12:00:00Z', endsAt: '2026-10-10T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'EXECUTING', reviewStatus: 'NOT_SUBMITTED', checklist: [], sciences: [], eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-10T12:00:00Z', requirementVersion: 'Matriz escolar v1', participants: [] }, availableActions: ['COMPLETE', 'SUSPEND'], snapshots: [], history: [],
    preparation: { sourceId: 'Modelo de teste', sourceRevision: '1', identification: { serviceProvider: '', subcontractor: '', group: '', workFront: '', location: 'Local de demonstração', activityDescription: '', riskAnalysisReference: '', executorName: '', issuerName: '', atmosphereNotes: '', watchers: '', supervisors: '' }, activities: [], equipment: [], controls: [], additionalControls: '', checks: [], measurements: [], closingChecks: [{ id: 'closing-area', label: 'Área organizada ao final', section: 'closing', answer: null, sourceCell: 'A1' }] } };
}
async function transition(path: string, body: unknown) {
  const permit = state.permit!; const before = permit.operationStatus; permit.revision++;
  if (path.endsWith('/suspend')) {
    permit.operationStatus = 'SUSPENDED'; permit.availableActions = ['RESUME', 'CANCEL'];
    permit.lifecycle = { suspendedFrom: before as 'RELEASED' | 'EXECUTING', suspensionReason: (body as { reason: string }).reason, suspendedAt: '2026-10-10T12:30:00Z', suspendedByName: 'Técnico Demo' };
  } else if (path.endsWith('/resume')) { permit.operationStatus = 'EXECUTING'; permit.availableActions = ['COMPLETE', 'SUSPEND']; }
  else if (path.endsWith('/cancel')) { permit.operationStatus = 'CANCELED'; permit.availableActions = []; }
  else if (path.endsWith('/complete')) {
    const result = body as { summary: string; closingChecks: PermitSourceCheckDto[] };
    permit.operationStatus = 'COMPLETED'; permit.reviewStatus = 'PENDING_REVIEW'; permit.availableActions = [];
    permit.summary = result.summary; permit.preparation!.closingChecks = structuredClone(result.closingChecks);
  } else throw new Error(`Mutação inesperada: ${path}`);
  return structuredClone(permit);
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/app/pts/permit']}><Routes><Route path="/app/pts/:id" element={<PermitDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  state.permit = example(); vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async path => path.endsWith('/attachments') ? [] : structuredClone(state.permit));
  vi.mocked(api.post).mockReset().mockImplementation(transition);
});
// Estes cenários percorrem várias confirmações e digitação; uma expiração
// prematura deixa eventos pendentes interferirem no próximo cenário.
describe('integração do rascunho com as interrupções da PT', { timeout: 15000 }, () => {
  it('preserva resumo e encerramento no refetch, suspensão e retomada, e envia ambos na revisão atual', async () => {
    const user = userEvent.setup(); show();
    const draft = 'Registro local da atividade, preservado até o encerramento.';
    await user.type(await screen.findByRole('textbox', { name: 'Resumo do atendimento' }), draft);
    const closing = within(screen.getByRole('group', { name: /Área organizada ao final/ }));
    await user.click(closing.getByRole('radio', { name: 'Sim' }));
    await user.click(screen.getByRole('button', { name: 'Atualizar conferência' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Atualizar conferência' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Resumo do atendimento' })).toHaveValue(draft);
    expect(closing.getByRole('radio', { name: 'Sim' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Suspender operação' }));
    let modal = within(screen.getByRole('dialog', { name: 'Suspender operação' }));
    await user.type(modal.getByRole('textbox'), 'Condição imprevista durante a execução.');
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('button', { name: 'Confirmar: suspender operação' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Resumo do atendimento' })).toHaveValue(draft);
    expect(screen.getByRole('textbox', { name: 'Resumo do atendimento' })).toBeDisabled();
    expect(closing.getByRole('radio', { name: 'Sim' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Retomar operação' }));
    modal = within(screen.getByRole('dialog', { name: 'Retomar operação' }));
    await user.type(modal.getByRole('textbox'), 'Mesma equipe e condições novamente conferidas.');
    for (const checkbox of modal.getAllByRole('checkbox')) await user.click(checkbox);
    await user.click(modal.getByRole('button', { name: 'Confirmar: retomar operação' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Concluir atividade e enviar para revisão' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Resumo do atendimento' })).toHaveValue(draft);
    expect(closing.getByRole('radio', { name: 'Sim' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Concluir atividade e enviar para revisão' }));
    modal = within(screen.getByRole('dialog', { name: 'Concluir atividade e enviar para revisão' }));
    expect(modal.getByText(draft)).toBeInTheDocument();
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('button', { name: 'Confirmar ação' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/work-permits/permit/complete', { summary: draft, closingChecks: [expect.objectContaining({ id: 'closing-area', answer: 'YES' })] }, { etag: '"6"' }));
    expect(state.permit!.summary).toBe(draft); expect(state.permit!.preparation!.closingChecks[0].answer).toBe('YES');
  });
  it('preserva o rascunho e bloqueia envio quando o documento salvo mudou em outra revisão', async () => {
    const user = userEvent.setup(); show();
    const draft = 'Resumo local que precisa ser conferido com a nova preparação.';
    await user.type(await screen.findByRole('textbox', { name: 'Resumo do atendimento' }), draft);
    state.permit!.revision++; state.permit!.preparation!.identification.location = 'Outro local após atualização remota.';
    await user.click(screen.getByRole('button', { name: 'Atualizar conferência' }));
    expect(await screen.findByText(/Os dados da PT mudaram. Suas alterações foram preservadas/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Resumo do atendimento' })).toHaveValue(draft);
    expect(screen.getByRole('button', { name: 'Concluir atividade e enviar para revisão' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('bloqueia ações concorrentes no envio e mantém anexo local consultável após suspensão', async () => {
    const user = userEvent.setup(); show();
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'foto-pendente.png', { type: 'image/png' });
    await user.upload(await screen.findByLabelText('Arquivo de acompanhamento *'), file);
    await user.type(screen.getByLabelText('Descrição do anexo *'), 'Imagem local que ainda não foi registrada.');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(api.post).mockImplementationOnce(async (path, body) => { await gate; return transition(path, body); });
    await user.click(screen.getByRole('button', { name: 'Suspender operação' }));
    const modal = within(screen.getByRole('dialog', { name: 'Suspender operação' }));
    await user.type(modal.getByRole('textbox'), 'Interrupção para conferir as condições do local.');
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('button', { name: 'Confirmar: suspender operação' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Concluir atividade e enviar para revisão' })).toBeDisabled());
    expect(screen.getByRole('textbox', { name: 'Resumo do atendimento' })).toBeDisabled();
    expect(screen.getByLabelText('Arquivo de acompanhamento *')).toBeDisabled();
    await user.click(modal.getByRole('button', { name: 'Fechar janela' }));
    expect(screen.getByRole('dialog', { name: 'Suspender operação' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Arquivo selecionado: foto-pendente.png')).toBeInTheDocument();
    expect(screen.getByText('Imagem local que ainda não foi registrada.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar anexo não enviado' }));
    expect(screen.queryByText('Arquivo selecionado: foto-pendente.png')).not.toBeInTheDocument();
  });
});
