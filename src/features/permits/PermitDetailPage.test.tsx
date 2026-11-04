import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinalPdfDto, WorkPermitDto } from '../../shared/contracts/work-permits';
import type { ServiceTemplateVersionDto } from '../../shared/contracts/service-templates';
import { api } from '../../shared/api/client';
import { PermitDetailPage } from './PermitDetailPage';
import { triggerDownload } from '../../shared/lib/downloads';

const state = vi.hoisted(() => ({ permit: null as WorkPermitDto | null, role: 'operator' as 'operator' | 'engineer', unitId: 'unit' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, me: { user: { id: state.role === 'engineer' ? 'engineer' : 'technician', displayName: state.role === 'engineer' ? 'Engenheira Demo' : 'Técnico Demo' } }, can: (permission: string) => permission === 'permits.operate' ? state.role === 'operator' : permission === 'permits.review' && state.role === 'engineer' }) }));
vi.mock('../../shared/api/client', async original => {
  const actual = await original<typeof import('../../shared/api/client')>();
  return { ...actual, api: { get: vi.fn(async () => structuredClone(state.permit)), post: vi.fn(async () => structuredClone(state.permit)), patch: vi.fn(async () => structuredClone(state.permit)) } };
});
vi.mock('../../shared/lib/downloads', () => ({ triggerDownload: vi.fn() }));

const signatureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function reviewPermit() {
  return { ...example(), operationStatus: 'COMPLETED' as const, reviewStatus: 'PENDING_REVIEW' as const, availableActions: ['REVIEW'], summary: 'Atendimento concluído.' };
}
function approvedPermit(): WorkPermitDto {
  return { ...example(), operationStatus: 'COMPLETED', reviewStatus: 'VALIDATED', availableActions: [], snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Registro aprovado.', checklist: [], sciences: [], decision: 'APPROVE' }] };
}
function pdfReceipt(change: Partial<FinalPdfDto> = {}): FinalPdfDto {
  return { permitId: 'permit', version: 1, url: 'blob:http://localhost/final.pdf', fileName: 'PT-TESTE-final-v1.pdf', expiresAt: new Date(Date.now() + 60000).toISOString(), mimeType: 'application/pdf', backendPersisted: false, disclaimer: 'Demonstração de PDF', ...change };
}
function drawSignature(dialog: HTMLElement) {
  const canvas = within(dialog).getByLabelText('Área para desenhar a manifestação') as HTMLCanvasElement;
  Object.defineProperties(canvas, {
    getContext: { value: () => ({ beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() }) },
    toDataURL: { value: () => signatureImage },
    getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 500, height: 180 }) },
    setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => false },
  });
  for (const [type, x, y] of [['pointerdown', 10, 20], ['pointermove', 50, 60], ['pointerup', 50, 60]] as const) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'pen' }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
    fireEvent(canvas, event);
  }
}

