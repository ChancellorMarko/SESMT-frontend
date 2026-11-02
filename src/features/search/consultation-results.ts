import type { PageDto } from '../../shared/contracts';

/** Compatibility with legacy list responses; paged API results are not paged twice. */
export function consultationResults<T>(data: PageDto<T> | T[] | undefined, page: number): PageDto<T> {
  if (!data) return { items: [], total: 0, page, pageSize: 10 };
  if (!Array.isArray(data)) return data;
  return { items: data.slice((page - 1) * 10, page * 10), total: data.length, page, pageSize: 10 };
}
