import { nativeAgendaCriteria } from './contracts';

export function nativeAgendaReturn(value: unknown) {
  if (typeof value !== 'string' || value.length > 2000) return '/app/agenda';
  try {
    const url = new URL(value, 'https://workspace.invalid');
    return url.origin === 'https://workspace.invalid' && url.pathname === '/app/agenda' && !url.hash && nativeAgendaCriteria(url.searchParams) ? `${url.pathname}${url.search}` : '/app/agenda';
  } catch { return '/app/agenda'; }
}
