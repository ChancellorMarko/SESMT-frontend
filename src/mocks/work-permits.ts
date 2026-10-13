/** Domínio fictício executado no navegador pelo MSW. Não é uma API de produção. */
import type { UserDto, WorkerDto } from '../shared/contracts';
import type { AppointmentDto, AppointmentWriteDto, ChecklistItemDto, EligibilityDto, EvidenceDto, ParticipantDto, PermitEventDto, PermitOptionsDto, PermitPreparationDto, PermitSourceCheckDto, ServiceTypeDto, TeamDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { DocumentaryReadinessDto, MatrixRuleDto } from '../shared/contracts/requirements';
import { canonicalChecks, canonicalPreparation, createPermitPreparation, validatePreparation, validateSourceChecks } from '../features/permits/templates/ri-s-36001';
import { createTeamManagement } from './team-management';
import { makePermitAttachmentsDemo } from './permit-attachments';
import { makePermitLifecycleDemo } from './permit-lifecycle';
import { makeRequirementMatrixDemo } from './requirement-matrix';
import { makeWorkAuthorizationDemo } from './work-authorizations';
import { COMPANY, id, UNIT_A, UNIT_B } from './fixtures';
import { appointmentServiceIds, checklistItemBlocked } from '../shared/lib/appointment-services';
import { PT_SERVICE_TYPES } from '../shared/lib/service-types';
import { makeServiceTemplatesDemo } from './service-templates';

export interface PermitDemoContext {
  user: UserDto;
  permissions: string[];
  workers: WorkerDto[];
  checkUnit: (unitId: string) => void;
}
export class PermitDemoError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}
function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function text(value: unknown, field: string, maximum = 4000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, 422, 'VALIDATION_FAILED', 'Preencha um texto válido para este campo.', field);
  return value.trim();
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const instant = () => new Date().toISOString();
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const futureDay = (offset: number) => localDate(new Date(Date.now() + offset * 86400000));
function revision(request: Request, value: { revision: number }) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Recarregue o registro antes de alterar.');
  assert(request.headers.get('If-Match') === `"${value.revision}"`, 412, 'REVISION_CONFLICT', 'Este registro mudou. Recarregue e confira a versão atual.');
}

