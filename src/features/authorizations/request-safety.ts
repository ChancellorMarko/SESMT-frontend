import type { QueryClient } from '@tanstack/react-query';
import type { WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';

/** A response must describe the same preparation before it can replace its cache. */
export function assertAuthorizationResponse(value: WorkAuthorizationDto, context: { id?: string; unitId?: string; companyId?: string; appointmentId: string; minimumRevision?: number; advancedFrom?: number }) {
  if (!value || typeof value.id !== 'string' || !value.id.trim() || context.id && value.id !== context.id || value.unitId !== context.unitId || context.companyId && value.companyId !== context.companyId || value.appointment?.id !== context.appointmentId || value.appointment.unitId !== context.unitId || value.appointment.companyId && value.appointment.companyId !== value.companyId) {
    throw new Error('A resposta pertence a outro registro, atendimento ou unidade. Seu preenchimento foi preservado.');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision < (context.minimumRevision || 0) || context.advancedFrom !== undefined && value.revision <= context.advancedFrom) {
    throw new Error('A revisão recebida não confirma a atualização esperada da AT. Seu preenchimento foi preservado.');
  }
}

export function invalidateAuthorizationContext(client: QueryClient, sessionKey: string, unitId: string | undefined, resources: readonly string[]) {
  if (!unitId) return Promise.resolve();
  return Promise.all([...resources.map(resource => client.invalidateQueries({ queryKey: [resource, sessionKey, unitId] })), invalidateConsultation(client, 'ats', { sessionKey, unitId })]);
}
