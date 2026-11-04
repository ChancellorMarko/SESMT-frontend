import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, Feedback, Field, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import type { Training } from './contracts';
import { checkedEvidence, checkedEvidenceOptions, evidenceStates, sameBinding, type EvidenceOption, type EvidenceReceipt } from './evidence-contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

export type EvidenceCommand = { kind: 'link' | 'unlink'; training: Training; receipt: EvidenceReceipt };
const path = (id: string) => `/trainings/${id}/evidence`;
export function TrainingEvidence({ training, onCommand }: { training: Training; onCommand: (command: EvidenceCommand) => void }) {
  const { sessionKey, me } = useSession();
  const query = useVerifiedRead({ queryKey: ['native-training', sessionKey, training.unitId, 'evidence', training.id, training.revision], enabled: true,
    request: signal => api.get<unknown>(path(training.id), { query: { unitId: training.unitId }, signal }),
    validate: value => checkedEvidence(value, training, Boolean(me?.scope.ownOnly)) });
  const receipt = query.data;
  return <section className="panel stack" aria-label="Comprovante do treinamento"><strong>Comprovante</strong>
    {query.isPending ? <Spinner/> : query.isError ? <Feedback tone="danger">Não foi possível conferir o vínculo do comprovante. <Button variant="ghost" onClick={() => void query.refetch()}>Atualizar vínculo</Button></Feedback> : receipt && <>
      <div><Badge tone={['CURRENT', 'EMPTY'].includes(receipt.state) ? 'neutral' : 'warning'}>{evidenceStates[receipt.state]}</Badge></div>
      {receipt.evidence && <><p>{receipt.evidence.code} · {receipt.evidence.title}<br/>Versão {receipt.evidence.versionNumber} · vínculo em {formatDate(receipt.evidence.linkedAt)}</p>
        <Link className="button button--secondary" target="_blank" rel="noopener noreferrer" to={`/app/documentos/${receipt.evidence.documentId}?versao=${receipt.evidence.versionId}&sha256=${receipt.evidence.fileHash}`}>Abrir documento</Link>
        <details><summary>Identificação da versão vinculada</summary><p className={styles.message}>SHA-256: {receipt.evidence.fileHash}</p><p>Revisão do treinamento na conferência: {receipt.evidence.linkedTrainingRevision}</p></details>
      </>}
      {receipt.canManage && !training.revokedAt && <div className="actions"><Button variant="secondary" onClick={() => onCommand({ kind: 'link', training, receipt })}>{receipt.state === 'EMPTY' ? 'Vincular comprovante' : 'Conferir ou substituir vínculo'}</Button>{receipt.state !== 'EMPTY' && <Button variant="ghost" onClick={() => onCommand({ kind: 'unlink', training, receipt })}>Remover vínculo</Button>}</div>}
    </>}
  </section>;
}
export function TrainingEvidenceEditor({ command, onClose, onSaved }: { command: EvidenceCommand; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const { training, kind } = command, { me, sessionKey } = useSession();
  const ownOnly = Boolean(me?.scope.ownOnly), [reason, setReason] = useState(''), [confirmed, confirm] = useState(false);
  const [input, setInput] = useState(''), [q, search] = useState(''), [page, setPage] = useState(1), [selection, select] = useState<EvidenceOption>();
  const options = useVerifiedRead({ queryKey: ['native-training', sessionKey, training.unitId, 'evidence-options', training.id, training.revision, q, page], enabled: kind === 'link',
    request: signal => api.get<unknown>(`${path(training.id)}/options`, { query: { unitId: training.unitId, q, page }, signal }), validate: value => checkedEvidenceOptions(value, training, page, q) });
  function find(event: FormEvent) { event.preventDefault(); search(input.trim()); setPage(1); select(undefined); confirm(false); if (q === input.trim() && page === 1) void options.refetch(); }
  async function perform(signal: AbortSignal) {
    if (!confirmed || reason.trim().length < 3 || reason.trim().length > 200 || ownOnly || kind === 'link' && !selection) throw new NativeFormError('Selecione o comprovante, informe o motivo e confirme os dados.');
    const fresh = checkedEvidence(await api.get<unknown>(path(training.id), { query: { unitId: training.unitId }, signal }), training, ownOnly);
    if (!fresh.canManage) throw new NativeContextConflict('O acesso ao vínculo mudou. Atualize o treinamento.');
    const body = { unitId: training.unitId, expectedRevision: training.revision, reason: reason.trim(), confirmation: true,
      ...(kind === 'link' ? { documentId: selection!.documentId, versionId: selection!.versionId, expectedDocumentRevision: selection!.documentRevision } : {}) };
    const revised = { ...training, revision: training.revision + 1 };
    const saved = checkedEvidence(await api.post<unknown>(`${path(training.id)}${kind === 'unlink' ? '/unlink' : ''}`, body, { signal }), revised, ownOnly);
    if (kind === 'link' ? !sameBinding(saved, selection!) : saved.state !== 'EMPTY' || saved.evidence !== null) throw new InvalidReadResponse();
    const stored = checkedEvidence(await api.get<unknown>(path(training.id), { query: { unitId: training.unitId }, signal }), revised, ownOnly);
    if (kind === 'link' ? !sameBinding(stored, selection!) : stored.state !== 'EMPTY' || stored.evidence !== null) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={kind === 'link' ? 'Vincular comprovante' : 'Remover vínculo do comprovante'} dirty={Boolean(reason || selection)}
    disabled={!confirmed || kind === 'link' && (!selection || options.isError || options.isFetching)} perform={perform} onClose={onClose} onDone={() => onSaved(training.id)}
    submitLabel={kind === 'link' ? 'Confirmar vínculo' : 'Confirmar remoção'}>{busy => <>
      <p><strong>{training.title}</strong><br/>{training.workerName}</p>
      {kind === 'link' && <>
        <div className={styles.toolbar}><Field label="Buscar comprovante"><input maxLength={160} disabled={busy} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') find(event); }}/></Field><Button variant="secondary" disabled={busy || options.isFetching} onClick={find}>Buscar documentos</Button></div>
        {options.isPending ? <Spinner/> : options.isError ? <Feedback tone="danger">Os comprovantes ou a revisão do treinamento não puderam ser conferidos. Feche a janela e atualize.</Feedback>
          : options.data && <><Field label="Versão do comprovante" required><select value={selection?.versionId ?? ''} disabled={busy} onChange={event => { select(options.data!.items.find(item => item.versionId === event.target.value)); confirm(false); }}><option value="">Selecionar versão publicada</option>{options.data.items.map(item => <option key={item.versionId} value={item.versionId}>{item.code} · {item.title} · versão {item.versionNumber}</option>)}</select></Field>
            {!options.data.items.length && <p>Nenhuma versão publicada e autorizada para este trabalhador nesta consulta.</p>}
            <div className="actions"><Button variant="secondary" disabled={busy || page <= 1} onClick={() => { setPage(page - 1); select(undefined); confirm(false); }}>Anterior</Button><span>Página {page} de {Math.max(1, Math.ceil(options.data.total / 20))}</span><Button variant="secondary" disabled={busy || page * 20 >= options.data.total} onClick={() => { setPage(page + 1); select(undefined); confirm(false); }}>Próxima</Button></div>
          </>}
        <Link target="_blank" rel="noopener noreferrer" to="/app/documentos">Gerenciar documentos</Link>
      </>}
      {kind === 'unlink' && <p>O arquivo será preservado em Documentos, e a remoção ficará no histórico do treinamento.</p>}
      <Field label={kind === 'link' ? 'Motivo da conferência' : 'Motivo da remoção'} required><textarea maxLength={200} disabled={busy} value={reason} onChange={event => { setReason(event.target.value); confirm(false); }}/></Field>
      <label className="check-label"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => confirm(event.target.checked)}/>{kind === 'link' ? 'Conferi a pessoa, o treinamento e a versão deste comprovante.' : 'Confirmo a remoção deste vínculo.'}</label>
    </>}</NativeCommandDialog>;
}