function example(): WorkPermitDto {
  return {
    id: 'permit', code: 'PT-TESTE', version: 1, revision: 4, templateVersion: 'Modelo escolar v1',
    appointment: { id: 'appointment', code: 'AG-TESTE', unitId: 'unit', teamId: 'team', teamName: 'Equipe Demo', serviceTypeId: 'service', serviceLabel: 'Serviço ilustrativo', location: 'Local de demonstração', startsAt: '2026-10-09T12:00:00Z', endsAt: '2026-10-09T14:00:00Z', responsibleId: 'technician', responsibleName: 'Técnico Demo', participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo' }], status: 'ATTENDANCE_OPENED', revision: 1, availableActions: [], history: [] },
    operationStatus: 'VERIFICATION', reviewStatus: 'NOT_SUBMITTED', checklist: [{ id: 'check', label: 'Conferência ilustrativa', required: true, answer: 'YES' }], sciences: [],
    eligibility: { appointmentId: 'appointment', eligible: true, checkedAt: '2026-10-09T12:00:00Z', requirementVersion: 'Matriz escolar v1', participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo', eligible: true, items: [] }] },
    availableActions: ['RELEASE', 'COLLECT_SCIENCE'], snapshots: [], history: [],
  };
}
function show(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }), extra?: ReactNode, entryState?: unknown) {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: '/app/pts/permit', state: entryState }]}><Routes><Route path="/app/pts/:id" element={<PermitDetailPage />} /></Routes>{extra}</MemoryRouter></QueryClientProvider>);
  return client;
}
const consultationKeys = [
  ['consulta-permits', 'session', 'unit', 1, '', '', 'PENDING_REVIEW', ''],
  ['consulta-permits', 'session', 'unit', 2, 'PT', 'COMPLETED', '', 'team'],
  ['consulta-permits', 'other-session', 'unit', 1, '', '', '', ''],
  ['consulta-permits', 'session', 'other-unit', 1, '', '', '', ''],
];
const consultationSummary = (permit: WorkPermitDto) => `${permit.version}:${permit.operationStatus}:${permit.reviewStatus}:${permit.appointment.participants.map(participant => participant.serviceFunction).join(',')}`;
function ConsultationProbe({ index }: { index: number }) {
  const result = useQuery({ queryKey: consultationKeys[index], staleTime: Infinity, queryFn: async () => structuredClone(state.permit!) });
  return <output data-testid={`consultation-${index}`}>{result.data && consultationSummary(result.data)}</output>;
}
function showWithConsultation() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  consultationKeys.forEach(key => client.setQueryData(key, structuredClone(state.permit!)));
  show(client, <>{consultationKeys.map((_, index) => <ConsultationProbe key={index} index={index} />)}</>);
  return client;
}
beforeEach(() => {
  state.permit = example(); state.role = 'operator'; state.unitId = 'unit'; vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async () => structuredClone(state.permit));
  vi.mocked(api.post).mockImplementation(async () => structuredClone(state.permit));
  vi.mocked(api.patch).mockImplementation(async () => structuredClone(state.permit));
});

