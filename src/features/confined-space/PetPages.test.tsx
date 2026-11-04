import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageDto } from '../../shared/contracts';
import type { ConfinedSpacePermitDto } from '../../shared/contracts/confined-space-permits';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { api, ApiError } from '../../shared/api/client';
import { PetsPage } from './PetsPage';
import { PetDetailPage } from './PetDetailPage';
import { PetPrintPage } from './PetPrintPage';
import { PetFormPage } from './PetFormPage';
import { PET_SOURCE, createPetPreparation } from './model';

const state = vi.hoisted(() => ({ unitId: 'unit-a', sessionKey: 'session-a', permissions: ['pet.read', 'pet.write', 'appointments.read'] }));
vi.mock('../../shared/auth/SessionProvider', () => ({ useSession: () => ({ unitId: state.unitId, sessionKey: state.sessionKey, can: (permission: string) => state.permissions.includes(permission) }) }));
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
let record: ConfinedSpacePermitDto;
function example(): ConfinedSpacePermitDto {
  const appointment: AppointmentDto = { id: 'appointment-a', code: 'AGE-101', companyId: 'company-a', unitId: 'unit-a', teamId: 'team-a', teamName: 'Equipe de teste', serviceTypeId: 'service-a', serviceLabel: 'Inspeção de tanque', location: 'Área de teste', startsAt: '2099-10-11T12:00:00Z', endsAt: '2099-10-11T14:00:00Z', responsibleId: 'operator-a', responsibleName: 'Operador de teste', participants: [], status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
  const current = createPetPreparation(appointment), historical = createPetPreparation(appointment);
  current.identification.spaceCode = 'EC-ATUAL'; current.identification.task = 'Tarefa da revisão atual'; current.identification.notes = 'Observação atual';
  historical.identification.spaceCode = 'EC-HISTORICO'; historical.identification.task = 'Tarefa da primeira revisão'; historical.identification.notes = 'Observação histórica';
  historical.people = [{ id: 'historical-person', role: 'WATCHER', name: 'Vigia da primeira revisão', registration: 'VIGIA-001', serviceFunction: 'Vigilância prevista' }];
  historical.atmosphere = [{ id: 'historical-reading', phase: 'INITIAL', measuredAt: '2026-10-11T11:55:00Z', instrument: 'Detector da primeira revisão', responsibleName: 'Responsável da primeira revisão', oxygenPercent: '20,9', carbonMonoxidePpm: '7', flammabilityPercentLel: '2', otherAgent: '', otherValue: '', otherUnit: '', notes: 'Registro histórico da leitura' }];
  return { id: 'pet-a', code: 'PET-101', companyId: 'company-a', unitId: 'unit-a', revision: 2, status: 'DRAFT', appointment, preparation: current,
    sourceId: PET_SOURCE.sourceId, sourceRevision: PET_SOURCE.sourceRevision, sourceSha256: PET_SOURCE.sourceSha256, availableActions: ['EDIT'],
    history: [{ id: 'created', action: 'PET_DRAFT_CREATED', actorName: 'Autor da primeira revisão', occurredAt: '2026-10-11T12:00:00Z', version: 1 }, { id: 'updated', action: 'PET_DRAFT_UPDATED', actorName: 'Autor da revisão atual', occurredAt: '2026-10-11T13:00:00Z', version: 2 }],
    snapshots: [{ revision: 1, preparation: historical, savedAt: '2026-10-11T12:00:00Z', actorName: 'Autor da primeira revisão' }, { revision: 2, preparation: current, savedAt: '2026-10-11T13:00:00Z', actorName: 'Autor da revisão atual' }],
    createdAt: '2026-10-11T12:00:00Z', createdByName: 'Autor da primeira revisão', updatedAt: '2026-10-11T13:00:00Z' };
}
function LocationProbe() { const location = useLocation(); return <output aria-label="Endereço atual">{location.pathname}{location.search}</output>; }
function ConsultationEntry() { const location = useLocation(); return <><h1>Consulta central</h1><Link to="/app/pets/pet-a" state={{ fromConsulta: true, fromSearch: location.search, fromUnitId: state.unitId }}>Consultar PET da central</Link></>; }
function show(route = '/app/pets/pet-a', navigationState?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[{ pathname: route.split('?')[0], search: route.includes('?') ? `?${route.split('?').slice(1).join('?')}` : '', state: navigationState }]}><LocationProbe /><Routes>
    <Route path="/app/consulta" element={<ConsultationEntry />} /><Route path="/app/pets" element={<PetsPage />} /><Route path="/app/pets/nova" element={<PetFormPage />} /><Route path="/app/pets/:id" element={<PetDetailPage />} /><Route path="/app/pets/:id/editar" element={<PetFormPage />} /><Route path="/app/pets/:id/imprimir" element={<PetPrintPage />} />
  </Routes></MemoryRouter></QueryClientProvider>;
  const view = render(tree()); return { client, view, rerender: () => view.rerender(tree()) };
}
beforeEach(() => {
  vi.clearAllMocks(); state.unitId = 'unit-a'; state.sessionKey = 'session-a'; state.permissions = ['pet.read', 'pet.write', 'appointments.read']; record = example();
  vi.mocked(api.get).mockImplementation(async (path, config) => {
    if (path === '/confined-space-permit-options') return { appointments: [structuredClone(record.appointment)] } as never;
    if (path !== '/confined-space-permits') return structuredClone(record) as never;
    const page = Number(config?.query?.page || 1), q = String(config?.query?.q || '').toLocaleLowerCase('pt-BR');
    const rows = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(record), id: `pet-${index + 1}`, code: `PET-${101 + index}` }));
    const filtered = rows.filter(item => `${item.code} ${item.preparation.identification.spaceCode} ${item.preparation.identification.task}`.toLocaleLowerCase('pt-BR').includes(q));
    return { items: filtered.slice((page - 1) * 10, page * 10), page, pageSize: 10, total: filtered.length } as PageDto<ConfinedSpacePermitDto> as never;
  });
});

