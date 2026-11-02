import { createHash } from 'node:crypto';
import { declarationFixture, permitFixture, permitIds } from './native-permits';
import { templateFixture } from './native-checklists';

export function scienceFixture(item = permitFixture()) {
  const base = declarationFixture(item), data = { ...base.context!, teamId: permitIds.team };
  const declarations = base.declarations.map(d => ({ ...d, templateId: templateFixture().templateId }));
  const prefix = JSON.stringify({ Id: data.appointmentId, Version: data.version, LocationId: data.locationId, TeamId: data.teamId,
    ResponsibleId: data.responsibleId, From: data.from, Until: data.until, Services: data.serviceCodes, Participants: data.participantIds });
  const canonicalContent = prefix + '\n\n' + declarations.map(d => `${d.templateId} / ${d.version}: ${d.text}`).join('\n\n');
  return { ...base, declarations, context: data, canonicalContent, contentHash: createHash('sha256').update(canonicalContent).digest('hex') };
}
export function scienceParticipantFixture(item = permitFixture(), name = 'Pessoa da operação') {
  return { ...item.participants[0], acknowledgedAt: '2026-11-01T12:00:00Z', acknowledgedVersion: item.contentVersion,
    acknowledgements: [{ id: '69000000-0000-4000-8000-000000000010', participantUserId: item.participants[0].userId,
      collectorId: item.participants[0].userId, contentVersion: item.contentVersion, confirmedName: name,
      identificationMethod: 'Sessão autenticada', declaration: scienceFixture(item).canonicalContent, recordedAt: '2026-11-01T12:00:00Z' }] };
}
