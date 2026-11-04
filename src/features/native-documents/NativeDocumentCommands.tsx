import { useState } from 'react';
import { nativeDocumentsApi } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { Feedback, Field } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedDocument, checkedDocumentType, checkedVersion, checkedVersions, type FilePolicy, type NativeDocument, type NativeDocumentVersion } from './contracts';
import { checkDocumentFile, documentHash } from './files';

function sameContext(a: NativeDocument, b: NativeDocument) {
  return a.id === b.id && a.companyId === b.companyId && a.unitId === b.unitId && a.departmentId === b.departmentId
    && a.ownerId === b.ownerId && a.documentTypeId === b.documentTypeId && a.code === b.code;
}
export function NativeDocumentUpload({ item, policy, onClose, onDone }: { item: NativeDocument; policy: FilePolicy; onClose: () => void; onDone: () => Promise<void> }) {
  const { me, can } = useSession(), [file, setFile] = useState<File>(), [reason, setReason] = useState('');
  const allowed = Boolean(me && can('documento:editar') && item.status !== 'ARQUIVADO'
    && (item.secrecyLevel !== 'Medico' || can('aso:editar')));
  async function perform(signal: AbortSignal) {
    if (!allowed || !me) throw new NativeFormError('Sua conta não permite anexar uma versão a este documento.');
    const selected = checkDocumentFile(file, policy), expectedHash = await documentHash(selected, signal);
    const fresh = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    if (!sameContext(fresh, item) || fresh.revision !== item.revision || fresh.currentVersionNumber !== item.currentVersionNumber || fresh.status !== item.status)
      throw new NativeContextConflict('O documento foi alterado. Atualize o registro antes de anexar a versão.');
    const body = new FormData(); body.set('file', selected); body.set('expectedVersion', String(item.revision));
    if (reason.trim()) body.set('justification', reason.trim());
    const saved = checkedVersion(await nativeDocumentsApi.post<unknown>(`/documents/${item.id}/versions`, body, { signal }), item.id);
    if (saved.versionNumber !== item.currentVersionNumber + 1 || saved.fileHash !== expectedHash || saved.authorId !== me.user.id
      || saved.state !== 'EM_REVISAO' || saved.isCurrent || saved.approverId || saved.approvedAt
      || saved.justification !== (reason.trim() || null)) throw new InvalidReadResponse();
    const updated = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    if (!sameContext(updated, item) || updated.revision !== item.revision + 1 || updated.currentVersionNumber !== saved.versionNumber || updated.status !== 'EM_REVISAO') throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title="Anexar versão" dirty={Boolean(file || reason)} disabled={!allowed} submitLabel="Enviar para conferência" perform={perform} onClose={onClose} onDone={onDone}>{busy => <>
    <p>{item.title} · {item.code}</p><Field label="Arquivo" required><input type="file" accept={policy.allowedMimeTypes.join(',')} disabled={busy} onChange={e => setFile(e.target.files?.[0])}/></Field>
    <p>Até {(policy.maxSizeBytes / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB · {policy.allowedMimeTypes.map(t => ({ 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPEG' }[t])).join(', ')}.</p>
    <Field label="Observação da versão"><textarea maxLength={2000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/></Field>
    <Feedback>O envio ficará aguardando conferência. Anexar o arquivo não libera uma atividade.</Feedback>
  </>}</NativeCommandDialog>;
}

export function NativeDocumentReview({ item, version, decision, onClose, onDone }: { item: NativeDocument; version: NativeDocumentVersion; decision: 'aceita' | 'reprovada'; onClose: () => void; onDone: () => Promise<void> }) {
  const { me, can } = useSession(), [reason, setReason] = useState(''), [confirmation, confirm] = useState(false);
  const allowed = Boolean(me && can('documento:aprovar') && (item.secrecyLevel !== 'Medico' || can('aso:editar')));
  async function perform(signal: AbortSignal) {
    if (!allowed || !me || !confirmation || decision === 'reprovada' && !reason.trim()) throw new NativeFormError('Confirme a conferência e informe o motivo em caso de reprovação.');
    const fresh = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    if (!sameContext(fresh, item) || fresh.revision !== item.revision || fresh.currentVersionNumber !== version.versionNumber) throw new NativeContextConflict('O documento mudou. Atualize a versão antes de decidir.');
    const versions = checkedVersions(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}/versions`, { signal }), fresh);
    const selected = versions.find(v => v.id === version.id);
    if (!selected || JSON.stringify(selected) !== JSON.stringify(version) || selected.state !== 'EM_REVISAO') throw new NativeContextConflict('A versão já foi alterada ou recebeu uma decisão. Atualize a consulta.');
    const type = checkedDocumentType(await nativeDocumentsApi.get<unknown>(`/document-types/${item.documentTypeId}`, { signal }), item.documentTypeId);
    if (decision === 'aceita' && type.requiresSignature) throw new NativeFormError('Este tipo exige verificação de assinatura em um fluxo específico antes da aprovação.');
    const receipt = checkedVersion(await nativeDocumentsApi.post<unknown>(`/documents/${item.id}/versions/${version.id}/review`, {
      expectedVersion: item.revision, version: version.versionNumber, decision, reason: reason.trim() || null,
    }, { signal }), item.id);
    if (receipt.id !== version.id || receipt.versionNumber !== version.versionNumber || receipt.fileHash !== version.fileHash
      || receipt.storedFileId !== version.storedFileId || receipt.authorId !== version.authorId || receipt.approverId !== me.user.id
      || receipt.state !== (decision === 'aceita' ? 'VIGENTE' : 'REJEITADA') || receipt.isCurrent !== (decision === 'aceita')
      || decision === 'aceita' && !receipt.approvedAt || decision === 'reprovada' && receipt.justification !== reason.trim()) throw new InvalidReadResponse();
    const updated = checkedDocument(await nativeDocumentsApi.get<unknown>(`/documents/${item.id}`, { signal }), item.id, me.scope);
    if (!sameContext(updated, item) || updated.revision !== item.revision + 1 || updated.currentVersionNumber !== item.currentVersionNumber
      || updated.status !== (decision === 'aceita' ? 'VIGENTE' : 'EM_REVISAO')) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={decision === 'aceita' ? 'Aceitar evidência' : 'Reprovar evidência'} dirty={Boolean(reason || confirmation)} disabled={!allowed}
    submitLabel={decision === 'aceita' ? 'Confirmar aceite' : 'Confirmar reprovação'} perform={perform} onClose={onClose} onDone={onDone}>{busy => <>
    <p>{item.title} · versão {version.versionNumber}</p>
    <Field label={decision === 'reprovada' ? 'Motivo da reprovação' : 'Observação da conferência'} required={decision === 'reprovada'}><textarea maxLength={2000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/></Field>
    <label><input type="checkbox" checked={confirmation} disabled={busy} onChange={e => confirm(e.target.checked)}/> Conferi o arquivo e confirmo esta decisão para a versão indicada.</label>
  </>}</NativeCommandDialog>;
}