describe('consulta, versões e impressão da preparação PET', { timeout: 15000 }, () => {
  it('preserva filtros da central ao abrir PET, mudar revisão, imprimir e retornar', async () => {
    const user = userEvent.setup(); const centralPath = '/app/consulta?tab=pets&q=tanque&page=2&unitId=unit-a'; show(centralPath);
    await user.click(screen.getByRole('link', { name: 'Consultar PET da central' })); await screen.findByRole('heading', { name: 'PET-101' });
    expect(screen.getByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', centralPath);
    await user.selectOptions(screen.getByLabelText('Revisão da preparação'), '1'); await user.click(screen.getByRole('link', { name: 'Visualizar / imprimir rascunho' }));
    const article = await screen.findByRole('article', { name: 'Rascunho imprimível da PET' }); expect(article).toHaveTextContent('EC-HISTORICO'); expect(article).not.toHaveTextContent('EC-ATUAL');
    await user.click(screen.getByRole('link', { name: 'Voltar à PET' })); await screen.findByRole('heading', { name: 'PET-101' }); expect(screen.getByLabelText('Revisão da preparação')).toHaveValue('1');
    await user.click(screen.getByRole('link', { name: 'Voltar à consulta' })); await screen.findByRole('heading', { name: 'Consulta central' }); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(centralPath);
    expect(api.patch).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('preserva retorno à central ao editar e salvar a preparação sem autorizar entrada', async () => {
    const user = userEvent.setup(); const centralPath = '/app/consulta?tab=pets&q=reservat%C3%B3rio&page=3&unitId=unit-a'; show(centralPath);
    vi.mocked(api.patch).mockImplementationOnce(async (_path, input) => {
      record = { ...record, revision: record.revision + 1, preparation: input as ConfinedSpacePermitDto['preparation'] };
      record.snapshots = [...record.snapshots, { revision: record.revision, preparation: structuredClone(record.preparation), savedAt: record.updatedAt, actorName: 'Autor da atualização' }];
      return structuredClone(record) as never;
    });
    await user.click(screen.getByRole('link', { name: 'Consultar PET da central' })); await screen.findByRole('heading', { name: 'PET-101' }); await user.click(screen.getByRole('link', { name: 'Editar preparação' }));
    await screen.findByRole('form', { name: 'Preparação da PET' }); const task = screen.getByLabelText('Objetivo da entrada / tarefa prevista'); await user.clear(task); await user.type(task, 'Tarefa editada a partir da central');
    const save = screen.getByRole('button', { name: 'Salvar rascunho da PET' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() => expect(api.patch).toHaveBeenCalledOnce());
    await screen.findByRole('heading', { name: 'PET-101' });
    expect(screen.getByRole('article', { name: 'Preparação da PET' })).toHaveTextContent('Tarefa editada a partir da central'); expect(screen.getByText('Rascunho da PET salvo. Este registro não autoriza a entrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', centralPath); await user.click(screen.getByRole('link', { name: 'Voltar à consulta' }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(centralPath); expect(api.patch).toHaveBeenCalledOnce(); expect(api.post).not.toHaveBeenCalled();
  });
  it('conserva origem da central após recuperar revisão inválida e rejeita origem de outra unidade', async () => {
    const user = userEvent.setup(); const fromSearch = '?tab=pets&q=tanque&page=2&unitId=unit-a'; const first = show('/app/pets/pet-a?revision=999', { fromConsulta: true, fromSearch, fromUnitId: 'unit-a' });
    await user.click(await screen.findByRole('button', { name: 'Consultar revisão atual' })); await screen.findByRole('heading', { name: 'PET-101' }); expect(screen.getByRole('link', { name: 'Voltar à consulta' })).toHaveAttribute('href', `/app/consulta${fromSearch}`); first.view.unmount();
    show('/app/pets/pet-a', { fromConsulta: true, fromSearch: '?tab=pets&q=outra-unidade', fromUnitId: 'unit-b' }); await screen.findByRole('heading', { name: 'PET-101' });
    expect(screen.queryByRole('link', { name: 'Voltar à consulta' })).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Voltar às PETs' })).toHaveAttribute('href', '/app/pets');
  });
  it('retorna aos critérios da central ao descartar nova preparação', async () => {
    const user = userEvent.setup(); const fromSearch = '?tab=pets&q=novo&page=2&unitId=unit-a';
    show('/app/pets/nova?appointmentId=appointment-a', { fromConsulta: true, fromSearch, fromUnitId: 'unit-a' }); await screen.findByRole('form', { name: 'Preparação da PET' });
    expect(screen.getByRole('link', { name: 'Voltar' })).toHaveAttribute('href', `/app/consulta${fromSearch}`);
    await user.click(screen.getByRole('link', { name: 'Cancelar preenchimento' })); await screen.findByRole('dialog', { name: 'Alterações não salvas' }); await user.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    await screen.findByRole('heading', { name: 'Consulta central' }); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(`/app/consulta${fromSearch}`); expect(api.post).not.toHaveBeenCalled();
  });
  it('consulta o atual com edição autorizada, impressão da revisão explícita e contexto da unidade', async () => {
    show(); await screen.findByRole('heading', { name: 'PET-101' });
    expect(screen.getByRole('link', { name: 'Editar preparação' })).toHaveAttribute('href', '/app/pets/pet-a/editar');
    expect(screen.getByRole('link', { name: 'Visualizar / imprimir rascunho' })).toHaveAttribute('href', '/app/pets/pet-a/imprimir?revision=2');
    expect(screen.getByRole('link', { name: /Consultar atendimento de origem/ })).toHaveAttribute('href', '/app/agenda/appointment-a');
    const article = screen.getByRole('article', { name: 'Preparação da PET' }); expect(article).toHaveTextContent('EC-ATUAL'); expect(article).not.toHaveTextContent('EC-HISTORICO');
    expect(api.get).toHaveBeenCalledWith('/confined-space-permits/pet-a', expect.objectContaining({ query: { unitId: 'unit-a' }, signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/Rascunho de preparação · entrada não autorizada/)).toBeInTheDocument();
  });
  it('usa a preparação histórica completa sem misturar os dados nem eventos posteriores', async () => {
    const user = userEvent.setup(); show('/app/pets/pet-a?revision=1'); await screen.findByRole('heading', { name: 'PET-101' });
    const article = screen.getByRole('article', { name: 'Preparação da PET' });
    expect(article).toHaveTextContent('EC-HISTORICO'); expect(article).toHaveTextContent('Observação histórica'); expect(article).toHaveTextContent('Vigia da primeira revisão'); expect(article).toHaveTextContent('Detector da primeira revisão');
    expect(article).not.toHaveTextContent('EC-ATUAL'); expect(article).not.toHaveTextContent('Observação atual'); expect(screen.queryByText('Preparação atualizada')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar preparação' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Revisão da preparação')).toHaveValue('1');
    expect(screen.getByRole('link', { name: 'Visualizar / imprimir rascunho' })).toHaveAttribute('href', '/app/pets/pet-a/imprimir?revision=1');
    await user.selectOptions(screen.getByLabelText('Revisão da preparação'), '2');
    expect(screen.getByRole('article', { name: 'Preparação da PET' })).toHaveTextContent('EC-ATUAL'); expect(screen.getByRole('link', { name: 'Editar preparação' })).toBeInTheDocument(); expect(screen.getByText('Preparação atualizada')).toBeInTheDocument();
  });
  it.each(['99', '0', 'Infinity', '1.5', '9007199254740992', ''])('não substitui revisão inexistente ou inválida por atual: %s', async revision => {
    const user = userEvent.setup(); show(`/app/pets/pet-a?revision=${revision}`);
    await screen.findByText('Revisão não encontrada'); expect(screen.queryByRole('article', { name: 'Preparação da PET' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar preparação' })).not.toBeInTheDocument(); expect(screen.queryByText('EC-ATUAL')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Consultar revisão atual' })); expect(await screen.findByRole('article', { name: 'Preparação da PET' })).toHaveTextContent('EC-ATUAL');
  });
  it('perfil somente leitura consulta e imprime sem exibir edição ou contextos sem permissão', async () => {
    state.permissions = ['pet.read']; show(); await screen.findByRole('heading', { name: 'PET-101' });
    expect(screen.queryByRole('link', { name: 'Editar preparação' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Consultar atendimento de origem/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Visualizar / imprimir rascunho' })).toBeInTheDocument(); expect(api.patch).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('não exibe uma preparação retornada para outra unidade', async () => {
    record.unitId = 'unit-b'; show(); expect(await screen.findByText('PET de outra unidade')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Preparação da PET' })).not.toBeInTheDocument(); expect(screen.queryByRole('heading', { name: 'PET-101' })).not.toBeInTheDocument();
  });
  it('imprime o snapshot histórico com autoria e leituras daquele salvamento', async () => {
    state.permissions = ['pet.read']; show('/app/pets/pet-a/imprimir?revision=1');
    const article = await screen.findByRole('article', { name: 'Rascunho imprimível da PET' });
    expect(article).toHaveTextContent('Revisão do rascunho 1'); expect(article).toHaveTextContent('EC-HISTORICO'); expect(article).toHaveTextContent('Autor da primeira revisão');
    expect(article).toHaveTextContent('Vigia da primeira revisão'); expect(article).toHaveTextContent('Detector da primeira revisão'); expect(article).toHaveTextContent('Registro histórico da leitura');
    expect(article).not.toHaveTextContent('EC-ATUAL'); expect(article).not.toHaveTextContent('Observação atual'); expect(article).not.toHaveTextContent('Autor da revisão atual');
    expect(article).toHaveTextContent('RASCUNHO DE PREPARAÇÃO · NÃO EMITIDO · ENTRADA NÃO AUTORIZADA'); expect(article).toHaveTextContent(PET_SOURCE.sourceSha256);
    expect(screen.getByRole('link', { name: 'Voltar à PET' })).toHaveAttribute('href', '/app/pets/pet-a?revision=1');
    expect(screen.queryByRole('button', { name: /Liberar|Emitir|Autorizar entrada/ })).not.toBeInTheDocument();
  });
  it('invoca impressão somente pelo botão e restaura o título da aplicação ao sair', async () => {
    const user = userEvent.setup(), print = vi.spyOn(window, 'print').mockImplementation(() => {}); const originalTitle = document.title;
    const { view } = show('/app/pets/pet-a/imprimir?revision=2'); await screen.findByRole('article', { name: 'Rascunho imprimível da PET' });
    expect(document.title).toBe('PET-101 — rascunho 2 — Ampara SESMT'); expect(print).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Imprimir \/ salvar PDF/ })); expect(print).toHaveBeenCalledOnce(); view.unmount(); expect(document.title).toBe(originalTitle);
  });
  it('revisão de impressão inexistente não produz artigo imprimível ou botão de impressão', async () => {
    show('/app/pets/pet-a/imprimir?revision=99'); await screen.findByText('Revisão não encontrada');
    expect(screen.queryByRole('article', { name: 'Rascunho imprimível da PET' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Imprimir \/ salvar PDF/ })).not.toBeInTheDocument();
    expect(screen.queryByText('EC-ATUAL')).not.toBeInTheDocument();
  });
  it('mostra erros com tentativa explícita de recarregar e sem dados da preparação', async () => {
    const user = userEvent.setup(); vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, { code: 'NOT_FOUND', message: 'Indisponível', requestId: 'test' })); show();
    expect(await screen.findByText('Preparação de PET não encontrada ou fora da unidade selecionada.')).toBeInTheDocument(); expect(screen.queryByRole('article', { name: 'Preparação da PET' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' })); expect(await screen.findByRole('heading', { name: 'PET-101' })).toBeInTheDocument();
  });
});

describe('lista de preparações PET', { timeout: 15000 }, () => {
  it('preserva a busca e a página da lista ao consultar, mudar revisão e imprimir', async () => {
    const user = userEvent.setup();
    show('/app/pets?q=PET&page=2&unitId=unit-a');
    const link = await screen.findByRole('link', { name: 'PET-111' });
    // The list fixture has twelve IDs; return the matching detail for the opened result.
    record.id = 'pet-11'; record.code = 'PET-111';
    await user.click(link);
    await screen.findByRole('heading', { name: 'PET-111' });
    const returnToList = '/app/pets?q=PET&page=2&unitId=unit-a';
    expect(screen.getByRole('link', { name: 'Voltar às PETs' })).toHaveAttribute('href', returnToList);
    await user.selectOptions(screen.getByLabelText('Revisão da preparação'), '1');
    await user.click(screen.getByRole('link', { name: 'Visualizar / imprimir rascunho' }));
    await screen.findByRole('article', { name: 'Rascunho imprimível da PET' });
    await user.click(screen.getByRole('link', { name: 'Voltar à PET' }));
    await screen.findByRole('heading', { name: 'PET-111' });
    expect(screen.getByLabelText('Revisão da preparação')).toHaveValue('1');
    await user.click(screen.getByRole('link', { name: 'Voltar às PETs' }));
    expect(await screen.findByRole('link', { name: 'PET-111' })).toBeInTheDocument();
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent(returnToList);
    expect(screen.getByLabelText('Buscar PET por código, espaço ou tarefa')).toHaveValue('PET');
  });
  it('não reaproveita critérios de uma unidade anterior', async () => {
    show('/app/pets/pet-a', { fromPreparationList: 'pets', fromUnitId: 'unit-b', fromSearch: '?q=segredo&page=2&unitId=unit-b' });
    await screen.findByRole('heading', { name: 'PET-101' });
    expect(screen.getByRole('link', { name: 'Voltar às PETs' })).toHaveAttribute('href', '/app/pets');
  });
  it.each(['id', 'appointment'])('não revela registro quando a identidade de %s diverge da rota ou unidade', async field => {
    if (field === 'id') record.id = 'other-pet'; else record.appointment.unitId = 'unit-b';
    show('/app/pets/pet-a');
    await screen.findByText('PET de outra unidade');
    expect(screen.queryByRole('article', { name: 'Preparação da PET' })).not.toBeInTheDocument();
  });
  it('busca por envio explícito, preserva o contexto e reinicia a paginação', async () => {
    const user = userEvent.setup(); show('/app/pets?page=2&unitId=unit-a');
    await screen.findByRole('link', { name: 'PET-111' }); expect(screen.queryByRole('link', { name: 'PET-101' })).not.toBeInTheDocument();
    const search = screen.getByLabelText('Buscar PET por código, espaço ou tarefa'); await user.type(search, '  PET-105  ');
    expect(api.get).not.toHaveBeenCalledWith('/confined-space-permits', expect.objectContaining({ query: expect.objectContaining({ q: 'PET-105' }) }));
    await user.click(screen.getByRole('button', { name: 'Buscar' })); expect(await screen.findByRole('link', { name: 'PET-105' })).toHaveAttribute('href', '/app/pets/pet-5');
    expect(api.get).toHaveBeenLastCalledWith('/confined-space-permits', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: 'PET-105' } }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-a'); expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Limpar busca' })); await screen.findByRole('link', { name: 'PET-101' }); expect(search).toHaveValue('');
    expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('q=');
  });
  it('pagina os resultados consultando a API e permite retorno à página anterior', async () => {
    const user = userEvent.setup(); show('/app/pets'); await screen.findByRole('link', { name: 'PET-101' });
    expect(within(screen.getByRole('region', { name: 'Preparações de PET' })).getAllByRole('article')).toHaveLength(10); expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Próxima' })); await screen.findByRole('link', { name: 'PET-111' });
    expect(within(screen.getByRole('region', { name: 'Preparações de PET' })).getAllByRole('article')).toHaveLength(2); expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(api.get).toHaveBeenLastCalledWith('/confined-space-permits', expect.objectContaining({ query: { unitId: 'unit-a', page: 2, pageSize: 10, q: '' } }));
    await user.click(screen.getByRole('button', { name: 'Anterior' })); expect(await screen.findByRole('link', { name: 'PET-101' })).toBeInTheDocument();
  });
  it.each(['Infinity', '1.5', '0', '-1', '9007199254740992'])('normaliza paginação inválida %s antes de consultar a API', async page => {
    show(`/app/pets?page=${page}`); await screen.findByRole('link', { name: 'PET-101' });
    expect(api.get).toHaveBeenCalledWith('/confined-space-permits', expect.objectContaining({ query: expect.objectContaining({ page: 1 }) })); expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });
  it('recupera uma página vazia sem perder a busca atual', async () => {
    const user = userEvent.setup(); show('/app/pets?page=9&q=PET-105&unitId=unit-a'); await screen.findByText('Nenhuma preparação de PET encontrada');
    await user.click(screen.getByRole('button', { name: 'Primeira página' })); expect(await screen.findByRole('link', { name: 'PET-105' })).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar PET por código, espaço ou tarefa')).toHaveValue('PET-105'); expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('q=PET-105');
  });
  it('reinicia a página quando o endereço veio de outra unidade e consulta somente a selecionada', async () => {
    show('/app/pets?page=2&unitId=unit-b&q=PET'); await screen.findByRole('link', { name: 'PET-101' });
    expect(api.get).toHaveBeenCalledWith('/confined-space-permits', expect.objectContaining({ query: { unitId: 'unit-a', page: 1, pageSize: 10, q: 'PET' } }));
    expect(api.get).not.toHaveBeenCalledWith('/confined-space-permits', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b' }) }));
    expect(screen.getByLabelText('Endereço atual')).toHaveTextContent('unitId=unit-a'); expect(screen.getByLabelText('Endereço atual')).not.toHaveTextContent('page=2');
  });
  it('troca a unidade sem conservar a lista no cache da identidade anterior', async () => {
    const { rerender } = show('/app/pets'); await screen.findByRole('link', { name: 'PET-101' });
    vi.mocked(api.get).mockImplementation(async () => ({ items: [], total: 0, page: 1, pageSize: 10 }) as never);
    state.unitId = 'unit-b'; state.sessionKey = 'session-b'; act(() => rerender()); await screen.findByText('Nenhuma preparação de PET encontrada');
    expect(screen.queryByRole('link', { name: 'PET-101' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/confined-space-permits', expect.objectContaining({ query: expect.objectContaining({ unitId: 'unit-b' }) })));
  });
  it('oculta criação no perfil de leitura e não consulta a API sem unidade ou permissão', async () => {
    state.permissions = ['pet.read']; const first = show('/app/pets'); await screen.findByRole('link', { name: 'PET-101' }); expect(screen.queryByRole('link', { name: 'Nova PET' })).not.toBeInTheDocument(); first.view.unmount();
    vi.clearAllMocks(); state.unitId = ''; const second = show('/app/pets'); await screen.findByText('Selecione uma unidade'); expect(api.get).not.toHaveBeenCalled(); second.view.unmount();
    state.unitId = 'unit-a'; state.permissions = []; show('/app/pets'); await screen.findByText('Acesso restrito'); expect(api.get).not.toHaveBeenCalled();
  });
});
