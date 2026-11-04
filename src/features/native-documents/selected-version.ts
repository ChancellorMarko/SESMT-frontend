import type { NativeDocumentVersion } from './contracts';

/** A pinned link must never fall back to a newer or differently hashed file. */
export function selectDocumentVersions(versions: NativeDocumentVersion[] | undefined, search: string) {
  const params = new URLSearchParams(search), id = params.get('versao'), hash = params.get('sha256');
  const invalid = params.getAll('versao').length > 1 || params.getAll('sha256').length > 1
    || id !== null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
    || hash !== null && (!id || !/^[a-f0-9]{64}$/.test(hash));
  const items = id ? versions?.filter(v => v.id.toLowerCase() === id.toLowerCase()) : versions;
  const error = invalid || Boolean(versions && id && (items?.length !== 1 || hash && items[0].fileHash !== hash));
  return { items: error ? undefined : items, pinned: id !== null, error };
}
