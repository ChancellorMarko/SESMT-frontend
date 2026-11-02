import { useState } from 'react';
import { nativeDocumentsApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Field } from '../../shared/ui';
import { isCivilDate } from '../documents/validation';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedDocument, type NativeDocument } from './contracts';
import styles from './NativeDocuments.module.css';

export function editableDocument(item: NativeDocument) { return item.status === 'RASCUNHO' || item.status === 'EM_REVISAO'; }

/** Change descriptive fields without replacing files, links, classification or structured metadata. */
export function NativeDocumentMetadata({ item, onClose, onDone }: { item: NativeDocument; onClose: () => void; onDone: () => Promise<void> }) {
  const { me, can } = useSession();
  const [title, setTitle] = useState(item.title), [description, setDescription] = useState(item.description ?? '');
  const [issue, setIssue] = useState(item.issueDate), [from, setFrom] = useState(item.validFromDate ?? ''), [until, setUntil] = useState(item.validUntilDate ?? '');
  const allowed = Boolean(me && can('documento:editar') && editableDocument(item) && (item.secrecyLevel !== 'Medico' || can('aso:editar')));
  const dirty = title !== item.title || description !== (item.description ?? '') || issue !== item.issueDate || from !== (item.validFromDate ?? '') || until !== (item.validUntilDate ?? '');
  async function perform(signal: AbortSignal) {
    if (!allowed || !me) throw new NativeFormError('Seu acesso ou a situação do documento não permite esta edição.');
    if (!title.trim() || title.trim().length > 255 || description.trim().length > 2000 || !isCivilDate(issue)
      || from && !isCivilDate(from) || until && (!isCivilDate(until) || until < issue || from && until < from))
      throw new NativeFormError('Confira título, emissão e intervalo de validade. O vencimento não pode anteceder a emissão ou o início da validade.');
    const fresh = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    if (JSON.stringify(fresh) !== JSON.stringify(item)) throw new NativeContextConflict('O documento foi alterado. Seus dados foram mantidos. Feche a janela e atualize o registro antes de salvar.');
    const body = { expectedVersion: item.revision, title: title.trim(), description: description.trim() || null, issueDate: issue,
      validFromDate: from || null, validUntilDate: until || null, secrecyLevel: item.secrecyLevel, keywords: item.keywords, metadata: item.metadata };
    const saved = checkedDocument(await nativeDocumentsApi.patch<unknown>(`/documents/${item.id}`, body, { signal }), item.id, me.scope);
    const expected = { ...item, ...body, revision: item.revision + 1 };
    for (const key of Object.keys(item) as (keyof NativeDocument)[]) {
      if (JSON.stringify(saved[key]) !== JSON.stringify(expected[key])) throw new InvalidReadResponse();
    }
    const stored = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    if (JSON.stringify(stored) !== JSON.stringify(saved)) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Editar dados do documento" dirty={dirty} disabled={!allowed || !dirty} submitLabel="Salvar alterações" onClose={onClose} onDone={onDone} perform={perform}>{busy => <>
    <p>{item.code}</p><Field label="Título" required><input maxLength={255} disabled={busy} value={title} onChange={e => setTitle(e.target.value)}/></Field>
    <Field label="Descrição"><textarea maxLength={2000} disabled={busy} value={description} onChange={e => setDescription(e.target.value)}/></Field>
    <div className={styles.grid}><Field label="Emissão" required><input type="date" disabled={busy} value={issue} onChange={e => setIssue(e.target.value)}/></Field>
    <Field label="Válido a partir de"><input type="date" disabled={busy} value={from} onChange={e => setFrom(e.target.value)}/></Field>
    <Field label="Válido até"><input type="date" disabled={busy} value={until} onChange={e => setUntil(e.target.value)}/></Field></div>
  </>}</NativeCommandDialog>;
}
