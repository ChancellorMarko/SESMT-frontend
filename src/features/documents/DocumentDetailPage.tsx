import { isDownloadUrlAllowed } from '../../shared/lib/downloads';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentHistoryDto, DocumentTypeDto, DocumentVersionDto, DownloadUrlDto, OrganizationDto, PageDto, SignatureEvidenceDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { DocumentStatus } from './DocumentStatus';
import { accessLabels, errorMessage, formatBytes, formatDate, validateUpload, zonedDateTimeToIso } from './validation';
import styles from './documents.module.css';

type Command = 'submit-review' | 'review' | 'approve' | 'publish' | 'archive' | 'signature' | 'verify';
const commandLabels: Record<Command, string> = { 'submit-review': 'Enviar para revisão', review: 'Registrar revisão', approve: 'Aprovar versão', publish: 'Publicar versão', archive: 'Arquivar documento', signature: 'Registrar evidência de assinatura', verify: 'Conferir evidência de assinatura' };
const historyLabels: Record<string, string> = { CREATED: 'Documento cadastrado', UPDATED: 'Metadados atualizados', VERSION_CREATED: 'Nova versão anexada', REVIEW_SUBMITTED: 'Enviado para revisão', REVIEWED: 'Revisão registrada', APPROVED: 'Versão aprovada', PUBLISHED: 'Versão publicada', ARCHIVED: 'Documento arquivado', SIGNATURE_EVIDENCE_ADDED: 'Evidência de assinatura registrada', SIGNATURE_VERIFIED: 'Evidência conferida', DOWNLOADED: 'Download autorizado', PREVIEWED: 'Prévia autorizada' };

export { isDownloadUrlAllowed };

