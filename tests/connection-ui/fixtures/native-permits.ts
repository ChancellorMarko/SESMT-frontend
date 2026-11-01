import type { NativePermit, PermitDeclarations } from '../../../src/features/native-permits/contracts';
import { operationIds } from './native-operations';

// Controlled native HTTP fixtures, not production data or backend homologation.
export const permitIds = { ...operationIds, permit: '69000000-0000-4000-8000-000000000001',
  templateVersion: '69000000-0000-4000-8000-000000000002', event: '69000000-0000-4000-8000-000000000003' };
const ids = permitIds;
export function permitFixture(): NativePermit {
  return { id: ids.permit, companyId: ids.company, appointmentId: ids.appointment, serviceCode: 'ALTURA', title: 'Manutenção da cobertura',
    status: 'EM_VERIFICACAO', version: 4, contentVersion: 3, createdAt: '2026-10-31T10:00:00Z', releasedAt: null, startedAt: null, suspendedAt: null,
    suspensionReason: null, completedAt: null, cancelledAt: null, cancellationReason: null,
    participants: [{ userId: ids.user, responsibility: 'Executante', acknowledgedAt: null, acknowledgedVersion: null, acknowledgements: [] }],
    templateVersionIds: [ids.templateVersion], checklistAnswers: [], authorizedFrom: null, authorizedUntil: null, releaseConditions: null,
    completionSummary: null, actualEnd: null, reviewStatus: 'NAO_ENVIADA', closingAnswers: [], observations: [] };
}
export function declarationFixture(item = permitFixture()): PermitDeclarations {
  return { permitId: item.id, expectedVersion: item.version, contentVersion: item.contentVersion,
    declarations: [{ templateVersionId: ids.templateVersion, version: 2, text: 'Declaração fornecida pelo modelo da operação.' }],
    context: { appointmentId: ids.appointment, version: 2, locationId: ids.unit, responsibleId: ids.responsible,
      from: '2026-10-31T10:00:00Z', until: '2026-10-31T20:00:00Z', serviceCodes: ['ALTURA'], participantIds: [ids.worker] } };
}
export function historyFixture() {
  return [{ id: ids.event, previousStatus: null, newStatus: 'EM_VERIFICACAO', action: 'ABERTA', actorId: ids.user, occurredAt: '2026-10-31T10:00:00Z', reason: null, version: 1 }];
}
