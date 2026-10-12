/** Simulação em memória da AT recebida; os nomes declarados não são assinaturas verificadas. */
import type { AppointmentDto, EligibilityDto, PermitEventDto, PermitSourceCheckDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { AuthorizationCreateDto, AuthorizationPreparationDto, AuthorizationRepresentationsDto, AuthorizationReleaseDto, AuthorizationWriteDto, WorkAuthorizationDto } from '../shared/contracts/work-authorizations';
import { AT_REVALIDATION_CAPACITY, AT_SOURCE, canonicalAuthorizationChecks, canonicalAuthorizationPreparation, createAuthorizationClosingChecks, createAuthorizationPreparation, validateAuthorizationChecks, validateAuthorizationPreparation } from '../features/authorizations/model';
import { PermitDemoError, type PermitDemoContext } from './work-permits';

export interface AuthorizationDemoHooks {
  units: { id: string; companyId: string }[];
  appointments: (context: PermitDemoContext) => AppointmentDto[];
  appointmentById: (id: string, context: PermitDemoContext) => AppointmentDto;
  eligibility: (appointment: AppointmentDto, context: PermitDemoContext) => EligibilityDto;
  permitById: (id: string, context: PermitDemoContext) => WorkPermitDto;
  permitsForAppointment: (appointmentId: string, context: PermitDemoContext) => WorkPermitDto[];
  knownResponsible: (id: string) => boolean;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const instant = () => new Date().toISOString();
const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const terminal = (value: WorkAuthorizationDto) => value.status === 'CLOSED' || value.status === 'CANCELED';
function assert(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
function text(value: unknown, field: string, minimum = 10, maximum = 2000) {
  assert(typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum, 422, 'VALIDATION_FAILED', `Informe um texto com ${minimum} a ${maximum} caracteres.`, field);
  return value.trim();
}
function revision(request: Request, value: WorkAuthorizationDto) {
  assert(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Carregue a AT antes de alterar.');
  assert(request.headers.get('If-Match') === `"${value.revision}"`, 412, 'REVISION_CONFLICT', 'A AT mudou. Recarregue e confira a revisão atual.');
}
function permission(context: PermitDemoContext, name: string) {
  assert(context.permissions.includes(name) && !context.user.scope.ownOnly, 403, 'FORBIDDEN', 'Seu perfil não permite esta ação na AT.');
}
function technical(context: PermitDemoContext) {
  return context.user.roles.some(role => ['TECHNICIAN', 'FIREFIGHTER'].includes(role)) && !context.user.roles.some(role => ['ADMIN', 'SESMT_MANAGER'].includes(role));
}
function administrator(context: PermitDemoContext) {
  return context.permissions.includes('at.write') && context.user.roles.some(role => ['ADMIN', 'SESMT_MANAGER'].includes(role));
}
/** Exclui revisões, histórico, estado e vínculo PT; abertura de uma PT não muda as condições. */
function appointmentContext(appointment: AppointmentDto) {
  return JSON.stringify({ companyId: appointment.companyId, unitId: appointment.unitId, teamId: appointment.teamId, serviceTypeId: appointment.serviceTypeId,
    location: normalized(appointment.location), startsAt: Date.parse(appointment.startsAt), endsAt: Date.parse(appointment.endsAt), responsibleId: appointment.responsibleId,
    participants: appointment.participants.map(({ workerId, name, serviceFunction }) => ({ workerId, name: normalized(name), serviceFunction: normalized(serviceFunction) })).sort((a, b) => a.workerId.localeCompare(b.workerId)) });
}

export function makeWorkAuthorizationDemo(hooks: AuthorizationDemoHooks) {
  const authorizations = new Map<string, WorkAuthorizationDto>();
  const handles = (path: string) => /^\/(authorization-options|work-authorizations)(\/|$)/.test(path);
  const event = (context: PermitDemoContext, action: string, reason?: string): PermitEventDto => ({ id: crypto.randomUUID(), action, actorName: context.user.displayName, occurredAt: instant(), reason, version: 1 });
  function queryUnit(url: URL, context: PermitDemoContext, required: boolean) {
    const unitId = url.searchParams.get('unitId');
    assert(!required || unitId, 422, 'VALIDATION_FAILED', 'Selecione a unidade da AT.', 'unitId');
    if (unitId) {
      const unit = hooks.units.find(value => value.id === unitId);
      assert(unit && context.user.scope.unitIds.includes(unitId) && context.user.scope.companyIds.includes(unit.companyId), 403, 'FORBIDDEN', 'Unidade fora do seu alcance.');
      context.checkUnit(unitId);
    }
    return unitId;
  }
  function visible(appointment: AppointmentDto, context: PermitDemoContext, historical = false) {
    const unit = hooks.units.find(value => value.id === appointment.unitId);
    const scope = context.user.scope;
    return !scope.ownOnly && !!unit && scope.companyIds.includes(appointment.companyId || unit.companyId) && scope.unitIds.includes(appointment.unitId)
      && (!scope.teamIds.length || scope.teamIds.includes(appointment.teamId)) && (!technical(context) || appointment.responsibleId === context.user.id)
      && appointment.participants.every(participant => {
        const worker = context.workers.find(value => value.id === participant.workerId);
        return worker && (historical ? scope.unitIds.includes(worker.unitId) : worker.unitId === appointment.unitId) && worker.companyId === (appointment.companyId || unit.companyId) && scope.companyIds.includes(worker.companyId) && (!scope.sectorIds.length || scope.sectorIds.includes(worker.sectorId));
      });
  }
  function appointmentById(id: string, context: PermitDemoContext, historical = false) {
    const value = hooks.appointmentById(id, context);
    assert(visible(value, context, historical), 404, 'NOT_FOUND', 'Atendimento indisponível no seu alcance.');
    context.checkUnit(value.unitId);
    return value;
  }
  function valueById(id: string, context: PermitDemoContext, unitId: string | null) {
    const value = authorizations.get(id);
    assert(value && visible(value.appointment, context, true) && (!unitId || value.unitId === unitId), 404, 'NOT_FOUND', 'AT indisponível no seu alcance.');
    appointmentById(value.appointment.id, context, true);
    return value;
  }
  function openAppointment(appointment: AppointmentDto, context: PermitDemoContext) {
    assert(['CONFIRMED', 'ATTENDANCE_OPENED'].includes(appointment.status), 409, 'INVALID_APPOINTMENT', 'A AT exige agendamento confirmado ou atendimento aberto.');
    const currentPermit = appointment.permitId ? hooks.permitById(appointment.permitId, context) : undefined;
    assert(!currentPermit || !['COMPLETED', 'CANCELED'].includes(currentPermit.operationStatus), 409, 'INVALID_APPOINTMENT', 'Este atendimento já possui PT concluída ou cancelada.');
  }
  function linkedPermit(permitId: unknown, appointment: AppointmentDto, context: PermitDemoContext) {
    if (permitId === undefined || permitId === null || permitId === '') return undefined;
    assert(typeof permitId === 'string', 422, 'VALIDATION_FAILED', 'Selecione uma PT válida.', 'permitId');
    const permit = hooks.permitById(permitId, context);
    assert(permit.appointment.id === appointment.id && !['COMPLETED', 'CANCELED'].includes(permit.operationStatus), 422, 'INVALID_PT_LINK', 'A PT deve pertencer ao mesmo atendimento e permanecer não concluída e não cancelada.', 'permitId');
    return permit;
  }
  function operationActor(value: WorkAuthorizationDto, context: PermitDemoContext) {
    permission(context, 'at.operate');
    const current = appointmentById(value.appointment.id, context, true);
    assert(technical(context) && hooks.knownResponsible(context.user.id) && value.appointment.responsibleId === context.user.id && current.responsibleId === context.user.id,
      403, 'NOT_DESIGNATED', 'Somente o técnico ou bombeiro responsável pelo atendimento pode operar esta AT.');
  }
  function canonicalPreparation(input: AuthorizationPreparationDto, current: AuthorizationPreparationDto, appointment: AppointmentDto) {
    let value: AuthorizationPreparationDto;
    try { value = canonicalAuthorizationPreparation(input, current); }
    catch (error) { throw new PermitDemoError(422, 'VALIDATION_FAILED', error instanceof Error ? error.message : 'Confira o preenchimento da AT.', 'preparation'); }
    const error = validateAuthorizationPreparation(value);
    assert(!error, 422, 'VALIDATION_FAILED', error || '', 'preparation');
    assert(!value.foremanId || appointment.participants.some(participant => participant.workerId === value.foremanId), 422, 'INVALID_FOREMAN', 'O encarregado deve ser um participante deste atendimento.', 'foremanId');
    return value;
  }
  const allSciences = (value: WorkAuthorizationDto) => value.appointment.participants.length > 0 && value.appointment.participants.every(participant => value.sciences.some(science => science.workerId === participant.workerId && science.version === 1 && science.confirmed));
  function currentContext(value: WorkAuthorizationDto, context: PermitDemoContext): AppointmentDto {
    const current = appointmentById(value.appointment.id, context);
    openAppointment(current, context);
    assert(appointmentContext(value.appointment) === appointmentContext(current), 409, 'CONTEXT_CHANGED', 'O atendimento mudou em equipe, serviço, local, período ou responsável. Crie uma nova AT para as condições atuais.');
    if (value.permitId) linkedPermit(value.permitId, current, context);
    return current;
  }
  function currentPrepared(value: WorkAuthorizationDto, context: PermitDemoContext): EligibilityDto {
    const current = currentContext(value, context);
    const error = validateAuthorizationPreparation(value.preparation, true);
    assert(!error, 409, 'PREPARATION_PENDING', error || '', 'preparation');
    assert(value.appointment.participants.some(participant => participant.workerId === value.preparation.foremanId), 409, 'PREPARATION_PENDING', 'Selecione um participante como encarregado.');
    assert(allSciences(value), 409, 'SCIENCES_PENDING', 'Registre a ciência de cada participante desta AT.');
    const eligibility = hooks.eligibility(current, context);
    assert(eligibility.eligible, 409, 'DOCUMENTARY_BLOCK', 'Há participante sem vínculo ativo ou requisito documental pendente, vencido ou reprovado.');
    return eligibility;
  }
  function response(value: WorkAuthorizationDto, context: PermitDemoContext): WorkAuthorizationDto {
    const actions: string[] = [];
    if (context.permissions.includes('at.write') && value.status === 'DRAFT' && !value.sciences.length) actions.push('EDIT');
    if (administrator(context) && !terminal(value)) actions.push('CANCEL');
    const operator = context.permissions.includes('at.operate') && technical(context) && hooks.knownResponsible(context.user.id) && value.appointment.responsibleId === context.user.id && hooks.appointmentById(value.appointment.id, context).responsibleId === context.user.id;
    if (operator && !terminal(value)) {
      if (value.status === 'DRAFT') {
        try { currentContext(value, context); if (!validateAuthorizationPreparation(value.preparation, true) && !allSciences(value)) actions.push('COLLECT_SCIENCE'); } catch (error) { if (!(error instanceof PermitDemoError)) throw error; }
        try { currentPrepared(value, context); actions.push('AUTHORIZE'); } catch (error) { if (!(error instanceof PermitDemoError)) throw error; }
      }
      if (['AUTHORIZED', 'SUSPENDED'].includes(value.status)) {
        if (value.releases.filter(release => release.kind === 'REVALIDATION').length < AT_REVALIDATION_CAPACITY) actions.push('REVALIDATE');
        actions.push('CLOSE');
      }
      if (value.status === 'AUTHORIZED') actions.push('SUSPEND');
      actions.push('CANCEL');
    }
    return { ...clone(value), eligibility: terminal(value) ? clone(value.eligibility) : hooks.eligibility(appointmentById(value.appointment.id, context, true), context), availableActions: actions };
  }
  function representations(input: unknown, value: WorkAuthorizationDto, context: PermitDemoContext): AuthorizationRepresentationsDto {
    assert(input && typeof input === 'object' && !Array.isArray(input), 422, 'VALIDATION_FAILED', 'Confirme as representações declaradas.', 'representations');
    const data = input as Record<string, unknown>;
    assert(data.confirmed === true, 422, 'CONFIRMATION_REQUIRED', 'Confirme expressamente as representações declaradas.', 'representations.confirmed');
    const responsibleName = text(data.responsibleName, 'representations.responsibleName', 3, 160);
    assert(normalized(responsibleName) === normalized(context.user.displayName), 422, 'REPRESENTATION_MISMATCH', 'O responsável deve declarar o próprio nome do usuário autenticado.', 'representations.responsibleName');
    const foreman = value.appointment.participants.find(participant => participant.workerId === value.preparation.foremanId);
    const foremanName = text(data.foremanName, 'representations.foremanName', 3, 160);
    assert(foreman && normalized(foremanName) === normalized(foreman.name), 422, 'REPRESENTATION_MISMATCH', 'O nome declarado deve corresponder ao encarregado selecionado.', 'representations.foremanName');
    return { responsibleName: context.user.displayName, foremanName: foreman.name, issuerName: text(data.issuerName, 'representations.issuerName', 3, 160), confirmed: true };
  }
  async function inputBody(request: Request): Promise<Record<string, unknown>> {
    let body: unknown;
    try { body = await request.json(); } catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie um objeto JSON válido.'); }
    assert(body && typeof body === 'object' && !Array.isArray(body), 422, 'VALIDATION_FAILED', 'Envie os dados em um objeto.');
    return body as Record<string, unknown>;
  }

  async function route(request: Request, url: URL, path: string, context: PermitDemoContext): Promise<unknown> {
    assert(handles(path), 404, 'NOT_FOUND', 'Rota AT indisponível.');
    const parts = path.split('/').filter(Boolean);
    const method = request.method;
    const collection = parts.length === 1;
    const action = parts[2];
    const administrativeCancellation = method === 'POST' && action === 'cancel' && administrator(context);
    permission(context, method === 'GET' ? path === '/authorization-options' ? 'at.write' : 'at.read' : collection || method === 'PATCH' || administrativeCancellation ? 'at.write' : 'at.operate');
    const unitId = queryUnit(url, context, collection);
    if (path === '/authorization-options') {
      assert(method === 'GET', 405, 'METHOD_NOT_ALLOWED', 'A consulta de opções aceita somente GET.');
      const appointments = hooks.appointments(context).filter(appointment => appointment.unitId === unitId && visible(appointment, context) && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(appointment.status)).filter(appointment => {
        const permit = appointment.permitId ? hooks.permitById(appointment.permitId, context) : undefined;
        return !permit || !['COMPLETED', 'CANCELED'].includes(permit.operationStatus);
      }).map(appointment => ({ appointment: clone(appointment), permits: hooks.permitsForAppointment(appointment.id, context).filter(permit => !['COMPLETED', 'CANCELED'].includes(permit.operationStatus)).map(permit => ({ id: permit.id, code: permit.code })) }));
      return { appointments };
    }
    if (collection && method === 'GET') {
      const status = url.searchParams.get('status');
      const query = normalized(url.searchParams.get('q') || '');
      return [...authorizations.values()].filter(value => value.unitId === unitId && visible(value.appointment, context, true) && (!status || value.status === status) && (!query || normalized(`${value.code} ${value.appointment.teamName} ${value.appointment.location} ${value.preparation.identification.activityDescription}`).includes(query)))
        .filter(value => { try { appointmentById(value.appointment.id, context, true); return true; } catch (error) { if (error instanceof PermitDemoError && error.status === 404) return false; throw error; } }).map(value => response(value, context));
    }
    if (collection && method === 'POST') {
      const data = await inputBody(request) as unknown as AuthorizationCreateDto;
      permission(context, 'at.write'); queryUnit(url, context, true);
      assert(typeof data.appointmentId === 'string', 422, 'VALIDATION_FAILED', 'Selecione o atendimento.', 'appointmentId');
      const appointment = appointmentById(data.appointmentId, context);
      assert(appointment.unitId === unitId, 422, 'INVALID_ASSIGNMENT', 'O atendimento deve pertencer à unidade selecionada.', 'appointmentId');
      openAppointment(appointment, context);
      assert(![...authorizations.values()].some(value => value.appointment.id === appointment.id && !terminal(value)), 409, 'AUTHORIZATION_ALREADY_OPEN', 'Este atendimento já possui uma AT não encerrada.');
      const preparation = canonicalPreparation(data, createAuthorizationPreparation(appointment), appointment);
      const permit = linkedPermit(data.permitId, appointment, context);
      const time = instant();
      const value: WorkAuthorizationDto = { id: crypto.randomUUID(), code: `AT-DEMO-${String(authorizations.size + 1).padStart(3, '0')}`, companyId: appointment.companyId || hooks.units.find(unit => unit.id === appointment.unitId)!.companyId, unitId: appointment.unitId, revision: 1,
        sourceId: AT_SOURCE.sourceId, sourceRevision: AT_SOURCE.sourceRevision, sourceSha256: AT_SOURCE.sourceSha256, appointment: clone(appointment), permitId: permit?.id, permitCode: permit?.code, preparation, status: 'DRAFT', sciences: [], eligibility: clone(hooks.eligibility(appointment, context)), releases: [], closingChecks: createAuthorizationClosingChecks(), history: [event(context, 'AUTHORIZATION_CREATED')], availableActions: [], createdAt: time, createdByName: context.user.displayName };
      authorizations.set(value.id, value);
      return response(value, context);
    }
    assert(!collection && parts.length <= 3, 404, 'NOT_FOUND', 'Operação AT indisponível.');
    const value = valueById(parts[1], context, unitId);
    if (parts.length === 2 && method === 'GET') return response(value, context);
    revision(request, value);
    if (parts.length === 2 && method === 'PATCH') {
      assert(value.status === 'DRAFT', 409, 'IMMUTABLE_AUTHORIZATION', 'A AT autorizada ou encerrada preserva o preenchimento original.');
      assert(!value.sciences.length, 409, 'SCIENCE_LOCKED_PREPARATION', 'A ciência preserva o conteúdo apresentado ao participante.');
      const data = await inputBody(request) as unknown as AuthorizationWriteDto;
      revision(request, value); permission(context, 'at.write'); valueById(value.id, context, unitId);
      const preparation = canonicalPreparation(data, value.preparation, value.appointment);
      const permit = linkedPermit(data.permitId, value.appointment, context);
      value.preparation = preparation; value.permitId = permit?.id; value.permitCode = permit?.code;
      value.history.push(event(context, 'AUTHORIZATION_UPDATED'));
    } else {
      assert(method === 'POST' && ['sciences', 'authorize', 'revalidate', 'suspend', 'close', 'cancel'].includes(action), 404, 'NOT_FOUND', 'Operação AT indisponível.');
      if (!administrativeCancellation) operationActor(value, context);
      const data = await inputBody(request);
      // Esta revisão deve ocorrer no chamador, depois do await e no mesmo turno da escrita.
      revision(request, value); valueById(value.id, context, unitId);
      if (administrativeCancellation) { permission(context, 'at.write'); assert(administrator(context), 403, 'FORBIDDEN', 'Cancelamento administrativo exige gestor ou administrador.'); }
      else operationActor(value, context);
      if (action === 'sciences') {
        assert(value.status === 'DRAFT', 409, 'INVALID_TRANSITION', 'Colete ciências apenas na AT em preenchimento.');
        currentContext(value, context);
        const error = validateAuthorizationPreparation(value.preparation, true);
        assert(!error, 409, 'PREPARATION_PENDING', error || 'Conclua a preparação.');
        const participant = value.appointment.participants.find(item => item.workerId === data.workerId);
        assert(participant && normalized(text(data.declarantName, 'declarantName', 3, 160)) === normalized(participant.name), 422, 'DECLARANT_MISMATCH', 'Declare o nome do participante selecionado.', 'declarantName');
        assert(data.confirmed === true && ['TYPED', 'DRAWN'].includes(String(data.method)), 422, 'SCIENCE_CONFIRMATION_REQUIRED', 'Confirme o método e a declaração de ciência.', 'confirmed');
        const representation = text(data.representation, 'representation', 1, 1000000);
        assert(data.method === 'TYPED' ? normalized(representation) === normalized(participant.name) : /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(representation), 422, 'INVALID_REPRESENTATION', 'Confira o nome digitado ou o desenho.', 'representation');
        assert(!value.sciences.some(science => science.workerId === participant.workerId), 409, 'SCIENCE_ALREADY_RECORDED', 'A ciência deste participante já foi registrada.');
        value.sciences.push({ id: crypto.randomUUID(), workerId: participant.workerId, declarantName: participant.name, method: data.method as 'TYPED' | 'DRAWN', representation, confirmed: true, collectedBy: context.user.id, collectedByName: context.user.displayName, collectedAt: instant(), version: 1 });
        value.history.push(event(context, 'AUTHORIZATION_SCIENCE_COLLECTED', `Declarante: ${participant.name}; coleta pelo usuário autenticado.`));
      } else if (action === 'authorize' || action === 'revalidate') {
        if (action === 'authorize') assert(value.status === 'DRAFT' && !value.releases.length, 409, 'INVALID_TRANSITION', 'A autorização inicial exige AT em preenchimento.');
        else {
          assert(['AUTHORIZED', 'SUSPENDED'].includes(value.status), 409, 'INVALID_TRANSITION', 'Revalide apenas AT autorizada ou suspensa.');
          assert(value.releases.filter(release => release.kind === 'REVALIDATION').length < AT_REVALIDATION_CAPACITY, 409, 'REVALIDATION_LIMIT', 'O formulário recebido contém seis espaços de revalidação. Crie uma nova AT ao esgotar esse registro.');
          assert(data.sameTeam === true, 409, 'TEAM_CHANGED', 'Confirme a manutenção da equipe; alteração exige nova AT.', 'sameTeam');
          assert(data.sameConditions === true, 409, 'CONDITIONS_CHANGED', 'Confirme a manutenção das condições; alteração exige nova AT.', 'sameConditions');
        }
        const reason = action === 'revalidate' ? text(data.reason, 'reason') : undefined;
        const declared = representations(data.representations, value, context);
        const eligibility = currentPrepared(value, context);
        const time = instant();
        const validFrom = new Date(Math.max(Date.now(), Date.parse(value.appointment.startsAt))).toISOString();
        assert(typeof data.validUntil === 'string' && Number.isFinite(Date.parse(data.validUntil)) && Date.parse(data.validUntil) > Date.parse(validFrom) && Date.parse(data.validUntil) <= Date.parse(value.appointment.endsAt), 422, 'INVALID_AUTHORIZATION_WINDOW', 'O fim deve ser posterior ao início da validade e não ultrapassar o período planejado.', 'validUntil');
        const release: AuthorizationReleaseDto = { id: crypto.randomUUID(), sequence: value.releases.length + 1, kind: action === 'authorize' ? 'INITIAL' : 'REVALIDATION', occurredAt: time, validFrom, validUntil: new Date(data.validUntil).toISOString(), actorId: context.user.id, actorName: context.user.displayName, reason, representations: declared, eligibility: clone(eligibility) };
        value.releases.push(release); value.eligibility = clone(eligibility); value.status = 'AUTHORIZED'; delete value.suspensionReason;
        value.history.push(event(context, action === 'authorize' ? 'AUTHORIZATION_AUTHORIZED' : 'AUTHORIZATION_REVALIDATED', reason || 'Preparação, ciências e requisitos conferidos nesta autorização demonstrativa.'));
      } else if (action === 'suspend' || action === 'cancel') {
        assert(action === 'suspend' ? value.status === 'AUTHORIZED' : ['DRAFT', 'AUTHORIZED', 'SUSPENDED'].includes(value.status), 409, 'INVALID_TRANSITION', 'O estado da AT não permite esta ação.');
        assert(data.confirmed === true, 422, 'CONFIRMATION_REQUIRED', 'Confirme expressamente esta ação.', 'confirmed');
        const reason = text(data.reason, 'reason');
        if (action === 'suspend') { value.status = 'SUSPENDED'; value.suspensionReason = reason; }
        else { value.eligibility = clone(hooks.eligibility(appointmentById(value.appointment.id, context, true), context)); value.status = 'CANCELED'; value.cancellationReason = reason; }
        value.history.push(event(context, action === 'suspend' ? 'AUTHORIZATION_SUSPENDED' : administrativeCancellation ? 'AUTHORIZATION_ADMIN_CANCELED' : 'AUTHORIZATION_CANCELED', reason));
      } else {
        assert(['AUTHORIZED', 'SUSPENDED'].includes(value.status), 409, 'INVALID_TRANSITION', 'Encerre apenas AT autorizada ou suspensa.');
        const summary = text(data.summary, 'summary');
        let checks: PermitSourceCheckDto[];
        try { checks = canonicalAuthorizationChecks(data.checks as PermitSourceCheckDto[], createAuthorizationClosingChecks()); }
        catch (error) { throw new PermitDemoError(422, 'CLOSING_PENDING', error instanceof Error ? error.message : 'Confira o encerramento.', 'checks'); }
        const error = validateAuthorizationChecks(checks, true);
        assert(!error, 422, 'CLOSING_PENDING', error || '', 'checks');
        const declared = representations(data.representations, value, context);
        value.closingChecks = checks; value.closure = { summary, checks: clone(checks), representations: declared, occurredAt: instant(), actorId: context.user.id, actorName: context.user.displayName };
        // O término guarda a consulta atual; cada autorização mantém sua própria conferência.
        value.eligibility = clone(hooks.eligibility(appointmentById(value.appointment.id, context, true), context));
        value.status = 'CLOSED'; value.history.push(event(context, 'AUTHORIZATION_CLOSED', summary));
      }
    }
    value.revision++;
    return response(value, context);
  }
  return { handles, route };
}
