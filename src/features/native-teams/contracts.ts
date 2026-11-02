import { z } from 'zod';
import { checkedNativeTeam, nativeId, type NativeTeam } from '../native-operations/contracts';
import { checkedNativeTeamPeople } from '../native-operations/directory';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { NativeFormError } from '../native-operations/NativeCommandDialog';

export type TeamScope = { unitId: string; companyIds: readonly string[] };
const context = z.object({ companyId: nativeId, localId: nativeId, organizationId: nativeId, companyName: z.string().trim().min(1), localName: z.string().trim().min(1) });
export type TeamContext = z.infer<typeof context>;
export function checkedTeamContext(value: unknown, scope: TeamScope) {
  const parsed = context.safeParse(value);
  if (!parsed.success || parsed.data.localId !== scope.unitId || !scope.companyIds.includes(parsed.data.companyId)) throw new InvalidReadResponse();
  return parsed.data;
}
export type EditableTeam = NativeTeam & { version: number };
export function checkedEditableTeam(value: unknown, id: string, scope: TeamScope): EditableTeam {
  const team = checkedNativeTeam(value, { ...scope, id });
  if (!team.version) throw new InvalidReadResponse();
  return team as EditableTeam;
}
export function checkedTeamEditor(value: unknown, scope: TeamScope, id?: string) {
  if (!value || typeof value !== 'object' || !('context' in value) || !('team' in value) || !('people' in value)) throw new InvalidReadResponse();
  const context = checkedTeamContext(value.context, scope);
  const team = id ? checkedEditableTeam(value.team, id, scope) : undefined;
  if (team && team.companyId !== context.companyId || !id && value.team !== undefined) throw new InvalidReadResponse();
  const people = team ? checkedNativeTeamPeople(value.people, team) : [];
  if (!team && (!Array.isArray(value.people) || value.people.length)) throw new InvalidReadResponse();
  return { context, team, people };
}
export function teamFields(name: string, description: string, chiefId: string, participantIds: string[]) {
  if (!name.trim() || name.trim().length > 150 || description.trim().length > 1000 || /[\u0000-\u001f\u007f]/.test(name)
    || !nativeId.safeParse(chiefId).success || participantIds.some(id => !nativeId.safeParse(id).success)
    || new Set(participantIds).size !== participantIds.length || participantIds.includes(chiefId)) throw new NativeFormError('Confira nome, chefe e participantes da equipe.');
  return { name: name.trim(), description: description.trim() || null, chiefId, participantIds: [...participantIds] };
}
export function sameRoster(a: readonly string[], b: readonly string[]) { return a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id)); }
export function teamReturnPage(state: unknown, unitId: string | undefined, sessionKey: string) {
  if (!state || typeof state !== 'object' || !('nativeTeamReturnTo' in state)) return 1;
  const parsed = z.object({ nativeTeamReturnTo: z.object({ unitId: nativeId, sessionKey: z.string(), page: z.number().int().min(1).max(Math.floor(2147483647 / 10)) }) }).safeParse(state);
  return parsed.success && parsed.data.nativeTeamReturnTo.unitId === unitId && parsed.data.nativeTeamReturnTo.sessionKey === sessionKey ? parsed.data.nativeTeamReturnTo.page : 1;
}
