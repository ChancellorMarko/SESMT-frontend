import type { QueryClient } from '@tanstack/react-query';
import { nativeDocumentsApi } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { DOCUMENT_TYPE_PAGE_SIZE, checkedDocumentType, checkedDocumentTypePage } from './contracts';

const MAX_DOCUMENT_TYPE_PAGES = 50;
/** Read one type and unwrap the official envelope before it reaches the query cache. */
export async function readDocumentType(id: string, signal?: AbortSignal) {
  return checkedDocumentType(await nativeDocumentsApi.get<unknown>(`/document-types/${id}`, { signal }), id);
}
/** Read every active document type; a catalog that changes between pages is refused instead of merged. */
export async function readActiveDocumentTypes(signal?: AbortSignal): Promise<unknown> {
  const items: unknown[] = [];
  let total: number | undefined;
  for (let page = 1; page <= MAX_DOCUMENT_TYPE_PAGES; page++) {
    const current = checkedDocumentTypePage(await nativeDocumentsApi.get<unknown>('/document-types', { query: { page, pageSize: DOCUMENT_TYPE_PAGE_SIZE }, signal }), page);
    if (total !== undefined && current.total !== total) throw new InvalidReadResponse();
    total = current.total; items.push(...current.items);
    if (items.length >= total) return items;
  }
  throw new InvalidReadResponse();
}

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
