/** PET preparation is a synthetic in-memory draft. It never authorizes entry or changes a PT/AT. */
import type { PageDto, UserDto, WorkerDto } from '../shared/contracts';
import type { AppointmentDto, PermitEventDto } from '../shared/contracts/work-permits';
import type { ConfinedSpacePermitDto, PetCreateDto, PetOptionsDto, PetPreparationDto } from '../shared/contracts/confined-space-permits';
import { PET_SOURCE, canonicalPetPreparation, createPetPreparation, validatePetPreparation } from '../features/confined-space/model';

export interface PetDemoContext {
  user: UserDto;
  permissions: string[];
  workers: WorkerDto[];
  checkUnit: (unitId: string) => void;
  appointment: (id: string) => Promise<AppointmentDto>;
  appointments: () => Promise<AppointmentDto[]>;
}
export class PetDemoError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}
function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PetDemoError(status, code, message, field);
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const instant = () => new Date().toISOString();
const normalized = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const availableAppointment = (value: AppointmentDto) => ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(value.status);
function permission(context: PetDemoContext, name: string) {
  assert(context.permissions.includes(name) && !context.user.scope.ownOnly, 403, 'FORBIDDEN', 'Seu perfil não permite esta ação na PET.');
}
function revision(request: Request, value: ConfinedSpacePermitDto) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue o rascunho antes de alterar.');
  assert(request.headers.get('If-Match') === `"${value.revision}"`, 412, 'REVISION_CONFLICT', 'Este rascunho mudou. Recarregue e confira a revisão atual.');
}
function queryUnit(url: URL, context: PetDemoContext) {
  const unitId = url.searchParams.get('unitId');
  assert(unitId, 422, 'VALIDATION_FAILED', 'Selecione a unidade da PET.', 'unitId');
  assert(context.user.scope.unitIds.includes(unitId), 403, 'FORBIDDEN', 'Unidade fora do seu alcance.');
  context.checkUnit(unitId);
  return unitId;
}
function company(appointment: AppointmentDto, context: PetDemoContext) {
  // A single scoped company is the only unambiguous fallback for older demo appointments.
  const companyId = appointment.companyId || (context.user.scope.companyIds.length === 1 ? context.user.scope.companyIds[0] : undefined);
  assert(companyId, 409, 'APPOINTMENT_COMPANY_MISSING', 'O atendimento precisa identificar sua empresa antes de preparar a PET.');
  return companyId;
}
function workerVisible(worker: WorkerDto, appointment: AppointmentDto, companyId: string, context: PetDemoContext) {
  const scope = context.user.scope;
  return worker.unitId === appointment.unitId && worker.companyId === companyId && scope.companyIds.includes(worker.companyId)
    && (!scope.sectorIds.length || scope.sectorIds.includes(worker.sectorId));
}
function scopedAppointment(value: AppointmentDto, unitId: string, context: PetDemoContext) {
  const companyId = company(value, context);
  const scope = context.user.scope;
  const assignedOnly = context.user.roles.some(role => ['TECHNICIAN', 'FIREFIGHTER'].includes(role)) && !context.user.roles.some(role => ['ADMIN', 'SESMT_MANAGER'].includes(role));
  assert(value.unitId === unitId && scope.unitIds.includes(value.unitId) && scope.companyIds.includes(companyId)
    && (!scope.teamIds.length || scope.teamIds.includes(value.teamId))
    && (!assignedOnly || value.responsibleId === context.user.id)
    && value.participants.every(participant => {
      const worker = context.workers.find(candidate => candidate.id === participant.workerId);
      return worker && workerVisible(worker, value, companyId, context);
    }), 404, 'NOT_FOUND', 'Atendimento indisponível no seu alcance.');
  context.checkUnit(value.unitId);
  return companyId;
}
function pagination(url: URL) {
  const read = (field: string, fallback: number, maximum: number) => {
    const raw = url.searchParams.get(field);
    const value = raw === null ? fallback : Number(raw);
    assert(raw === null || /^[1-9]\d*$/.test(raw), 422, 'VALIDATION_FAILED', 'Informe uma página válida.', field);
    assert(Number.isSafeInteger(value) && value > 0 && value <= maximum, 422, 'VALIDATION_FAILED', 'Informe uma página válida.', field);
    return value;
  };
  return { page: read('page', 1, 1000000), pageSize: read('pageSize', 10, 100) };
}
async function body(request: Request) {
  let input: unknown;
  try { input = await request.json(); } catch { throw new PetDemoError(422, 'VALIDATION_FAILED', 'Envie um preenchimento JSON válido.'); }
  assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Envie o preenchimento completo da PET.');
  return input as PetCreateDto;
}

