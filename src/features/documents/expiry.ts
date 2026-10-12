import { dateOnly } from '../../shared/lib/format';
import { isCivilDate } from './validation';

export const expiryWindows = [7, 30, 90] as const;
export function expiryWindow(value: string | null) {
  return expiryWindows.find(days => String(days) === value) ?? 30;
}
export function positivePage(value: string | null) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
// Civil dates are counted at UTC midnight to avoid daylight-saving transitions.
export function addCivilDays(value: string, days: number) {
  if (!isCivilDate(value)) throw new Error('Data civil inválida.');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function daysUntil(value: string | undefined, today: string) {
  return value && isCivilDate(value) && isCivilDate(today)
    ? Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
    : undefined;
}
export function expiryQuery(params: URLSearchParams, today = dateOnly()) {
  const expired = params.get('view') === 'expired';
  return {
    status: expired ? 'EXPIRED' : 'ACTIVE',
    ...(!expired ? { validUntilFrom: today, validUntilTo: addCivilDays(today, expiryWindow(params.get('days'))) } : {}),
    ...(params.get('q')?.trim() ? { q: params.get('q')!.trim().slice(0, 200) } : {}),
  };
}
