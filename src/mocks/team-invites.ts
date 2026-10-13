/** Gestão sintética de convites de equipe por link no navegador. */
import type { TeamDto } from '../shared/contracts/work-permits';
import type { TeamInviteDto, TeamInviteWriteDto, PublicTeamInviteDto } from '../shared/contracts/teams';
import { PermitDemoError, type PermitDemoContext } from './work-permits';
import { UNIT_A, COMPANY, id } from './fixtures';

export function createTeamInvites(teams: TeamDto[]) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const invites: TeamInviteDto[] = [
    {
      id: 'invite-demo-active',
      token: 'tok-equipe-civil-2026',
      teamId: id(200),
      teamName: 'Equipe Civil Alpha',
      unitId: UNIT_A,
      unitName: 'Unidade Principal',
      companyId: COMPANY,
      companyName: 'Mineração Vale do Rio Doce',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86400000 * 3).toISOString(),
      createdAt: new Date().toISOString(),
      createdByName: 'Administrador Demo',
      membersCount: 2,
      serviceFunctions: ['Executante', 'Apoio'],
      shareUrl: `${origin}/convite/tok-equipe-civil-2026`,
    },
    {
      id: 'invite-demo-expired',
      token: 'tok-equipe-expirada',
      teamId: id(200),
      teamName: 'Equipe Civil Alpha',
      unitId: UNIT_A,
      unitName: 'Unidade Principal',
      companyId: COMPANY,
      companyName: 'Mineração Vale do Rio Doce',
      status: 'EXPIRED',
      expiresAt: '2026-01-01T00:00:00Z',
      createdAt: '2025-12-25T00:00:00Z',
      createdByName: 'Administrador Demo',
      membersCount: 2,
      serviceFunctions: ['Executante', 'Apoio'],
      shareUrl: `${origin}/convite/tok-equipe-expirada`,
    },
    {
      id: 'invite-demo-revoked',
      token: 'tok-equipe-revogada',
      teamId: id(200),
      teamName: 'Equipe Civil Alpha',
      unitId: UNIT_A,
      unitName: 'Unidade Principal',
      companyId: COMPANY,
      companyName: 'Mineração Vale do Rio Doce',
      status: 'REVOKED',
      expiresAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      createdAt: new Date().toISOString(),
      createdByName: 'Administrador Demo',
      membersCount: 2,
      serviceFunctions: ['Executante'],
      shareUrl: `${origin}/convite/tok-equipe-revogada`,
    },
  ];

  const handles = (path: string) =>
    path === '/team-invites' ||
    /^\/team-invites\/[^/]+$/.test(path) ||
    /^\/team-invites\/public\/[^/]+$/.test(path) ||
    /^\/team-invites\/[^/]+\/revoke$/.test(path);

  async function route(
    request: Request,
    url: URL,
    path: string,
    context?: PermitDemoContext
  ): Promise<unknown | undefined> {
    if (!handles(path)) return undefined;

    // Public route: GET /team-invites/public/:token
    if (path.startsWith('/team-invites/public/')) {
      const token = decodeURIComponent(path.replace('/team-invites/public/', ''));
      const found = invites.find(inv => inv.token === token);
      if (!found) {
        throw new PermitDemoError(404, 'NOT_FOUND', 'Convite de equipe não encontrado ou link inválido.');
      }
      const isExpired = new Date(found.expiresAt).getTime() < Date.now();
      const currentStatus = found.status === 'REVOKED' ? 'REVOKED' : isExpired ? 'EXPIRED' : found.status;
      const team = teams.find(t => t.id === found.teamId);
      const chief = team?.members.find(m => m.workerId === team.chiefId);

      const publicDto: PublicTeamInviteDto = {
        token: found.token,
        teamId: found.teamId,
        teamName: found.teamName,
        unitName: found.unitName,
        companyName: found.companyName,
        chiefName: chief?.name || 'Chefe da equipe',
        status: currentStatus,
        expiresAt: found.expiresAt,
        members:
          team?.members.map(m => ({
            name: m.name,
            serviceFunction: m.serviceFunction,
            isChief: m.workerId === team.chiefId,
          })) || [],
        operationalInstructions:
          'Apresente-se ao encarregado/chefe da equipe e confira os requisitos de segurança e EPIs antes do início das atividades de campo.',
      };
      return JSON.parse(JSON.stringify(publicDto));
    }

    // Authenticated routes
    if (!context) throw new PermitDemoError(401, 'UNAUTHORIZED', 'Sessão necessária para gerenciar convites.');
    const reading = request.method === 'GET';
    if (!context.permissions.includes(reading ? 'teams.read' : 'teams.write')) {
      throw new PermitDemoError(403, 'FORBIDDEN', 'Seu perfil não permite esta ação.');
    }

    if (path === '/team-invites' && reading) {
      const teamId = url.searchParams.get('teamId');
      const unitId = url.searchParams.get('unitId');
      let filtered = invites;
      if (teamId) filtered = filtered.filter(inv => inv.teamId === teamId);
      if (unitId) filtered = filtered.filter(inv => inv.unitId === unitId);
      return JSON.parse(JSON.stringify(filtered));
    }

    if (path === '/team-invites' && request.method === 'POST') {
      const b = (await request.json()) as TeamInviteWriteDto;
      if (!b?.teamId) throw new PermitDemoError(422, 'VALIDATION_FAILED', 'Selecione a equipe para gerar o convite.', 'teamId');
      const team = teams.find(t => t.id === b.teamId);
      if (!team) throw new PermitDemoError(404, 'NOT_FOUND', 'Equipe indisponível no seu escopo.');
      if (team.status === 'INACTIVE') {
        throw new PermitDemoError(409, 'TEAM_INACTIVE', 'Não é possível gerar convite para uma equipe inativa.');
      }
      context.checkUnit(team.unitId);

      const hours = b.validityHours && b.validityHours > 0 ? b.validityHours : 48;
      const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const token = `inv-${crypto.randomUUID().slice(0, 8)}`;
      const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

      const created: TeamInviteDto = {
        id: crypto.randomUUID(),
        token,
        teamId: team.id,
        teamName: team.name,
        unitId: team.unitId,
        unitName: 'Unidade Principal',
        companyId: team.companyId,
        companyName: 'Empresa Principal',
        status: 'ACTIVE',
        expiresAt,
        createdAt: new Date().toISOString(),
        createdByName: context.user?.displayName || 'Administrador',
        membersCount: team.members.length,
        serviceFunctions: Array.from(new Set(team.members.map(m => m.serviceFunction))),
        shareUrl: `${currentOrigin}/convite/${token}`,
      };
      invites.unshift(created);
      return JSON.parse(JSON.stringify(created));
    }

    if (path.endsWith('/revoke') && request.method === 'POST') {
      const inviteId = path.split('/')[2];
      const inv = invites.find(i => i.id === inviteId);
      if (!inv) throw new PermitDemoError(404, 'NOT_FOUND', 'Convite não encontrado.');
      inv.status = 'REVOKED';
      return JSON.parse(JSON.stringify(inv));
    }

    throw new PermitDemoError(404, 'NOT_FOUND', 'Operação não prevista na demonstração.');
  }

  return { handles, route };
}
