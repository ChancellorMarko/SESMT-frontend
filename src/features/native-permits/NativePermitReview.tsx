import { useState } from 'react';
import { api } from '../../shared/api/client';
import { formatDate } from '../../shared/lib/format';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Badge, Button, Feedback, Field, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedPermit, permitReviewLabels, type NativePermit, type PermitReview } from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

type ReviewRead = { data?: PermitReview; isPending: boolean; isError: boolean };
type Decision = 'APROVADA' | 'DEVOLVIDA';

/**
 * Final review of a completed permit. Completion only sends the closing for review; approving or returning it is
 * a separate decision by whoever the API designates as reviewer, and a return keeps the replaced closing on record.
 */
export function NativePermitReview({ item, review, refreshing, onDone }: { item: NativePermit; review: ReviewRead; refreshing: boolean; onDone: () => Promise<void> }) {
  const [deciding, decide] = useState<Decision>(), [note, setNote] = useState('');
  const state = review.data;
  async function perform(signal: AbortSignal) {
    if (!deciding || !state?.canReview) throw new NativeFormError('A revisão não está disponível para esta conta agora. Atualize a PT.');
    const text = note.trim();
    if (deciding === 'DEVOLVIDA' && !text) throw new NativeFormError('Informe o motivo da devolução.');
    if (text.length > 2000) throw new NativeFormError('Use até 2.000 caracteres no parecer.');
    const updated = checkedPermit(await api.post<unknown>(`/work-permits/${item.id}/review`, { expectedVersion: item.version, decision: deciding, note: text || null }, { signal }), item.id);
    if (updated.version !== item.version + 1 || updated.status !== 'CONCLUIDA' || updated.reviewStatus !== deciding
      || updated.completionSummary !== item.completionSummary) throw new InvalidReadResponse();
  }
  return <section className="panel stack" aria-label="Revisão final da PT">
    <div className="actions"><h2>Revisão final</h2><Badge tone={item.reviewStatus === 'APROVADA' ? 'success' : item.reviewStatus === 'DEVOLVIDA' ? 'warning' : 'info'}>{permitReviewLabels[item.reviewStatus] ?? item.reviewStatus}</Badge></div>
    <p className="muted">A conclusão envia o encerramento para revisão. A PT só fica revisada depois da aprovação de quem tem a designação de revisor.</p>
    {review.isPending && <Spinner/>}
    {review.isError && <Feedback tone="danger">Não foi possível conferir a revisão desta PT. Atualize a página.</Feedback>}
    {state && <>
      <dl className={styles.details}>
        <dt>Encerramento enviado</dt><dd>{formatDate(state.submittedAt)}</dd>
        {state.reviewedAt && <><dt>{state.reviewStatus === 'APROVADA' ? 'Aprovado em' : 'Devolvido em'}</dt><dd>{formatDate(state.reviewedAt)}</dd></>}
        {state.reviewNote && <><dt>Parecer</dt><dd className={styles.message}>{state.reviewNote}</dd></>}
      </dl>
      {state.reviewStatus === 'DEVOLVIDA' && <Feedback tone="warning">{state.canResubmit ? 'Corrija o encerramento em "Checklists" e reenvie para revisão.' : 'O encerramento foi devolvido. A correção cabe ao responsável pela execução.'}</Feedback>}
      {state.canReview && <div className="actions">
        <Button disabled={refreshing} onClick={() => { setNote(''); decide('APROVADA'); }}>Aprovar encerramento</Button>
        <Button variant="secondary" disabled={refreshing} onClick={() => { setNote(''); decide('DEVOLVIDA'); }}>Devolver para correção</Button>
      </div>}
      {state.previousClosings.length > 0 && <details><summary>Encerramentos anteriores · {state.previousClosings.length}</summary>
        {state.previousClosings.map((closing, index) => <article className="stack" key={`${closing.submittedAt}:${index}`}>
          <p><strong>Enviado em</strong> {formatDate(closing.submittedAt)} · <strong>término informado</strong> {formatDate(closing.actualEnd)}</p>
          <p className={styles.message}>{closing.summary}</p>
          {closing.reviewNote && <p><strong>Motivo da devolução:</strong> {closing.reviewNote}</p>}
        </article>)}
      </details>}
    </>}
    {deciding && <NativeCommandDialog title={deciding === 'APROVADA' ? 'Aprovar encerramento' : 'Devolver encerramento'} dirty={Boolean(note)} onClose={() => decide(undefined)}
      submitLabel={deciding === 'APROVADA' ? 'Confirmar aprovação' : 'Confirmar devolução'} perform={perform} onDone={async () => { decide(undefined); await onDone(); }}>
      {busy => <>
        <p>{item.title} · versão {item.version}</p>
        {item.completionSummary && <p className={styles.message}><strong>Resumo enviado:</strong> {item.completionSummary}</p>}
        <Field label={deciding === 'APROVADA' ? 'Parecer (opcional)' : 'Motivo da devolução'} required={deciding === 'DEVOLVIDA'}>
          <textarea maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)}/>
        </Field>
      </>}
    </NativeCommandDialog>}
  </section>;
}
