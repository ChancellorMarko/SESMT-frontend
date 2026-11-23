import { useState } from 'react';
import { z } from 'zod';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, Modal } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { validPasswordResetToken } from '../auth/password-recovery';
import type { NativeUser } from './native-users';
import styles from './NativeUsersPage.module.css';

// SESMT.API/Contracts/Users/UserRequests.cs: AdminPasswordResetResponse.
const resetReceipt = z.object({
  token: z.string().refine(validPasswordResetToken),
  expiresAt: z.iso.datetime({ offset: true }),
  sessionsEnded: z.number().int().min(0),
});
export type PasswordResetReceipt = z.infer<typeof resetReceipt>;
export function checkedPasswordReset(value: unknown): PasswordResetReceipt {
  const parsed = resetReceipt.safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) throw new InvalidReadResponse();
  return parsed.data;
}
/** The reset page reads the token from the fragment, so it never reaches server logs or the Referer header. */
export const passwordResetLink = (token: string, origin = window.location.origin) => `${origin}/redefinir-senha#token=${token}`;
const inBrasilia = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * The administrator never chooses or sees the new password: the API ends the account's sessions, invalidates the
 * old password and issues a single-use link that only the account holder should open.
 */
export function NativeUserPasswordReset({ user, onClose, onDone }: { user: NativeUser; onClose: () => void; onDone: (receipt: PasswordResetReceipt) => void }) {
  const { can, me } = useSession();
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<PasswordResetReceipt>();
  const trimmed = reason.trim();

  async function perform(signal: AbortSignal) {
    if (!can('users.edit') || !user.active || user.id === me?.user.id) throw new NativeContextConflict('Seu acesso ou a conta mudou. Feche a janela e atualize a lista.');
    if (trimmed.length < 10 || trimmed.length > 500) throw new NativeFormError('Informe o motivo da redefinição.', { reason: 'Descreva o motivo com 10 a 500 caracteres.' });
    if (!confirmed) throw new NativeFormError('Confirme que a pessoa perderá o acesso atual.');
    setReceipt(checkedPasswordReset(await api.post<unknown>(`/users/${encodeURIComponent(user.id)}/password-reset`, { reason: trimmed, confirmation: true }, { signal, idempotencyKey: undefined })));
  }

  if (receipt) return <PasswordResetLink user={user} receipt={receipt} onClose={() => onDone(receipt)}/>;
  return <NativeCommandDialog title={`Redefinir senha de ${user.name}`} dirty={Boolean(reason)} disabled={!confirmed || trimmed.length < 10}
    onClose={onClose} onDone={async () => {}} perform={perform} submitLabel="Redefinir senha">{(busy, errors) => <>
    <p>A senha atual de <strong>{user.name}</strong> deixa de funcionar e as sessões abertas da conta são encerradas. Você recebe um link de uso único, válido por 24 horas, para entregar à pessoa. É ela quem define a nova senha.</p>
    <Field label="Motivo" required error={errors.reason}><textarea value={reason} maxLength={500} rows={3} disabled={busy} aria-invalid={Boolean(errors.reason)}
      placeholder="Ex.: a pessoa esqueceu a senha e o e-mail de recuperação não chegou." onChange={event => setReason(event.target.value)}/></Field>
    <label className={styles.option}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>
      <span>Confirmo que {user.name} perderá o acesso atual até definir uma nova senha. O motivo fica registrado na auditoria.</span></label>
  </>}</NativeCommandDialog>;
}

function PasswordResetLink({ user, receipt, onClose }: { user: NativeUser; receipt: PasswordResetReceipt; onClose: () => void }) {
  const link = passwordResetLink(receipt.token);
  const [copied, setCopied] = useState<'ok' | 'failed'>();
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied('ok'); }
    catch { setCopied('failed'); }
  }
  const sessions = receipt.sessionsEnded === 0 ? 'Não havia sessões abertas.' : receipt.sessionsEnded === 1 ? '1 sessão aberta foi encerrada.' : `${receipt.sessionsEnded} sessões abertas foram encerradas.`;
  return <Modal open title={`Link de redefinição de ${user.name}`} onClose={onClose}><div className="stack">
    <Feedback tone="success">A senha anterior não funciona mais. {sessions}</Feedback>
    <Field label="Link de uso único"><input readOnly value={link} onFocus={event => event.currentTarget.select()}/></Field>
    <div className="actions"><Button variant="secondary" onClick={() => void copy()}>Copiar link</Button></div>
    {copied === 'ok' && <p role="status" className={styles.accessHint}>Link copiado.</p>}
    {copied === 'failed' && <p role="status" className={styles.accessHint}>Não foi possível copiar automaticamente. Selecione o link acima e copie.</p>}
    <p className={styles.accessHint}>Válido até {inBrasilia(receipt.expiresAt)} (horário de Brasília). Entregue o link somente a {user.name}, por um canal que você confia. Quem abrir o link define a senha. Este link não aparece de novo: se ele se perder, faça outra redefinição, que cancela a anterior.</p>
    <div className="actions"><Button onClick={onClose}>Concluir</Button></div>
  </div></Modal>;
}
