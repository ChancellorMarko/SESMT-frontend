import type { QueryClient } from '@tanstack/react-query';

export function invalidateConsultation(client: QueryClient, resource: 'documents' | 'permits' | 'ats' | 'pets', context: { sessionKey: string; unitId: string | undefined }): Promise<void> {
  if (!context.sessionKey || !context.unitId) return Promise.resolve();
  return client.invalidateQueries({ queryKey: [`consulta-${resource}`, context.sessionKey, context.unitId] });
}
