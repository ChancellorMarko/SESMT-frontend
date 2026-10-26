/** Syntactic check only. The API remains responsible for expiry, ownership and use. */
export function validPasswordResetToken(token: string) {
  // The native identity service emits unpadded base64url tokens. Do not trim secrets.
  return /^[A-Za-z0-9_-]{1,512}$/.test(token);
}

export function passwordResetTokenFromHash(hash: string): { token: string; invalid: boolean } {
  if (!hash.startsWith('#')) return { token: '', invalid: false };
  const tokens = new URLSearchParams(hash.replace(/^#/, '')).getAll('token');
  if (!tokens.length) return { token: '', invalid: false };
  return tokens.length === 1 && validPasswordResetToken(tokens[0])
    ? { token: tokens[0], invalid: false }
    : { token: '', invalid: true };
}

/** Keep public recovery feedback independent of whether an identity exists. */
export function checkedRecoveryMessage(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('message' in value) || typeof value.message !== 'string'
    || !value.message.trim() || value.message.length > 500
    || /[\u0000-\u001f\u007f]/.test(value.message)) {
    throw new Error('Não foi possível confirmar a solicitação. Tente novamente.');
  }
  return 'Se houver uma conta para esse e-mail, enviaremos as instruções de recuperação.';
}
