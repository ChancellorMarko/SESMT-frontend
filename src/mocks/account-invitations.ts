/** Synthetic account invitations and credentials, in memory only; not an identity service. */
import type { UserDto } from '../shared/contracts';
import type { AccountInvitationAcceptDto, AccountInvitationInspectDto, AccountInvitationSummaryDto } from '../shared/contracts/account-invitations';

export class AccountInvitationError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message); }
}

type Invitation = { id: string; userId: string; token: string; expiresAt: string; revoked: boolean; accepted?: AccountInvitationAcceptDto; acceptKey?: string };
type Options = { users: () => UserDto[]; now?: () => number; onActivated?: (user: UserDto) => void };
const passwordPolicy = { minLength: 15, maxLength: 128 };
const lifetime = 24 * 60 * 60 * 1000;

function reject(status: number, code: string, message: string, field?: string): never { throw new AccountInvitationError(status, code, message, field); }
function payload(input: unknown, allowed: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) reject(422, 'VALIDATION_FAILED', 'Informe somente os dados necessários para este convite.');
  return input as Record<string, unknown>;
}
function tokenValue(raw: unknown) {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 512 || raw.trim() !== raw || /[\u0000-\u0020\u007f]/.test(raw)) reject(404, 'INVITATION_INVALID', 'Este convite de conta é inválido. Peça um novo convite ao administrador.');
  return raw;
}
function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}${'•'.repeat(Math.min(Math.max(name.length - 1, 3), 6))}@${domain}`;
}

export function makeAccountInvitationDemo({ users, now = Date.now, onActivated }: Options) {
  const initialCredentials = new Set(users().filter(user => user.status === 'ACTIVE').map(user => user.id));
  const invitations = new Map<string, Invitation>();
  // Plain strings here intentionally simulate identity only. Production needs secure credential storage.
  const activatedPasswords = new Map<string, string>();

  function userFor(invitation: Invitation) {
    const user = users().find(item => item.id === invitation.userId);
    if (!user || user.status === 'DISABLED' || user.scope.expiresAt && (!Number.isFinite(Date.parse(user.scope.expiresAt)) || Date.parse(user.scope.expiresAt) <= now())) reject(409, 'INVITATION_UNAVAILABLE', 'O acesso deste convite não está disponível. Fale com o administrador.');
    return user;
  }
  function pending(invitation: Invitation) {
    if (invitation.revoked) reject(410, 'INVITATION_REVOKED', 'Este convite foi revogado. Peça um novo convite ao administrador.');
    if (invitation.accepted) reject(409, 'INVITATION_USED', 'Este convite já foi utilizado. Entre com a senha definida ou recupere seu acesso.');
    if (Date.parse(invitation.expiresAt) <= now()) reject(410, 'INVITATION_EXPIRED', 'Este convite expirou. Peça um novo convite ao administrador.');
    const user = userFor(invitation);
    if (user.status !== 'INVITED') reject(409, 'INVITATION_UNAVAILABLE', 'O acesso deste convite não está disponível. Fale com o administrador.');
    return user;
  }
  function find(rawToken: unknown) {
    const token = tokenValue(rawToken);
    const invitation = [...invitations.values()].find(item => item.token === token);
    if (!invitation) reject(404, 'INVITATION_INVALID', 'Este convite de conta é inválido. Peça um novo convite ao administrador.');
    return invitation;
  }
  function summary(user: UserDto): AccountInvitationSummaryDto {
    const invitation = invitations.get(user.id);
    if (!invitation) reject(404, 'INVITATION_NOT_FOUND', 'Não há convite de primeiro acesso disponível para esta conta.');
    const status = invitation.revoked || user.status === 'DISABLED' ? 'REVOKED' : invitation.accepted ? 'ACCEPTED' : Date.parse(invitation.expiresAt) <= now() || user.scope.expiresAt && Date.parse(user.scope.expiresAt) <= now() ? 'EXPIRED' : 'PENDING';
    return { userId: user.id, userRevision: user.revision, status, expiresAt: invitation.expiresAt, mfaRequired: user.mfaRequired, deliveryStatus: 'SIMULATED', ...(status === 'PENDING' && user.status === 'INVITED' ? { demoActivationPath: `/ativar-acesso#token=${encodeURIComponent(invitation.token)}` } : {}) };
  }
  function issue(user: UserDto): AccountInvitationSummaryDto {
    if (user.status !== 'INVITED') reject(409, 'INVITATION_UNAVAILABLE', 'Somente uma conta convidada pode receber um convite de primeiro acesso.');
    invitations.set(user.id, { id: crypto.randomUUID(), userId: user.id, token: crypto.randomUUID(), expiresAt: new Date(now() + lifetime).toISOString(), revoked: false });
    return summary(user);
  }
  function inspect(input: unknown): AccountInvitationInspectDto {
    const value = payload(input, ['token']);
    const invitation = find(value.token), user = pending(invitation);
    return { invitationId: invitation.id, displayName: user.displayName, emailMasked: maskEmail(user.email), expiresAt: invitation.expiresAt, mfaRequired: user.mfaRequired, passwordPolicy: { ...passwordPolicy } };
  }
  function accept(input: unknown, idempotencyKey?: string): AccountInvitationAcceptDto {
    const value = payload(input, ['token', 'newPassword']);
    const invitation = find(value.token);
    if (invitation.revoked) reject(410, 'INVITATION_REVOKED', 'Este convite foi revogado. Peça um novo convite ao administrador.');
    const currentUser = userFor(invitation);
    if (invitation.accepted && idempotencyKey && invitation.acceptKey === idempotencyKey) {
      if (currentUser.status !== 'ACTIVE') reject(409, 'INVITATION_UNAVAILABLE', 'O acesso deste convite não está disponível. Fale com o administrador.');
      if (activatedPasswords.get(currentUser.id) !== value.newPassword) reject(409, 'IDEMPOTENCY_CONFLICT', 'Esta tentativa já foi utilizada com outros dados. Confira o resultado antes de continuar.');
      return { ...invitation.accepted };
    }
    const user = pending(invitation);
    if (typeof value.newPassword !== 'string' || value.newPassword.length < passwordPolicy.minLength || value.newPassword.length > passwordPolicy.maxLength || !value.newPassword.trim()) reject(422, 'PASSWORD_POLICY', `Use de ${passwordPolicy.minLength} a ${passwordPolicy.maxLength} caracteres para a senha.`, 'newPassword');
    // No asynchronous boundary between the final checks, credential write and consumption.
    activatedPasswords.set(user.id, value.newPassword);
    user.status = 'ACTIVE'; user.revision++;
    invitation.accepted = { invitationId: invitation.id, nextStep: user.mfaRequired ? 'MFA_SETUP_REQUIRED' : user.scope.ownOnly ? 'WORKER_LINK_REQUIRED' : 'LOGIN' };
    invitation.acceptKey = idempotencyKey;
    onActivated?.(user);
    return { ...invitation.accepted };
  }
  return {
    issue, summary, inspect, accept,
    revoke(userId: string) { const invitation = invitations.get(userId); if (invitation && !invitation.accepted) invitation.revoked = true; },
    hasCredential(user: UserDto) { return initialCredentials.has(user.id) || activatedPasswords.has(user.id); },
    matchesPassword(user: UserDto, password: unknown) { return typeof password === 'string' && (activatedPasswords.has(user.id) ? activatedPasswords.get(user.id) === password : initialCredentials.has(user.id) && password === 'Demo123!'); },
    requiresMfaSetup(user: UserDto) { return user.mfaRequired && !initialCredentials.has(user.id) && activatedPasswords.has(user.id); },
    // The legacy fixture maps ownOnly to its single worker. Never borrow that identity for new accounts.
    requiresWorkerLink(user: UserDto) { return user.scope.ownOnly && !initialCredentials.has(user.id) && activatedPasswords.has(user.id); },
  };
}