export function makePermitDemo() {
  const teams: TeamDto[] = [
    { id: id(200), name: 'Equipe de manutenção · demonstração', unitId: UNIT_A, companyId: COMPANY, chiefId: id(41), revision: 1, members: [{ workerId: id(40), name: 'Camila Demo', serviceFunction: 'Executante' }, { workerId: id(41), name: 'Bruno Demo', serviceFunction: 'Executante' }, { workerId: id(42), name: 'Julia Demo', serviceFunction: 'Apoio' }] },
    { id: id(201), name: 'Equipe operacional · demonstração', unitId: UNIT_B, companyId: COMPANY, chiefId: id(46), revision: 1, members: [{ workerId: id(46), name: 'Luiza Demo', serviceFunction: 'Executante' }, { workerId: id(47), name: 'André Demo', serviceFunction: 'Apoio' }] },
  ];
  const services: ServiceTypeDto[] = [
    { id: id(210), name: 'Manutenção programada', description: 'Serviço ilustrativo. Checklist e requisitos didáticos; validar com o SESMT antes de uso operacional.', templateVersion: 'DEMO-PT-1', requirementVersion: 'DEMO-MATRIZ-1' },
    { id: id(211), name: 'Inspeção de área', description: 'Exemplo acadêmico de atendimento; não constitui procedimento de segurança.', templateVersion: 'DEMO-INSPECAO-1', requirementVersion: 'DEMO-MATRIZ-1' },
    ...PT_SERVICE_TYPES,
  ];
  const teamManagement = createTeamManagement(teams);
  const attachmentsDemo = makePermitAttachmentsDemo();
  const responsibles = [{ id: id(25), name: 'Diego Demo · técnico' }, { id: id(26), name: 'Felipe Demo · bombeiro' }];
  const requirements: MatrixRuleDto[] = [
    { id: id(240), label: 'Evidência de capacitação aplicável (demo)', description: 'Conferência didática do participante e do período planejado; a validade é um critério da matriz de exemplo, não um prazo legal de NR.', serviceTypeId: id(210), serviceFunction: '*', locationContains: '', restricted: false, validFromRequired: true, validUntilRequired: true },
    { id: id(241), label: 'Conferência ocupacional restrita (demo)', description: 'Exibe apenas a pendência administrativa mínima. Avaliação e documentos médicos ficam com profissional competente; o sistema não define aptidão clínica.', serviceTypeId: id(210), serviceFunction: '*', locationContains: '', restricted: true, validFromRequired: false, validUntilRequired: false },
    { id: id(242), label: 'Orientação do atendimento (demo)', description: 'Evidência ilustrativa vinculada à inspeção; não substitui capacitação regulamentar.', serviceTypeId: id(211), serviceFunction: '*', locationContains: '', restricted: false, validFromRequired: false, validUntilRequired: false },
    ...PT_SERVICE_TYPES.map((service, index) => ({ id: id(520 + index), label: `${service.name} · evidência administrativa (demo)`, description: 'Regra sintética por serviço para demonstrar a união de requisitos. Não define capacitação, validade legal ou aptidão clínica.', serviceTypeId: service.id, serviceFunction: '*', locationContains: '', restricted: false, validFromRequired: true, validUntilRequired: true })),
  ];
  const requirementMatrix = makeRequirementMatrixDemo([{ id: UNIT_A, companyId: COMPANY }, { id: UNIT_B, companyId: COMPANY }], services, requirements);
  const serviceTemplates = makeServiceTemplatesDemo([{ id: UNIT_A, companyId: COMPANY }, { id: UNIT_B, companyId: COMPANY }], services);
  const evidence = new Map<string, EvidenceDto>();
  const evidenceFiles = new Map<string, File>();
  const downloadUrls = new Set<string>();
  const seedEvidence = (n: number, workerId: string, requirementId: string, status: EvidenceDto['status'], restricted = false) => {
    evidence.set(id(n), { unitId: UNIT_A, requirementVersion: 'DEMO-MATRIZ-1', id: id(n), workerId, requirementId, status, fileName: restricted ? 'Informação restrita' : `comprovante-${n}-demo.pdf`, validFrom: futureDay(-30), validUntil: futureDay(365), revision: 1, submittedAt: instant(), reviewedBy: status === 'APPROVED' ? (restricted ? 'PROFISSIONAL_COMPETENTE_DEMO' : id(20)) : undefined });
  };
  seedEvidence(250, id(40), id(240), 'APPROVED');
  seedEvidence(251, id(41), id(240), 'PENDING');
  seedEvidence(252, id(40), id(241), 'APPROVED', true);
  seedEvidence(253, id(41), id(241), 'APPROVED', true);
  seedEvidence(254, id(42), id(242), 'APPROVED');
  PT_SERVICE_TYPES.forEach((service, index) => {
    seedEvidence(530 + index, id(40), id(520 + index), 'APPROVED');
    seedEvidence(540 + index, id(41), id(520 + index), service.activityIds?.includes('hot-work') ? 'PENDING' : 'APPROVED');
  });
  const appointments = new Map<string, AppointmentDto>();
  const permits = new Map<string, WorkPermitDto>();
  const correctionDrafts = new Set<string>();
  const event = (context: PermitDemoContext, action: string, reason?: string, version?: number): PermitEventDto => ({ id: crypto.randomUUID(), action, actorName: context.user.displayName, occurredAt: instant(), reason, version });
  const can = (context: PermitDemoContext, permission: string) => context.permissions.includes(permission);
  const requirePermission = (context: PermitDemoContext, permission: string) => assert(can(context, permission), 403, 'FORBIDDEN', 'Seu perfil não permite esta ação.');
  const assignedOnly = (context: PermitDemoContext) => can(context, 'permits.operate') && !can(context, 'permits.review');
  const visible = (appointment: AppointmentDto, context: PermitDemoContext) => context.user.scope.companyIds.includes(appointment.companyId || teams.find(team => team.id === appointment.teamId)?.companyId || '') && context.user.scope.unitIds.includes(appointment.unitId)
    && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(appointment.teamId))
    && (!assignedOnly(context) || appointment.responsibleId === context.user.id)
    && (!context.user.scope.ownOnly || appointment.participants.some(participant => participant.workerId === (context.user.id === id(24) ? id(40) : context.user.id)));
  const appointmentById = (appointmentId: string, context: PermitDemoContext) => {
    const value = appointments.get(appointmentId);
    assert(value && visible(value, context), 404, 'NOT_FOUND', 'Agendamento indisponível no seu alcance.');
    context.checkUnit(value.unitId);
    return value;
  };
  const permitById = (permitId: string, context: PermitDemoContext) => {
    const value = permits.get(permitId);
    assert(value, 404, 'NOT_FOUND', 'PT indisponível.');
    appointmentById(value.appointment.id, context);
    return value;
  };
  const applicable = (appointment: AppointmentDto, participant: ParticipantDto) => requirementMatrix.published(appointment.unitId).rules.filter(requirement => appointmentServiceIds(appointment).includes(requirement.serviceTypeId) && (requirement.serviceFunction === '*' || normalized(requirement.serviceFunction) === normalized(participant.serviceFunction)) && (!requirement.locationContains || normalized(appointment.location).includes(normalized(requirement.locationContains))));
  const eligibility = (appointment: AppointmentDto, context?: PermitDemoContext): EligibilityDto => {
    const participants = appointment.participants.map(participant => {
      const worker = context?.workers.find(value => value.id === participant.workerId);
      const items = applicable(appointment, participant).map(requirement => {
        const candidate = [...evidence.values()].filter(value => value.workerId === participant.workerId && value.requirementId === requirement.id && (!value.unitId || value.unitId === appointment.unitId)).at(-1);
        let status = candidate?.status || 'MISSING';
        let reason = candidate?.reason;
        if (status === 'APPROVED' && candidate && !requirement.restricted) {
          const starts = localDate(new Date(appointment.startsAt));
          const ends = localDate(new Date(appointment.endsAt));
          const today = localDate(new Date());
          if (requirement.validFromRequired && !candidate.validFrom || requirement.validUntilRequired && !candidate.validUntil) { status = 'PENDING'; reason = 'A evidência não informa todas as datas de vigência exigidas pela matriz publicada.'; }
          else if (candidate.validUntil && (candidate.validUntil < ends || candidate.validUntil < today)) { status = 'EXPIRED'; reason = 'A evidência não cobre a data atual e o período planejado.'; }
          else if (candidate.validFrom && (candidate.validFrom > starts || candidate.validFrom > today)) { status = 'PENDING'; reason = 'A vigência ainda não iniciou ou não cobre o atendimento.'; }
        }
        if (context && (!worker || worker.status !== 'ACTIVE' || worker.unitId !== appointment.unitId || !context.user.scope.companyIds.includes(worker.companyId) || context.user.scope.sectorIds.length > 0 && !context.user.scope.sectorIds.includes(worker.sectorId))) { status = 'REJECTED'; reason = 'Confira o vínculo ativo, a unidade e o alcance autorizado do participante.'; }
        return { requirementId: requirement.id, label: requirement.label, description: requirement.description, status, evidenceId: requirement.restricted ? undefined : candidate?.id, evidenceRevision: requirement.restricted ? undefined : candidate?.revision, fileName: requirement.restricted ? undefined : candidate?.fileName, validFrom: requirement.restricted ? undefined : candidate?.validFrom, validUntil: requirement.restricted ? undefined : candidate?.validUntil, validFromRequired: !requirement.restricted && requirement.validFromRequired, validUntilRequired: !requirement.restricted && requirement.validUntilRequired, reason: requirement.restricted ? (status === 'APPROVED' ? undefined : 'Pendência administrativa restrita; consultar o profissional competente.') : reason, restricted: requirement.restricted };
      });
      return { ...participant, eligible: items.length > 0 && items.every(item => item.status === 'APPROVED'), items };
    });
    return { unitId: appointment.unitId, appointmentId: appointment.id, checkedAt: instant(), requirementVersion: requirementMatrix.published(appointment.unitId).version, eligible: participants.length > 0 && participants.every(participant => participant.eligible), participants };
  };
  const operationActor = (permit: WorkPermitDto, context: PermitDemoContext) => {
    requirePermission(context, 'permits.operate');
    assert(permit.appointment.responsibleId === context.user.id && responsibles.some(value => value.id === context.user.id), 403, 'NOT_DESIGNATED', 'Somente o responsável operacional designado pode realizar esta ação.');
  };
  const allSciences = (permit: WorkPermitDto) => permit.appointment.participants.every(participant => permit.sciences.some(science => science.workerId === participant.workerId && science.version === permit.version && science.confirmed));
  const checklistComplete = (permit: WorkPermitDto) => permit.checklist.length > 0 && permit.checklist.every(item => !checklistItemBlocked(item));
  const preparationComplete = (permit: WorkPermitDto) => !permit.preparation || !validatePreparation(permit.preparation, true);
  const prepared = (permit: WorkPermitDto, context: PermitDemoContext) => preparationComplete(permit) && checklistComplete(permit) && allSciences(permit) && eligibility(permit.appointment, context).eligible;
  const ensurePrepared = (permit: WorkPermitDto, context: PermitDemoContext, documentary = true) => {
    assert(preparationComplete(permit), 409, 'PREPARATION_PENDING', 'Conclua a preparação e as respostas aplicáveis do modelo antes de continuar.');
    assert(checklistComplete(permit), 409, 'CHECKLIST_PENDING', 'Responda os itens obrigatórios e regularize as respostas impeditivas de todos os serviços.');
    assert(allSciences(permit), 409, 'SCIENCES_PENDING', 'Registre a ciência de cada participante nesta versão.');
    if (documentary) assert(eligibility(permit.appointment, context).eligible, 409, 'DOCUMENTARY_BLOCK', 'Há requisito documental ausente, vencido, reprovado ou ainda não conferido. Regularize antes de liberar ou iniciar.');
  };
  const lifecycleDemo = makePermitLifecycleDemo(ensurePrepared);
  const appointmentActions = (appointment: AppointmentDto, context: PermitDemoContext) => {
    const actions: string[] = [];
    if (can(context, 'appointments.write') && !appointment.permitId && appointment.status !== 'CANCELED') {
      if (appointment.status === 'REQUESTED') actions.push('CONFIRM');
      actions.push('RESCHEDULE', 'CANCEL');
    }
    if (can(context, 'permits.operate') && appointment.responsibleId === context.user.id && appointment.status === 'CONFIRMED' && !appointment.permitId) actions.push('OPEN_PERMIT');
    return { ...clone(appointment), availableActions: actions };
  };
  const permitResponse = (permit: WorkPermitDto, context: PermitDemoContext): WorkPermitDto => {
    const appointment = appointments.get(permit.appointment.id)!;
    const actions: string[] = [];
    const operator = can(context, 'permits.operate') && appointment.responsibleId === context.user.id;
    if (operator && (permit.operationStatus === 'VERIFICATION' || correctionDrafts.has(permit.id))) {
      if (!permit.sciences.length) actions.push('EDIT_CHECKLIST', 'EDIT_PREPARATION');
      if (preparationComplete(permit) && checklistComplete(permit) && !allSciences(permit)) actions.push('COLLECT_SCIENCE');
      if (correctionDrafts.has(permit.id)) { if (preparationComplete(permit) && checklistComplete(permit) && allSciences(permit)) actions.push('SUBMIT_CORRECTION'); }
      else if (prepared(permit, context)) actions.push('RELEASE');
    }
    if (operator && permit.operationStatus === 'RELEASED' && prepared(permit, context)) actions.push('START');
    if (operator && permit.operationStatus === 'EXECUTING') actions.push('COMPLETE');
    if (operator && permit.reviewStatus === 'NOT_SUBMITTED') {
      if (['RELEASED', 'EXECUTING'].includes(permit.operationStatus)) actions.push('SUSPEND');
      if (permit.operationStatus === 'SUSPENDED') actions.push('RESUME');
      if (['VERIFICATION', 'RELEASED', 'SUSPENDED'].includes(permit.operationStatus)) actions.push('CANCEL');
    }
    if (operator && permit.operationStatus === 'COMPLETED' && permit.reviewStatus === 'RETURNED') actions.push('NEW_VERSION');
    if (can(context, 'permits.review') && permit.operationStatus === 'COMPLETED' && permit.reviewStatus === 'PENDING_REVIEW') actions.push('REVIEW');
    return { ...clone(permit), appointment: appointmentActions(appointment, context), eligibility: permit.operationStatus === 'COMPLETED' ? clone(permit.eligibility) : eligibility(appointment, context), availableActions: actions };
  };
  const initialChecklist = (): ChecklistItemDto[] => [
    { id: 'demo-context', label: 'Contexto, local e participantes conferidos (exemplo didático)', required: true, answer: null },
    { id: 'demo-control', label: 'Medidas do procedimento aplicável conferidas (exemplo didático)', required: true, answer: null },
    { id: 'demo-communication', label: 'Comunicação da equipe registrada (exemplo didático)', required: false, answer: null },
  ];
  const seedAppointment = (n: number, team: TeamDto, participants: ParticipantDto[], status: AppointmentDto['status'], serviceTypeId = id(210), responsibleId = id(25), offset = 1) => {
    const service = services.find(value => value.id === serviceTypeId)!;
    const appointment: AppointmentDto = { companyId: team.companyId, id: id(n), code: `AG-DEMO-${n}`, unitId: team.unitId, teamId: team.id, teamName: team.name, participants: clone(participants), serviceTypeId, serviceLabel: service.name, location: team.unitId === UNIT_A ? 'Área A · local fictício' : 'Área operacional · local fictício', startsAt: `${futureDay(offset)}T09:00:00-03:00`, endsAt: `${futureDay(offset)}T10:00:00-03:00`, responsibleId, responsibleName: responsibles.find(value => value.id === responsibleId)!.name, status, revision: 1, availableActions: [], history: [], notes: 'Dados sintéticos para demonstração acadêmica.' };
    appointments.set(appointment.id, appointment);
    return appointment;
  };
  seedAppointment(220, teams[0], teams[0].members.slice(0, 2), 'CONFIRMED');
  seedAppointment(221, teams[0], teams[0].members.slice(0, 1), 'CONFIRMED', id(210), id(25), 2);
  seedAppointment(222, teams[0], teams[0].members.slice(2), 'REQUESTED', id(211), id(26), 3);
  seedAppointment(223, teams[1], teams[1].members.slice(0, 1), 'CONFIRMED', id(210), id(26), 4);
  const closedAppointment = seedAppointment(224, teams[0], teams[0].members.slice(0, 1), 'ATTENDANCE_OPENED', id(210), id(25), 0);
  closedAppointment.permitId = id(230);
  const completedTime = instant();
  const closedChecklist = initialChecklist().map(item => ({ ...item, answer: 'YES' as const }));
  const closedSciences = [{ id: id(260), workerId: id(40), declarantName: 'Camila Demo', method: 'TYPED' as const, representation: 'Camila Demo', confirmed: true as const, collectedBy: id(25), collectedByName: 'Diego Demo', collectedAt: completedTime, version: 1 }];
  const closedSummary = 'Exemplo sintético concluído para demonstrar a fila de revisão do engenheiro.';
  const closedEligibility = eligibility(closedAppointment);
  permits.set(id(230), { id: id(230), code: 'PT-DEMO-230', appointment: clone(closedAppointment), operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', version: 1, revision: 1, templateVersion: 'DEMO-PT-1', checklist: closedChecklist, sciences: closedSciences, eligibility: clone(closedEligibility), availableActions: [], releasedAt: completedTime, startedAt: completedTime, completedAt: completedTime, summary: closedSummary, snapshots: [{ eligibility: clone(closedEligibility), version: 1, submittedAt: completedTime, summary: closedSummary, checklist: clone(closedChecklist), sciences: clone(closedSciences) }], history: [{ id: crypto.randomUUID(), action: 'DEMO_COMPLETED', actorName: 'Diego Demo', occurredAt: completedTime, version: 1 }] });

  const authorizationDemo = makeWorkAuthorizationDemo({
    units: [{ id: UNIT_A, companyId: COMPANY }, { id: UNIT_B, companyId: COMPANY }],
    appointments: context => [...appointments.values()].filter(appointment => visible(appointment, context)),
    appointmentById, eligibility, permitById,
    permitsForAppointment: (appointmentId, context) => {
      appointmentById(appointmentId, context);
      return [...permits.values()].filter(permit => permit.appointment.id === appointmentId);
    },
    knownResponsible: responsibleId => responsibles.some(value => value.id === responsibleId),
  });
  const handles = (path: string) => /^\/(permit-options|team-options|teams|appointments|evidence|work-permits|permit-dashboard|requirement-matrix|service-templates|documentary-readiness|authorization-options|work-authorizations)(\/|$)/.test(path);
  async function route(request: Request, url: URL, path: string, context: PermitDemoContext): Promise<unknown | undefined> {
    if (!handles(path)) return undefined;
    const parts = path.split('/').filter(Boolean);
    const method = request.method;
    const body = async <T,>() => await request.json() as T;
    if (requirementMatrix.handles(path)) return requirementMatrix.route(request, url, path, context);
    if (serviceTemplates.handles(path)) return serviceTemplates.route(request, url, path, context);
    if (authorizationDemo.handles(path)) return authorizationDemo.route(request, url, path, context);
    const queryUnit = url.searchParams.get('unitId');
    if (path === '/documentary-readiness') {
      requirePermission(context, 'eligibility.read');
      assert(method === 'GET', 405, 'METHOD_NOT_ALLOWED', 'A consulta de prontidão aceita somente GET.');
      assert(queryUnit, 422, 'VALIDATION_FAILED', 'Informe a unidade para consultar as pendências.', 'unitId');
      assert([UNIT_A, UNIT_B].includes(queryUnit) && context.user.scope.unitIds.includes(queryUnit) && context.user.scope.companyIds.includes(COMPANY), 403, 'FORBIDDEN', 'Unidade fora do alcance autorizado.');
      context.checkUnit(queryUnit);
      const rows = [...appointments.values()].filter(appointment => {
        const permit = appointment.permitId ? permits.get(appointment.permitId) : undefined;
        return appointment.unitId === queryUnit && visible(appointment, context) && appointment.status !== 'CANCELED' && (!permit || !['COMPLETED', 'CANCELED'].includes(permit.operationStatus))
          && appointment.participants.every(participant => { const worker = context.workers.find(value => value.id === participant.workerId); return worker && worker.unitId === queryUnit && context.user.scope.companyIds.includes(worker.companyId) && (!context.user.scope.sectorIds.length || context.user.scope.sectorIds.includes(worker.sectorId)) && (!context.user.scope.ownOnly || participant.workerId === (context.user.id === id(24) ? id(40) : context.user.id)); });
      }).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(appointment => ({ appointmentId: appointment.id, appointmentCode: appointment.code, teamId: appointment.teamId, teamName: appointment.teamName, serviceTypeId: appointment.serviceTypeId, serviceTypeIds: appointmentServiceIds(appointment), services: appointmentServiceIds(appointment).map(serviceId => ({ id: serviceId, name: services.find(service => service.id === serviceId)!.name })), serviceLabel: appointment.serviceLabel, location: appointment.location, startsAt: appointment.startsAt, endsAt: appointment.endsAt, permitId: appointment.permitId, eligibility: eligibility(appointment, context) }));
      return { generatedAt: instant(), rows } satisfies DocumentaryReadinessDto;
    }
    if (queryUnit) context.checkUnit(queryUnit);
    const inQuery = (appointment: AppointmentDto) => visible(appointment, context) && (!queryUnit || appointment.unitId === queryUnit);
    const query = normalized(url.searchParams.get('q') || '');
    if (teamManagement.handles(path) && !(path === '/teams' && method === 'GET')) return teamManagement.route(request, url, path, context);
    if ((path === '/permit-options' || path === '/teams') && method === 'GET') {
      requirePermission(context, path === '/teams' ? 'teams.read' : 'appointments.read');
      const scopedTeams = teams.filter(team => context.user.scope.companyIds.includes(team.companyId) && context.user.scope.unitIds.includes(team.unitId) && (!queryUnit || team.unitId === queryUnit) && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(team.id)));
      const safeTeams = context.user.scope.ownOnly ? [] : scopedTeams;
      if (path === '/teams') return clone(safeTeams);
      const options: PermitOptionsDto = { teams: clone(safeTeams), services: services.map(service => ({ ...clone(service), templateVersion: queryUnit && PT_SERVICE_TYPES.some(value => value.id === service.id) ? serviceTemplates.published(queryUnit, service.id).version : service.templateVersion, requirementVersion: queryUnit ? requirementMatrix.published(queryUnit).version : service.requirementVersion })), responsibles: assignedOnly(context) ? responsibles.filter(value => value.id === context.user.id) : clone(responsibles) };
      return options;
    }
    if (path === '/permit-dashboard' && method === 'GET') {
      requirePermission(context, 'appointments.read');
      const list = [...appointments.values()].filter(inQuery);
      const scopedPermits = [...permits.values()].filter(permit => inQuery(appointments.get(permit.appointment.id)!));
      return { generatedAt: instant(), appointments: list.filter(value => value.status !== 'CANCELED').length, activePermits: scopedPermits.filter(value => !['COMPLETED', 'CANCELED'].includes(value.operationStatus)).length, blockedAppointments: list.filter(value => ['REQUESTED', 'CONFIRMED'].includes(value.status) && !eligibility(value, context).eligible).length, pendingReviews: scopedPermits.filter(value => value.reviewStatus === 'PENDING_REVIEW').length, nextAppointments: list.filter(value => ['REQUESTED', 'CONFIRMED'].includes(value.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 5).map(value => appointmentActions(value, context)), pendingPermits: scopedPermits.filter(value => ['PENDING_REVIEW', 'RETURNED'].includes(value.reviewStatus)).map(value => permitResponse(value, context)) };
    }
    if (parts[0] === 'appointments') {
      if (parts.length === 1 && method === 'GET') {
        requirePermission(context, 'appointments.read');
        const status = url.searchParams.get('status');
        return [...appointments.values()].filter(inQuery).filter(value => (!status || value.status === status) && (url.searchParams.get('eligibility') !== 'blocked' || ['REQUESTED', 'CONFIRMED'].includes(value.status) && !eligibility(value, context).eligible) && (!query || normalized(`${value.code} ${value.teamName} ${value.location} ${value.serviceLabel} ${value.responsibleName}`).includes(query))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(value => appointmentActions(value, context));
      }
      if (parts.length === 1 && method === 'POST') {
        requirePermission(context, 'appointments.write');
        const input = await body<AppointmentWriteDto>();
        assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Envie os dados do agendamento.');
        context.checkUnit(text(input.unitId, 'unitId'));
        const team = teams.find(value => value.id === input.teamId && value.unitId === input.unitId);
        assert(team && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(team.id)), 422, 'INVALID_ASSIGNMENT', 'Selecione uma equipe da unidade autorizada.', 'teamId');
        const selectedIds = input.serviceTypeIds === undefined ? [input.serviceTypeId] : input.serviceTypeIds;
        assert(Array.isArray(selectedIds) && selectedIds.length >= 1 && selectedIds.length <= services.length && new Set(selectedIds).size === selectedIds.length && selectedIds.every(value => typeof value === 'string' && services.some(service => service.id === value)), 422, 'VALIDATION_FAILED', 'Selecione serviços válidos, sem repetição.', 'serviceTypeIds');
        assert(input.serviceTypeId === selectedIds[0], 422, 'VALIDATION_FAILED', 'O serviço principal deve corresponder ao primeiro serviço selecionado.', 'serviceTypeId');
        const selectedServices = selectedIds.map(value => services.find(service => service.id === value)!);
        const service = selectedServices[0];
        const responsible = responsibles.find(value => value.id === input.responsibleId);
        assert(responsible && (!assignedOnly(context) || responsible.id === context.user.id), 422, 'INVALID_ASSIGNMENT', 'Responsável operacional inválido.', 'responsibleId');
        const location = text(input.location, 'location', 200);
        assert(Number.isFinite(Date.parse(input.startsAt)) && Number.isFinite(Date.parse(input.endsAt)) && Date.parse(input.endsAt) > Date.parse(input.startsAt), 422, 'VALIDATION_FAILED', 'Informe um período válido; o fim deve ser posterior ao início.', 'endsAt');
        assert(Array.isArray(input.participants) && input.participants.length > 0 && input.participants.length <= 100 && new Set(input.participants.map(value => value.workerId)).size === input.participants.length, 422, 'VALIDATION_FAILED', 'Selecione participantes sem duplicação.', 'participants');
        const participants = input.participants.map(participant => {
          const worker = context.workers.find(value => value.id === participant.workerId && value.unitId === input.unitId && value.status === 'ACTIVE');
          assert(worker && team.members.some(value => value.workerId === worker.id), 422, 'INVALID_ASSIGNMENT', 'Participante incompatível com a equipe ou sem vínculo ativo.', 'participants');
          return { workerId: worker.id, name: worker.fullName, serviceFunction: text(participant.serviceFunction, 'participants', 100) };
        });
        assert(input.notes === undefined || typeof input.notes === 'string' && input.notes.length <= 2000, 422, 'VALIDATION_FAILED', 'As observações devem ter até 2.000 caracteres.', 'notes');
        const appointment: AppointmentDto = { companyId: team.companyId, unitId: input.unitId, teamId: team.id, serviceTypeId: service.id, serviceTypeIds: [...selectedIds], startsAt: input.startsAt, endsAt: input.endsAt, responsibleId: responsible.id, notes: input.notes?.trim(), id: crypto.randomUUID(), code: `AG-DEMO-${225 + appointments.size - 5}`, location, participants, teamName: team.name, responsibleName: responsible.name, serviceLabel: selectedServices.map(value => value.name).join(' + '), status: 'REQUESTED', revision: 1, availableActions: [], history: [event(context, 'APPOINTMENT_REQUESTED', `Serviços: ${selectedServices.map(value => value.name).join(' + ')}.`)] };
        appointments.set(appointment.id, appointment);
        return appointmentActions(appointment, context);
      }
      const appointment = appointmentById(parts[1], context);
      if (parts.length === 2 && method === 'GET') { requirePermission(context, 'appointments.read'); return appointmentActions(appointment, context); }
      if (parts[2] === 'eligibility' && method === 'GET') { requirePermission(context, 'eligibility.read'); return eligibility(appointment, context); }
      if (parts[2] === 'evidence' && method === 'POST') {
        requirePermission(context, 'eligibility.write');
        revision(request, appointment);
        const form = await request.formData();
        revision(request, appointment);
        const requirementVersion = requirementMatrix.published(appointment.unitId).version;
        const workerId = text(form.get('workerId'), 'workerId');
        const requirementId = text(form.get('requirementId'), 'requirementId');
        const participant = appointment.participants.find(value => value.workerId === workerId);
        const requirement = participant && applicable(appointment, participant).find(value => value.id === requirementId);
        assert(requirement, 422, 'INVALID_ASSIGNMENT', 'Requisito ou participante incompatível com este atendimento.');
        assert(!requirement.restricted, 403, 'RESTRICTED_EVIDENCE', 'Informação ocupacional restrita deve ser conferida pelo profissional competente, fora deste fluxo de demonstração.');
        const file = form.get('file');
        assert(file instanceof File && file.size > 0 && file.size <= 5 * 1024 * 1024, 413, 'FILE_TOO_LARGE', 'Envie um arquivo de até 5 MB.', 'file');
        assert(['application/pdf', 'image/png', 'image/jpeg'].includes(file.type), 415, 'UNSUPPORTED_MEDIA_TYPE', 'Use PDF, PNG ou JPEG.', 'file');
        const bytes = new Uint8Array(await file.arrayBuffer());
        revision(request, appointment);
        assert(requirementMatrix.published(appointment.unitId).version === requirementVersion, 409, 'REQUIREMENTS_CHANGED', 'A matriz foi publicada durante o envio. Atualize os requisitos antes de anexar a evidência.');
        const validFile = file.type === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' : file.type === 'image/png' ? bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 : bytes[0] === 255 && bytes[1] === 216;
        assert(validFile, 415, 'UNSUPPORTED_MEDIA_TYPE', 'O conteúdo do arquivo não corresponde ao formato informado.', 'file');
        const validFrom = String(form.get('validFrom') || '') || undefined;
        const validUntil = String(form.get('validUntil') || '') || undefined;
        const validDate = (value: string | undefined) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00-03:00`)) && localDate(new Date(`${value}T00:00:00-03:00`)) === value;
        assert(validDate(validFrom) && validDate(validUntil) && (!validFrom || !validUntil || validFrom <= validUntil), 422, 'VALIDATION_FAILED', 'Confira as datas de vigência.', 'validUntil');
        assert(!requirement.validFromRequired || validFrom, 422, 'VALIDATION_FAILED', 'A matriz publicada exige a data inicial da evidência.', 'validFrom');
        assert(!requirement.validUntilRequired || validUntil, 422, 'VALIDATION_FAILED', 'A matriz publicada exige a data final da evidência.', 'validUntil');
        const value: EvidenceDto = { unitId: appointment.unitId, requirementVersion, id: crypto.randomUUID(), workerId, requirementId, fileName: file.name.slice(0, 200), status: 'PENDING', validFrom, validUntil, revision: 1, submittedAt: instant() };
        evidence.set(value.id, value);
        evidenceFiles.set(value.id, file);
        appointment.revision++;
        appointment.history.push(event(context, 'EVIDENCE_SUBMITTED', `Participante: ${participant!.name}; requisito: ${requirement.label}.`));
        return clone(value);
      }
      if (parts[2] === 'open-permit' && method === 'POST') {
        requirePermission(context, 'permits.operate');
        revision(request, appointment);
        assert(appointment.responsibleId === context.user.id && responsibles.some(value => value.id === context.user.id), 403, 'NOT_DESIGNATED', 'O atendimento deve ser aberto pelo responsável designado.');
        assert(appointment.status === 'CONFIRMED' && !appointment.permitId, 409, 'INVALID_TRANSITION', 'Confirme o agendamento antes de abrir o atendimento.');
        const selected = appointmentServiceIds(appointment);
        const templates = selected.length > 1 || selected.some(serviceId => PT_SERVICE_TYPES.some(service => service.id === serviceId)) ? selected.map(serviceId => serviceTemplates.published(appointment.unitId, serviceId)) : undefined;
        const requiredActivities = templates ? [...new Set(templates.flatMap(template => template.activityIds))] : undefined;
        const checklist: ChecklistItemDto[] = templates ? templates.flatMap(template => template.questions.map(question => ({ ...clone(question), id: `${template.serviceTypeId}:${question.id}`, serviceTypeId: template.serviceTypeId, serviceName: template.serviceName, templateVersion: template.version, answer: null }))) : initialChecklist();
        const permit: WorkPermitDto = { id: crypto.randomUUID(), code: `PT-DEMO-${231 + permits.size - 1}`, appointment: clone(appointment), operationStatus: 'VERIFICATION', reviewStatus: 'NOT_SUBMITTED', version: 1, revision: 1, templateVersion: templates ? templates.map(template => template.version).join(' + ') : services.find(value => value.id === appointment.serviceTypeId)!.templateVersion, ...(templates ? { serviceTemplates: clone(templates) } : {}), checklist, preparation: createPermitPreparation(appointment, requiredActivities), sciences: [], eligibility: eligibility(appointment, context), availableActions: [], snapshots: [], history: [event(context, 'ATTENDANCE_OPENED', 'Verificações iniciadas; execução ainda não liberada.', 1)] };
        appointment.status = 'ATTENDANCE_OPENED';
        appointment.permitId = permit.id;
        appointment.revision++;
        appointment.history.push(event(context, 'ATTENDANCE_OPENED'));
        permits.set(permit.id, permit);
        return permitResponse(permit, context);
      }
      requirePermission(context, 'appointments.write');
      revision(request, appointment);
      assert(!appointment.permitId && appointment.status !== 'CANCELED', 409, 'INVALID_TRANSITION', 'Agendamento com atendimento aberto ou cancelado não aceita esta alteração.');
      if (method === 'POST' && parts[2] === 'confirm') {
        assert(appointment.status === 'REQUESTED', 409, 'INVALID_TRANSITION', 'Somente uma solicitação pode ser confirmada.');
        appointment.status = 'CONFIRMED';
        appointment.history.push(event(context, 'APPOINTMENT_CONFIRMED'));
      } else if (method === 'POST' && parts[2] === 'reschedule') {
        const input = await body<{ startsAt: string; endsAt: string; reason: string }>();
        revision(request, appointment);
        const reason = text(input.reason, 'reason');
        assert(Number.isFinite(Date.parse(input.startsAt)) && Number.isFinite(Date.parse(input.endsAt)) && Date.parse(input.endsAt) > Date.parse(input.startsAt), 422, 'VALIDATION_FAILED', 'Confira o novo período do atendimento.', 'endsAt');
        appointment.history.push(event(context, 'APPOINTMENT_RESCHEDULED', `${reason} · Período anterior: ${appointment.startsAt} até ${appointment.endsAt}.`));
        appointment.startsAt = input.startsAt;
        appointment.endsAt = input.endsAt;
      } else if (method === 'POST' && parts[2] === 'cancel') {
        const input = await body<{ reason: string }>();
        revision(request, appointment);
        const reason = text(input.reason, 'reason');
        appointment.status = 'CANCELED';
        appointment.history.push(event(context, 'APPOINTMENT_CANCELED', reason));
      } else throw new PermitDemoError(404, 'NOT_FOUND', 'Operação não prevista na demonstração.');
      appointment.revision++;
      return appointmentActions(appointment, context);
    }
    if (parts[0] === 'evidence' && (parts[2] === 'review' && method === 'POST' || parts[2] === 'download' && method === 'GET')) {
      requirePermission(context, parts[2] === 'download' ? 'eligibility.read' : 'eligibility.review');
      const value = evidence.get(parts[1]);
      assert(value, 404, 'NOT_FOUND', 'Evidência indisponível.');
      const requirement = requirementMatrix.findPublishedRule(value.requirementId, value.unitId);
      assert(requirement, 404, 'NOT_FOUND', 'A origem administrativa da evidência não está disponível.');
      assert(!requirement.restricted, 403, 'RESTRICTED_EVIDENCE', 'Seu perfil não confere documentos de saúde.');
      assert([...appointments.values()].some(appointment => visible(appointment, context) && (!value.unitId || value.unitId === appointment.unitId) && appointment.participants.some(participant => participant.workerId === value.workerId) && appointmentServiceIds(appointment).includes(requirement.serviceTypeId)), 404, 'NOT_FOUND', 'Evidência fora do seu alcance.');
      if (parts[2] === 'download') {
        let file: Blob = evidenceFiles.get(value.id)!;
        if (!file) {
          const content = 'BT /F1 14 Tf 40 760 Td (EVIDENCIA SINTETICA - DEMONSTRACAO) Tj 0 -26 Td (Nao e um certificado real. Conferencia simulada.) Tj ET';
          const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
          let pdf = '%PDF-1.4\n';
          const offsets = objects.map((object, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
          const xref = pdf.length;
          pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
          file = new Blob([pdf], { type: 'application/pdf' });
        }
        const fileUrl = URL.createObjectURL(file);
        downloadUrls.add(fileUrl);
        return { url: fileUrl, expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: value.fileName, mimeType: file.type };
      }
      revision(request, value);
      const input = await body<{ decision: 'APPROVE' | 'REJECT'; reason?: string }>();
      revision(request, value);
      assert(input.decision === 'APPROVE' || input.decision === 'REJECT', 422, 'VALIDATION_FAILED', 'Selecione uma decisão válida.', 'decision');
      if (input.decision === 'REJECT') text(input.reason, 'reason');
      value.status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      value.reason = input.reason?.trim();
      value.reviewedBy = context.user.id;
      value.revision++;
      return clone(value);
    }
    if (parts[0] === 'work-permits') {
      requirePermission(context, method === 'GET' ? 'permits.read' : parts[2] === 'review' ? 'permits.review' : 'permits.operate');
      if (parts.length === 1 && method === 'GET') {
        const operationStatus = url.searchParams.get('operationStatus');
        const reviewStatus = url.searchParams.get('reviewStatus');
        return [...permits.values()].filter(permit => inQuery(appointments.get(permit.appointment.id)!)).filter(permit => (!operationStatus || permit.operationStatus === operationStatus) && (!reviewStatus || permit.reviewStatus === reviewStatus) && (!query || normalized(`${permit.code} ${permit.appointment.teamName} ${permit.appointment.location} ${permit.appointment.serviceLabel}`).includes(query))).map(permit => permitResponse(permit, context));
      }
      const permit = permitById(parts[1], context);
      if (lifecycleDemo.handles(path)) {
        operationActor(permit, context);
        await lifecycleDemo.route(request, path, permit, context);
        return permitResponse(permit, context);
      }
      if (attachmentsDemo.handles(path)) {
        if (method !== 'GET') operationActor(permit, context);
        return attachmentsDemo.route(request, path, permit, context);
      }
      if (parts.length === 2 && method === 'GET') return permitResponse(permit, context);
      revision(request, permit);
      const action = parts[2];
      if (action !== 'review') operationActor(permit, context);
      const editable = permit.operationStatus === 'VERIFICATION' || correctionDrafts.has(permit.id);
      if (action === 'preparation' && method === 'PATCH') {
        assert(editable, 409, 'IMMUTABLE_VERSION', 'A preparação liberada ou concluída exige uma nova versão documental.');
        assert(!permit.sciences.length, 409, 'SCIENCE_LOCKED_PREPARATION', 'A ciência preserva a preparação apresentada ao participante.');
        const input = await body<PermitPreparationDto>();
        // Recheck after the awaited read, in the same synchronous turn as the write.
        revision(request, permit);
        let updated: PermitPreparationDto;
        try { updated = canonicalPreparation(input, permit.preparation || createPermitPreparation(permit.appointment)); }
        catch (error) { throw new PermitDemoError(422, 'VALIDATION_FAILED', error instanceof Error ? error.message : 'Confira a preparação.', 'preparation'); }
        const error = validatePreparation(updated);
        assert(!error, 422, 'VALIDATION_FAILED', error || '', 'preparation');
        permit.preparation = updated;
        permit.history.push(event(context, 'PREPARATION_UPDATED', 'Identificação, atividades, proteções e respostas documentais atualizadas.', permit.version));
      } else if (action === 'checklist' && method === 'PATCH') {
        assert(editable, 409, 'IMMUTABLE_VERSION', 'A versão liberada ou concluída não pode ser alterada diretamente.');
        assert(!permit.sciences.length, 409, 'SCIENCE_LOCKED_CHECKLIST', 'A ciência confirmada preserva o checklist desta versão. Não altere o conteúdo já apresentado ao participante.');
        const input = await body<{ items: ChecklistItemDto[] }>();
        revision(request, permit);
        assert(Array.isArray(input.items) && input.items.length === permit.checklist.length && new Set(input.items.map(item => item.id)).size === permit.checklist.length && input.items.every(item => permit.checklist.some(original => original.id === item.id)), 422, 'VALIDATION_FAILED', 'Envie todos os itens da versão do template sem substituir o checklist.', 'items');
        permit.checklist = permit.checklist.map(original => {
          const answer = input.items.find(item => item.id === original.id)!;
          assert(answer.answer === null || answer.answer === 'YES' || answer.answer === 'NO', 422, 'VALIDATION_FAILED', 'Resposta inválida no checklist.', 'items');
          assert(answer.note === undefined || typeof answer.note === 'string' && answer.note.length <= 1000, 422, 'VALIDATION_FAILED', 'Observação inválida.', 'items');
          assert(answer.answer !== 'NO' || answer.note?.trim(), 422, 'VALIDATION_FAILED', 'Explique a resposta Não na observação do item.', 'items');
          return { ...original, answer: answer.answer, note: answer.note?.trim() };
        });
        permit.history.push(event(context, 'CHECKLIST_UPDATED', undefined, permit.version));
      } else if (action === 'sciences' && method === 'POST') {
        assert(editable, 409, 'IMMUTABLE_VERSION', 'Ciência só pode ser coletada na versão em preenchimento.');
        assert(preparationComplete(permit), 409, 'PREPARATION_PENDING', 'Conclua a preparação do modelo antes de apresentar a declaração aos participantes.');
        assert(checklistComplete(permit), 409, 'CHECKLIST_PENDING', 'Conclua o checklist obrigatório antes de apresentar a declaração aos participantes.');
        const input = await body<{ workerId: string; declarantName: string; method: 'TYPED' | 'DRAWN'; representation: string; confirmed: boolean }>();
        revision(request, permit);
        const participant = permit.appointment.participants.find(value => value.workerId === input.workerId);
        assert(participant && normalized(text(input.declarantName, 'declarantName', 200)) === normalized(participant.name), 422, 'DECLARANT_MISMATCH', 'O nome declarado deve corresponder ao participante desta PT.', 'declarantName');
        assert(input.confirmed === true && ['TYPED', 'DRAWN'].includes(input.method), 422, 'SCIENCE_CONFIRMATION_REQUIRED', 'Confirme explicitamente a declaração e o método.', 'confirmed');
        const representation = text(input.representation, 'representation', 1000000);
        assert(input.method === 'TYPED' ? normalized(representation) === normalized(participant.name) : /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(representation), 422, 'INVALID_REPRESENTATION', 'Confira o nome digitado ou refaça o desenho.', 'representation');
        assert(!permit.sciences.some(value => value.workerId === input.workerId && value.version === permit.version), 409, 'SCIENCE_ALREADY_RECORDED', 'Esta ciência já foi confirmada; preserve o registro da versão.');
        permit.sciences.push({ id: crypto.randomUUID(), workerId: input.workerId, declarantName: participant.name, method: input.method, representation, confirmed: true, collectedBy: context.user.id, collectedByName: context.user.displayName, collectedAt: instant(), version: permit.version });
        permit.history.push(event(context, 'SCIENCE_COLLECTED', `Declarante: ${participant.name}; coleta pelo usuário autenticado.`, permit.version));
      } else if (action === 'release' && method === 'POST') {
        assert(permit.operationStatus === 'VERIFICATION' && !correctionDrafts.has(permit.id), 409, 'INVALID_TRANSITION', 'Liberação exige PT em verificação inicial.');
        ensurePrepared(permit, context);
        permit.operationStatus = 'RELEASED';
        permit.releasedAt = instant();
        permit.history.push(event(context, 'EXECUTION_RELEASED', 'Requisitos, checklist e ciências revalidados na liberação.', permit.version));
      } else if (action === 'start' && method === 'POST') {
        assert(permit.operationStatus === 'RELEASED', 409, 'RELEASE_REQUIRED', 'Registre a liberação antes de iniciar a execução.');
        ensurePrepared(permit, context);
        permit.operationStatus = 'EXECUTING';
        permit.startedAt = instant();
        permit.history.push(event(context, 'EXECUTION_STARTED', 'Requisitos revalidados no início.', permit.version));
      } else if (action === 'complete' && method === 'POST') {
        assert(permit.operationStatus === 'EXECUTING', 409, 'INVALID_TRANSITION', 'Somente execução iniciada pode ser concluída.');
        const input = await body<{ summary: string; closingChecks?: PermitSourceCheckDto[] }>();
        revision(request, permit);
        const summary = text(input.summary, 'summary');
        assert(summary.length >= 10, 422, 'VALIDATION_FAILED', 'Descreva a conclusão com pelo menos 10 caracteres.', 'summary');
        let closingChecks: PermitSourceCheckDto[] | undefined;
        if (permit.preparation) {
          try { closingChecks = canonicalChecks(input.closingChecks || [], permit.preparation.closingChecks); }
          catch (error) { throw new PermitDemoError(422, 'CLOSING_PENDING', error instanceof Error ? error.message : 'Confira o encerramento.', 'closingChecks'); }
          const error = validateSourceChecks(closingChecks, true);
          assert(!error, 422, 'CLOSING_PENDING', error || '', 'closingChecks');
        }
        permit.operationStatus = 'COMPLETED';
        permit.reviewStatus = 'PENDING_REVIEW';
        permit.completedAt = instant();
        permit.summary = summary;
        permit.eligibility = eligibility(appointments.get(permit.appointment.id)!, context);
        if (closingChecks) permit.preparation!.closingChecks = closingChecks;
        permit.snapshots.push({ eligibility: clone(permit.eligibility), templateVersion: permit.templateVersion, ...(permit.serviceTemplates ? { serviceTemplates: clone(permit.serviceTemplates) } : {}), appointment: clone(appointments.get(permit.appointment.id)!), version: permit.version, submittedAt: instant(), summary, checklist: clone(permit.checklist), sciences: clone(permit.sciences), ...(permit.preparation ? { preparation: clone(permit.preparation) } : {}) });
        permit.history.push(event(context, 'OPERATION_COMPLETED', summary, permit.version));
      } else if (action === 'review' && method === 'POST') {
        assert(permit.operationStatus === 'COMPLETED' && permit.reviewStatus === 'PENDING_REVIEW' && !correctionDrafts.has(permit.id), 409, 'INVALID_TRANSITION', 'Aguarde uma versão concluída e submetida à revisão.');
        const input = await body<{ decision: 'APPROVE' | 'RETURN'; comment: string; signatureRepresentation?: string }>();
        revision(request, permit);
        assert(input.decision === 'APPROVE' || input.decision === 'RETURN', 422, 'VALIDATION_FAILED', 'Selecione uma decisão válida.', 'decision');
        const comment = input.decision === 'RETURN' ? text(input.comment, 'comment') : typeof input.comment === 'string' && input.comment.length <= 4000 ? input.comment.trim() : '';
        assert(input.decision !== 'APPROVE' || input.comment === undefined || typeof input.comment === 'string' && input.comment.length <= 4000, 422, 'VALIDATION_FAILED', 'A observação deve ter até 4.000 caracteres.', 'comment');
        const snapshot = permit.snapshots.find(value => value.version === permit.version)!;
        assert(!snapshot.decision, 409, 'IMMUTABLE_VERSION', 'A versão já possui uma decisão registrada.');
        if (input.decision === 'APPROVE') {
          const signature = text(input.signatureRepresentation, 'signatureRepresentation', 200);
          assert(normalized(signature) === normalized(context.user.displayName), 422, 'SIGNATURE_MISMATCH', 'Confirme sua própria representação de assinatura com seu nome de usuário.', 'signatureRepresentation');
          snapshot.signatureRepresentation = signature;
          permit.reviewStatus = 'VALIDATED';
        } else permit.reviewStatus = 'RETURNED';
        snapshot.decision = input.decision;
        snapshot.comment = comment;
        snapshot.reviewedBy = context.user.id;
        snapshot.reviewedAt = instant();
        permit.reviewComment = comment;
        permit.history.push(event(context, input.decision === 'APPROVE' ? 'FINAL_REVIEW_APPROVED' : 'FINAL_REVIEW_RETURNED', comment, permit.version));
      } else if (action === 'new-version' && method === 'POST') {
        assert(permit.operationStatus === 'COMPLETED' && permit.reviewStatus === 'RETURNED' && !correctionDrafts.has(permit.id), 409, 'INVALID_TRANSITION', 'Uma versão de correção exige devolução documental.');
        const input = await body<{ reason: string }>();
        revision(request, permit);
        const reason = text(input.reason, 'reason');
        permit.version++;
        permit.reviewStatus = 'NOT_SUBMITTED';
        permit.sciences = [];
        correctionDrafts.add(permit.id);
        permit.history.push(event(context, 'CORRECTION_VERSION_CREATED', reason, permit.version));
      } else if (action === 'submit-correction' && method === 'POST') {
        assert(permit.operationStatus === 'COMPLETED' && correctionDrafts.has(permit.id), 409, 'INVALID_TRANSITION', 'Crie a versão de correção antes de reapresentar.');
        ensurePrepared(permit, context, false);
        const input = await body<{ summary: string; closingChecks?: PermitSourceCheckDto[] }>();
        revision(request, permit);
        const summary = text(input.summary, 'summary');
        assert(summary.length >= 10, 422, 'VALIDATION_FAILED', 'Descreva a correção com pelo menos 10 caracteres.', 'summary');
        let closingChecks: PermitSourceCheckDto[] | undefined;
        if (permit.preparation) {
          try { closingChecks = canonicalChecks(input.closingChecks || [], permit.preparation.closingChecks); }
          catch (error) { throw new PermitDemoError(422, 'CLOSING_PENDING', error instanceof Error ? error.message : 'Confira o encerramento.', 'closingChecks'); }
          const error = validateSourceChecks(closingChecks, true);
          assert(!error, 422, 'CLOSING_PENDING', error || '', 'closingChecks');
        }
        permit.summary = summary;
        if (closingChecks) permit.preparation!.closingChecks = closingChecks;
        permit.reviewStatus = 'PENDING_REVIEW';
        correctionDrafts.delete(permit.id);
        permit.snapshots.push({ eligibility: clone(permit.eligibility), templateVersion: permit.templateVersion, ...(permit.serviceTemplates ? { serviceTemplates: clone(permit.serviceTemplates) } : {}), appointment: clone(appointments.get(permit.appointment.id)!), version: permit.version, submittedAt: instant(), summary, checklist: clone(permit.checklist), sciences: clone(permit.sciences), ...(permit.preparation ? { preparation: clone(permit.preparation) } : {}) });
        permit.history.push(event(context, 'CORRECTION_SUBMITTED', summary, permit.version));
      } else throw new PermitDemoError(404, 'NOT_FOUND', 'Operação não prevista na demonstração.');
      permit.revision++;
      return permitResponse(permit, context);
    }
    throw new PermitDemoError(404, 'NOT_FOUND', 'Rota não prevista na demonstração.');
  }
  return { route, handles, dispose: () => { downloadUrls.forEach(value => URL.revokeObjectURL(value)); downloadUrls.clear(); attachmentsDemo.dispose(); } };
}