describe('interações da PT em campo', () => {
  it('conta ciências pela equipe e versão sem completar o indicador com duplicatas ou pessoas externas', async () => {
    const science = { id: 'science', workerId: 'outsider', declarantName: 'Pessoa externa', method: 'TYPED' as const, representation: 'Pessoa externa', confirmed: true as const, collectedBy: 'technician', collectedByName: 'Técnico Demo', collectedAt: '2026-10-09T12:00:00Z', version: 1 };
    state.permit!.sciences = [science, { ...science, id: 'duplicate' }, { ...science, id: 'old', workerId: 'worker', version: 0 }];
    show();
    const context = await screen.findByRole('region', { name: 'Contexto da permissão de trabalho' });
    expect(within(context).getByText('Ciências 0/1')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Ciência dos participantes' })).getByText('0/1 registradas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Liberar execução' })).toBeDisabled();
  });
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
    await user.clear(name); await user.paste('Coletor diferente');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar ação' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/corresponder ao participante/);
    expect(api.post).not.toHaveBeenCalled();
    await user.clear(name); await user.paste('José Demo');
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
    expect(api.post).toHaveBeenCalledWith('/work-permits/permit/review', { decision: 'APPROVE', comment: '', signatureRepresentation: 'Engenheira Demo', signatureMethod: 'TYPED', signatureImage: undefined }, { etag: '"4"' });
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
    expect(within(screen.getByRole('region', { name: 'Orientação da PT' })).getByText(/A operação permanece concluída/)).toBeInTheDocument();
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
  it('mostra as versões de cada serviço preservadas na PT e na revisão anterior sem consultar o catálogo atual', async () => {
    const oldTemplate: ServiceTemplateVersionDto = { serviceTypeId: 'height', serviceName: 'Serviço preservado original', version: '1', activityIds: ['height'], questions: [{ id: 'risk', label: 'Pergunta original invertida', required: true, blockingAnswers: ['YES'] }], publishedAt: '2026-10-09T10:00:00Z', publishedBy: 'Admin Demo', reason: 'Publicação inicial' };
    const currentTemplate = { ...oldTemplate, version: '2', serviceName: 'Serviço preservado na correção' };
    state.permit = { ...example(), version: 2, operationStatus: 'COMPLETED', availableActions: [], serviceTemplates: [currentTemplate], snapshots: [{ version: 1, submittedAt: '2026-10-09T14:00:00Z', summary: 'Resumo preservado do serviço.', serviceTemplates: [oldTemplate], checklist: [{ id: 'old-question', label: 'Pergunta original invertida', required: true, answer: 'NO', serviceName: oldTemplate.serviceName, templateVersion: '1', blockingAnswers: ['YES'] }], sciences: [], decision: 'RETURN' }] };
    show();
    expect(await screen.findByText('Serviço preservado na correção')).toBeInTheDocument();
    const historical = screen.getByText('Versão 1').closest('details')!;
    const versions = within(within(historical).getByLabelText('Serviços e templates preservados'));
    expect(versions.getByText('Serviço preservado original')).toBeInTheDocument();
    expect(versions.getByText('Template v1')).toBeInTheDocument();
    expect(within(historical).getByText('Serviço preservado original · template v1')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.every(([path]) => path.startsWith('/work-permits/permit'))).toBe(true);
  });
  it('permite alterar os participantes da equipe com justificativa e confirmação explícita (#94/#116)', async () => {
    state.permit = { ...example(), availableActions: ['EDIT_CHECKLIST', 'RELEASE', 'COLLECT_SCIENCE'] };
    const user = userEvent.setup(); show();
    const editBtn = await screen.findByRole('button', { name: /Alterar participantes da equipe/ });
    await user.click(editBtn);
    const dialog = screen.getByRole('dialog', { name: 'Alterar participantes da equipe' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/A alteração de participantes revoga ciências existentes/)).toBeInTheDocument();

    const reasonInput = within(dialog).getByLabelText('Motivo da alteração de participantes');
    await user.type(reasonInput, 'Ajuste de escalação de pessoal');

    const confirmCheck = within(dialog).getByRole('checkbox', { name: /Confirmo a atualização da composição da equipe/ });
    await user.click(confirmCheck);

    const submitBtn = within(dialog).getByRole('button', { name: 'Confirmar alteração de participantes' });
    await user.click(submitBtn);

    expect(api.patch).toHaveBeenCalledWith(
      '/work-permits/permit/participants',
      {
        participants: [{ workerId: 'worker', name: 'José Demo', serviceFunction: 'Operador Demo' }],
        reason: 'Ajuste de escalação de pessoal',
      },
      { etag: '"4"' }
    );
  });
  it('oferece opções de assinatura desenhada (DRAWN) e upload (IMAGE) na revisão do encerramento (#112)', async () => {
    state.role = 'engineer';
    state.permit = { ...example(), operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', availableActions: ['REVIEW'], summary: 'Atendimento concluído.' };
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar encerramento' });

    expect(within(dialog).getByRole('radio', { name: 'Nome digitado' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Desenho' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Upload de imagem' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: 'Desenho' }));
    expect(within(dialog).getByLabelText('Área para desenhar a manifestação')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: 'Upload de imagem' }));
    expect(within(dialog).getByLabelText('Upload de imagem da rubrica')).toBeInTheDocument();
  });
  it('solicita o PDF da versão aprovada com autorização pelo endpoint (#115)', async () => {
    state.role = 'engineer';
    state.permit = { ...reviewPermit(), reviewStatus: 'VALIDATED', snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Atendimento concluído.', checklist: [], sciences: [], decision: 'APPROVE' }] };
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.endsWith('/final-pdf')) {
        return {
          url: 'blob:http://localhost/final.pdf',
          permitId: 'permit', version: 1, expiresAt: new Date(Date.now() + 60000).toISOString(),
          fileName: 'PT-TESTE-final-v1.pdf',
          mimeType: 'application/pdf',
          backendPersisted: false,
          disclaimer: 'Demonstração de PDF',
        };
      }
      return structuredClone(state.permit);
    });

    const user = userEvent.setup(); show();
    const downloadBtns = await screen.findAllByRole('button', { name: /Baixar PDF final/ });
    expect(downloadBtns.length).toBeGreaterThanOrEqual(1);

    await user.click(downloadBtns[0]);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/work-permits/permit/final-pdf', { query: { version: 1 }, signal: expect.any(AbortSignal) }));
    expect(triggerDownload).toHaveBeenCalledWith('blob:http://localhost/final.pdf', 'PT-TESTE-final-v1.pdf');
  });
  it('não apresenta PDF final enquanto a versão está pendente de aprovação', async () => {
    state.role = 'engineer'; state.permit = reviewPermit(); show();
    await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' });
    expect(screen.queryByRole('button', { name: /Baixar PDF final/ })).not.toBeInTheDocument();
  });
  it.each([
    { change: { expiresAt: '2000-01-01T00:00:00Z' }, message: /vencido ou sem prazo válido/ },
    { change: { mimeType: 'text/html' }, message: /não foi identificado como PDF/ },
  ])('recusa PDF inválido e permite solicitar um novo recibo: $change', async ({ change, message }) => {
    state.permit = approvedPermit();
    let attempts = 0;
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/final-pdf') ? pdfReceipt(attempts++ === 0 ? change : {}) : structuredClone(state.permit));
    const user = userEvent.setup(); show();
    const buttons = await screen.findAllByRole('button', { name: /Baixar PDF final/ });
    expect(screen.getByRole('heading', { name: 'PDF da versão aprovada' })).toBeInTheDocument();
    expect(screen.queryByText(/homologado/i)).not.toBeInTheDocument();
    await user.click(buttons[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(buttons[0]).toBeEnabled();
    await user.click(buttons[0]);
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledOnce());
    expect(attempts).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('ignora o PDF pendente quando a versão deixa de estar aprovada', async () => {
    state.permit = approvedPermit();
    let resolvePdf!: (value: FinalPdfDto) => void;
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/final-pdf') ? new Promise<FinalPdfDto>(resolve => { resolvePdf = resolve; }) : structuredClone(state.permit));
    const user = userEvent.setup(); const client = show();
    await user.click((await screen.findAllByRole('button', { name: /Baixar PDF final/ }))[0]);
    await act(async () => { client.setQueryData(['work-permit', 'session', 'unit', 'permit'], { ...state.permit, reviewStatus: 'RETURNED', snapshots: [{ ...state.permit!.snapshots[0], decision: 'RETURN' }] }); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Baixando/ })).not.toBeInTheDocument());
    await act(async () => { resolvePdf(pdfReceipt()); });
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(screen.queryByText('Demonstração de PDF')).not.toBeInTheDocument();
  });
  it('descarta o desenho ao mudar de método e não confirma um canvas vazio com a imagem anterior', async () => {
    state.role = 'engineer'; state.permit = reviewPermit(); const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Desenho' })); drawSignature(dialog);
    expect(within(dialog).getByAltText('Prévia da assinatura desenhada')).toHaveAttribute('src', signatureImage);
    await user.click(within(dialog).getByRole('radio', { name: 'Nome digitado' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Desenho' }));
    expect(within(dialog).queryByAltText('Prévia da assinatura desenhada')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar aprovação' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Desenhe sua assinatura/); expect(api.post).not.toHaveBeenCalled();
  });
  it('descarta a representação ao trocar a decisão e grava somente a imagem confirmada', async () => {
    state.role = 'engineer'; state.permit = reviewPermit(); const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Desenho' })); drawSignature(dialog);
    await user.selectOptions(within(dialog).getByLabelText('Decisão da revisão'), 'RETURN');
    await user.selectOptions(within(dialog).getByLabelText('Decisão da revisão'), 'APPROVE');
    expect(within(dialog).getByRole('radio', { name: 'Nome digitado' })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: 'Desenho' })); drawSignature(dialog);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar aprovação' }));
    expect(api.post).toHaveBeenCalledWith('/work-permits/permit/review', { decision: 'APPROVE', comment: '', signatureRepresentation: 'Engenheira Demo', signatureMethod: 'DRAWN', signatureImage }, { etag: '"4"' });
  });
  it('rejeita MIME não permitido e remove a imagem válida e a confirmação anteriores', async () => {
    state.role = 'engineer'; state.permit = reviewPermit(); const user = userEvent.setup({ applyAccept: false }); show();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog'); await user.click(within(dialog).getByRole('radio', { name: 'Upload de imagem' }));
    const file = within(dialog).getByLabelText('Upload de imagem da rubrica');
    await user.upload(file, new File([Uint8Array.from(atob(signatureImage.split(',')[1]), character => character.charCodeAt(0))], 'rubrica.png', { type: 'image/png' }));
    expect(await within(dialog).findByAltText('Prévia da imagem da assinatura')).toHaveAttribute('src', signatureImage);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.upload(file, new File(['<svg/>'], 'imagem.svg', { type: 'image/svg+xml' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/PNG ou JPEG/);
    expect(within(dialog).queryByAltText('Prévia da imagem da assinatura')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked(); expect(api.post).not.toHaveBeenCalled();
  });
  it('aborta a leitura ao fechar a revisão e ignora uma resposta tardia no modal reaberto', async () => {
    const readers: { onload: (() => void) | null; result: string; readyState: number; abort: ReturnType<typeof vi.fn> }[] = [];
    class DelayedReader {
      static LOADING = 1; readyState = 1; result = signatureImage; onload = null; onerror = null; abort = vi.fn();
      constructor() { readers.push(this); }
      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', DelayedReader);
    try {
      state.role = 'engineer'; state.permit = reviewPermit(); const user = userEvent.setup(); show();
      await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
      let dialog = screen.getByRole('dialog'); await user.click(within(dialog).getByRole('radio', { name: 'Upload de imagem' }));
      await user.upload(within(dialog).getByLabelText('Upload de imagem da rubrica'), new File(['image'], 'rubrica.png', { type: 'image/png' }));
      expect(within(dialog).getByRole('button', { name: 'Confirmar aprovação' })).toBeDisabled();
      expect(within(dialog).getByRole('checkbox')).toBeDisabled();
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' })); expect(readers[0].abort).toHaveBeenCalledOnce();
      await user.click(screen.getByRole('button', { name: 'Revisar encerramento da versão 1' }));
      dialog = screen.getByRole('dialog'); await user.click(within(dialog).getByRole('radio', { name: 'Upload de imagem' }));
      await act(async () => { readers[0].onload?.(); });
      expect(within(dialog).queryByAltText('Prévia da imagem da assinatura')).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Confirmar aprovação' })).toBeEnabled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('consulta da PT após alterações confirmadas', () => {
  it.each([
    { navigation: { fromConsulta: true, fromSearch: '?tab=permits&q=PT&page=2', fromUnitId: 'unit' }, label: 'Voltar à consulta', href: '/app/consulta?tab=permits&q=PT&page=2' },
    { navigation: { fromConsulta: true, fromSearch: '?page=2' }, label: 'Voltar à consulta', href: '/app/consulta?page=2&tab=permits' },
    { navigation: { fromConsulta: true, fromSearch: '?q=PT', fromUnitId: 'other-unit' }, label: 'Voltar às PTs', href: '/app/pts' },
    { navigation: { fromConsulta: true, fromSearch: 'https://outside.example/consulta' }, label: 'Voltar às PTs', href: '/app/pts' },
    { navigation: { fromSearch: '?q=PT&page=3' }, label: 'Voltar às PTs', href: '/app/pts?q=PT&page=3' },
  ])('preserva somente retorno local válido no contexto atual: $href', async ({ navigation, label, href }) => {
    show(undefined, undefined, navigation);
    expect(await screen.findByRole('link', { name: label })).toHaveAttribute('href', href);
  });

  it.each(['APPROVE', 'RETURN'] as const)('renova as consultas filtradas após %s sem afetar outra sessão ou unidade', async decision => {
    state.role = 'engineer'; state.permit = reviewPermit();
    const previous = consultationSummary(state.permit);
    let confirm!: () => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise<WorkPermitDto>(resolve => {
      confirm = () => {
        state.permit = { ...state.permit!, revision: 5, reviewStatus: decision === 'APPROVE' ? 'VALIDATED' : 'RETURNED', availableActions: decision === 'RETURN' ? ['NEW_VERSION'] : [] };
        resolve(structuredClone(state.permit));
      };
    }));
    const user = userEvent.setup(); showWithConsultation();
    expect(screen.getByTestId('consultation-0')).toHaveTextContent(previous);
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar encerramento' });
    if (decision === 'RETURN') {
      await user.selectOptions(within(dialog).getByLabelText('Decisão da revisão'), decision);
      await user.type(within(dialog).getByLabelText('Motivo da devolução'), 'Conferir as observações documentais do atendimento.');
    }
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: decision === 'APPROVE' ? 'Confirmar aprovação' : 'Confirmar devolução' }));
    expect(screen.getByTestId('consultation-0')).toHaveTextContent(previous);
    expect(screen.getByTestId('consultation-1')).toHaveTextContent(previous);
    await act(async () => { confirm(); });
    await waitFor(() => expect(screen.getByTestId('consultation-0')).toHaveTextContent(consultationSummary(state.permit!)));
    expect(screen.getByTestId('consultation-1')).toHaveTextContent(consultationSummary(state.permit!));
    expect(screen.getByTestId('consultation-2')).toHaveTextContent(previous);
    expect(screen.getByTestId('consultation-3')).toHaveTextContent(previous);
    expect(state.permit!.operationStatus).toBe('COMPLETED');
    expect(screen.queryByRole('button', { name: 'Registrar início da execução' })).not.toBeInTheDocument();
  });

  it('exibe a nova versão na consulta e mantém a execução concluída na correção documental', async () => {
    state.permit = { ...reviewPermit(), reviewStatus: 'RETURNED', availableActions: ['NEW_VERSION'], snapshots: [{ version: 1, submittedAt: '2026-10-09T15:00:00Z', summary: 'Atendimento concluído.', checklist: [], sciences: [], decision: 'RETURN' }] };
    const previous = consultationSummary(state.permit);
    vi.mocked(api.post).mockImplementationOnce(async () => {
      state.permit = { ...state.permit!, revision: 5, version: 2, reviewStatus: 'NOT_SUBMITTED', availableActions: ['EDIT_CHECKLIST', 'COLLECT_SCIENCE'] };
      return structuredClone(state.permit);
    });
    const user = userEvent.setup(); showWithConsultation();
    await user.click(await screen.findByRole('button', { name: 'Criar versão de correção' }));
    const dialog = screen.getByRole('dialog', { name: 'Criar versão de correção' });
    await user.type(within(dialog).getByLabelText('Motivo da correção'), 'Complementar o registro conforme devolução documental.');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar ação' }));
    await waitFor(() => expect(screen.getByTestId('consultation-0')).toHaveTextContent('2:COMPLETED:NOT_SUBMITTED'));
    expect(screen.getByTestId('consultation-1')).toHaveTextContent('2:COMPLETED:NOT_SUBMITTED');
    expect(screen.getByTestId('consultation-2')).toHaveTextContent(previous);
    expect(screen.getByTestId('consultation-3')).toHaveTextContent(previous);
    expect(screen.queryByRole('button', { name: 'Liberar execução' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar início da execução' })).not.toBeInTheDocument();
  });

  it('atualiza a composição consultada somente após a alteração de participantes confirmada', async () => {
    state.permit = { ...example(), availableActions: ['EDIT_CHECKLIST', 'RELEASE', 'COLLECT_SCIENCE'] };
    const previous = consultationSummary(state.permit);
    vi.mocked(api.patch).mockImplementationOnce(async () => {
      state.permit = { ...state.permit!, revision: 5, appointment: { ...state.permit!.appointment, participants: [{ ...state.permit!.appointment.participants[0], serviceFunction: 'Supervisor de campo' }] } };
      return structuredClone(state.permit);
    });
    const user = userEvent.setup(); showWithConsultation();
    await user.click(await screen.findByRole('button', { name: /Alterar participantes da equipe/ }));
    const dialog = screen.getByRole('dialog', { name: 'Alterar participantes da equipe' });
    const serviceFunction = within(dialog).getByLabelText('Função no serviço de José Demo');
    await user.clear(serviceFunction); await user.paste('Supervisor de campo');
    await user.click(within(dialog).getByLabelText('Motivo da alteração de participantes'));
    await user.paste('Atualização da função durante a preparação.');
    await user.click(within(dialog).getByRole('checkbox', { name: /Confirmo a atualização/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar alteração de participantes' }));
    await waitFor(() => expect(screen.getByTestId('consultation-0')).toHaveTextContent('Supervisor de campo'));
    expect(screen.getByTestId('consultation-1')).toHaveTextContent('Supervisor de campo');
    expect(screen.getByTestId('consultation-2')).toHaveTextContent(previous);
    expect(screen.getByTestId('consultation-3')).toHaveTextContent(previous);
    expect(state.permit!.operationStatus).toBe('VERIFICATION');
  });

  it('conserva a consulta fresca e a confirmação aberta quando a decisão falha', async () => {
    state.role = 'engineer'; state.permit = reviewPermit();
    const previous = consultationSummary(state.permit);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Não foi possível registrar a revisão.'));
    const user = userEvent.setup(); const client = showWithConsultation();
    await user.click(await screen.findByRole('button', { name: 'Revisar encerramento da versão 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar encerramento' });
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar aprovação' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Não foi possível registrar a revisão.');
    for (let index = 0; index < consultationKeys.length; index++) {
      expect(screen.getByTestId(`consultation-${index}`)).toHaveTextContent(previous);
      expect(client.getQueryState(consultationKeys[index])?.isInvalidated).toBe(false);
    }
  });
});
