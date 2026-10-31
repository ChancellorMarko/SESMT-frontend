/** Route only the implemented UI projection to the same official API. */
export function resolveApiPath(path: string, mode: string, browserPrefix?: string): string {
  if (mode !== 'api' || browserPrefix !== '/browser') return path;
  if (path === '/auth/password/forgot') return '/auth/forgot-password';
  if (path === '/auth/password/reset') return '/auth/reset-password';
  if (/^\/auth\/(csrf|login|refresh|logout)$/.test(path)
    || /^\/(me|organization|workers|documents|document-types)(?:\/|$)/.test(path)) return `/browser${path}`;
  return path;
}