export function DocumentDetailPage() {
  const { id } = useParams();
  const { me, sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const [chosenVersionId, setChosenVersionId] = useState('');
  const [versionPage, setVersionPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [command, setCommand] = useState<Command>();
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState('ACCEPT');
  const [evidenceId, setEvidenceId] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signedAt, setSignedAt] = useState('');
  const [file, setFile] = useState<File>();
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const [download, setDownload] = useState<DownloadUrlDto>();
  const [preview, setPreview] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => { setChosenVersionId(''); setVersionPage(1); setHistoryPage(1); setCommand(undefined); setDownload(undefined); setNotice(''); }, [id, sessionKey, unitId]);
  const document = useQuery({ queryKey: ['document', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<DocumentDto>(`/documents/${id}`, { signal }) });
  const types = useQuery({ queryKey: ['document-types', sessionKey], queryFn: ({ signal }) => api.get<PageDto<DocumentTypeDto>>('/document-types', { signal, query: { pageSize: 100 } }) });
  const organization = useQuery({ queryKey: ['organization', sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }), enabled: can('organization.read') });
  const versions = useQuery({ queryKey: ['document-versions', sessionKey, unitId, id, versionPage], queryFn: ({ signal }) => api.get<PageDto<DocumentVersionDto>>(`/documents/${id}/versions`, { signal, query: { page: versionPage, pageSize: 10 } }), enabled: Boolean(document.data), refetchInterval: (query) => query.state.data?.items.some((item) => item.file.scanStatus === 'PENDING') ? 3000 : false });
  const selectedId = chosenVersionId || document.data?.currentVersionId || document.data?.activeVersionIds?.[0];
  const version = useQuery({ queryKey: ['document-version', sessionKey, unitId, id, selectedId], queryFn: ({ signal }) => api.get<DocumentVersionDto>(`/documents/${id}/versions/${selectedId}`, { signal }), enabled: Boolean(document.data && selectedId), refetchInterval: (query) => query.state.data?.file.scanStatus === 'PENDING' || query.state.data?.signatureEvidences.some((evidence) => evidence.file.scanStatus === 'PENDING') ? 3000 : false });
  const history = useQuery({ queryKey: ['document-history', sessionKey, unitId, id, historyPage], queryFn: ({ signal }) => api.get<PageDto<DocumentHistoryDto>>(`/documents/${id}/history`, { signal, query: { page: historyPage, pageSize: 10 } }), enabled: Boolean(document.data) });
  const type = types.data?.items.find((item) => item.id === document.data?.typeId);
  const medicalWriteAllowed = document.data?.accessClass !== 'MEDICAL' || can('documents.medical.write');
  const hasDocumentAction = (permission: string, action: string) => can(permission) && medicalWriteAllowed && document.data?.availableActions.includes(action);
  const hasVersionAction = (permission: string, action: string, writing = true) => can(permission) && (!writing || medicalWriteAllowed) && version.data?.availableActions.includes(action);

  const mutation = useMutation({ mutationFn: async () => {
    if (!command) return;
    const base = `/documents/${id}/versions/${selectedId}`;
    const options = { etag: revisionEtag(command === 'archive' ? document.data!.revision : version.data!.revision), idempotencyKey: crypto.randomUUID() };
    if (command === 'archive') return api.post<DocumentDto>(`/documents/${id}/archive`, { reason: comment.trim() }, options);
    if (command === 'signature') {
      const body = new FormData(); body.append('file', file!); body.append('signerName', signerName.trim()); body.append('signedAt', zonedDateTimeToIso(signedAt));
      return api.post<SignatureEvidenceDto>(`${base}/signature-evidences`, body, options);
    }
    if (command === 'verify') return api.post<SignatureEvidenceDto>(`${base}/signature-evidences/${evidenceId}/verification`, { decision, comment: comment.trim() }, options);
    if (command === 'review') return api.post<DocumentVersionDto>(`${base}/reviews`, { decision, comment: comment.trim() }, options);
    const suffix = command === 'approve' ? 'approvals' : command;
    return api.post<unknown>(`${base}/${suffix}`, { comment: comment.trim() || undefined }, options);
  }, onSuccess: async () => {
    const label = command ? commandLabels[command] : 'Operação';
    setCommand(undefined); setNotice(`${label}: operação confirmada.`);
    await Promise.all(['document', 'document-versions', 'document-version', 'document-history', 'documents', 'dashboard', 'notifications', 'audit-logs'].map((key) => client.invalidateQueries({ queryKey: [key] })));
  } });

  function openCommand(next: Command, selectedEvidenceId = '') {
    setCommand(next); setComment(''); setDecision(next === 'verify' ? 'VERIFIED' : 'ACCEPT'); setSignerName(''); setSignedAt(''); setFile(undefined); setEvidenceId(selectedEvidenceId); setLocalError(''); mutation.reset();
  }
  async function submitCommand(event: FormEvent) {
    event.preventDefault(); setLocalError('');
    if ((command === 'archive' || command === 'review' || command === 'verify') && !comment.trim()) { setLocalError('Informe uma justificativa antes de confirmar.'); return; }
    if (command === 'signature') {
      const uploadError = validateUpload(file, type);
      if (uploadError) { setLocalError(uploadError); return; }
      if (!signerName.trim() || !signedAt) { setLocalError('Informe o signatário e a data/hora da assinatura.'); return; }
      try { zonedDateTimeToIso(signedAt); } catch (error) { setLocalError(errorMessage(error)); return; }
    }
    if (command === 'verify') {
      const evidence = version.data?.signatureEvidences.find((item) => item.id === evidenceId);
      if (!evidence || evidence.file.scanStatus !== 'CLEAN') { setLocalError('Selecione uma evidência com arquivo liberado.'); return; }
    }
    try { await mutation.mutateAsync(); } catch { /* Preserve the form and display the server response. */ }
  }

  const downloadMutation = useMutation({ mutationFn: async ({ purpose, signatureEvidenceId }: { purpose: 'DOWNLOAD' | 'PREVIEW'; signatureEvidenceId?: string }) => {
    const base = `/documents/${id}/versions/${selectedId}`;
    const path = signatureEvidenceId ? `${base}/signature-evidences/${signatureEvidenceId}/download-url` : `${base}/download-url`;
    const result = await api.post<DownloadUrlDto>(path, { purpose });
    if (!isDownloadUrlAllowed(result.url)) throw new Error('O endereço do arquivo não pertence a uma origem de armazenamento autorizada.');
    if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error('O link expirou. Solicite um novo acesso ao arquivo.');
    return { result, purpose };
  }, onSuccess: ({ result, purpose }) => { setDownload(result); setPreview(purpose === 'PREVIEW'); }, onError: (error) => setDownloadError(errorMessage(error)) });
  useEffect(() => {
    if (!download) return;
    const timer = window.setTimeout(() => { setDownload(undefined); setDownloadError('O acesso temporário ao arquivo expirou. Solicite uma nova prévia ou download.'); }, Math.max(0, Date.parse(download.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [download]);
  function requestDownload(purpose: 'DOWNLOAD' | 'PREVIEW', signatureEvidenceId?: string) { setDownloadError(''); downloadMutation.mutate({ purpose, signatureEvidenceId }); }

  if (document.isPending) return <Spinner />;
  if (document.isError) return <div className="panel stack"><Feedback tone="danger">{errorMessage(document.error)}</Feedback><Button variant="secondary" onClick={() => document.refetch()}>Tentar novamente</Button></div>;
  const doc = document.data;
  const current = version.data;
  const currentIsClean = current?.file.scanStatus === 'CLEAN';

  return <div className="stack">
    <PageHeader eyebrow={doc.code} title={doc.title} description="Metadados, vigência e histórico de um documento controlado." actions={<Link to="/app/documentos">Voltar à central</Link>} />
    {notice && <Feedback tone="success">{notice}</Feedback>}
    <section className="panel stack" aria-label="Metadados do documento">
      <div className="toolbar"><div className="actions"><DocumentStatus status={doc.status} /><span className="muted">{accessLabels[doc.accessClass]}</span></div><div className="actions">
        {hasDocumentAction('documents.write', 'EDIT_METADATA') && <Link className="button button--secondary" to={`/app/documentos/${id}/editar`}>Editar metadados</Link>}
        {hasDocumentAction('documents.write', 'CREATE_VERSION') && <Link className="button button--primary" to={`/app/documentos/${id}/versoes/nova`}>Nova versão</Link>}
        {hasDocumentAction('documents.archive', 'ARCHIVE') && <Button variant="danger" onClick={() => openCommand('archive')}>Arquivar</Button>}
      </div></div>
      <dl className={styles.metadata}>
        <div><dt>Tipo documental</dt><dd>{type?.name ?? 'Tipo cadastrado'}</dd></div><div><dt>Unidade</dt><dd>{organization.data?.units.find((item) => item.id === doc.unitId)?.name ?? 'Unidade autorizada'}</dd></div>
        <div><dt>Setor</dt><dd>{doc.sectorId ? organization.data?.sectors.find((item) => item.id === doc.sectorId)?.name ?? 'Setor vinculado' : 'Sem setor específico'}</dd></div><div><dt>Proprietário</dt><dd>{doc.ownerId === me?.user.id ? me.user.displayName : 'Proprietário cadastrado'}</dd></div>
        <div><dt>Emissão</dt><dd>{formatDate(doc.issueDate)}</dd></div><div><dt>Vigência</dt><dd>{formatDate(doc.validFrom)} a {formatDate(doc.validUntil)}</dd></div>
        <div><dt>Trabalhadores vinculados</dt><dd>{doc.workerIds.length}</dd></div><div><dt>Responsáveis</dt><dd>{doc.responsibleIds.length}</dd></div><div><dt>Palavras-chave</dt><dd>{doc.keywords.join(', ') || '—'}</dd></div>
      </dl>
      {doc.activeVersionIds.length > 1 && <Feedback tone="info">A política deste documento autoriza {doc.activeVersionIds.length} versões vigentes. Selecione a versão desejada para consultar seu arquivo.</Feedback>}
      {doc.currentVersionId && !doc.activeVersionIds.includes(doc.currentVersionId) && doc.activeVersionIds.length > 0 && <Feedback tone="info">A versão em trabalho ainda não substituiu a versão vigente.</Feedback>}
    </section>
    <section className="panel stack" aria-label="Versões do documento"><h2>Versões</h2>
      {versions.isPending ? <Spinner /> : versions.isError ? <Feedback tone="danger">{errorMessage(versions.error)}</Feedback> : !versions.data?.items.length ? <EmptyState title="Nenhum arquivo anexado" description="Crie a primeira versão para iniciar a revisão deste documento." /> : <>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Versão</th><th>Arquivo</th><th>Situação</th><th>Verificação</th><th>Criada em</th><th>Consulta</th></tr></thead><tbody>{versions.data.items.map((item) => <tr key={item.id}><td>v{item.versionNumber}{doc.activeVersionIds.includes(item.id) ? ' · vigente' : ''}{doc.currentVersionId === item.id ? ' · em trabalho' : ''}</td><td>{item.file.name}</td><td><DocumentStatus status={item.status} /></td><td><DocumentStatus status={item.file.scanStatus} /></td><td>{formatDate(item.createdAt)}</td><td><Button variant="ghost" onClick={() => { setChosenVersionId(item.id); setDownload(undefined); }}>Consultar v{item.versionNumber}</Button></td></tr>)}</tbody></table></div>
        <div className="toolbar"><span className="muted">Página {versionPage} · {versions.data.total} versão(ões)</span><div className="actions"><Button variant="secondary" disabled={versionPage <= 1} onClick={() => setVersionPage(versionPage - 1)}>Versões anteriores</Button><Button variant="secondary" disabled={versionPage * 10 >= versions.data.total} onClick={() => setVersionPage(versionPage + 1)}>Próximas versões</Button></div></div>
      </>}
    </section>
    {selectedId && <section className="panel stack" aria-label="Versão selecionada">{version.isPending ? <Spinner /> : version.isError ? <Feedback tone="danger">{errorMessage(version.error)}</Feedback> : current && <>
      <div className="toolbar"><h2>Versão {current.versionNumber}</h2><DocumentStatus status={current.status} /></div><p>{current.reason}</p>
      <div className="muted">{current.file.name} · {formatBytes(current.file.sizeBytes)} · <DocumentStatus status={current.file.scanStatus} /></div>
      <dl className={styles.metadata}><div><dt>Emissão da versão</dt><dd>{formatDate(current.metadataSnapshot.issueDate)}</dd></div><div><dt>Validade da versão</dt><dd>{formatDate(current.metadataSnapshot.validFrom)} a {formatDate(current.metadataSnapshot.validUntil)}</dd></div></dl>
      {!currentIsClean && <Feedback tone={current.file.scanStatus === 'REJECTED' ? 'danger' : 'warning'}>{current.file.scanStatus === 'REJECTED' ? 'O arquivo foi rejeitado na verificação. Envie uma nova versão permitida.' : 'O arquivo está em verificação. Prévia, download e avanços de aprovação aguardam a liberação.'}</Feedback>}
      <div className="actions">
        {hasVersionAction('documents.download', 'PREVIEW', false) && <Button variant="secondary" disabled={!currentIsClean || downloadMutation.isPending} onClick={() => requestDownload('PREVIEW')}>Visualizar arquivo</Button>}
        {hasVersionAction('documents.download', 'DOWNLOAD', false) && <Button variant="secondary" disabled={!currentIsClean || downloadMutation.isPending} onClick={() => requestDownload('DOWNLOAD')}>Solicitar download</Button>}
        {hasVersionAction('documents.write', 'SUBMIT_REVIEW') && <Button disabled={!currentIsClean} onClick={() => openCommand('submit-review')}>Enviar para revisão</Button>}
        {hasVersionAction('documents.review', 'REVIEW') && <Button disabled={!currentIsClean} onClick={() => openCommand('review')}>Registrar revisão</Button>}
        {hasVersionAction('documents.approve', 'APPROVE') && <Button disabled={!currentIsClean} onClick={() => openCommand('approve')}>Aprovar versão</Button>}
        {hasVersionAction('documents.write', 'ADD_SIGNATURE_EVIDENCE') && <Button variant="secondary" onClick={() => openCommand('signature')}>Registrar assinatura</Button>}
        {hasVersionAction('documents.publish', 'PUBLISH') && <Button disabled={!currentIsClean} onClick={() => openCommand('publish')}>Publicar versão</Button>}
      </div>
      {current.review && <Feedback tone="info">Revisão: {current.review.decision === 'ACCEPT' ? 'aceita' : 'correções solicitadas'}. {current.review.comment}</Feedback>}
      {current.approval && <Feedback tone="success">Aprovação registrada{current.approval.approvedAt ? ` em ${formatDate(current.approval.approvedAt)}` : ''}. {current.approval.comment}</Feedback>}
      <h3>Evidências de assinatura</h3>{current.signatureEvidences.length === 0 ? <p className="muted">Nenhuma evidência registrada nesta versão.</p> : current.signatureEvidences.map((evidence) => <div className={styles.evidence} key={evidence.id}><div><strong>{evidence.signerName}</strong><p className="muted">{formatDate(evidence.signedAt)} · {evidence.file.name}</p><div className="actions"><DocumentStatus status={evidence.file.scanStatus} /><DocumentStatus status={evidence.verificationStatus} /></div></div><div className="actions">
        {can('documents.download') && <Button variant="secondary" disabled={evidence.file.scanStatus !== 'CLEAN' || downloadMutation.isPending} onClick={() => requestDownload('PREVIEW', evidence.id)}>Consultar evidência</Button>}
        {hasVersionAction('documents.signatures.verify', 'VERIFY_SIGNATURE_EVIDENCE') && <Button disabled={evidence.file.scanStatus !== 'CLEAN'} onClick={() => openCommand('verify', evidence.id)}>Conferir evidência</Button>}
      </div></div>)}
      <small className="muted">Evidências registradas e conferidas pelo responsável. A interface não declara validação jurídica ou criptográfica da assinatura.</small>
    </>}</section>}
    {downloadError && <Feedback tone="danger">{downloadError}</Feedback>}
    <section className="panel stack" aria-label="Histórico do documento"><h2>Histórico</h2>{history.isPending ? <Spinner /> : history.isError ? <Feedback tone="danger">{errorMessage(history.error)}</Feedback> : !history.data?.items.length ? <p className="muted">Nenhum evento disponível para consulta.</p> : <>
      <ol className={styles.history}>{history.data.items.map((item) => <li key={item.id}><strong>{historyLabels[item.action] ?? item.action}</strong><span>{item.actor.displayName} · {formatDate(item.occurredAt)}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol>
      <div className="toolbar"><span className="muted">Página {historyPage} · {history.data.total} evento(s)</span><div className="actions"><Button variant="secondary" disabled={historyPage <= 1} onClick={() => setHistoryPage(historyPage - 1)}>Histórico anterior</Button><Button variant="secondary" disabled={historyPage * 10 >= history.data.total} onClick={() => setHistoryPage(historyPage + 1)}>Próximos eventos</Button></div></div>
    </>}</section>
    <Modal open={Boolean(command)} title={command ? commandLabels[command] : ''} onClose={() => { if (!mutation.isPending) setCommand(undefined); }}><form className="stack" onSubmit={submitCommand}>
      {command === 'archive' && <Feedback tone="warning">O documento será arquivado. Versões e histórico permanecem preservados.</Feedback>}
      {command === 'publish' && <Feedback tone="info">A publicação seguirá a política de vigência do documento. A alteração só será apresentada após a confirmação.</Feedback>}
      {command === 'review' && <Field label="Resultado da revisão"><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="ACCEPT">Revisão aceita</option><option value="REQUEST_CHANGES">Solicitar correções</option></select></Field>}
      {command === 'verify' && <><Feedback tone="info">Consulte o arquivo da evidência antes de registrar sua decisão.</Feedback><Field label="Resultado da conferência"><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="VERIFIED">Conferida pelo responsável</option><option value="REJECTED">Rejeitada</option></select></Field></>}
      {command === 'signature' && <><Field label="Nome do signatário *"><input value={signerName} maxLength={200} onChange={(event) => setSignerName(event.target.value)} /></Field><Field label="Data e hora da assinatura (Brasília) *"><input type="datetime-local" value={signedAt} onChange={(event) => setSignedAt(event.target.value)} /></Field><Field label="Arquivo da evidência *"><input type="file" accept={type?.allowedMimeTypes.join(',')} onChange={(event) => setFile(event.target.files?.[0])} />{type && <small className="muted">Limite: {formatBytes(type.maxFileSizeBytes)}.</small>}</Field></>}
      {command !== 'signature' && <Field label={command === 'archive' || command === 'review' || command === 'verify' ? 'Justificativa *' : 'Observação (opcional)'}><textarea value={comment} rows={4} maxLength={1000} onChange={(event) => setComment(event.target.value)} /></Field>}
      {localError && <Feedback tone="danger">{localError}</Feedback>}{mutation.isError && <Feedback tone="danger">{errorMessage(mutation.error)}</Feedback>}
      <div className="actions"><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Confirmando…' : 'Confirmar'}</Button><Button variant="secondary" type="button" disabled={mutation.isPending} onClick={() => setCommand(undefined)}>Cancelar</Button></div>
    </form></Modal>
    <Modal open={Boolean(download)} title={preview ? 'Prévia autorizada' : 'Download autorizado'} onClose={() => setDownload(undefined)}>{download && <div className="stack"><p>{download.fileName}</p>{preview && download.mimeType === 'application/pdf' && <iframe className={styles.preview} title={`Prévia de ${download.fileName}`} src={download.url} sandbox="allow-same-origin" />}{preview && ['image/png', 'image/jpeg'].includes(download.mimeType) && <img className={styles.imagePreview} src={download.url} alt={`Prévia de ${download.fileName}`} />}{preview && !['application/pdf', 'image/png', 'image/jpeg'].includes(download.mimeType) && <p>Este formato pode ser consultado baixando o arquivo.</p>}<a className="button button--primary" href={download.url} target="_blank" rel="noopener noreferrer" download={download.fileName}>Abrir / baixar arquivo</a><small className="muted">Acesso temporário válido até {formatDate(download.expiresAt)}.</small></div>}</Modal>
  </div>;
}
