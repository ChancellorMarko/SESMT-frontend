import type { QueryClient } from '@tanstack/react-query';

/** Refresh all document entry points, including expiration keys with a different prefix. */
export async function invalidateDocumentReads(client: QueryClient, sessionKey: string) {
  await Promise.all([
    ...['native-document', 'native-document-versions', 'documents', 'document', 'document-versions', 'document-history',
      'consulta-documents', 'worker-documents', 'dashboard', 'native-dashboard', 'native-permit', 'native-permits',
      'native-permit-declarations', 'native-permit-eligibility', 'native-document-link-options']
      .map(key => client.invalidateQueries({ queryKey: [key, sessionKey] })),
    client.invalidateQueries({ queryKey: ['documents', 'expirations', sessionKey] }),
  ]);
}
