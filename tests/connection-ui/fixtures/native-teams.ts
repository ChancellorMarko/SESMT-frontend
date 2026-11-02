import { operationIds, nativePersonFixture, teamFixture } from './native-operations';

export const teamIds = { ...operationIds, secondWorker: '64000000-0000-4000-8000-000000000002' };
export const teamScope = { companyIds: [teamIds.company], unitIds: [teamIds.unit], sectorIds: [], teamIds: [], ownOnly: false };
export const teamContext = { companyId: teamIds.company, localId: teamIds.unit, organizationId: teamIds.organization, companyName: 'Empresa da operação', localName: 'Unidade principal' };
export const teamPeople = [nativePersonFixture, { ...nativePersonFixture, id: teamIds.secondWorker, fullName: 'Bruno Trabalhador', registration: 'MAT-02' }];
export function editableTeamFixture() { return { ...teamFixture(), version: 1, participantIds: [] as string[] }; }
export function teamSummary(team = editableTeamFixture()) { return { id: team.id, organizationId: team.organizationId, name: team.name, chiefId: team.chiefId, active: team.active, version: team.version }; }
