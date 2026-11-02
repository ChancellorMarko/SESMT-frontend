import { ApiError } from '../api/client';
import type { PageDto } from '../contracts';

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const shortText = (value: unknown, max = 4000): value is string => typeof value === 'string' && value.length <= max;

export function isSafePage(raw: string | null, pageSize = 20): boolean {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) return false;
  if (raw === null) return true;
  const page = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(page) && page <= Math.floor(Number.MAX_SAFE_INTEGER / pageSize);
}

export class ScopedPageError extends Error {
  constructor() { super('A consulta retornou uma página inválida. Tente novamente.'); this.name = 'ScopedPageError'; }
}

/** Check the response envelope before exposing records or calculating navigation. */
export function checkedPage<T>(value: unknown, expected: { page: number; pageSize: number }, isItem: (item: unknown) => item is T): PageDto<T> {
  if (!Number.isSafeInteger(expected.page) || expected.page < 1 || !Number.isSafeInteger(expected.pageSize) || expected.pageSize < 1
    || expected.page > Math.floor(Number.MAX_SAFE_INTEGER / expected.pageSize)
    || !isRecord(value) || !Array.isArray(value.items) || value.page !== expected.page || value.pageSize !== expected.pageSize
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || value.items.length > expected.pageSize
    || value.items.length > 0 && (expected.page - 1) * expected.pageSize + value.items.length > Number(value.total)) throw new ScopedPageError();
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || !shortText(item.id, 200) || !item.id.trim() || /[\u0000-\u0020\u007f/?#\\]/.test(item.id) || ids.has(item.id) || !isItem(item)) throw new ScopedPageError();
    ids.add(item.id);
  }
  return value as unknown as PageDto<T>;
}

export function scopedQueryError(error: unknown, resourceLabel: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sua sessão precisa ser verificada novamente.';
    if (error.status === 403) return `Seu acesso não permite consultar ${resourceLabel} nesta unidade.`;
    if (error.status === 404) return `Consulta de ${resourceLabel} indisponível nesta unidade.`;
  }
  return error instanceof Error ? error.message : `Não foi possível consultar ${resourceLabel}. Tente novamente.`;
}
