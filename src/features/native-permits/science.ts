import { z } from 'zod';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { nativeId, nativeIds } from '../native-operations/contracts';
import { checkedDeclarations, same, type NativePermit } from './contracts';

const context = z.object({ Id: nativeId, Version: z.number().int().positive(), LocationId: nativeId.nullable(),
  TeamId: nativeId.nullable(), ResponsibleId: nativeId.nullable(), From: z.string(), Until: z.string(),
  Services: z.array(z.string()), Participants: nativeIds,
}).strict();

/** Verify the complete statement's meaning; the API's hash remains an opaque precondition. */
export function checkedScience(value: unknown, permit: NativePermit) {
  const item = checkedDeclarations(value, permit), data = item.context;
  if (!data || data.teamId === undefined || !item.canonicalContent || !item.contentHash || !item.declarations.length
    || item.declarations.some(record => !record.templateId)
    || new Set(item.declarations.map(record => record.templateId)).size !== item.declarations.length
    || !same(data.serviceCodes, permit.serviceCode.split(','))) throw new InvalidReadResponse();
  const boundary = item.canonicalContent.indexOf('\n\n');
  let raw: unknown;
  try { raw = JSON.parse(item.canonicalContent.slice(0, boundary)); } catch { throw new InvalidReadResponse(); }
  const parsed = context.safeParse(raw);
  if (boundary < 1 || !parsed.success || parsed.data.Id !== data.appointmentId || parsed.data.Version !== data.version
    || parsed.data.LocationId !== data.locationId || parsed.data.TeamId !== data.teamId || parsed.data.ResponsibleId !== data.responsibleId
    || Date.parse(parsed.data.From) !== Date.parse(data.from) || Date.parse(parsed.data.Until) !== Date.parse(data.until)
    || !same(parsed.data.Services, data.serviceCodes) || !same(parsed.data.Participants, data.participantIds)) throw new InvalidReadResponse();
  const statements = [...item.declarations].sort((a, b) => a.templateVersionId < b.templateVersionId ? -1 : 1)
    .map(record => `${record.templateId} / ${record.version}: ${record.text}`).join('\n\n');
  if (item.canonicalContent.slice(boundary + 2) !== statements) throw new InvalidReadResponse();
  return { ...item, context: { ...data, teamId: data.teamId }, canonicalContent: item.canonicalContent, contentHash: item.contentHash };
}
