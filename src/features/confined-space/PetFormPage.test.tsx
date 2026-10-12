import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfinedSpacePermitDto, PetPreparationDto } from '../../shared/contracts/confined-space-permits';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { api, ApiError } from '../../shared/api/client';
import { PetFormPage } from './PetFormPage';
import { createPetPreparation, PET_CONTROLS, PET_EQUIPMENT, PET_SOURCE } from './model';
import { petKey } from './support';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['pet.write'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ unitId: state.unitId, sessionKey: state.sessionKey, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
let appointment: AppointmentDto; let record: ConfinedSpacePermitDto;
function example(): AppointmentDto {
  return { id: 'appointment-a', code: 'AG-001', companyId: 'company-a', unitId: 'unit-a', teamId: 'team-a', teamName: 'Equipe A', serviceTypeId: 'service-a', serviceLabel: 'Inspeção de reservatório', location: 'Reservatório A', startsAt: '2099-10-09T17:00:00Z', endsAt: '2099-10-09T19:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador A', participants: [{ workerId: 'worker-a', name: 'Ana Silva', serviceFunction: 'Inspeção' }], status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
}
beforeEach(() => {
  vi.clearAllMocks(); state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['pet.write']; appointment = example();
  record = { id: 'pet-a', code: 'PET-001', companyId: 'company-a', unitId: 'unit-a', sourceId: PET_SOURCE.sourceId, sourceRevision: PET_SOURCE.sourceRevision, sourceSha256: PET_SOURCE.sourceSha256, revision: 2, status: 'DRAFT', appointment, preparation: createPetPreparation(appointment), availableActions: ['EDIT'], history: [], snapshots: [], createdAt: '2026-10-11T12:00:00Z', updatedAt: '2026-10-11T12:00:00Z', createdByName: 'Operador A' };
  vi.mocked(api.get).mockImplementation(async path => path === '/confined-space-permit-options' ? { appointments: [structuredClone(appointment)] } as never : structuredClone(record) as never);
  vi.mocked(api.post).mockImplementation(async (_path, input) => ({ ...structuredClone(record), preparation: input as PetPreparationDto }) as never);
  vi.mocked(api.patch).mockImplementation(async (_path, input) => ({ ...structuredClone(record), revision: record.revision + 1, preparation: input as PetPreparationDto }) as never);
});
function show(route = '/app/pets/nova?appointmentId=appointment-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = <QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/app/pets/nova" element={<PetFormPage />} /><Route path="/app/pets/:id/editar" element={<PetFormPage />} />
    <Route path="/app/pets/:id" element={<h1>PET salva</h1>} /><Route path="/app/pets" element={<h1>Rascunhos da PET</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree);
  return { client, view, rerender: () => view.rerender(tree) };
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Preparação da PET', { timeout: 15000 }, () => {
  it('salva preparação incompleta com o catálogo recebido, sem emissão ou atribuição automática de papéis', async () => {
    const user = userEvent.setup(); show();
    expect(await screen.findByRole('form', { name: 'Preparação da PET' })).toBeInTheDocument();
    expect(screen.getByLabelText('Atendimento da PET *')).toHaveValue('appointment-a');
    expect(screen.getByLabelText('Início previsto')).toHaveValue('2099-10-09T14:00');
    expect(screen.queryByLabelText('Nome da pessoa 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar participante cadastrado' })).toBeDisabled();
    expect(screen.getAllByRole('combobox', { name: /Resposta da verificação/ })).toHaveLength(23);
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(await screen.findByRole('heading', { name: 'PET salva' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledOnce();
    const [path, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(path).toBe('/confined-space-permits'); expect(config).toMatchObject({ query: { unitId: 'unit-a' }, signal: expect.any(AbortSignal) });
    expect(body).toMatchObject({ appointmentId: 'appointment-a', people: [], atmosphere: [], equipment: [], controls: [], identification: { plannedStartAt: '2099-10-09T17:00:00Z', spaceCode: '' } });
    expect((body as PetPreparationDto).checks).toHaveLength(23); expect((body as PetPreparationDto).checks.every(item => item.answer === null)).toBe(true);
  });
  it('registra escolha explícita de papéis, leitura com fuso e respostas sem interpretar a atmosfera', async () => {
    const user = userEvent.setup(); show(); await screen.findByRole('form', { name: 'Preparação da PET' });
    await user.selectOptions(screen.getByLabelText('Participante do atendimento'), 'worker-a');
    await user.selectOptions(screen.getByLabelText('Papel previsto para o participante'), 'WATCHER');
    await user.click(screen.getByRole('button', { name: 'Adicionar participante cadastrado' }));
    expect(screen.getByLabelText('Nome da pessoa 1')).toHaveValue('Ana Silva'); expect(screen.getByLabelText('Nome da pessoa 1')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Adicionar pessoa prevista' }));
    change('Nome da pessoa 2', 'Responsável de resgate'); change('Matrícula da pessoa 2', 'R-7'); change('Função no serviço da pessoa 2', 'Resgate');
    await user.selectOptions(screen.getByLabelText('Papel previsto da pessoa 2'), 'RESCUE');
    await user.click(screen.getByRole('checkbox', { name: PET_EQUIPMENT[0].label })); await user.click(screen.getByRole('checkbox', { name: PET_CONTROLS[0].label }));
    await user.selectOptions(screen.getByLabelText('Resposta da verificação 1'), 'NO'); change('Justificativa da verificação 1', 'Controle ainda precisa ser verificado.');
    await user.click(screen.getByRole('button', { name: 'Adicionar leitura atmosférica' }));
    change('Data e hora da leitura 1', '2099-10-09T14:10'); change('Instrumento da leitura 1', 'Detector de teste'); change('Responsável pela leitura 1', 'Técnico de teste');
    change('Oxigênio (%) da leitura 1', '20,9'); change('Monóxido de carbono (ppm) da leitura 1', '1200'); change('Inflamabilidade (% LIE) da leitura 1', '90');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(await screen.findByRole('heading', { name: 'PET salva' })).toBeInTheDocument();
    const payload = vi.mocked(api.post).mock.calls[0][1] as PetPreparationDto;
    expect(payload.people).toEqual(expect.arrayContaining([expect.objectContaining({ workerId: 'worker-a', role: 'WATCHER' }), expect.objectContaining({ name: 'Responsável de resgate', role: 'RESCUE' })]));
    expect(payload.atmosphere[0]).toMatchObject({ measuredAt: '2099-10-09T17:10:00.000Z', oxygenPercent: '20,9', carbonMonoxidePpm: '1200', flammabilityPercentLel: '90' });
    expect(payload.checks[0]).toMatchObject({ answer: 'NO', note: 'Controle ainda precisa ser verificado.' });
    expect(payload.equipment).toEqual([PET_EQUIPMENT[0].id]); expect(payload.controls).toEqual([PET_CONTROLS[0].id]);
    expect(api.post).toHaveBeenCalledOnce();
  });
  it('preserva os campos no conflito e só usa a revisão atual após decisão explícita', async () => {
    const user = userEvent.setup(); show('/app/pets/pet-a/editar');
    await screen.findByRole('form', { name: 'Preparação da PET' }); change('Identificação do espaço confinado', 'Meu espaço local');
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError(412, { code: 'REVISION_CONFLICT', message: 'Conflito', requestId: 'test' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(await screen.findByRole('button', { name: 'Conferir PET atual' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Salvar rascunho da PET' })).toBeDisabled();
    record = { ...record, revision: 8, preparation: { ...record.preparation, identification: { ...record.preparation.identification, spaceCode: 'Outro espaço' } } };
    await user.click(screen.getByRole('button', { name: 'Conferir PET atual' }));
    expect(await screen.findByText('PET atual · revisão 8')).toBeInTheDocument(); expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Meu espaço local');
    await user.click(screen.getByRole('button', { name: 'Usar revisão atual e manter preenchimento' }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(await screen.findByRole('heading', { name: 'PET salva' })).toBeInTheDocument();
    expect(vi.mocked(api.patch).mock.calls[0][2]?.etag).toBe('"2"'); expect(vi.mocked(api.patch).mock.calls[1][2]?.etag).toBe('"8"');
    expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({ identification: { spaceCode: 'Meu espaço local' } });
    expect(api.get).not.toHaveBeenCalledWith('/confined-space-permit-options', expect.anything());
  });
  it('mantém o bloqueio do conflito quando falha a consulta da revisão atual', async () => {
    const user = userEvent.setup(); show('/app/pets/pet-a/editar'); await screen.findByRole('form', { name: 'Preparação da PET' });
    change('Identificação do espaço confinado', 'Rascunho preservado'); vi.mocked(api.patch).mockRejectedValueOnce({ status: 412 });
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' })); await screen.findByRole('button', { name: 'Conferir PET atual' });
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Falha ao consultar a revisão.'));
    await user.click(screen.getByRole('button', { name: 'Conferir PET atual' }));
    expect(await screen.findByText('Falha ao consultar a revisão.')).toBeInTheDocument(); expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Rascunho preservado');
    expect(screen.getByRole('button', { name: 'Salvar rascunho da PET' })).toBeDisabled(); expect(api.patch).toHaveBeenCalledOnce();
  });
  it('preserva rascunho quando a consulta muda em segundo plano ou falha', async () => {
    const { client } = show('/app/pets/pet-a/editar'); await screen.findByRole('form', { name: 'Preparação da PET' }); change('Identificação do espaço confinado', 'Local digitado');
    record = { ...record, revision: 7, preparation: { ...record.preparation, identification: { ...record.preparation.identification, spaceCode: 'Texto concorrente' } } };
    await act(async () => { await client.refetchQueries({ queryKey: petKey('session-a', 'unit-a', 'pet-a') }); });
    expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Local digitado');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar rascunho da PET' })).toBeDisabled());
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Consulta indisponível.'));
    await act(async () => { await client.refetchQueries({ queryKey: petKey('session-a', 'unit-a', 'pet-a') }); });
    expect(screen.getByRole('form', { name: 'Preparação da PET' })).toBeInTheDocument(); expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Local digitado');
  });
  it('protege o preenchimento ao mudar de unidade e bloqueia a mudança enquanto salva', async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); show(); await screen.findByRole('form', { name: 'Preparação da PET' });
    change('Identificação do espaço confinado', 'EC-100');
    const changed = new Event('sesmt:before-context-change', { cancelable: true }); act(() => { window.dispatchEvent(changed); });
    expect(changed.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledOnce(); confirm.mockClear();
    let complete!: (value: ConfinedSpacePermitDto) => void; vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { complete = resolve as (value: ConfinedSpacePermitDto) => void; }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' })); await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const busyChange = new Event('sesmt:before-context-change', { cancelable: true }); act(() => { window.dispatchEvent(busyChange); });
    expect(busyChange.defaultPrevented).toBe(true); expect(confirm).not.toHaveBeenCalled(); expect(screen.getByLabelText('Identificação do espaço confinado')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    await act(async () => complete(record)); expect(await screen.findByRole('heading', { name: 'PET salva' })).toBeInTheDocument();
  });
  it('não armazena nem navega ao receber o salvamento de outra unidade', async () => {
    const user = userEvent.setup(); const { client } = show(); await screen.findByRole('form', { name: 'Preparação da PET' }); change('Identificação do espaço confinado', 'Meu registro');
    vi.mocked(api.post).mockResolvedValueOnce({ ...record, unitId: 'unit-b' }); await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(await screen.findByText('A resposta pertence a outro registro ou unidade. Seu preenchimento foi preservado.')).toBeInTheDocument(); expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Meu registro');
    expect(client.getQueryData(petKey('session-a', 'unit-a', 'pet-a'))).toBeUndefined(); expect(screen.queryByRole('heading', { name: 'PET salva' })).not.toBeInTheDocument();
  });
  it('cancela o pedido e ignora uma resposta tardia após desmontar o contexto', async () => {
    const user = userEvent.setup(); const { client, view } = show(); await screen.findByRole('form', { name: 'Preparação da PET' });
    let complete!: (value: ConfinedSpacePermitDto) => void; vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { complete = resolve as (value: ConfinedSpacePermitDto) => void; }));
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' })); await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const signal = vi.mocked(api.post).mock.calls[0][2]?.signal; view.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => complete(record)); expect(client.getQueryData(petKey('session-a', 'unit-a', 'pet-a'))).toBeUndefined();
  });
  it('valida apenas a integridade das leituras e as justificativas antes de salvar', async () => {
    const user = userEvent.setup(); show(); await screen.findByRole('form', { name: 'Preparação da PET' });
    await user.selectOptions(screen.getByLabelText('Resposta da verificação 1'), 'NA'); await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Justifique as respostas Não e Não aplicável'); expect(api.post).not.toHaveBeenCalled();
    change('Justificativa da verificação 1', 'Registro de preparação ainda incompleto.'); await user.click(screen.getByRole('button', { name: 'Adicionar leitura atmosférica' }));
    change('Oxigênio (%) da leitura 1', 'texto'); await user.click(screen.getByRole('button', { name: 'Salvar rascunho da PET' }));
    expect(screen.getByRole('alert')).toHaveTextContent('As leituras devem ser números finitos'); expect(api.post).not.toHaveBeenCalled();
  });
  it('não consulta nem exibe formulário sem permissão e não usa atendimento de outra unidade', async () => {
    state.permissions = []; const first = show(); expect(screen.getByText('Acesso restrito')).toBeInTheDocument(); expect(api.get).not.toHaveBeenCalled(); first.view.unmount();
    state.permissions = ['pet.write']; appointment = { ...appointment, unitId: 'unit-b' }; show(); await screen.findByLabelText('Atendimento da PET *');
    expect(screen.getByLabelText('Atendimento da PET *')).toHaveValue(''); expect(screen.queryByRole('form', { name: 'Preparação da PET' })).not.toBeInTheDocument();
  });
  it('mantém o rascunho ao desistir da navegação ou da troca de atendimento', async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(api.get).mockResolvedValueOnce({ appointments: [appointment, { ...appointment, id: 'appointment-b', code: 'AG-002', location: 'Reservatório B' }] });
    show(); await screen.findByRole('form', { name: 'Preparação da PET' }); change('Identificação do espaço confinado', 'Espaço em preenchimento');
    await user.selectOptions(screen.getByLabelText('Atendimento da PET *'), 'appointment-b');
    expect(confirm).toHaveBeenCalledOnce(); expect(screen.getByLabelText('Atendimento da PET *')).toHaveValue('appointment-a'); expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Espaço em preenchimento');
    await user.click(screen.getByRole('link', { name: 'Cancelar preenchimento' }));
    expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar preenchendo' })); expect(screen.getByLabelText('Identificação do espaço confinado')).toHaveValue('Espaço em preenchimento');
    await user.click(screen.getByRole('link', { name: 'Cancelar preenchimento' })); await user.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(await screen.findByRole('heading', { name: 'Rascunhos da PET' })).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
  });
});
