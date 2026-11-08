import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../shared/api/client', async original => ({ ...await original<typeof import('../../shared/api/client')>(), nativeDocumentsApi: { get: vi.fn() } }));
import { nativeDocumentsApi } from '../../shared/api/client';
import { readActiveDocumentTypes } from './queries';

const type = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, code: `T${n}`, name: `Tipo ${n}`, category: 'GERAL', active: true });
const page = (p: number, total: number, from: number, count: number) => ({ items: Array.from({ length: count }, (_, i) => { const t = type(from + i); return { id: t.id, item: t, version: 1 }; }), page: p, pageSize: 100, total });
beforeEach(() => vi.clearAllMocks());

it('lê todas as páginas do catálogo ativo', async () => {
  vi.mocked(nativeDocumentsApi.get).mockImplementation(async (_path, options) => (options?.query?.page === 1 ? page(1, 130, 1, 100) : page(2, 130, 101, 30)) as never);
  const items = await readActiveDocumentTypes() as { id: string }[];
  expect(items).toHaveLength(130);
  expect(nativeDocumentsApi.get).toHaveBeenCalledTimes(2);
  expect(nativeDocumentsApi.get).toHaveBeenLastCalledWith('/document-types', expect.objectContaining({ query: { page: 2, pageSize: 100 } }));
});

it('recusa um catálogo que muda entre páginas', async () => {
  vi.mocked(nativeDocumentsApi.get).mockImplementation(async (_path, options) => (options?.query?.page === 1 ? page(1, 130, 1, 100) : page(2, 131, 101, 31)) as never);
  await expect(readActiveDocumentTypes()).rejects.toThrow();
});
