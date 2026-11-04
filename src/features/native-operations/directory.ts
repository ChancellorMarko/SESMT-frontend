import { z } from 'zod';
import { api } from '../../shared/api/client';
import { isIsoInstant } from '../../shared/auth/session-response';
import { checkedPage } from '../../shared/lib/scoped-page';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { nativeId, type NativeTeam } from './contracts';

const label = z.string().trim().min(1).max(500);
const directory = z.object({ companies: z.array(z.object({ id: nativeId, name: label, status: z.enum(['ACTIVE','INACTIVE']) })),
  units: z.array(z.object({ id: nativeId, companyId: nativeId, name: label, status: z.enum(['ACTIVE','INACTIVE']) })) });
export function checkedNativeDirectory(value: unknown) {
  const parsed = directory.safeParse(value);
  if (!parsed.success || new Set(parsed.data.units.map(item=>item.id)).size !== parsed.data.units.length || new Set(parsed.data.companies.map(item=>item.id)).size !== parsed.data.companies.length
    || parsed.data.units.some(unit => !parsed.data.companies.some(company => company.id === unit.companyId))) throw new InvalidReadResponse();
  return parsed.data;
}
const person = z.object({ id: nativeId, companyId: nativeId, unitId: nativeId, fullName: label, registration: z.string().max(200),
  status: z.enum(['ACTIVE','TERMINATED']), admissionDate: z.string().refine(value => isIsoInstant(`${value}T00:00:00Z`)) });
export function checkedNativePerson(value: unknown, expected: { id: string; companyId: string }) {
  const parsed = person.safeParse(value);
  if (!parsed.success || parsed.data.id !== expected.id || parsed.data.companyId !== expected.companyId) throw new InvalidReadResponse();
  return parsed.data;
}
export function checkedNativePeople(value: unknown, expected: { unitId: string; companyId: string; page: number }) {
  const parsed = z.object({ items: z.array(person), total: z.number(), page: z.number(), pageSize: z.number() }).safeParse(value);
  if (!parsed.success) throw new InvalidReadResponse();
  const result = checkedPage(parsed.data, { page: expected.page, pageSize: 20 }, (item): item is z.infer<typeof person> => person.safeParse(item).success);
  if (result.items.some(item => item.companyId !== expected.companyId || item.unitId !== expected.unitId || item.status !== 'ACTIVE')) throw new InvalidReadResponse();
  return result;
}
export async function loadNativeTeamPeople(team: NativeTeam, signal: AbortSignal) {
  if (!team.companyId) throw new InvalidReadResponse();
  const ids = [...new Set([...team.participantIds, ...(team.chiefId ? [team.chiefId] : [])])];
  return Promise.all(ids.map(async id => checkedNativePerson(await api.get<unknown>(`/workers/${id}`, { signal }), { id, companyId: team.companyId! })));
}
export function checkedNativeTeamPeople(value: unknown, team: NativeTeam) {
  const parsed = z.array(person).safeParse(value), allowed = new Set([...team.participantIds, ...(team.chiefId ? [team.chiefId] : [])]);
  if (!parsed.success || !team.companyId || parsed.data.length !== allowed.size || new Set(parsed.data.map(item=>item.id)).size !== allowed.size
    || parsed.data.some(item => !allowed.has(item.id) || item.companyId !== team.companyId)) throw new InvalidReadResponse();
  return parsed.data;
}
