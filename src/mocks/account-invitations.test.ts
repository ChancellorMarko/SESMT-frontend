import { describe, expect, it, vi } from 'vitest';
import type { UserDto } from '../shared/contracts';
import { AccountInvitationError, makeAccountInvitationDemo } from './account-invitations';

const password = 'Uma frase de senha 2026!';
const instant = Date.parse('2030-01-01T12:00:00Z');
function setup(mfaRequired = false) {
  let now = instant;
  const user: UserDto = { id: 'invited-user', displayName: 'Pessoa convidada', email: 'pessoa@example.invalid', status: 'INVITED', roles: [mfaRequired ? 'ADMIN' : 'HR'], scope: { companyIds: ['company'], unitIds: ['unit'], sectorIds: [], teamIds: [], ownOnly: false }, mfaRequired, revision: 1 };
  const users = [user], onActivated = vi.fn();
  const demo = makeAccountInvitationDemo({ users: () => users, now: () => now, onActivated });
  const summary = demo.issue(user), token = new URL(summary.demoActivationPath!, 'https://example.invalid').hash.slice('#token='.length);
  return { demo, user, users, token, summary, onActivated, moveTo: (date: number) => { now = date; } };
}

describe('convite sintético de primeiro acesso', () => {
  it('entrega contexto mínimo e mascarado sem expor o token, os perfis ou o escopo', () => {
    const { demo, token, user, summary } = setup();
    const result = demo.inspect({ token });
    expect(result).toEqual({ invitationId: expect.any(String), displayName: user.displayName, emailMasked: 'p•••••@example.invalid', expiresAt: summary.expiresAt, mfaRequired: false, passwordPolicy: { minLength: 15, maxLength: 128 } });
    expect(result).not.toHaveProperty('token'); expect(result).not.toHaveProperty('roles'); expect(result).not.toHaveProperty('scope');
    result.passwordPolicy.minLength = 1;
    expect(demo.inspect({ token }).passwordPolicy.minLength).toBe(15);
  });

  it('recusa senhas fora da política sem consumir o convite e preserva espaços da senha válida', () => {
    const { demo, token, user } = setup();
    for (const newPassword of ['curta', ' '.repeat(20), 'x'.repeat(129), undefined, 123]) expect(() => demo.accept({ token, newPassword })).toThrow(expect.objectContaining({ code: 'PASSWORD_POLICY', field: 'newPassword' }));
    expect(user).toMatchObject({ status: 'INVITED', revision: 1 });
    const rawPassword = ` ${password} `;
    expect(demo.accept({ token, newPassword: rawPassword })).toMatchObject({ nextStep: 'LOGIN' });
    expect(demo.matchesPassword(user, rawPassword)).toBe(true);
    expect(demo.matchesPassword(user, rawPassword.trim())).toBe(false);
    expect(demo.matchesPassword(user, 'Demo123!')).toBe(false);
  });

  it('consome uma única vez em tentativas concorrentes e não emite sessão', async () => {
    const { demo, token, user, onActivated } = setup();
    const attempts = await Promise.allSettled([1, 2].map(() => Promise.resolve().then(() => demo.accept({ token, newPassword: password }))));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'INVITATION_USED' } }]);
    expect(user).toMatchObject({ status: 'ACTIVE', revision: 2 }); expect(onActivated).toHaveBeenCalledTimes(1);
    const receipt = attempts.find(result => result.status === 'fulfilled');
    expect(receipt).toMatchObject({ value: { invitationId: expect.any(String), nextStep: 'LOGIN' } });
    expect(receipt).not.toHaveProperty('value.accessToken');
    expect(() => demo.inspect({ token })).toThrow(expect.objectContaining({ code: 'INVITATION_USED' }));
    expect(demo.summary(user)).toMatchObject({ status: 'ACCEPTED', userRevision: 2 });
    expect(demo.summary(user)).not.toHaveProperty('demoActivationPath');
  });

  it('repete o recibo com a mesma chave sem aplicar duas ativações e rejeita outro payload', () => {
    const { demo, token, user, onActivated } = setup();
    const first = demo.accept({ token, newPassword: password }, 'attempt-1');
    expect(demo.accept({ token, newPassword: password }, 'attempt-1')).toEqual(first);
    expect(() => demo.accept({ token, newPassword: `${password} diferente` }, 'attempt-1')).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(() => demo.accept({ token, newPassword: password }, 'attempt-2')).toThrow(expect.objectContaining({ code: 'INVITATION_USED' }));
    expect(user.revision).toBe(2); expect(onActivated).toHaveBeenCalledTimes(1);
  });

  it('não reutiliza recibo após desativação ou expiração da concessão', () => {
    const { demo, token, user } = setup();
    demo.accept({ token, newPassword: password }, 'attempt-1'); user.status = 'DISABLED';
    expect(() => demo.accept({ token, newPassword: password }, 'attempt-1')).toThrow(expect.objectContaining({ code: 'INVITATION_UNAVAILABLE' }));
    user.status = 'ACTIVE'; user.scope.expiresAt = new Date(instant).toISOString();
    expect(() => demo.accept({ token, newPassword: password }, 'attempt-1')).toThrow(expect.objectContaining({ code: 'INVITATION_UNAVAILABLE' }));
  });

  it('distingue convites expirados e revogados, sem mudar o usuário', () => {
    const expired = setup(); expired.moveTo(Date.parse(expired.summary.expiresAt));
    expect(() => expired.demo.inspect({ token: expired.token })).toThrow(expect.objectContaining({ status: 410, code: 'INVITATION_EXPIRED' }));
    expect(() => expired.demo.accept({ token: expired.token, newPassword: password })).toThrow(expect.objectContaining({ code: 'INVITATION_EXPIRED' }));
    expect(expired.demo.summary(expired.user)).toMatchObject({ status: 'EXPIRED' });
    const revoked = setup(); revoked.demo.revoke(revoked.user.id);
    expect(() => revoked.demo.inspect({ token: revoked.token })).toThrow(expect.objectContaining({ status: 410, code: 'INVITATION_REVOKED' }));
    expect(() => revoked.demo.accept({ token: revoked.token, newPassword: password })).toThrow(expect.objectContaining({ code: 'INVITATION_REVOKED' }));
    expect(revoked.demo.summary(revoked.user)).toMatchObject({ status: 'REVOKED' });
    expect(expired.user.status).toBe('INVITED'); expect(revoked.user.status).toBe('INVITED');
  });

  it('revalida usuário e concessão depois da inspeção antes de gravar', () => {
    for (const change of ['disabled', 'expired', 'removed'] as const) {
      const { demo, token, user, users } = setup(); demo.inspect({ token });
      if (change === 'disabled') user.status = 'DISABLED';
      if (change === 'expired') user.scope.expiresAt = new Date(instant).toISOString();
      if (change === 'removed') users.length = 0;
      expect(() => demo.accept({ token, newPassword: password })).toThrow(expect.objectContaining({ code: 'INVITATION_UNAVAILABLE' }));
      expect(demo.hasCredential(user)).toBe(false); expect(user.revision).toBe(1);
    }
  });

  it('mantém a nova conta administrativa bloqueada para configuração de MFA', () => {
    const { demo, token, user } = setup(true);
    expect(demo.accept({ token, newPassword: password })).toEqual({ invitationId: expect.any(String), nextStep: 'MFA_SETUP_REQUIRED' });
    expect(demo.hasCredential(user)).toBe(true); expect(demo.requiresMfaSetup(user)).toBe(true);
    expect(demo.matchesPassword(user, password)).toBe(true);
  });

  it('não associa uma conta nova restrita aos dados próprios ao trabalhador da fixture', () => {
    const { demo, token, user } = setup(); user.scope.ownOnly = true;
    expect(demo.accept({ token, newPassword: password })).toEqual({ invitationId: expect.any(String), nextStep: 'WORKER_LINK_REQUIRED' });
    expect(demo.requiresWorkerLink(user)).toBe(true);
    expect(demo.hasCredential(user)).toBe(true);
  });

  it('recusa tokens inválidos e campos controlados sem aceitar perfis do navegador', () => {
    const { demo, token, user } = setup();
    for (const invalid of ['', ' outro ', null, 'sem-convite', 'x'.repeat(513)]) expect(() => demo.inspect({ token: invalid })).toThrow(expect.objectContaining({ code: 'INVITATION_INVALID' }));
    expect(() => demo.accept({ token, newPassword: password, roles: ['ADMIN'] })).toThrow(AccountInvitationError);
    expect(() => demo.inspect({ token, userId: 'outro' })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(user.roles).toEqual(['HR']); expect(user.status).toBe('INVITED');
  });
});
