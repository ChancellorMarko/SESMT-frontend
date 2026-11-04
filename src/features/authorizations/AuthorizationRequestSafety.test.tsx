import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../shared/api/client';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import { AuthorizationFormPage } from './AuthorizationFormPage';
import { AuthorizationDetailPage } from './AuthorizationDetailPage';
import { authorizationKey } from './support';
import { AT_SOURCE, createAuthorizationClosingChecks, createAuthorizationPreparation } from './model';

const state = vi.hoisted(() => ({ sessionKey: 'session', unitId: 'unit' }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ ...state, me: { user: { id: 'operator', displayName: 'Operador de teste' }, roles: ['TECHNICIAN'] }, can: () => true }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

function example(): WorkAuthorizationDto {
  const appointment: AppointmentDto = { id: 'appointment', code: 'AGE-1', companyId: 'company', unitId: 'unit', teamId: 'team', teamName: 'Equipe de teste', serviceTypeId: 'service', serviceLabel: 'Manutenção', responsibleId: 'operator', responsibleName: 'Operador de teste', location: 'Galpão', startsAt: '2099-10-10T12:00:00Z', endsAt: '2099-10-10T20:00:00Z', participants: [{ workerId: 'worker', name: 'Ana Silva', serviceFunction: 'Executante' }], status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
  return { id: 'at', code: 'AT-1', companyId: 'company', unitId: 'unit', revision: 2, sourceId: AT_SOURCE.sourceId, sourceRevision: AT_SOURCE.sourceRevision, sourceSha256: AT_SOURCE.sourceSha256, appointment, preparation: createAuthorizationPreparation(appointment), status: 'DRAFT', sciences: [], eligibility: { appointmentId: 'appointment', unitId: 'unit', checkedAt: '2026-10-10T12:00:00Z', eligible: true, requirementVersion: 'MATRIZ-1', participants: [] }, releases: [], closingChecks: createAuthorizationClosingChecks(), history: [], availableActions: ['EDIT', 'CANCEL'], createdAt: '2026-10-10T12:00:00Z', createdByName: 'Operador de teste' };
}
let record: WorkAuthorizationDto;
function show(edit = true, existingClient?: QueryClient, creation = false) {
  const client = existingClient || new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (!existingClient) client.setQueryData(authorizationKey('session', 'unit', 'at'), structuredClone(record));
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[creation ? '/app/ats/nova?appointmentId=appointment' : edit ? '/app/ats/at/editar' : '/app/ats/at']}><Routes>
    <Route path="/app/ats/nova" element={<AuthorizationFormPage />} />
    <Route path="/app/ats/:id/editar" element={<AuthorizationFormPage />} />
    <Route path="/app/ats/:id" element={edit ? <h1>AT salva</h1> : <AuthorizationDetailPage />} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { ...view, client, update: () => view.rerender(tree()) };
}
async function editLocal() {
  const field = await screen.findByLabelText('Descrição da atividade');
  fireEvent.change(field, { target: { value: 'Minha preparação local deve permanecer.' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeEnabled());
  return screen.getByRole('form', { name: 'Preparação da AT' });
}
async function cancelDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cancelar AT' }));
  const dialog = screen.getByRole('dialog', { name: 'Cancelar AT' });
  fireEvent.change(within(dialog).getByLabelText('Motivo *'), { target: { value: 'Cancelamento registrado para conferência.' } });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  return { dialog, form: dialog.querySelector('form')! };
}
beforeEach(() => {
  vi.clearAllMocks(); record = example(); state.unitId = 'unit'; state.sessionKey = 'session';
  vi.mocked(api.get).mockImplementation(async path => path === '/authorization-options' ? { appointments: [{ appointment: structuredClone(record.appointment), permits: [] }] } as never : structuredClone(record) as never);
  vi.mocked(api.patch).mockImplementation(async () => ({ ...structuredClone(record), revision: 3 }) as never);
  vi.mocked(api.post).mockImplementation(async () => ({ ...structuredClone(record), revision: 3, status: 'CANCELED', availableActions: [] }) as never);
});

describe('respostas e ciclo de vida da preparação da AT', () => {
  it('aceita atendimento que omite empresa opcional sem afrouxar o vínculo da AT', async () => {
    delete record.appointment.companyId;
    show(); fireEvent.submit(await editLocal());
    expect(await screen.findByRole('heading', { name: 'AT salva' })).toBeInTheDocument();
  });
  it('não troca a empresa da AT quando o atendimento omite esse campo opcional', async () => {
    delete record.appointment.companyId;
    vi.mocked(api.patch).mockResolvedValueOnce({ ...structuredClone(record), companyId: 'other-company', revision: 3 });
    const view = show(); fireEvent.submit(await editLocal());
    await screen.findByText(/resposta pertence a outro registro/);
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ companyId: 'company', revision: 2 });
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
    expect(screen.queryByRole('heading', { name: 'AT salva' })).not.toBeInTheDocument();
  });
  it('preserva a criação após resposta inválida sem exigir conferência de um registro desconhecido', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ ...structuredClone(record), revision: 0 });
    show(true, undefined, true); fireEvent.submit(await editLocal());
    await screen.findByText(/revisão recebida não confirma/);
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
    expect(screen.queryByRole('button', { name: 'Conferir AT atual' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeEnabled();
  });
  it.each(['id', 'appointment', 'unit', 'company', 'revision'] as const)('preserva o preenchimento e o cache quando o PATCH retorna %s incompatível', async mismatch => {
    const response = { ...structuredClone(record), revision: 3 };
    if (mismatch === 'id') response.id = 'another-at';
    if (mismatch === 'appointment') response.appointment.id = 'another-appointment';
    if (mismatch === 'unit') response.appointment.unitId = 'another-unit';
    if (mismatch === 'company') response.companyId = 'another-company';
    if (mismatch === 'revision') response.revision = 2;
    vi.mocked(api.patch).mockResolvedValue(response);
    const view = show(); const form = await editLocal(); fireEvent.submit(form);
    await screen.findByText(mismatch === 'revision' ? /revisão recebida não confirma/ : /resposta pertence a outro registro/);
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
    expect(screen.queryByRole('heading', { name: 'AT salva' })).not.toBeInTheDocument();
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ id: 'at', revision: 2 });
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'another-at'))).toBeUndefined();
  });

  it('recusa conferência anterior à revisão já consultada sem adotar nem apagar texto local', async () => {
    vi.mocked(api.patch).mockRejectedValue(new ApiError(412, { code: 'CONFLICT', message: 'Conflito', requestId: '' }));
    const view = show(); fireEvent.submit(await editLocal());
    const check = await screen.findByRole('button', { name: 'Conferir AT atual' });
    vi.mocked(api.get).mockResolvedValue({ ...structuredClone(record), revision: 1 });
    fireEvent.click(check);
    await screen.findByText(/revisão recebida não confirma/);
    expect(screen.queryByRole('region', { name: 'Conferência da AT atual' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ revision: 2 });
  });

  it('não adota conferência que ficou antiga enquanto o usuário comparava o preenchimento', async () => {
    vi.mocked(api.patch).mockRejectedValue(new ApiError(412, { code: 'CONFLICT', message: 'Conflito', requestId: '' }));
    const view = show(); fireEvent.submit(await editLocal());
    const check = await screen.findByRole('button', { name: 'Conferir AT atual' });
    vi.mocked(api.get).mockResolvedValue({ ...structuredClone(record), revision: 3 }); fireEvent.click(check);
    const adopt = await screen.findByRole('button', { name: 'Usar revisão atual e manter preenchimento' });
    await act(async () => { view.client.setQueryData(authorizationKey('session', 'unit', 'at'), { ...structuredClone(record), revision: 4 }); });
    fireEvent.click(adopt); await screen.findByText(/revisão recebida não confirma/);
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ revision: 4 });
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
  });

  it('envia uma única gravação para dois submits e aborta a resposta depois de desmontar', async () => {
    let resolve!: (value: WorkAuthorizationDto) => void; let signal!: AbortSignal;
    vi.mocked(api.patch).mockImplementation((_path, _body, settings) => { signal = settings!.signal!; return new Promise(done => { resolve = done; }); });
    const view = show(); const form = await editLocal();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Descrição da atividade')).toBeDisabled();
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ...structuredClone(record), revision: 3 }));
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ revision: 2 });
    expect(view.client.getQueryState(authorizationKey('session', 'unit', 'at'))?.isInvalidated).toBe(false);
  });

  it('ignora a gravação da sessão antiga após mudança forçada de contexto', async () => {
    let resolve!: (value: WorkAuthorizationDto) => void; let signal!: AbortSignal;
    vi.mocked(api.patch).mockImplementation((_path, _body, settings) => { signal = settings!.signal!; return new Promise(done => { resolve = done; }); });
    const view = show(); fireEvent.submit(await editLocal()); await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    state.sessionKey = 'new-session'; view.update();
    await screen.findByLabelText('Descrição da atividade'); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ...structuredClone(record), revision: 3 }));
    expect(screen.queryByRole('heading', { name: 'AT salva' })).not.toBeInTheDocument();
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ revision: 2 });
    expect(view.client.getQueryData(authorizationKey('new-session', 'unit', 'at'))).toMatchObject({ revision: 2 });
  });

  it('suspende a gravação até recuperar referências que falharam sem perder a preparação', async () => {
    const view = show(); const form = await editLocal();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta de referências indisponível.'));
    await act(async () => { await view.client.refetchQueries({ queryKey: ['authorization-options'] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeDisabled());
    fireEvent.submit(form); expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar referências da AT' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeEnabled());
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
  });

  it('não reabre dados do cache quando uma nova entrada no editor recebe acesso negado', async () => {
    const view = show(); await editLocal(); view.unmount();
    const denial = new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso negado', requestId: '' });
    vi.mocked(api.get).mockRejectedValue(denial);
    await view.client.fetchQuery({ queryKey: authorizationKey('session', 'unit', 'at'), queryFn: () => api.get('/work-authorizations/at'), staleTime: 0 }).catch(() => {});
    show(true, view.client);
    await screen.findByText('Seu acesso não permite esta ação na AT desta unidade.');
    expect(screen.queryByLabelText('Descrição da atividade')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho da AT' })).not.toBeInTheDocument();
  });

  it('preserva a nova preparação e bloqueia envio se o atendimento escolhido deixa de estar disponível', async () => {
    const view = show(true, undefined, true); const form = await editLocal();
    vi.mocked(api.get).mockResolvedValue({ appointments: [{ appointment: { ...structuredClone(record.appointment), status: 'CANCELED' }, permits: [] }] });
    await act(async () => { await view.client.refetchQueries({ queryKey: ['authorization-options'] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da AT' })).toBeDisabled());
    fireEvent.submit(form); expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Descrição da atividade')).toHaveValue('Minha preparação local deve permanecer.');
    expect(screen.getByText(/já não está confirmado ou aberto/)).toBeInTheDocument();
  });
});

describe('respostas das confirmações da AT', () => {
  it.each(['id', 'appointment', 'revision'] as const)('não substitui a AT ao receber %s incompatível na confirmação', async mismatch => {
    const response = { ...structuredClone(record), revision: 3 };
    if (mismatch === 'id') response.id = 'another-at';
    if (mismatch === 'appointment') response.appointment.id = 'another-appointment';
    if (mismatch === 'revision') response.revision = 2;
    vi.mocked(api.post).mockResolvedValue(response);
    const view = show(false); const { dialog, form } = await cancelDialog(); fireEvent.submit(form);
    await within(dialog).findByText(mismatch === 'revision' ? /revisão recebida não confirma/ : /resposta pertence a outro registro/);
    expect(within(dialog).getByLabelText('Motivo *')).toHaveValue('Cancelamento registrado para conferência.');
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ id: 'at', revision: 2 });
  });

  it.each(['id', 'revision'] as const)('confere resposta %s antes de gravar qualquer valor no cache', async mismatch => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(412, { code: 'CONFLICT', message: 'Conflito', requestId: '' }));
    const view = show(false); const { dialog, form } = await cancelDialog(); fireEvent.submit(form);
    const refresh = await within(dialog).findByRole('button', { name: 'Atualizar AT e preservar preenchimento' });
    vi.mocked(api.get).mockResolvedValue({ ...structuredClone(record), ...(mismatch === 'id' ? { id: 'another-at', revision: 3 } : { revision: 1 }) });
    fireEvent.click(refresh);
    await within(dialog).findByText(mismatch === 'revision' ? /revisão recebida não confirma/ : /resposta pertence a outro registro/);
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ id: 'at', revision: 2 });
    expect(within(dialog).getByLabelText('Motivo *')).toHaveValue('Cancelamento registrado para conferência.');
    expect(within(dialog).queryByText(/AT atual carregada/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmar cancelar at' })).toBeDisabled();
  });

  it('mantém o conflito depois de conferência negada e exige consulta válida e nova confirmação', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(412, { code: 'CONFLICT', message: 'Conflito', requestId: '' }));
    show(false); const { dialog, form } = await cancelDialog(); fireEvent.submit(form);
    const refresh = await within(dialog).findByRole('button', { name: 'Atualizar AT e preservar preenchimento' });
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(403, { code: 'FORBIDDEN', message: 'Acesso negado', requestId: '' }));
    fireEvent.click(refresh); await within(dialog).findByText('Seu acesso não permite esta ação na AT desta unidade.');
    expect(within(dialog).getByRole('button', { name: 'Confirmar cancelar at' })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
    fireEvent.submit(form); expect(api.post).toHaveBeenCalledOnce();
    vi.mocked(api.get).mockResolvedValue({ ...structuredClone(record), revision: 4 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar AT e preservar preenchimento' }));
    await within(dialog).findByText(/AT atual carregada/);
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
    fireEvent.submit(form); await within(dialog).findByText(/Confirme explicitamente esta ação/);
    expect(api.post).toHaveBeenCalledOnce();
    vi.mocked(api.post).mockResolvedValue({ ...structuredClone(record), revision: 5, status: 'CANCELED', availableActions: [] });
    fireEvent.click(within(dialog).getByRole('checkbox')); fireEvent.submit(form);
    await screen.findByText(/Cancelar AT: registro confirmado/);
    expect(api.post).toHaveBeenLastCalledWith('/work-authorizations/at/cancel', expect.anything(), expect.objectContaining({ etag: '"4"' }));
  });

  it('não aplica resposta pendente após desmontar e impede confirmação duplicada no mesmo instante', async () => {
    let resolve!: (value: WorkAuthorizationDto) => void; let signal!: AbortSignal;
    vi.mocked(api.post).mockImplementation((_path, _body, settings) => { signal = settings!.signal!; return new Promise(done => { resolve = done; }); });
    const view = show(false); const { form } = await cancelDialog();
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ...structuredClone(record), revision: 3 }));
    expect(view.client.getQueryData(authorizationKey('session', 'unit', 'at'))).toMatchObject({ revision: 2 });
  });

  it('invalida apenas consultas da mesma sessão e unidade depois da confirmação', async () => {
    const view = show(false);
    const resources = ['work-authorizations', 'authorization-options', 'appointments', 'appointment', 'eligibility', 'documentary-readiness', 'permit-dashboard'];
    for (const resource of resources) {
      view.client.setQueryData([resource, 'session', 'unit', 'fixture'], 'same');
      view.client.setQueryData([resource, 'session', 'another-unit', 'fixture'], 'other-unit');
      view.client.setQueryData([resource, 'another-session', 'unit', 'fixture'], 'other-session');
    }
    const { form } = await cancelDialog(); fireEvent.submit(form);
    await screen.findByText(/Cancelar AT: registro confirmado/);
    for (const resource of resources) {
      expect(view.client.getQueryState([resource, 'session', 'unit', 'fixture'])?.isInvalidated).toBe(true);
      expect(view.client.getQueryState([resource, 'session', 'another-unit', 'fixture'])?.isInvalidated).toBe(false);
      expect(view.client.getQueryState([resource, 'another-session', 'unit', 'fixture'])?.isInvalidated).toBe(false);
    }
  });
});
