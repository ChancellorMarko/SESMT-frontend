import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../shared/api/client';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Button, Feedback, Modal } from '../../shared/ui';
import { useEditorProtection } from '../administration/useEditorProtection';
import { useEditorRequest } from '../administration/useEditorRequest';
import styles from './NativeForms.module.css';

export class NativeFormError extends Error {}
export class NativeContextConflict extends Error {}
/** A conflict or ambiguous result must be re-read, never replayed with a guessed version. */
export function NativeCommandDialog({ title, dirty, disabled, onClose, perform, onDone, children, submitLabel = 'Salvar' }: {
  title: string; dirty: boolean; disabled?: boolean; onClose: () => void;
  perform: (signal: AbortSignal) => Promise<void>; onDone: () => Promise<void>; children: (busy: boolean) => ReactNode; submitLabel?: string;
}) {
  const request = useEditorRequest(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const close = useEditorProtection({ dirty, busy }, onClose);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || blocked || request.isPending()) return;
    setBusy(true); setError('');
    try { await request.run(perform); if (request.isActive()) await onDone(); }
    catch (failure) {
      if (!request.isActive()) return;
      const retryable = failure instanceof NativeFormError || failure instanceof ApiError && [400, 422].includes(failure.status);
      setBlocked(!retryable);
      setError(failure instanceof NativeFormError || failure instanceof NativeContextConflict ? failure.message
        : failure instanceof ApiError && failure.status === 409 ? 'O registro ou as condições da operação mudaram. Seus dados foram mantidos. Feche a janela e atualize a consulta antes de tentar novamente.'
        : failure instanceof ApiError && [401, 403, 404].includes(failure.status) ? 'A API não autorizou ou não encontrou este registro. Atualize a consulta antes de tentar novamente.'
        : failure instanceof InvalidReadResponse ? 'A resposta não confirmou os dados desta operação. Atualize a consulta antes de repetir.'
        : retryable ? 'A API recusou os dados ou as condições da operação. Revise o formulário.'
        : 'Não foi possível confirmar a conclusão. Consulte a lista atualizada antes de repetir a operação.');
    } finally { if (request.isActive()) setBusy(false); }
  }
  return <Modal open title={title} onClose={close}><form className={`stack ${styles.form}`} onSubmit={event => void submit(event)}>{children(busy)}{error && <Feedback tone="danger">{error}</Feedback>}<div className="actions"><Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" disabled={busy || disabled || blocked}>{busy ? 'Salvando…' : submitLabel}</Button></div></form></Modal>;
}
