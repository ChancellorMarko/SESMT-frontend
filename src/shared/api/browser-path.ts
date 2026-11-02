/** Route only the implemented UI projection to the same official API. */
export function resolveApiPath(path: string, mode: string, browserPrefix?: string, authContract: 'native' | 'adapter' = 'adapter'): string {
  if (mode !== 'api' || browserPrefix !== '/browser') return path;
  if (path === '/auth/password/forgot') return '/auth/forgot-password';
  if (path === '/auth/password/reset') return '/auth/reset-password';
  if ((authContract === 'adapter' && /^\/auth\/(csrf|login|refresh|logout)$/.test(path))
    || /^\/(me|organization|workers|documents|document-types)(?:\/|$)/.test(path)) return `/browser${path}`;
  return path;
}
