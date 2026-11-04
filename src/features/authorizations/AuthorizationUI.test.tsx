import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { api, ApiError } from '../../shared/api/client';
import { AuthorizationDetailPage } from './AuthorizationDetailPage';
import { AuthorizationFormPage } from './AuthorizationFormPage';
import { AuthorizationPrintPage } from './AuthorizationPrintPage';
import { WorkAuthorizationsPage } from './WorkAuthorizationsPage';
import { AT_CONTROLS, AT_SOURCE, createAuthorizationClosingChecks, createAuthorizationPreparation } from './model';

const state = vi.hoisted(() => ({ record: null as WorkAuthorizationDto | null, permissions: ['at.read', 'at.write', 'at.operate'], roles: ['TECHNICIAN'], userId: 'operator', unitId: 'unit' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ sessionKey: 'session', unitId: state.unitId, me: { user: { id: state.userId, displayName: 'João Souza' }, roles: state.roles }, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
function example(): WorkAuthorizationDto {
  const appointment: AppointmentDto = { id: 'appointment', code: 'AGE-1', companyId: 'company', unitId: 'unit', teamId: 'team', teamName: 'Equipe de teste', serviceTypeId: 'service', serviceLabel: 'Serviço de manutenção', responsibleId: 'operator', responsibleName: 'João Souza', location: 'Galpão de teste', startsAt: '2099-10-10T12:00:00Z', endsAt: '2099-10-10T20:00:00Z', participants: [{ workerId: 'worker', name: 'Ana Silva', serviceFunction: 'Executante' }], status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
  const preparation = createAuthorizationPreparation(appointment);
  preparation.identification = { serviceManagement: 'Gerência de teste', serviceProvider: 'Empresa de teste', activityDescription: 'Manutenção administrativa de exemplo.', workFront: 'Galpão', areaManagement: 'Gerência do local', riskAnalysisReference: 'APT-TESTE', notes: '' };
  preparation.controls = [AT_CONTROLS[0].id];
  preparation.checks = preparation.checks.map(check => ({ ...check, answer: 'YES', note: check.id === 'at-check-b24' ? 'Rádio e contato de emergência disponíveis.' : undefined }));
  return { id: 'at', code: 'AT-1', companyId: 'company', unitId: 'unit', revision: 2, sourceId: AT_SOURCE.sourceId, sourceRevision: AT_SOURCE.sourceRevision, sourceSha256: AT_SOURCE.sourceSha256, appointment, preparation, status: 'DRAFT', sciences: [], eligibility: { appointmentId: appointment.id, unitId: 'unit', checkedAt: '2026-10-10T12:00:00Z', eligible: true, requirementVersion: 'MATRIZ-1', participants: [{ ...appointment.participants[0], eligible: true, items: [{ requirementId: 'restricted', label: 'Conferência administrativa', description: 'Informação clínica que não deve aparecer', fileName: 'arquivo-medico-secreto.pdf', validFrom: '2026-01-01', validUntil: '2026-12-31', status: 'APPROVED', restricted: true, reason: 'Motivo clínico confidencial' }] }] }, releases: [], closingChecks: createAuthorizationClosingChecks(), history: [{ id: 'event', action: 'AUTHORIZATION_CREATED', actorName: 'João Souza', occurredAt: '2026-10-10T12:00:00Z' }], availableActions: ['EDIT', 'COLLECT_SCIENCE', 'CANCEL'], createdAt: '2026-10-10T12:00:00Z', createdByName: 'João Souza' };
}
function LocationProbe() { const location = useLocation(); return <output aria-label="Endereço atual">{location.pathname}{location.search}</output>; }
function show(route = '/app/ats/at', detail = true, navigationState?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: route.split('?')[0], search: route.includes('?') ? `?${route.split('?').slice(1).join('?')}` : '', state: navigationState }]}><LocationProbe /><Routes>
    <Route path="/app/ats" element={<WorkAuthorizationsPage />} /><Route path="/app/ats/nova" element={<AuthorizationFormPage />} /><Route path="/app/ats/:id/editar" element={<AuthorizationFormPage />} />
    <Route path="/app/ats/:id" element={detail ? <AuthorizationDetailPage /> : <h1>AT salva</h1>} />
    <Route path="/app/ats/:id/imprimir" element={<AuthorizationPrintPage />} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks(); state.record = example(); state.permissions = ['at.read', 'at.write', 'at.operate']; state.roles = ['TECHNICIAN']; state.userId = 'operator'; state.unitId = 'unit';
  vi.mocked(api.get).mockImplementation(async (path, settings) => {
    if (path === '/authorization-options') return { appointments: [{ appointment: structuredClone(state.record!.appointment), permits: [{ id: 'permit', code: 'PT-1' }] }] } as never;
    if (path !== '/work-authorizations') return structuredClone(state.record) as never;
    const page = Number(settings?.query?.page || 1), pageSize = Number(settings?.query?.pageSize || 10);
    const q = String(settings?.query?.q || '').toLocaleLowerCase('pt-BR'), status = settings?.query?.status;
    const rows = [structuredClone(state.record!)].filter(item => (!status || item.status === status) && `${item.code} ${item.appointment.code} ${item.appointment.teamName} ${item.appointment.serviceLabel} ${item.appointment.location}`.toLocaleLowerCase('pt-BR').includes(q));
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize } as never;
  });
  vi.mocked(api.patch).mockImplementation(async (_path, body) => { state.record = { ...state.record!, revision: state.record!.revision + 1, preparation: body as WorkAuthorizationDto['preparation'] }; return structuredClone(state.record) as never; });
  vi.mocked(api.post).mockImplementation(async path => { state.record = { ...state.record!, revision: state.record!.revision + 1, availableActions: [] }; if (path.endsWith('/suspend')) state.record.status = 'SUSPENDED'; if (path.endsWith('/close')) state.record.status = 'CLOSED'; return structuredClone(state.record) as never; });
});

