import type { NativeAppointment } from '../../../src/features/native-operations/contracts';
import { appointmentFixture, appointmentState, nativePersonFixture } from './native-operations';
import { permitFixture } from './native-permits';
import { checklistIds as ids } from './native-checklists';

export function openingAppointmentFixture(): NativeAppointment {
  const item = { ...appointmentFixture(), status: 'CONFIRMED' as const, version: 2, responsibleId: ids.responsible };
  return { ...item, history: [...item.history, { action: 'CONFIRMED', version: 2, actorId: ids.user, occurredAt: '2026-11-01T10:00:00Z', reason: null, before: appointmentState(appointmentFixture()), after: appointmentState(item) }] };
}
export const openingBrowserWorker = nativePersonFixture;
export const openingNativeWorker = { id: ids.worker, companyId: ids.company, userId: ids.user, active: true,
  name: 'Alice Trabalhadora', enrollment: 'MAT-01', dateOfBirth: '1990-01-01', cpfMasked: '***.***.***-00', admissionDate: '2024-01-01', dismissalDate: null };
export function openedPermitFixture() {
  return { ...permitFixture(), title: openingAppointmentFixture().title, version: 3, contentVersion: 3 };
}
export function openingReceiptFixture() {
  return { id: ids.permit, numero: ids.permit, statusOperacional: 'em_verificacao', statusRevisao: 'nao_enviada', versao: 3,
    servicoIds: [ids.service], participanteIds: [ids.user], templateVersionIds: [ids.templateVersion], respostas: [] };
}
