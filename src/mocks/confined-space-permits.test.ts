import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageDto, UserDto, WorkerDto } from '../shared/contracts';
import type { AppointmentDto } from '../shared/contracts/work-permits';
import type { ConfinedSpacePermitDto, PetOptionsDto, PetPreparationDto } from '../shared/contracts/confined-space-permits';
import { PET_SOURCE, createPetPreparation } from '../features/confined-space/model';
import { makePetDemo, PetDemoError, type PetDemoContext } from './confined-space-permits';

const companyId = 'company-demo';
const unitId = 'unit-demo';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
describe('PET draft mock', () => {
  let demo: ReturnType<typeof makePetDemo>;
  let appointment: AppointmentDto;
  let workers: WorkerDto[];
  let actor: PetDemoContext;
  beforeEach(() => {
    appointment = { id: 'appointment-demo', code: 'AGE-DEMO-1', companyId, unitId, teamId: 'team-demo', serviceTypeId: 'service-demo',
      location: 'Área de demonstração', startsAt: '2026-10-12T12:00:00Z', endsAt: '2026-10-12T20:00:00Z', responsibleId: 'technician-demo',
      participants: [{ workerId: 'worker-demo', name: 'Nome do atendimento', serviceFunction: 'Executante' }], teamName: 'Equipe Demo', responsibleName: 'Técnico Demo',
      serviceLabel: 'Inspeção Demo', status: 'CONFIRMED', revision: 1, availableActions: [], history: [] };
    workers = [{ id: 'worker-demo', registration: 'M-001', fullName: 'Pessoa Cadastrada Demo', companyId, unitId, sectorId: 'sector-demo', employmentType: 'CLT', admissionDate: '2020-01-01', status: 'ACTIVE', revision: 1 }];
    const user: UserDto = { id: 'technician-demo', displayName: 'Técnico Demo', email: 'demo@example.test', roles: ['TECHNICIAN'], status: 'ACTIVE', mfaRequired: false, revision: 1,
      scope: { companyIds: [companyId], unitIds: [unitId], sectorIds: [], teamIds: [], ownOnly: false } };
    actor = { user, workers, permissions: ['pet.read', 'pet.write'], checkUnit: value => { if (!user.scope.unitIds.includes(value)) throw new PetDemoError(403, 'FORBIDDEN', 'Fora do alcance.'); },
      appointment: async value => { if (value !== appointment.id) throw new PetDemoError(404, 'NOT_FOUND', 'Indisponível.'); return appointment; }, appointments: async () => [appointment] };
    demo = makePetDemo();
  });
  function call<T>(path: string, method = 'GET', input?: unknown, revision?: number, context = actor) {
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: { ...(input !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}) }, body: input !== undefined ? JSON.stringify(input) : undefined });
    return demo.route(request, url, url.pathname.replace('/api/v1', ''), context) as Promise<T>;
  }
  const listPath = `/confined-space-permits?unitId=${unitId}`;
  const optionsPath = `/confined-space-permit-options?unitId=${unitId}`;
  function preparation(): PetPreparationDto { return createPetPreparation(appointment); }
  function create(input: PetPreparationDto = preparation()) { return call<ConfinedSpacePermitDto>(listPath, 'POST', { ...input, appointmentId: appointment.id }); }
  function hold(path: string, method: string, input: unknown, revision?: number) {
    let resume!: () => void;
    const json = new Promise<unknown>(resolve => { resume = () => resolve(input); });
    const url = new URL(`http://localhost/api/v1${path}`);
    const request = new Request(url, { method, headers: revision === undefined ? {} : { 'If-Match': `"${revision}"` } });
    Object.defineProperty(request, 'json', { value: () => json });
    return { resume, result: demo.route(request, url, url.pathname.replace('/api/v1', ''), actor) };
  }

  it('distingue rotas e não oferece emissão, liberação, assinatura ou exclusão', async () => {
    expect(demo.handles('/confined-space-permits')).toBe(true);
    expect(demo.handles('/confined-space-permit-options')).toBe(true);
    expect(demo.handles('/work-authorizations')).toBe(false);
    const value = await create();
    for (const action of ['release', 'sign', 'close', 'authorize']) await expect(call(`/confined-space-permits/${value.id}/${action}?unitId=${unitId}`, 'POST', {}, 1)).rejects.toMatchObject({ status: 404 });
    await expect(call(`/confined-space-permits/${value.id}?unitId=${unitId}`, 'DELETE')).rejects.toMatchObject({ status: 404 });
    expect(value.status).toBe('DRAFT'); expect(value.availableActions).toEqual(['EDIT', 'PRINT']);
  });
  it('mantém preparação incompleta como rascunho e não altera atendimento ou PT vinculada', async () => {
    appointment.permitId = 'pt-existing'; appointment.status = 'ATTENDANCE_OPENED';
    const before = copy(appointment);
    const value = await create();
    expect(value.preparation).toEqual(preparation()); expect(value.revision).toBe(1);
    expect(value.snapshots).toHaveLength(1); expect(value.history[0].action).toBe('PET_DRAFT_CREATED');
    expect(appointment).toEqual(before);
  });
  it('verifica permissão antes de consumir corpo e exclui alcance pessoal de trabalhador', async () => {
    const url = new URL(`http://localhost/api/v1${listPath}`);
    const request = new Request(url, { method: 'POST' });
    const json = vi.fn(async () => ({})); Object.defineProperty(request, 'json', { value: json });
    actor.permissions = ['pet.read'];
    await expect(demo.route(request, url, '/confined-space-permits', actor)).rejects.toMatchObject({ status: 403 }); expect(json).not.toHaveBeenCalled();
    actor.permissions = ['pet.read', 'pet.write']; actor.user.scope.ownOnly = true;
    await expect(call(listPath)).rejects.toMatchObject({ status: 403 }); await expect(call(optionsPath)).rejects.toMatchObject({ status: 403 });
  });
  it('separa leitura e edição e exige unidade em todas as consultas', async () => {
    const value = await create(); actor.permissions = ['pet.read'];
    expect((await call<ConfinedSpacePermitDto>(`/confined-space-permits/${value.id}?unitId=${unitId}`)).availableActions).toEqual(['PRINT']);
    await expect(call(optionsPath)).rejects.toMatchObject({ status: 403 });
    await expect(call(`/confined-space-permits/${value.id}?unitId=${unitId}`, 'PATCH', value.preparation, 1)).rejects.toMatchObject({ status: 403 });
    for (const path of ['/confined-space-permits', `/confined-space-permits/${value.id}`]) await expect(call(path)).rejects.toMatchObject({ status: 422, field: 'unitId' });
  });
  it('opções incluem apenas atendimentos atuais confirmados/abertos dentro do alcance', async () => {
    const other = { ...appointment, id: 'other', unitId: 'other-unit' };
    const requested = { ...appointment, id: 'requested', status: 'REQUESTED' as const };
    const canceled = { ...appointment, id: 'canceled', status: 'CANCELED' as const };
    actor.appointments = async () => [appointment, other, requested, canceled];
    expect((await call<PetOptionsDto>(optionsPath)).appointments.map(value => value.id)).toEqual([appointment.id]);
    appointment.status = 'CANCELED';
    await expect(create()).rejects.toMatchObject({ code: 'INVALID_APPOINTMENT' });
  });
  it('nega empresa, equipe, setor e responsável fora do alcance com dados atuais do cadastro', async () => {
    const value = await create();
    for (const field of ['companyIds', 'teamIds', 'sectorIds'] as const) {
      const previous = actor.user.scope[field]; actor.user.scope[field] = ['outside'];
      await expect(call(`/confined-space-permits/${value.id}?unitId=${unitId}`)).rejects.toMatchObject({ status: 404 });
      expect((await call<PageDto<ConfinedSpacePermitDto>>(listPath)).items).toEqual([]);
      actor.user.scope[field] = previous;
    }
    appointment.responsibleId = 'other-responsible';
    await expect(call(`/confined-space-permits/${value.id}?unitId=${unitId}`)).rejects.toMatchObject({ status: 404 });
  });
  it('transferência posterior de participante oculta o registro sem confiar no snapshot', async () => {
    const value = await create(); workers[0].unitId = 'other-unit';
    await expect(call(`/confined-space-permits/${value.id}?unitId=${unitId}`)).rejects.toMatchObject({ status: 404 });
    expect((await call<PageDto<ConfinedSpacePermitDto>>(listPath)).total).toBe(0);
  });
  it('não adivinha empresa se o atendimento omitir o vínculo e houver escopo múltiplo', async () => {
    delete appointment.companyId; actor.user.scope.companyIds.push('another-company');
    await expect(create()).rejects.toMatchObject({ code: 'APPOINTMENT_COMPANY_MISSING' });
    expect((await call<PetOptionsDto>(optionsPath)).appointments).toEqual([]);
  });
  it('usa a única empresa de um contexto antigo sem mudar o snapshot original', async () => {
    delete appointment.companyId;
    const value = await create(); expect(value.companyId).toBe(companyId);
    const originalLocation = value.appointment.location;
    appointment.location = 'Local atualizado no atendimento';
    expect((await call<ConfinedSpacePermitDto>(`/confined-space-permits/${value.id}?unitId=${unitId}`)).appointment.location).toBe(originalLocation);
  });
  it('reverifica alcance depois de uma consulta de atendimento atrasada', async () => {
    const value = await create();
    let resume!: () => void;
    const pendingAppointment = new Promise<AppointmentDto>(resolve => { resume = () => resolve(appointment); });
    actor.appointment = () => pendingAppointment;
    const pending = call(`/confined-space-permits/${value.id}?unitId=${unitId}`);
    actor.user.scope.companyIds = ['outside'];
    const failure = expect(pending).rejects.toMatchObject({ status: 404 }); resume(); await failure;
  });
  it('usa fonte e perguntas canônicas mesmo diante de campos forjados', async () => {
    const input = { ...preparation(), sourceId: 'FORGED', status: 'AUTHORIZED', revision: 88,
      checks: preparation().checks.map(value => ({ ...value, label: 'Texto adulterado', section: 'Outro', sourceCell: 'A1' })) };
    const value = await create(input);
    expect(value.sourceId).toBe(PET_SOURCE.sourceId); expect(value.sourceRevision).toBe(PET_SOURCE.sourceRevision); expect(value.sourceSha256).toBe(PET_SOURCE.sourceSha256);
    expect(value.status).toBe('DRAFT'); expect(value.revision).toBe(1);
    expect(value.preparation.checks[0].label).toBe(PET_SOURCE.checks[0].label); expect(value.preparation.checks[0].sourceCell).toBe(PET_SOURCE.checks[0].sourceCell);
  });
  it('pessoas vinculadas recebem nome e matrícula do cadastro e não aceitam outro alcance', async () => {
    const input = preparation(); input.people = [{ id: 'person-1', workerId: workers[0].id, name: 'Nome forjado', registration: 'forjada', serviceFunction: 'Executante', role: 'ENTRANT' }];
    const value = await create(input);
    expect(value.preparation.people[0]).toMatchObject({ workerId: workers[0].id, name: workers[0].fullName, registration: workers[0].registration });
    input.people[0].workerId = 'unknown'; await expect(create(input)).rejects.toMatchObject({ code: 'INVALID_PERSON_ASSIGNMENT' });
  });
  it('preserva snapshots e clona respostas, mesmo quando o consumidor altera objetos', async () => {
    const original = await create(); const oldTask = original.preparation.identification.task;
    const input = copy(original.preparation); input.identification.task = 'Novo planejamento em rascunho';
    const saved = await call<ConfinedSpacePermitDto>(`/confined-space-permits/${original.id}?unitId=${unitId}`, 'PATCH', input, 1);
    expect(saved.revision).toBe(2); expect(saved.snapshots.map(value => value.revision)).toEqual([1, 2]);
    expect(saved.snapshots[0].preparation.identification.task).toBe(oldTask); expect(saved.snapshots[1].preparation.identification.task).toBe(input.identification.task);
    saved.preparation.identification.task = 'Mutação externa'; saved.snapshots[0].preparation.identification.task = 'Snapshot adulterado';
    const current = await call<ConfinedSpacePermitDto>(`/confined-space-permits/${original.id}?unitId=${unitId}`);
    expect(current.preparation.identification.task).toBe(input.identification.task); expect(current.snapshots[0].preparation.identification.task).toBe(oldTask);
    expect(current.history.map(value => value.action)).toEqual(['PET_DRAFT_CREATED', 'PET_DRAFT_UPDATED']);
  });
  it('exige If-Match e rejeita gravação concorrente tardia sem apagar revisão mais recente', async () => {
    const value = await create(); const path = `/confined-space-permits/${value.id}?unitId=${unitId}`;
    await expect(call(path, 'PATCH', value.preparation)).rejects.toMatchObject({ status: 428 });
    const pendingInput = copy(value.preparation); pendingInput.identification.notes = 'Preenchimento antigo';
    const pending = hold(path, 'PATCH', pendingInput, 1);
    const currentInput = copy(value.preparation); currentInput.identification.notes = 'Preenchimento atual';
    await call(path, 'PATCH', currentInput, 1);
    const failure = expect(pending.result).rejects.toMatchObject({ status: 412 }); pending.resume(); await failure;
    expect((await call<ConfinedSpacePermitDto>(path)).preparation.identification.notes).toBe('Preenchimento atual');
  });
  it('reverifica permissão e estado depois de aguardar o corpo do rascunho', async () => {
    const pending = hold(listPath, 'POST', { ...preparation(), appointmentId: appointment.id });
    actor.permissions = ['pet.read']; const failure = expect(pending.result).rejects.toMatchObject({ status: 403 }); pending.resume(); await failure;
    actor.permissions = ['pet.read', 'pet.write'];
    const value = await create(); const path = `/confined-space-permits/${value.id}?unitId=${unitId}`;
    const edit = hold(path, 'PATCH', value.preparation, 1);
    // Let the initial detail lookup reach the delayed body before changing the current appointment.
    await Promise.resolve(); await Promise.resolve();
    appointment.status = 'CANCELED'; const invalid = expect(edit.result).rejects.toMatchObject({ code: 'INVALID_APPOINTMENT' }); edit.resume(); await invalid;
    expect((await call<ConfinedSpacePermitDto>(path)).revision).toBe(1);
  });
  it('proíbe trocar o atendimento por meio do PATCH', async () => {
    const value = await create();
    await expect(call(`/confined-space-permits/${value.id}?unitId=${unitId}`, 'PATCH', { ...value.preparation, appointmentId: 'replacement' }, 1)).rejects.toMatchObject({ code: 'IMMUTABLE_APPOINTMENT' });
  });
  it('transferência durante uma gravação pendente impede salvar com alcance antigo', async () => {
    const value = await create(); const path = `/confined-space-permits/${value.id}?unitId=${unitId}`;
    const pending = hold(path, 'PATCH', value.preparation, 1);
    await Promise.resolve(); await Promise.resolve();
    workers[0].unitId = 'other-unit';
    const failure = expect(pending.result).rejects.toMatchObject({ status: 404 }); pending.resume(); await failure;
    workers[0].unitId = unitId;
    expect((await call<ConfinedSpacePermitDto>(path)).revision).toBe(1);
  });
  it('rejeita JSON inválido e pergunta ausente mantendo a coleção vazia', async () => {
    await expect(create({ ...preparation(), checks: [] })).rejects.toMatchObject({ status: 422 });
    const url = new URL(`http://localhost/api/v1${listPath}`); const request = new Request(url, { method: 'POST', body: '{broken' });
    await expect(demo.route(request, url, '/confined-space-permits', actor)).rejects.toMatchObject({ status: 422 });
    expect((await call<PageDto<ConfinedSpacePermitDto>>(listPath)).total).toBe(0);
  });
  it('pagina resultados, normaliza busca por acentos e valida filtros da URL', async () => {
    const first = await create(); const input = preparation(); input.identification.spaceDescription = 'Espaço Tanque Industrial'; await create(input);
    const page = await call<PageDto<ConfinedSpacePermitDto>>(`${listPath}&page=2&pageSize=1`);
    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 2 }); expect(page.items).toHaveLength(1);
    expect((await call<PageDto<ConfinedSpacePermitDto>>(`${listPath}&q=espaco`)).total).toBe(1);
    expect((await call<PageDto<ConfinedSpacePermitDto>>(`${listPath}&q=${first.code}`)).items[0].id).toBe(first.id);
    for (const query of ['page=Infinity', 'page=0', 'page=1.5', 'page=9007199254740992', 'pageSize=101', 'pageSize=-1']) await expect(call(`${listPath}&${query}`)).rejects.toMatchObject({ status: 422 });
    await expect(call(`${listPath}&q=${'a'.repeat(201)}`)).rejects.toMatchObject({ status: 422, field: 'q' });
  });
});
