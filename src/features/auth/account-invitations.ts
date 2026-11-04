import { API_MODE } from '../../shared/api/client';
import type { AccountInvitationInspectDto, AccountInvitationAcceptDto } from '../../shared/contracts/account-invitations';

// Proposed API contracts must be explicitly enabled after backend homologation.
export function accountInvitationsEnabled() {
  return API_MODE === 'demo' || import.meta.env.VITE_ACCOUNT_INVITATIONS_ENABLED === 'true';
}
export function validInvitationToken(token: string) { return /^[A-Za-z0-9._~-]{12,512}$/.test(token); }
export function invitationTokenFromHash(hash: string) {
  const tokens = new URLSearchParams(hash.replace(/^#/, '')).getAll('token');
  if (!tokens.length) return { token: '', invalid: false };
  return tokens.length === 1 && validInvitationToken(tokens[0]) ? { token: tokens[0], invalid: false } : { token: '', invalid: true };
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const text = (value: unknown, max = 254): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function checkedInvitation(value: unknown): AccountInvitationInspectDto {
  if (!record(value) || !text(value.invitationId, 128) || !text(value.displayName, 120) || !text(value.emailMasked) || typeof value.mfaRequired !== 'boolean'
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()
    || !record(value.passwordPolicy) || !Number.isSafeInteger(value.passwordPolicy.minLength) || !Number.isSafeInteger(value.passwordPolicy.maxLength)
    || Number(value.passwordPolicy.minLength) < 1 || Number(value.passwordPolicy.maxLength) > 1024 || Number(value.passwordPolicy.maxLength) < Number(value.passwordPolicy.minLength)) {
    throw new Error('Não foi possível confirmar os dados do convite. Solicite um novo link ao administrador.');
  }
  return value as unknown as AccountInvitationInspectDto;
}
export function checkedAcceptance(value: unknown, invitationId: string): AccountInvitationAcceptDto {
  if (!record(value) || value.invitationId !== invitationId || !['LOGIN', 'MFA_SETUP_REQUIRED', 'WORKER_LINK_REQUIRED'].includes(String(value.nextStep))) {
    throw new Error('A resposta de ativação não pôde ser confirmada. Confira o convite antes de tentar novamente.');
  }
  return value as unknown as AccountInvitationAcceptDto;
}