describe('UI do formulário e consulta da AT', () => {
  it('mantém busca e estado no endereço ao consultar, imprimir, editar e salvar', async () => {
    const user = userEvent.setup(); show('/app/ats?q=Galp%C3%A3o&status=DRAFT&unitId=unit');
    await user.click(await screen.findByRole('link', { name: 'Consultar AT-1' }));
    await screen.findByRole('heading', { name: 'AT-1' });
    const listPath = '/app/ats?q=Galp%C3%A3o&status=DRAFT&unitId=unit';
    expect(screen.getByRole('link', { name: 'Voltar às ATs' })).toHaveAttribute('href', listPath);
    await user.click(screen.getByRole('link', { name: 'Imprimir AT' }));
    await screen.findByRole('article', { name: 'Registro imprimível da AT' });
    await user.click(screen.getByRole('link', { name: 'Voltar à AT' }));
    await user.click(await screen.findByRole('link', { name: 'Editar rascunho' }));
    const input = await screen.findByLabelText('Descrição da atividade');
    fireEvent.change(input, { target: { value: 'Alteração preservando origem da lista.' } });
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    await screen.findByRole('heading', { name: 'AT-1' });
    expect(screen.getByRole('link', { name: 'Voltar às ATs' })).toHaveAttribute('href', listPath);
    await user.click(screen.getByRole('link', { name: 'Voltar às ATs' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pesquisar AT')).toHaveValue('Galpão');
    expect(screen.getByLabelText('Estado da AT')).toHaveValue('DRAFT');
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(listPath);
  });
  it('rejeita estado desconhecido no endereço sem mostrar todas as ATs', async () => {
    const user = userEvent.setup(); show('/app/ats?status=UNKNOWN');
    expect(await screen.findByText(/O endereço contém um estado de AT inválido/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Consultar AT-1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar estado' }));
    expect(await screen.findByRole('link', { name: 'Consultar AT-1' })).toBeInTheDocument();
  });
  it('descarta a origem de outra unidade', async () => {
    show('/app/ats/at', true, { fromPreparationList: 'ats', fromUnitId: 'other', fromSearch: '?q=segredo&unitId=other' });
    await screen.findByRole('heading', { name: 'AT-1' });
    expect(screen.getByRole('link', { name: 'Voltar às ATs' })).toHaveAttribute('href', '/app/ats');
  });
  it.each(['id', 'appointment'])('não apresenta AT com %s divergente da rota ou unidade', async field => {
    if (field === 'id') state.record!.id = 'other-at'; else state.record!.appointment.unitId = 'other-unit';
    show(); await screen.findByText('AT fora da unidade atual');
    expect(screen.queryByRole('region', { name: 'Ações da AT' })).not.toBeInTheDocument();
  });
  it('mantém a edição local da AT quando a atualização falha', async () => {
    const client = show('/app/ats/at/editar', false);
    fireEvent.change(await screen.findByLabelText('Descrição da atividade'), { target: { value: 'Preenchimento preservado durante falha de conexão.' } });
    vi.mocked(api.get).mockRejectedValue(new Error('Conexão interrompida.'));
    await act(async () => { await client.refetchQueries({ queryKey: ['work-authorization'] }); });
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Preenchimento preservado durante falha de conexão.');
    expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeInTheDocument();
  });

  it('pré-seleciona atendimento, admite PT opcional e salva rascunho parcial com catálogo canônico', async () => {
    const user = userEvent.setup(); show('/app/ats/nova?appointmentId=appointment', false);
    const preparation = await screen.findByRole('form', { name: 'Preparação da AT' });
    expect(screen.getByLabelText('Atendimento da AT *')).toHaveValue('appointment');
    expect(screen.getByRole('region', { name: 'Contexto do atendimento da AT' })).toHaveTextContent('Equipe de teste');
    expect(within(preparation).getByLabelText('PT vinculada (opcional)')).toHaveValue('');
    expect(within(preparation).getByLabelText('Meios de comunicação de emergência disponíveis *')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    expect(await screen.findByRole('heading', { name: 'AT salva' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/work-authorizations', expect.objectContaining({ appointmentId: 'appointment', permitId: null, controls: [], checks: expect.arrayContaining([expect.objectContaining({ id: 'at-check-b24', answer: null })]) }), { query: { unitId: 'unit' }, signal: expect.any(AbortSignal) });
  });
  it('mantém a nota B24 visível com resposta Sim e mostra justificativa nas respostas Não', async () => {
    const user = userEvent.setup(); show('/app/ats/nova?appointmentId=appointment', false);
    const preparation = await screen.findByRole('form', { name: 'Preparação da AT' });
    const questions = within(preparation).getAllByRole('group').filter(group => within(group).queryAllByRole('radio').length > 0);
    await user.click(within(questions[3]).getByRole('radio', { name: 'Sim' }));
    expect(screen.getByLabelText('Meios de comunicação de emergência disponíveis *')).toBeInTheDocument();
    await user.click(within(questions[0]).getByRole('radio', { name: 'Não' }));
    expect(screen.getByLabelText('Justificativa da questão 1 *')).toBeInTheDocument();
  });
  it('preserva rascunho em conflito e só adota nova revisão depois da decisão explícita', async () => {
    const user = userEvent.setup(); show('/app/ats/at/editar', false);
    const field = await screen.findByLabelText('Descrição da atividade');
    await user.clear(field); await user.type(field, 'Meu texto local precisa ser preservado.');
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Conflito', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    expect(await screen.findByRole('button', { name: 'Conferir AT atual' })).toBeInTheDocument();
    expect(field).toHaveValue('Meu texto local precisa ser preservado.');
    state.record = { ...state.record!, revision: 7, preparation: { ...state.record!.preparation, identification: { ...state.record!.preparation.identification, activityDescription: 'Texto concorrente do servidor.' } } };
    await user.click(screen.getByRole('button', { name: 'Conferir AT atual' }));
    await user.click(await screen.findByRole('button', { name: 'Usar revisão atual e manter preenchimento' }));
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Meu texto local precisa ser preservado.');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da AT' }));
    expect(await screen.findByRole('heading', { name: 'AT salva' })).toBeInTheDocument();
    expect(api.patch).toHaveBeenLastCalledWith('/work-authorizations/at', expect.objectContaining({ identification: expect.objectContaining({ activityDescription: 'Meu texto local precisa ser preservado.' }) }), { query: { unitId: 'unit' }, etag: '"7"', signal: expect.any(AbortSignal) });
  });
  it('filtra a lista por pesquisa e estado sem misturar unidades', async () => {
    const user = userEvent.setup(); show('/app/ats');
    expect(await screen.findByRole('link', { name: 'Consultar AT-1' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Pesquisar AT'), 'local inexistente');
    expect(screen.getByText('Nenhuma AT encontrada')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Pesquisar AT'));
    await user.selectOptions(screen.getByLabelText('Estado da AT'), 'AUTHORIZED');
    expect(screen.queryByRole('link', { name: 'Consultar AT-1' })).not.toBeInTheDocument();
  });
  it('consulta ciências/elegibilidade sem detalhes clínicos e traduz os eventos do domínio', async () => {
    state.permissions = ['at.read']; show();
    expect(await screen.findByRole('heading', { name: 'AT-1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Histórico da AT' })).toHaveTextContent('AT criada');
    expect(screen.queryByText('Informação clínica que não deve aparecer')).not.toBeInTheDocument();
    expect(screen.queryByText(/arquivo-medico-secreto/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Motivo clínico confidencial/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar AT' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Imprimir AT' })).toHaveAttribute('href', '/app/ats/at/imprimir');
  });
  it('numera a primeira revalidação como 1, em acordo com o documento impresso', async () => {
    const record = state.record!;
    const release = { id: 'initial', sequence: 1, kind: 'INITIAL' as const, occurredAt: '2026-10-11T12:00:00Z', validFrom: '2026-10-11T12:00:00Z', validUntil: '2026-10-11T15:00:00Z', actorId: 'operator', actorName: 'João Souza', eligibility: record.eligibility, representations: { responsibleName: 'João Souza', foremanName: 'Ana Silva', issuerName: 'Emitente de teste', confirmed: true as const } };
    record.status = 'AUTHORIZED'; record.releases = [release, { ...release, id: 'revalidation', sequence: 2, kind: 'REVALIDATION' }];
    show();
    const section = await screen.findByRole('region', { name: 'Autorizações e revalidações da AT' });
    expect(within(section).getByRole('heading', { name: /Revalidação 1/ })).toBeInTheDocument();
    expect(within(section).queryByRole('heading', { name: /Revalidação 2/ })).not.toBeInTheDocument();
  });
});

describe('confirmações operacionais da AT', () => {
  it('explica um fim de autorização fora do período sem enviar uma tentativa inválida', async () => {
    const record = state.record!;
    record.availableActions = ['AUTHORIZE'];
    record.sciences = [{ id: 'science', workerId: 'worker', version: 1, declarantName: 'Ana Silva', representation: 'Ana Silva', method: 'TYPED', confirmed: true, collectedAt: '2026-10-10T12:00:00Z', collectedBy: 'operator', collectedByName: 'João Souza' }];
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Autorizar AT' }));
    const dialog = screen.getByRole('dialog', { name: 'Autorizar AT' });
    await user.type(within(dialog).getByLabelText('Nome do emitente *'), 'Emitente de teste');
    await user.clear(within(dialog).getByLabelText('Autorização válida até *'));
    await user.type(within(dialog).getByLabelText('Autorização válida até *'), '2099-10-11T17:00');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar autorizar at' }));
    expect(await within(dialog).findByText(/não pode ultrapassar o término previsto/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Nome do emitente *')).toHaveValue('Emitente de teste');
    await user.clear(within(dialog).getByLabelText('Autorização válida até *'));
    await user.type(within(dialog).getByLabelText('Autorização válida até *'), '2099-10-10T17:00');
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar autorizar at' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(await within(dialog).findByText(/Confirme explicitamente esta ação/)).toBeInTheDocument();
  });
  it('registra ciência digitada com participante e coletor distintos usando revisão carregada', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Registrar ciência na AT' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar ciência na AT' });
    await user.selectOptions(within(dialog).getByLabelText('Participante que declara *'), 'worker');
    expect(within(dialog).getByLabelText('Nome de quem declara *')).toHaveValue('Ana Silva');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar registrar ciência na at' }));
    expect(await screen.findByText(/Registrar ciência na AT: registro confirmado/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/work-authorizations/at/sciences', { workerId: 'worker', declarantName: 'Ana Silva', method: 'TYPED', representation: 'Ana Silva', confirmed: true }, { etag: '"2"', query: { unitId: 'unit' }, signal: expect.any(AbortSignal) });
  });
  it('preserva motivo no conflito, atualiza explicitamente e exige nova confirmação', async () => {
    const user = userEvent.setup(); state.record!.status = 'AUTHORIZED'; state.record!.availableActions = ['SUSPEND']; show();
    await user.click(await screen.findByRole('button', { name: 'Suspender AT' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspender AT' });
    await user.type(within(dialog).getByLabelText('Motivo *'), 'Interrupção registrada para o teste.');
    await user.click(within(dialog).getByRole('checkbox'));
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Conflito', requestId: 'test' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar suspender at' }));
    state.record!.revision = 6;
    await user.click(await within(dialog).findByRole('button', { name: 'Atualizar AT e preservar preenchimento' }));
    expect(await within(dialog).findByText(/AT atual carregada/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Motivo *')).toHaveValue('Interrupção registrada para o teste.');
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar suspender at' }));
    expect(api.post).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar suspender at' }));
    expect(await screen.findByText(/Suspender AT: registro confirmado/)).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/work-authorizations/at/suspend', { reason: 'Interrupção registrada para o teste.', confirmed: true }, { etag: '"6"', query: { unitId: 'unit' }, signal: expect.any(AbortSignal) });
  });
  it('permite registrar conclusão com documentos pendentes e janela vencida sem autorizar novamente', async () => {
    const user = userEvent.setup(); state.record!.status = 'AUTHORIZED'; state.record!.availableActions = ['CLOSE']; state.record!.eligibility.eligible = false;
    state.record!.releases = [{ id: 'expired', sequence: 1, kind: 'INITIAL', occurredAt: new Date(Date.now() - 7_200_000).toISOString(), validFrom: new Date(Date.now() - 7_200_000).toISOString(), validUntil: new Date(Date.now() - 3_600_000).toISOString(), actorId: 'operator', actorName: 'João Souza', eligibility: state.record!.eligibility, representations: { responsibleName: 'João Souza', foremanName: 'Ana Silva', issuerName: 'Emitente de teste', confirmed: true } }];
    show();
    await user.click(await screen.findByRole('button', { name: 'Encerrar AT' }));
    const dialog = screen.getByRole('dialog', { name: 'Encerrar AT' });
    await user.click(within(dialog).getByLabelText('Resumo da conclusão *'));
    await user.paste('A atividade foi concluída e as condições foram registradas.');
    for (const yes of within(dialog).getAllByRole('radio', { name: 'Sim' })) await user.click(yes);
    await user.click(within(dialog).getByLabelText('Nome do emitente *'));
    await user.paste('Emitente de teste');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar encerrar at' }));
    expect(await screen.findByText(/Encerrar AT: registro confirmado/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/work-authorizations/at/close', expect.objectContaining({ checks: expect.arrayContaining([expect.objectContaining({ answer: 'YES' })]), representations: { responsibleName: 'João Souza', foremanName: 'Ana Silva', issuerName: 'Emitente de teste', confirmed: true } }), expect.objectContaining({ etag: '"2"' }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('bloqueia troca de unidade durante uma confirmação aberta', async () => {
    const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Cancelar AT' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let permitted = true;
    act(() => { permitted = window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true })); });
    expect(permitted).toBe(false); expect(confirm).toHaveBeenCalledOnce();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continuar na AT' }));
  });
  it('oculta operação de outro técnico e permite apenas cancelamento administrativo para o gestor', async () => {
    state.userId = 'another'; state.roles = ['SESMT_MANAGER']; state.permissions = ['at.read', 'at.write']; show();
    await screen.findByRole('heading', { name: 'AT-1' });
    expect(screen.queryByRole('button', { name: 'Registrar ciência na AT' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar AT' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar AT' }));
    expect(within(screen.getByRole('dialog')).getByText(/Cancelamento administrativo/)).toBeInTheDocument();
  });
});
