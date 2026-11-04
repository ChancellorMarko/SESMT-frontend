/** Convites sintéticos em memória. A API real deve aplicar estas fronteiras. */
import type { OrganizationDto } from '../shared/contracts';
import type { AppointmentDto, ParticipantDto, ServiceTypeDto, TeamDto } from '../shared/contracts/work-permits';
import type { TeamInviteDto, TeamInviteWriteDto, PublicTeamInviteDto, PublicInviteAppointmentDto, PublicInviteAppointmentWriteDto } from '../shared/contracts/teams';
import { PermitDemoError, type PermitDemoContext } from './work-permits';
import { id } from './fixtures';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function require(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}

export interface TeamInviteAppointmentCreateInput {
  inviteId: string;
  team: TeamDto;
  serviceTypeIds: string[];
  services: ServiceTypeDto[];
  location: string;
  startsAt: string;
  endsAt: string;
  participants: ParticipantDto[];
  notes?: string;
  declarantName: string;
}
export interface TeamInviteAppointmentsBridge {
  services: (team: TeamDto) => ServiceTypeDto[];
  create: (input: TeamInviteAppointmentCreateInput) => AppointmentDto;
  read: (id: string) => AppointmentDto | undefined;
}

export function createTeamInvites(teams: TeamDto[], organization?: () => Pick<OrganizationDto, 'companies' | 'units'>, appointments?: TeamInviteAppointmentsBridge) {
  const memberTokens = new Map<string, Map<string, string>>();
  const requests = new Map<string, PublicInviteAppointmentDto[]>();
  const retries = new Map<string, { payload: string; id: string }>();
  const membersFor = (invite: TeamInviteDto, team: TeamDto) => {
    let map = memberTokens.get(invite.id);
    if (!map) { map = new Map(); memberTokens.set(invite.id, map); }
    return team.members.map(member => {
      if (!map!.has(member.workerId)) map!.set(member.workerId, crypto.randomUUID());
      return { ...member, memberId: map!.get(member.workerId)! };
    });
  };
  const origin = () => typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const names = (team: TeamDto) => ({
    teamName: team.name,
    unitName: organization?.().units.find(unit => unit.id === team.unitId)?.name || 'Unidade da equipe',
    companyName: organization?.().companies.find(company => company.id === team.companyId)?.name || 'Empresa da equipe',
    membersCount: team.members.length,
    serviceFunctions: [...new Set(team.members.map(member => member.serviceFunction))],
  });
  const seedTeam = teams.find(team => team.id === id(200));
  const invites: TeamInviteDto[] = seedTeam ? [
    { id: 'invite-demo-active', token: 'tok-equipe-civil-2026', status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000 * 3).toISOString() },
    { id: 'invite-demo-expired', token: 'tok-equipe-expirada', status: 'EXPIRED', expiresAt: '2026-01-01T00:00:00Z' },
    { id: 'invite-demo-revoked', token: 'tok-equipe-revogada', status: 'REVOKED', expiresAt: new Date(Date.now() + 86400000 * 2).toISOString() },
  ].map(seed => ({
    ...seed, status: seed.status as TeamInviteDto['status'], teamId: seedTeam.id,
    unitId: seedTeam.unitId, companyId: seedTeam.companyId, ...names(seedTeam),
    createdAt: new Date().toISOString(), createdByName: 'Administrador Demo',
    shareUrl: `${origin()}/convite/${seed.token}`,
  })) : [];

  const handles = (path: string) => path === '/team-invites'
    || /^\/team-invites\/[^/]+$/.test(path)
    || /^\/team-invites\/public\/[^/]+$/.test(path)
    || /^\/team-invites\/public\/[^/]+\/appointments$/.test(path)
    || /^\/team-invites\/[^/]+\/revoke$/.test(path);
  const visible = (team: TeamDto, context: PermitDemoContext) => !context.user.scope.ownOnly
    && context.user.scope.companyIds.includes(team.companyId)
    && context.user.scope.unitIds.includes(team.unitId)
    && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(team.id))
    && (!context.user.scope.expiresAt || Date.parse(context.user.scope.expiresAt) > Date.now());
  const byTeam = (teamId: string, context: PermitDemoContext) => {
    const team = teams.find(value => value.id === teamId);
    require(team && visible(team, context), 404, 'NOT_FOUND', 'Equipe indisponível no seu escopo.');
    context.checkUnit(team.unitId);
    return team;
  };
  const status = (invite: TeamInviteDto, team?: TeamDto): TeamInviteDto['status'] => {
    if (invite.status === 'REVOKED' || !team) return 'REVOKED';
    if (Date.parse(invite.expiresAt) <= Date.now() || invite.status === 'EXPIRED') return 'EXPIRED';
    return team.status === 'INACTIVE' ? 'REVOKED' : invite.status;
  };
  const view = (invite: TeamInviteDto, team: TeamDto): TeamInviteDto => ({ ...clone(invite), ...names(team), status: status(invite, team), unavailableReason: team.status === 'INACTIVE' && invite.status === 'ACTIVE' && Date.parse(invite.expiresAt) > Date.now() ? 'TEAM_INACTIVE' : undefined });

  async function route(request: Request, url: URL, path: string, context?: PermitDemoContext): Promise<unknown | undefined> {
    if (!handles(path)) return undefined;
    if (path.startsWith('/team-invites/public/')) {
      const requestEndpoint = path.endsWith('/appointments');
      require(request.method === 'GET' || requestEndpoint && request.method === 'POST', 405, 'METHOD_NOT_ALLOWED', 'Este convite permite apenas consulta e solicitação de atendimento.');
      let token: string;
      try { token = decodeURIComponent(path.slice('/team-invites/public/'.length).replace(/\/appointments$/, '')); }
      catch { throw new PermitDemoError(404, 'NOT_FOUND', 'Convite de equipe não encontrado ou link inválido.'); }
      const found = invites.find(invite => invite.token === token);
      require(found, 404, 'NOT_FOUND', 'Convite de equipe não encontrado ou link inválido.');
      const team = teams.find(value => value.id === found.teamId);
      require(team, 404, 'NOT_FOUND', 'A equipe deste convite não está mais disponível.');
      const currentStatus = status(found, team);
      const active = currentStatus === 'ACTIVE' && Boolean(team);
      const publicRequests = () => (requests.get(found.id) || []).map(saved => {
        const current = appointments?.read(saved.id);
        return { ...clone(saved), status: current?.status || saved.status, confirmedStartsAt: current?.confirmedStartsAt, confirmedEndsAt: current?.confirmedEndsAt };
      });
      if (requestEndpoint) {
        const requireActive = () => {
          const latestTeam = teams.find(value => value.id === found.teamId);
          require(latestTeam && status(found, latestTeam) === 'ACTIVE', 410, 'INVITE_UNAVAILABLE', 'Este convite expirou, foi revogado ou a equipe está inativa. Solicite um novo link.');
          return latestTeam;
        };
        requireActive();
        require(appointments, 503, 'REQUESTS_UNAVAILABLE', 'A solicitação por convite ainda não está disponível neste ambiente.');
        if (request.method === 'GET') return clone(publicRequests());
        const key = request.headers.get('Idempotency-Key');
        require(key && /^[A-Za-z0-9_-]{8,128}$/.test(key), 422, 'VALIDATION_FAILED', 'Envie uma chave válida para evitar solicitações duplicadas.');
        let raw: unknown;
        try { raw = await request.json(); }
        catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie a solicitação em JSON válido.'); }
        // Revocation, expiry and roster changes can occur while the body is being read.
        const currentTeam = requireActive();
        require(raw && typeof raw === 'object' && !Array.isArray(raw), 422, 'VALIDATION_FAILED', 'Preencha os dados da solicitação.');
        const input = raw as PublicInviteAppointmentWriteDto;
        const fields = ['serviceTypeIds', 'location', 'startsAt', 'endsAt', 'participants', 'notes', 'declarantName', 'acknowledged'];
        require(Object.keys(input).every(field => fields.includes(field)), 422, 'VALIDATION_FAILED', 'O convite determina a equipe e o alcance desta solicitação.');
        const validText = (value: unknown, field: string, minimum: number, maximum: number) => {
          require(typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum, 422, 'VALIDATION_FAILED', `Confira o campo ${field}.`, field);
          return value.trim();
        };
        const availableServices = appointments.services(currentTeam);
        require(Array.isArray(input.serviceTypeIds) && input.serviceTypeIds.length > 0 && input.serviceTypeIds.length <= 7 && new Set(input.serviceTypeIds).size === input.serviceTypeIds.length && input.serviceTypeIds.every(value => typeof value === 'string' && availableServices.some(service => service.id === value)), 422, 'VALIDATION_FAILED', 'Selecione de um a sete serviços disponíveis, sem repetição.', 'serviceTypeIds');
        const location = validText(input.location, 'location', 3, 200);
        const declarantName = validText(input.declarantName, 'declarantName', 3, 100);
        const validInstant = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
        require(validInstant(input.startsAt) && validInstant(input.endsAt) && Date.parse(input.startsAt) > Date.now() && Date.parse(input.endsAt) > Date.parse(input.startsAt), 422, 'VALIDATION_FAILED', 'Informe um período futuro válido; o término deve ocorrer depois do início.', 'endsAt');
        require(input.acknowledged === true, 422, 'VALIDATION_FAILED', 'Confirme que esta solicitação não libera a execução do serviço.', 'acknowledged');
        require(input.notes === undefined || typeof input.notes === 'string' && input.notes.length <= 2000, 422, 'VALIDATION_FAILED', 'Use até 2.000 caracteres nas observações.', 'notes');
        const roster = membersFor(found, currentTeam);
        require(Array.isArray(input.participants) && input.participants.length > 0 && input.participants.length <= 100 && input.participants.every(value => value && typeof value === 'object') && new Set(input.participants.map(value => value.memberId)).size === input.participants.length, 422, 'VALIDATION_FAILED', 'Selecione participantes disponíveis, sem repetição.', 'participants');
        const participants = input.participants.map(value => {
          require(Object.keys(value).every(field => field === 'memberId' || field === 'serviceFunction'), 422, 'VALIDATION_FAILED', 'A identidade do participante deve vir do convite.', 'participants');
          const member = roster.find(person => person.memberId === value.memberId);
          require(member, 422, 'INVALID_ASSIGNMENT', 'Um participante não está mais disponível nesta equipe.', 'participants');
          return { workerId: member.workerId, name: member.name, serviceFunction: validText(value.serviceFunction, 'participants', 1, 100) };
        });
        const selectedServices = input.serviceTypeIds.map(serviceId => availableServices.find(service => service.id === serviceId)!);
        const normalizedInput = { serviceTypeIds: input.serviceTypeIds, location, startsAt: input.startsAt, endsAt: input.endsAt, participants, notes: input.notes?.trim() || '', declarantName };
        const serialized = JSON.stringify(normalizedInput);
        const retryKey = `${found.id}:${key}`;
        const retry = retries.get(retryKey);
        if (retry) {
          require(retry.payload === serialized, 409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada para outra solicitação.');
          return clone(publicRequests().find(item => item.id === retry.id));
        }
        const created = appointments.create({ ...normalizedInput, inviteId: found.id, team: clone(currentTeam), services: clone(selectedServices) });
        const saved: PublicInviteAppointmentDto = {
          id: created.id, code: created.code, status: created.status,
          services: selectedServices.map(service => ({ id: service.id, name: service.name })), location,
          requestedStartsAt: input.startsAt, requestedEndsAt: input.endsAt,
          participants: participants.map(({ name, serviceFunction }) => ({ name, serviceFunction })), declarantName, requestedAt: new Date().toISOString(),
        };
        requests.set(found.id, [saved, ...(requests.get(found.id) || [])]);
        retries.set(retryKey, { payload: serialized, id: saved.id });
        return clone(saved);
      }
      const publicDto: PublicTeamInviteDto = {
        token: found.token, teamId: found.teamId, teamName: team?.name || found.teamName,
        unitName: active ? names(team!).unitName : '', companyName: active ? names(team!).companyName : '',
        chiefName: active ? team!.members.find(member => member.workerId === team!.chiefId)?.name || 'Não informado' : '',
        status: currentStatus, expiresAt: found.expiresAt,
        ...(currentStatus === 'REVOKED' && found.status !== 'REVOKED' && team.status === 'INACTIVE' ? { unavailableReason: 'TEAM_INACTIVE' as const } : {}),
        members: active ? membersFor(found, team).map(member => ({ memberId: member.memberId, name: member.name, serviceFunction: member.serviceFunction, isChief: member.workerId === team.chiefId })) : [],
        operationalInstructions: active ? 'Confira a equipe com o responsável e siga as orientações do atendimento. Este convite não libera a execução nem substitui a PT.' : '',
        ...(active && appointments ? { appointmentRequestsEnabled: true, services: appointments.services(team).map(({ id, name, description }) => ({ id, name, description })) } : {}),
      };
      return clone(publicDto);
    }

    require(context, 401, 'UNAUTHORIZED', 'Sessão necessária para gerenciar convites.');
    const reading = request.method === 'GET';
    require(context.permissions.includes(reading ? 'teams.read' : 'teams.write'), 403, 'FORBIDDEN', 'Seu perfil não permite esta ação.');
    require(!context.user.scope.ownOnly, 403, 'FORBIDDEN', 'Seu escopo não permite gerenciar convites de equipe.');

    if (path === '/team-invites' && reading) {
      const teamId = url.searchParams.get('teamId');
      const unitId = url.searchParams.get('unitId');
      if (teamId) byTeam(teamId, context);
      if (unitId) {
        context.checkUnit(unitId);
        require(context.user.scope.unitIds.includes(unitId), 403, 'FORBIDDEN', 'Unidade fora do seu escopo.');
      }
      return invites.flatMap(invite => {
        const team = teams.find(value => value.id === invite.teamId);
        return team && visible(team, context) && (!teamId || teamId === team.id) && (!unitId || unitId === team.unitId) ? [view(invite, team)] : [];
      });
    }

    if (path === '/team-invites' && request.method === 'POST') {
      let raw: unknown;
      try { raw = await request.json(); }
      catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie os dados do convite em JSON válido.'); }
      require(raw && typeof raw === 'object' && !Array.isArray(raw), 422, 'VALIDATION_FAILED', 'Informe os dados do convite.');
      const input = raw as TeamInviteWriteDto;
      require(typeof input.teamId === 'string' && input.teamId.length > 0, 422, 'VALIDATION_FAILED', 'Selecione a equipe para gerar o convite.', 'teamId');
      const team = byTeam(input.teamId, context);
      require(team.status !== 'INACTIVE', 409, 'TEAM_INACTIVE', 'Não é possível gerar convite para uma equipe inativa.');
      const hours = input.validityHours === undefined ? 48 : input.validityHours;
      require(Number.isInteger(hours) && hours >= 1 && hours <= 168, 422, 'VALIDATION_FAILED', 'Informe uma validade inteira entre 1 e 168 horas.', 'validityHours');
      const token = `inv-${crypto.randomUUID()}`;
      const created: TeamInviteDto = {
        id: crypto.randomUUID(), token, teamId: team.id, unitId: team.unitId, companyId: team.companyId,
        ...names(team), status: 'ACTIVE', expiresAt: new Date(Date.now() + hours * 3600000).toISOString(),
        createdAt: new Date().toISOString(), createdByName: context.user.displayName, shareUrl: `${origin()}/convite/${token}`,
      };
      invites.unshift(created);
      return clone(created);
    }

    const inviteId = path.split('/')[2];
    const invite = invites.find(value => value.id === inviteId);
    require(invite, 404, 'NOT_FOUND', 'Convite indisponível no seu escopo.');
    const team = byTeam(invite.teamId, context);
    if (reading && path === `/team-invites/${inviteId}`) return view(invite, team);
    if (path === `/team-invites/${inviteId}/revoke` && request.method === 'POST') {
      require(invite.status !== 'REVOKED', 409, 'ALREADY_REVOKED', 'Este convite já foi revogado.');
      invite.status = 'REVOKED';
      return view(invite, team);
    }
    throw new PermitDemoError(404, 'NOT_FOUND', 'Operação não prevista na demonstração.');
  }
  return { handles, route };
}