export function makePetDemo() {
  const records = new Map<string, ConfinedSpacePermitDto>();
  const handles = (path: string) => /^\/(confined-space-permit-options|confined-space-permits)(\/|$)/.test(path);
  const event = (context: PetDemoContext, action: string, version: number): PermitEventDto => ({ id: crypto.randomUUID(), action, actorName: context.user.displayName, occurredAt: instant(), version });
  const response = (value: ConfinedSpacePermitDto, context: PetDemoContext) => clone({ ...value, availableActions: context.permissions.includes('pet.write') ? ['EDIT', 'PRINT'] : ['PRINT'] });
  async function currentAppointment(id: string, unitId: string, context: PetDemoContext) {
    const value = await context.appointment(id);
    scopedAppointment(value, unitId, context);
    return value;
  }
  async function record(id: string, unitId: string, context: PetDemoContext) {
    const value = records.get(id);
    assert(value && value.unitId === unitId, 404, 'NOT_FOUND', 'PET indisponível no seu alcance.');
    const appointment = await currentAppointment(value.appointment.id, unitId, context);
    assert(company(appointment, context) === value.companyId, 404, 'NOT_FOUND', 'PET indisponível no seu alcance.');
    return { value, appointment };
  }
  function preparation(input: PetPreparationDto, appointment: AppointmentDto, context: PetDemoContext) {
    let result: PetPreparationDto;
    try { result = canonicalPetPreparation(input, createPetPreparation(appointment)); }
    catch (error) { throw new PetDemoError(422, 'VALIDATION_FAILED', error instanceof Error ? error.message : 'Confira o preenchimento da PET.'); }
    const issue = validatePetPreparation(result);
    assert(!issue, 422, 'VALIDATION_FAILED', issue || 'Confira o preenchimento da PET.');
    const companyId = company(appointment, context);
    result.people = result.people.map(person => {
      if (!person.workerId) return person;
      const worker = context.workers.find(candidate => candidate.id === person.workerId);
      assert(worker && workerVisible(worker, appointment, companyId, context), 422, 'INVALID_PERSON_ASSIGNMENT', 'Selecione pessoas da mesma empresa, unidade e alcance autorizado.', 'people');
      return { ...person, name: worker.fullName, registration: worker.registration };
    });
    return clone(result);
  }
  async function route(request: Request, url: URL, path: string, context: PetDemoContext): Promise<ConfinedSpacePermitDto | PetOptionsDto | PageDto<ConfinedSpacePermitDto>> {
    assert(handles(path), 404, 'NOT_FOUND', 'Operação PET indisponível.');
    const collection = path === '/confined-space-permits';
    const options = path === '/confined-space-permit-options';
    const parts = path.split('/').filter(Boolean);
    const isDetail = parts[0] === 'confined-space-permits' && parts.length === 2;
    assert((options && request.method === 'GET') || (collection && ['GET', 'POST'].includes(request.method)) || (isDetail && ['GET', 'PATCH'].includes(request.method)), 404, 'NOT_FOUND', 'Operação PET indisponível.');
    permission(context, options || request.method !== 'GET' ? 'pet.write' : 'pet.read');
    const unitId = queryUnit(url, context);
    if (options) {
      const appointments = await context.appointments();
      permission(context, 'pet.write'); queryUnit(url, context);
      return { appointments: clone(appointments.filter(value => {
        if (value.unitId !== unitId || !availableAppointment(value)) return false;
        try { scopedAppointment(value, unitId, context); return true; }
        catch (error) { if (error instanceof PetDemoError && [403, 404, 409].includes(error.status)) return false; throw error; }
      })) };
    }
    if (collection && request.method === 'GET') {
      const { page, pageSize } = pagination(url);
      const query = url.searchParams.get('q') || '';
      assert(query.length <= 200, 422, 'VALIDATION_FAILED', 'A busca deve ter até 200 caracteres.', 'q');
      const items: ConfinedSpacePermitDto[] = [];
      const currentAppointments = new Map<string, AppointmentDto>();
      for (const value of records.values()) {
        if (value.unitId !== unitId) continue;
        try { const current = await record(value.id, unitId, context); currentAppointments.set(value.id, current.appointment); }
        catch (error) { if (error && typeof error === 'object' && 'status' in error && [403, 404].includes(Number(error.status))) continue; throw error; }
        if (!normalized(`${value.code} ${value.appointment.code} ${value.appointment.location} ${value.preparation.identification.spaceCode} ${value.preparation.identification.spaceDescription} ${value.preparation.identification.task}`).includes(normalized(query))) continue;
        items.push(response(value, context));
      }
      permission(context, 'pet.read'); queryUnit(url, context);
      const visibleItems = items.filter(value => {
        try { return scopedAppointment(currentAppointments.get(value.id)!, unitId, context) === value.companyId; }
        catch (error) { if (error instanceof PetDemoError && [403, 404].includes(error.status)) return false; throw error; }
      });
      visibleItems.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.code.localeCompare(left.code));
      return { items: visibleItems.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: visibleItems.length };
    }
    if (collection && request.method === 'POST') {
      const data = await body(request);
      permission(context, 'pet.write'); queryUnit(url, context);
      assert(typeof data.appointmentId === 'string' && data.appointmentId.length > 0, 422, 'VALIDATION_FAILED', 'Selecione o atendimento.', 'appointmentId');
      const appointment = await currentAppointment(data.appointmentId, unitId, context);
      // All access and state checks run again after the last asynchronous dependency.
      permission(context, 'pet.write'); queryUnit(url, context); scopedAppointment(appointment, unitId, context);
      assert(availableAppointment(appointment), 409, 'INVALID_APPOINTMENT', 'Prepare a PET a partir de um agendamento confirmado ou atendimento aberto.');
      const time = instant();
      const saved = preparation(data, appointment, context);
      const value: ConfinedSpacePermitDto = { id: crypto.randomUUID(), code: `PET-DEMO-${String(records.size + 1).padStart(3, '0')}`, unitId, companyId: company(appointment, context), revision: 1,
        sourceId: PET_SOURCE.sourceId, sourceRevision: PET_SOURCE.sourceRevision, sourceSha256: PET_SOURCE.sourceSha256,
        status: 'DRAFT', appointment: clone(appointment), preparation: saved, availableActions: [], history: [event(context, 'PET_DRAFT_CREATED', 1)],
        snapshots: [{ revision: 1, preparation: clone(saved), savedAt: time, actorName: context.user.displayName }], createdAt: time, createdByName: context.user.displayName, updatedAt: time };
      records.set(value.id, value);
      return response(value, context);
    }
    const initial = await record(parts[1], unitId, context);
    permission(context, request.method === 'GET' ? 'pet.read' : 'pet.write'); queryUnit(url, context);
    assert(scopedAppointment(initial.appointment, unitId, context) === initial.value.companyId, 404, 'NOT_FOUND', 'PET indisponível no seu alcance.');
    if (request.method === 'GET') return response(initial.value, context);
    revision(request, initial.value);
    const data = await body(request);
    const { value, appointment } = await record(parts[1], unitId, context);
    permission(context, 'pet.write'); queryUnit(url, context); revision(request, value);
    assert(scopedAppointment(appointment, unitId, context) === value.companyId, 404, 'NOT_FOUND', 'PET indisponível no seu alcance.');
    assert(value.status === 'DRAFT', 409, 'IMMUTABLE_PET', 'Edite apenas o rascunho da PET.');
    assert(availableAppointment(appointment), 409, 'INVALID_APPOINTMENT', 'Este agendamento não está disponível para preparar a PET.');
    assert(data.appointmentId === undefined || data.appointmentId === value.appointment.id, 422, 'IMMUTABLE_APPOINTMENT', 'O atendimento de uma PET existente não pode ser substituído.', 'appointmentId');
    const saved = preparation(data, appointment, context);
    const time = instant();
    value.preparation = saved; value.revision++; value.updatedAt = time;
    value.snapshots.push({ revision: value.revision, preparation: clone(saved), savedAt: time, actorName: context.user.displayName });
    value.history.push(event(context, 'PET_DRAFT_UPDATED', value.revision));
    return response(value, context);
  }
  return { handles, route };
}
