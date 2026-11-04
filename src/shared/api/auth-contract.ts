const native = Object.freeze({
  kind: 'native',
  mePath: '/auth/me',
  forgotPasswordPath: '/auth/forgot-password',
  resetPasswordPath: '/auth/reset-password',
} as const);

const adapter = Object.freeze({
  kind: 'adapter',
  mePath: '/me',
  forgotPasswordPath: '/auth/password/forgot',
  resetPasswordPath: '/auth/password/reset',
} as const);

/** Choose one explicit contract; never retry a password command on another endpoint. */
export function resolveAuthContract(mode: unknown, configured?: unknown) {
  if (mode !== 'api' || configured === 'adapter') return adapter;
  return native;
}

export const AUTH_CONTRACT = resolveAuthContract(import.meta.env.VITE_API_MODE, import.meta.env.VITE_AUTH_API_CONTRACT);
