/** Gestão sintética de equipes no navegador. A API real deve aplicar as mesmas fronteiras. */
import type { TeamDto } from '../shared/contracts/work-permits';
import type { TeamOptionsDto, TeamWriteDto } from '../shared/contracts/teams';
import { normalizedTeamText, teamFormSchema } from '../features/teams/validation';
import { PermitDemoError, type PermitDemoContext } from './work-permits';

function require(condition: unknown, status: number, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new PermitDemoError(status, code, message, field);
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function createTeamManagement(teams: TeamDto[]) {
  // GET /teams remains owned by the permit demo so its list shares this array.
  const handles = (path: string) => path === '/team-options' || path === '/teams' || /^\/teams\/[^/]+$/.test(path);
  const visible = (team: TeamDto, context: PermitDemoContext) => !context.user.scope.ownOnly
    && context.user.scope.companyIds.includes(team.companyId)
    && context.user.scope.unitIds.includes(team.unitId)
    && (!context.user.scope.teamIds.length || context.user.scope.teamIds.includes(team.id));
  const byId = (teamId: string, context: PermitDemoContext) => {
    const team = teams.find(value => value.id === teamId);
    require(team && visible(team, context), 404, 'NOT_FOUND', 'Equipe indisponível no seu escopo.');
    context.checkUnit(team.unitId);
    return team;
  };
  const roster = (unitId: string, context: PermitDemoContext) => {
    const permittedMembers = new Set(teams.filter(team => visible(team, context) && team.unitId === unitId).flatMap(team => team.members.map(member => member.workerId)));
    return context.workers.filter(worker => worker.status === 'ACTIVE' && worker.unitId === unitId
      && context.user.scope.companyIds.includes(worker.companyId)
      && (!context.user.scope.teamIds.length || permittedMembers.has(worker.id)));
  };

  async function route(request: Request, url: URL, path: string, context: PermitDemoContext): Promise<unknown | undefined> {
    if (!handles(path)) return undefined;
    if (path === '/teams' && request.method === 'GET') return undefined;
    const reading = request.method === 'GET';
    require(context.permissions.includes(reading ? 'teams.read' : 'teams.write'), 403, 'FORBIDDEN', 'Seu perfil não permite esta ação.');
    require(!context.user.scope.ownOnly, 403, 'FORBIDDEN', 'O cadastro de equipes exige acesso ao conjunto de participantes.');
    if (path === '/team-options' && reading) {
      const unitId = url.searchParams.get('unitId');
      require(unitId, 422, 'VALIDATION_FAILED', 'Informe a unidade para consultar os participantes.', 'unitId');
      context.checkUnit(unitId);
      require(context.user.scope.unitIds.includes(unitId), 403, 'FORBIDDEN', 'Unidade fora do seu escopo.');
      const result: TeamOptionsDto = { unitId, workers: roster(unitId, context).map(worker => ({ id: worker.id, name: worker.fullName, companyId: worker.companyId, unitId: worker.unitId })) };
      return clone(result);
    }
    const teamId = path.split('/')[2];
    if (teamId && reading) return clone(byId(teamId, context));
    if (!((path === '/teams' && request.method === 'POST') || (teamId && request.method === 'PATCH'))) throw new PermitDemoError(404, 'NOT_FOUND', 'Operação de equipe não prevista na demonstração.');
    const existing = teamId ? byId(teamId, context) : undefined;
    if (existing) {
      require(request.headers.has('If-Match'), 428, 'PRECONDITION_REQUIRED', 'Recarregue a equipe antes de alterar.');
      require(request.headers.get('If-Match') === `"${existing.revision}"`, 412, 'REVISION_CONFLICT', 'Esta equipe mudou desde que o formulário foi aberto. Seus dados foram preservados.');
    } else require(!context.user.scope.teamIds.length, 403, 'FORBIDDEN', 'A concessão restrita a equipes existentes não permite cadastrar outra equipe.');
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Envie os dados da equipe em JSON válido.'); }
    if (existing) require(request.headers.get('If-Match') === `"${byId(existing.id, context).revision}"`, 412, 'REVISION_CONFLICT', 'Esta equipe mudou durante o envio. Seus dados foram preservados.');
    if (existing && typeof raw === 'object' && raw !== null && 'status' in raw && !('name' in raw)) {
      const statusInput = (raw as { status?: string; inactiveReason?: string }).status;
      require(statusInput === 'ACTIVE' || statusInput === 'INACTIVE', 422, 'VALIDATION_FAILED', 'Situação da equipe inválida.', 'status');
      const reason = (raw as { inactiveReason?: string }).inactiveReason?.trim();
      if (statusInput === 'INACTIVE' && reason) {
        require(reason.length <= 300, 422, 'VALIDATION_FAILED', 'O motivo da inativação deve ter até 300 caracteres.', 'inactiveReason');
      }
      existing.status = statusInput;
      existing.inactiveReason = reason;
      existing.revision++;
      return clone(existing);
    }
    const parsed = teamFormSchema.safeParse(raw);
    require(parsed.success, 422, 'VALIDATION_FAILED', parsed.success ? '' : parsed.error.issues[0].message, parsed.success ? undefined : parsed.error.issues[0].path.join('.'));
    const input: TeamWriteDto = parsed.data;
    context.checkUnit(input.unitId);
    require(context.user.scope.unitIds.includes(input.unitId), 403, 'FORBIDDEN', 'Unidade fora do seu escopo.');
    require(!existing || existing.unitId === input.unitId, 422, 'INVALID_ASSIGNMENT', 'A unidade de uma equipe existente não pode ser alterada neste cadastro.', 'unitId');
    const available = roster(input.unitId, context);
    const members = input.members.map((member, index) => {
      const worker = available.find(value => value.id === member.workerId);
      require(worker, 422, 'INVALID_ASSIGNMENT', 'Selecione um trabalhador ativo e disponível nesta unidade.', `members.${index}.workerId`);
      return { workerId: worker.id, name: worker.fullName, serviceFunction: member.serviceFunction };
    });
    const companyId = existing?.companyId || available.find(worker => worker.id === members[0].workerId)!.companyId;
    input.members.forEach((member, index) => require(available.find(worker => worker.id === member.workerId)?.companyId === companyId, 422, 'INVALID_ASSIGNMENT', 'Todos os participantes devem estar vinculados à empresa da equipe.', `members.${index}.workerId`));
    const name = input.name.replace(/\s+/g, ' ');
    require(!teams.some(team => team.id !== existing?.id && team.unitId === input.unitId && normalizedTeamText(team.name) === normalizedTeamText(name)), 409, 'DUPLICATE_TEAM', 'Já existe uma equipe com este nome nesta unidade.', 'name');
    const saved: TeamDto = {
      id: existing?.id || crypto.randomUUID(),
      name,
      unitId: input.unitId,
      companyId,
      chiefId: input.chiefId,
      members,
      revision: (existing?.revision || 0) + 1,
      status: existing?.status || 'ACTIVE',
      inactiveReason: existing?.inactiveReason,
    };
    // Replace only the current roster; saved appointment/PT copies stay untouched.
    if (existing) teams[teams.indexOf(existing)] = saved;
    else teams.push(saved);
    return clone(saved);
  }
  return { handles, route };
}
