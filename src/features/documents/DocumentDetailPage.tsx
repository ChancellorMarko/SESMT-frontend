import { isDownloadUrlAllowed } from '../../shared/lib/downloads';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { Archive, ArrowLeft, Check, ClipboardCheck, Download, Eye, FileCheck, FileText, History, Layers3, Pencil, Plus, Send, Signature } from 'lucide-react';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';
import { consultationNavigation } from '../../shared/lib/consultation-navigation';
import { usePagedLookup } from '../../shared/lib/use-paged-lookup';
import { readIdentifier, useVerifiedRead } from '../../shared/lib/verified-read';
import { isRecord, shortText } from '../../shared/lib/scoped-page';
import type { DocumentReadDto as DocumentDto, DocumentTypeReadDto as DocumentTypeDto, DocumentVersionReadDto as DocumentVersionDto, DownloadUrlDto, SignatureEvidenceDto } from '../../shared/contracts';
import { Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { DocumentStatus } from './DocumentStatus';
import { DocumentVersionList } from './DocumentVersionList';
import { expirationNavigation } from './expiry-navigation';
import { notificationNavigation } from '../notifications/notification-navigation';
import { documentNavigation } from './document-navigation';
import { checkedDocumentDetail, checkedDocumentHistory, checkedDocumentVersion, checkedDocumentVersions } from './document-read';
import { checkedOrganization } from '../workers/worker-read';
import { workerDocumentDestination, workerDocumentNavigation } from '../workers/worker-document-navigation';
import { accessLabels, errorMessage, formatBytes, formatDate, validateUpload, zonedDateTimeToIso } from './validation';
import styles from './documents.module.css';

type Command = 'submit-review' | 'review' | 'approve' | 'publish' | 'archive' | 'signature' | 'verify';
const commandLabels: Record<Command, string> = { 'submit-review': 'Enviar para revisão', review: 'Registrar revisão', approve: 'Aprovar versão', publish: 'Publicar versão', archive: 'Arquivar documento', signature: 'Registrar evidência de assinatura', verify: 'Conferir evidência de assinatura' };
const historyLabels: Record<string, string> = { CREATED: 'Documento cadastrado', DOCUMENT_CREATED: 'Documento cadastrado', UPDATED: 'Metadados atualizados', VERSION_CREATED: 'Nova versão anexada', REVIEW_SUBMITTED: 'Enviado para revisão', REVIEWED: 'Revisão registrada', APPROVED: 'Versão aprovada', PUBLISHED: 'Versão publicada', ARCHIVED: 'Documento arquivado', SIGNATURE_EVIDENCE_ADDED: 'Evidência de assinatura registrada', SIGNATURE_VERIFIED: 'Evidência conferida', DOWNLOADED: 'Download autorizado', PREVIEWED: 'Prévia autorizada' };

export { isDownloadUrlAllowed };

export function DocumentDetailPage() {
  const { id } = useParams();
  const { unitId, sessionKey, can } = useSession();
  return <DocumentDetailContent key={JSON.stringify([id, unitId, sessionKey, ...['documents.read', 'documents.download', 'documents.write', 'documents.approve', 'documents.review', 'documents.publish', 'documents.signatures.verify'].map(can)])} />;
}

function DocumentDetailContent() {
  const { id } = useParams();
  const location = useLocation();
  const { me, sessionKey, unitId, can } = useSession();
  const consultationOrigin = consultationNavigation(location.state, unitId);
  const expirationOrigin = expirationNavigation(location.state, unitId);
  const notificationOrigin = can('notifications.read') ? notificationNavigation(location.state, unitId) : undefined;
  const listOrigin = documentNavigation(location.state, unitId, can('dashboard.read'));
  const workerOrigin = workerDocumentNavigation(location.state, sessionKey, unitId, can('workers.read'), can('eligibility.read'));
  const workerReturn = workerOrigin ? workerDocumentDestination(workerOrigin) : undefined;
  const documentOrigin = notificationOrigin ?? expirationOrigin ?? consultationOrigin ?? workerOrigin ?? listOrigin;
  const backHref = notificationOrigin
    ? `/app/notificacoes${notificationOrigin.notificationReturnTo.search}`
    : expirationOrigin
    ? `/app/vencimentos${expirationOrigin.expirationReturnTo.search}`
    : consultationOrigin
    ? `/app/consulta${consultationOrigin.fromSearch}`
    : workerReturn
    ? workerReturn.to
    : listOrigin?.documentListReturnTo
    ? `/app/documentos${listOrigin.documentListReturnTo.search}`
    : listOrigin?.documentDashboardReturnTo
    ? `/app/painel-documental${listOrigin.documentDashboardReturnTo.search}`
    : '/app/documentos';
  const backLabel = notificationOrigin ? 'Voltar às notificações' : expirationOrigin ? 'Voltar aos vencimentos' : consultationOrigin ? 'Voltar à consulta'
    : workerReturn ? 'Voltar ao trabalhador' : !listOrigin?.documentListReturnTo && listOrigin?.documentDashboardReturnTo ? 'Voltar ao painel documental' : 'Voltar à central';
  const backState = documentOrigin === workerOrigin ? workerReturn?.state : documentOrigin === listOrigin ? listOrigin : undefined;
  const client = useQueryClient();
  const [chosenVersionId, setChosenVersionId] = useState('');
  const versionPanel = useRef<HTMLElement>(null);
  const focusVersion = useRef<string | undefined>(undefined);
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
  const [download, setDownload] = useState<DownloadUrlDto & { readContext: string }>();
  const [preview, setPreview] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => { focusVersion.current = undefined; setChosenVersionId(''); setVersionPage(1); setHistoryPage(1); setCommand(undefined); setDownload(undefined); setNotice(''); }, [id, sessionKey, unitId]);
  const allowed = can('documents.read') && readIdentifier(id) && readIdentifier(unitId);
  const document = useVerifiedRead({ queryKey: ['document', sessionKey, unitId, id], enabled: allowed,
    request: signal => api.get<unknown>(`/documents/${encodeURIComponent(id!)}`, { signal }), validate: value => checkedDocumentDetail(value, id!, unitId!) });
  const ready = Boolean(document.data);
  const organization = useVerifiedRead({ queryKey: ['organization', sessionKey, unitId], request: signal => api.get<unknown>('/organization', { signal, query: { unitId } }), validate: checkedOrganization, enabled: ready && can('organization.read') });
  const versions = useVerifiedRead({ queryKey: ['document-versions', sessionKey, unitId, id, versionPage], scope: ['document-versions', sessionKey, unitId, id],
    request: signal => api.get<unknown>(`/documents/${id}/versions`, { signal, query: { page: versionPage, pageSize: 10 } }),
    validate: value => checkedDocumentVersions(value, id!, versionPage), enabled: ready,
    poll: value => value?.items.some(item => item.file?.scanStatus === 'PENDING') ? 3000 : false });
  const selectedId = chosenVersionId || document.data?.currentVersionId || document.data?.activeVersionIds?.[0] || document.data?.activeVersionId;
  const version = useVerifiedRead({ queryKey: ['document-version', sessionKey, unitId, id, selectedId], scope: ['document-version', sessionKey, unitId, id],
    request: signal => api.get<unknown>(`/documents/${id}/versions/${encodeURIComponent(selectedId!)}`, { signal }),
    validate: value => checkedDocumentVersion(value, id!, selectedId!), enabled: ready && readIdentifier(selectedId),
    poll: value => value?.file?.scanStatus === 'PENDING' || value?.signatureEvidences.some(evidence => evidence.file.scanStatus === 'PENDING') ? 3000 : false });
  const types = usePagedLookup<DocumentTypeDto>({ queryKey: ['document-types', sessionKey, unitId, 'document-detail'], path: '/document-types', selectedIds: [document.data?.typeId, version.data?.metadataSnapshot?.typeId].filter((value): value is string => Boolean(value)), enabled: Boolean(document.data) && can('documents.read') });
  const history = useVerifiedRead({ queryKey: ['document-history', sessionKey, unitId, id, historyPage], scope: ['document-history', sessionKey, unitId, id],
    request: signal => api.get<unknown>(`/documents/${id}/history`, { signal, query: { page: historyPage, pageSize: 10 } }),
    validate: value => checkedDocumentHistory(value, id!, historyPage), enabled: ready });
  const readContext = JSON.stringify([sessionKey, unitId, id, selectedId, document.data?.revision, version.data?.revision, version.data?.file?.id, version.data?.file?.scanStatus,
    version.data?.signatureEvidences.map(evidence => [evidence.id, evidence.file.id, evidence.file.scanStatus, evidence.verificationStatus])]);
  const currentRead = useRef(readContext); currentRead.current = ready && version.data ? readContext : '';
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), [readContext]);
  useEffect(() => {
    if (ready) return;
    setDownload(undefined); setCommand(undefined);
    for (const resource of ['document-versions', 'document-version', 'document-history']) {
      const queryKey = [resource, sessionKey, unitId, id];
      void client.cancelQueries({ queryKey });
      if (document.isError) client.removeQueries({ queryKey });
    }
  }, [client, ready, document.isError, sessionKey, unitId, id]);
  const type = types.selectedItems.find((item) => item.id === document.data?.typeId);
  const selectedVersionType = types.selectedItems.find((item) => item.id === version.data?.metadataSnapshot?.typeId);
  const versionType = selectedVersionType?.sourceReadOnly ? undefined : selectedVersionType;
  const policyReady = types.verified && Boolean(versionType);
  const medicalWriteAllowed = document.data?.accessClass !== 'MEDICAL' || can('documents.medical.write');
  const hasDocumentAction = (permission: string, action: string) => !document.data?.sourceReadOnly && can(permission) && medicalWriteAllowed && document.data?.availableActions.includes(action);
  const hasVersionAction = (permission: string, action: string, writing = true) => !version.data?.sourceReadOnly && can(permission) && (!writing || medicalWriteAllowed) && version.data?.availableActions.includes(action);
  function canCommand(value: Command) {
    if (value === 'archive') return hasDocumentAction('documents.write', 'ARCHIVE');
    const authority = { 'submit-review': ['documents.write', 'SUBMIT_REVIEW'], review: ['documents.review', 'REVIEW'], approve: ['documents.approve', 'APPROVE'], publish: ['documents.publish', 'PUBLISH'], signature: ['documents.write', 'ADD_SIGNATURE_EVIDENCE'], verify: ['documents.signatures.verify', 'VERIFY_SIGNATURE_EVIDENCE'] };
    return hasVersionAction(authority[value][0], authority[value][1]);
  }
  useEffect(() => { if (command && !canCommand(command)) setCommand(undefined); }, [command, document.data, version.data]);

  const mutation = useMutation({ mutationFn: async () => {
    if (!command) return;
    if (!document.data || !canCommand(command)) throw new Error('Confira os dados e o acesso atuais antes de confirmar esta ação.');
    if (command !== 'archive' && !policyReady) throw new Error('Confira a política documental atual antes de confirmar esta ação.');
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
    const affectedUnits = [...new Set([unitId, document.data?.unitId, version.data?.metadataSnapshot?.unitId].map(value => value || undefined))];
    setCommand(undefined); setNotice(`${label}: operação confirmada.`);
    await Promise.all([
      ...['document', 'document-versions', 'document-version', 'document-history', 'documents', 'dashboard', 'notifications', 'audit-logs'].map((key) => client.invalidateQueries({ queryKey: [key] })),
      ...affectedUnits.map(affectedUnitId => invalidateConsultation(client, 'documents', { sessionKey, unitId: affectedUnitId })),
      ...affectedUnits.map(affectedUnitId => client.invalidateQueries({ queryKey: ['worker-documents', sessionKey, affectedUnitId] })),
    ]);
  } });

  function openCommand(next: Command, selectedEvidenceId = '') {
    setCommand(next); setComment(''); setDecision(next === 'verify' ? 'VERIFIED' : 'ACCEPT'); setSignerName(''); setSignedAt(''); setFile(undefined); setEvidenceId(selectedEvidenceId); setLocalError(''); mutation.reset();
  }
  async function submitCommand(event: FormEvent) {
    event.preventDefault(); setLocalError('');
    if (command !== 'archive' && !policyReady) { setLocalError('Confira a política documental atual antes de confirmar esta ação.'); return; }
    if ((command === 'archive' || command === 'review' || command === 'verify') && !comment.trim()) { setLocalError('Informe uma justificativa antes de confirmar.'); return; }
    if (command === 'signature') {
      const uploadError = validateUpload(file, versionType);
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

  const downloadMutation = useMutation({ mutationFn: async ({ purpose, signatureEvidenceId, context, signal }: { purpose: 'DOWNLOAD' | 'PREVIEW'; signatureEvidenceId?: string; context: string; signal: AbortSignal }) => {
    if (!document.data || !version.data || !can('documents.download') || context !== currentRead.current) throw new Error('Confira a versão atual antes de solicitar o arquivo.');
    const base = `/documents/${id}/versions/${selectedId}`;
    const path = signatureEvidenceId ? `${base}/signature-evidences/${signatureEvidenceId}/download-url` : `${base}/download-url`;
    const result = await api.post<DownloadUrlDto>(path, { purpose }, { signal });
    if (!isRecord(result) || !shortText(result.url, 16000) || !result.url || !shortText(result.fileName, 1000) || !result.fileName.trim()
      || !shortText(result.mimeType, 200) || !result.mimeType.trim() || !shortText(result.expiresAt, 100)) throw new Error('O serviço não confirmou um acesso válido ao arquivo. Tente novamente.');
    if (!isDownloadUrlAllowed(result.url)) throw new Error('O endereço do arquivo não pertence a uma origem de armazenamento autorizada.');
    if (!Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error('O link expirou. Solicite um novo acesso ao arquivo.');
    return { result, purpose, context };
  }, onSuccess: ({ result, purpose, context }) => { if (context !== currentRead.current) return; setDownload({ ...result, readContext: context }); setPreview(purpose === 'PREVIEW'); },
    onError: (error, variables) => { if (!variables.signal.aborted && variables.context === currentRead.current) setDownloadError(errorMessage(error)); } });
  useEffect(() => {
    if (!download) return;
    const timer = window.setTimeout(() => { setDownload(undefined); setDownloadError('O acesso temporário ao arquivo expirou. Solicite uma nova prévia ou download.'); }, Math.max(0, Date.parse(download.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [download]);
  function requestDownload(purpose: 'DOWNLOAD' | 'PREVIEW', signatureEvidenceId?: string) {
    downloadController.current?.abort(); downloadController.current = new AbortController();
    setDownloadError(''); downloadMutation.mutate({ purpose, signatureEvidenceId, context: readContext, signal: downloadController.current.signal });
  }
  function selectVersion(value: string) {
    focusVersion.current = value;
    setChosenVersionId(value); setDownload(undefined); setDownloadError('');
    if (value === selectedId && !version.isPending) {
      versionPanel.current?.focus({ preventScroll: true }); versionPanel.current?.scrollIntoView?.({ block: 'start' }); focusVersion.current = undefined;
    }
  }
  useEffect(() => {
    if (focusVersion.current !== selectedId || version.isPending) return;
    if (!version.isError && version.data?.id !== selectedId) return;
    versionPanel.current?.focus({ preventScroll: true }); versionPanel.current?.scrollIntoView?.({ block: 'start' }); focusVersion.current = undefined;
  }, [selectedId, version.isPending, version.isError, version.data?.id]);

  if (!can('documents.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode consultar documentos." />;
  if (!readIdentifier(id)) return <EmptyState title="Documento inválido" description="Abra o documento pela consulta da unidade." />;
  if (!readIdentifier(unitId)) return <EmptyState title="Selecione uma unidade" />;
  if (document.isPending) return <Spinner />;
  if (document.isError) return <div className="panel stack">{notice && <Feedback tone="success">{notice}</Feedback>}<Feedback tone="danger">{errorMessage(document.error)}</Feedback><div className="actions"><Button variant="secondary" onClick={() => document.refetch()}>Tentar novamente</Button><Link className="button button--secondary" to={backHref} state={backState}><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link></div></div>;
  const doc = document.data;
  if (!doc) return <Spinner />;
  const current = version.data;
  const currentIsClean = current?.file?.scanStatus === 'CLEAN';

  return <div className={`stack ${styles.detailWorkspace}`}>
    <PageHeader eyebrow={doc.code} title={doc.title} description="Metadados, vigência e histórico de um documento controlado." actions={<Link className="button button--secondary" to={backHref} state={backState}><ArrowLeft size={16} aria-hidden="true" />{backLabel}</Link>} />
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {types.isError ? <Feedback tone="danger">Não foi possível conferir a política documental. <Button variant="secondary" onClick={() => void types.refetch()}>Conferir política novamente</Button></Feedback> : types.isPending || types.isFetching ? <p role="status">Conferindo política documental…</p> : !types.verified && <Feedback tone="warning">O tipo documental desta referência não está disponível. Confira a política antes de confirmar ações da versão. <Button variant="secondary" onClick={() => void types.refetch()}>Conferir política novamente</Button></Feedback>}
    <section className="panel stack" aria-label="Metadados do documento">
      <div className={styles.metadataHeader}><div className={styles.documentIdentity}><h2 className={styles.sectionTitle}><FileText size={18} aria-hidden="true" />Dados do documento</h2><div className={styles.documentStatus}><DocumentStatus status={doc.status} /><span className="muted">{accessLabels[doc.accessClass]}</span></div></div><div className={`actions ${styles.documentActions}`}>
        {hasDocumentAction('documents.write', 'EDIT_METADATA') && <Link className="button button--secondary" to={`/app/documentos/${id}/editar`} state={documentOrigin}><Pencil size={16} aria-hidden="true" />Editar metadados</Link>}
        {hasDocumentAction('documents.write', 'CREATE_VERSION') && <Link className="button button--primary" to={`/app/documentos/${id}/versoes/nova`} state={documentOrigin}><Plus size={16} aria-hidden="true" />Nova versão</Link>}
        {hasDocumentAction('documents.archive', 'ARCHIVE') && <Button variant="danger" onClick={() => openCommand('archive')}><Archive size={16} aria-hidden="true" />Arquivar</Button>}
      </div></div>
      <dl className={styles.metadata}>
        <div><dt>Código</dt><dd>{doc.code}</dd></div>
        <div><dt>Tipo documental</dt><dd>{type?.name ?? 'Tipo cadastrado'}</dd></div><div><dt>Unidade</dt><dd>{doc.unitId ? organization.data?.units.find((item) => item.id === doc.unitId)?.name ?? 'Unidade autorizada' : 'Abrangência da empresa'}</dd></div>
        <div><dt>Setor</dt><dd>{doc.sectorId ? organization.data?.sectors.find((item) => item.id === doc.sectorId)?.name ?? 'Setor vinculado' : 'Sem setor específico'}</dd></div><div><dt>Proprietário</dt><dd>{doc.ownerId === me?.user.id ? me.user.displayName : 'Proprietário cadastrado'}</dd></div>
        <div><dt>Emissão</dt><dd>{formatDate(doc.issueDate)}</dd></div><div><dt>Vigência</dt><dd>{formatDate(doc.validFrom)} a {formatDate(doc.validUntil)}</dd></div>
        <div><dt>Trabalhadores vinculados</dt><dd>{doc.workerIds.length}</dd></div>{!doc.sourceReadOnly && <div><dt>Responsáveis</dt><dd>{doc.responsibleIds.length}</dd></div>}<div><dt>Palavras-chave</dt><dd>{doc.keywords.join(', ') || '—'}</dd></div>
      </dl>
      {doc.activeVersionIds.length > 1 && <Feedback tone="info">Este documento possui {doc.activeVersionIds.length} versões vigentes. Selecione a versão desejada para consultar seu arquivo.</Feedback>}
      {doc.currentVersionId && !doc.activeVersionIds.includes(doc.currentVersionId) && doc.activeVersionIds.length > 0 && <Feedback tone="info">A versão em trabalho ainda não substituiu a versão vigente.</Feedback>}
    </section>
    <section className="panel stack" aria-label="Versões do documento"><h2 className={styles.sectionTitle}><Layers3 size={18} aria-hidden="true" />Versões</h2>
      {versions.isPending ? <Spinner /> : versions.isError ? <Feedback tone="danger">{errorMessage(versions.error)} <Button variant="secondary" disabled={versions.isFetching} onClick={() => void versions.refetch()}>Tentar carregar versões novamente</Button></Feedback> : !versions.data?.items.length ? <><EmptyState title="Nenhum arquivo anexado" description="Crie a primeira versão para iniciar a revisão deste documento." />{hasDocumentAction('documents.write', 'CREATE_VERSION') && <div className="actions"><Link className="button button--primary" to={`/app/documentos/${id}/versoes/nova`} state={documentOrigin}><Plus size={16} aria-hidden="true" />Anexar primeiro arquivo</Link></div>}</> : <>
        <DocumentVersionList versions={versions.data.items} selectedId={selectedId} currentVersionId={doc.currentVersionId} activeVersionIds={doc.activeVersionIds} onSelect={selectVersion} />
        <nav className="toolbar" aria-label="Paginação de versões"><span className="muted">Página {versionPage} · {versions.data.total} versão(ões)</span><div className="actions"><Button variant="secondary" disabled={versionPage <= 1 || versions.isFetching} onClick={() => setVersionPage(versionPage - 1)}>Versões anteriores</Button><Button variant="secondary" disabled={versionPage * 10 >= versions.data.total || versions.isFetching} onClick={() => setVersionPage(versionPage + 1)}>Próximas versões</Button></div></nav>
      </>}
    </section>
    {selectedId && <section ref={versionPanel} tabIndex={-1} className={`panel stack ${styles.selectedVersion}`} aria-label="Versão selecionada" aria-busy={version.isFetching}>{version.isPending ? <Spinner /> : version.isError ? <Feedback tone="danger">{errorMessage(version.error)} <Button variant="secondary" disabled={version.isFetching} onClick={() => void version.refetch()}>Tentar carregar versão selecionada novamente</Button></Feedback> : current && <>
      <div className="toolbar"><h2 className={styles.sectionTitle}><FileCheck size={18} aria-hidden="true" />Versão {current.versionNumber}</h2><DocumentStatus status={current.status} /></div><p>{current.reason}</p>
      {current.file ? <div className="muted">{current.file.name} · {formatBytes(current.file.sizeBytes)} · <DocumentStatus status={current.file.scanStatus} /></div> : <p className="muted">Arquivo indisponível para consulta.</p>}
      {current.metadataSnapshot ? <dl className={styles.metadata}><div><dt>Emissão da versão</dt><dd>{formatDate(current.metadataSnapshot.issueDate)}</dd></div><div><dt>Validade da versão</dt><dd>{formatDate(current.metadataSnapshot.validFrom)} a {formatDate(current.metadataSnapshot.validUntil)}</dd></div></dl> : <p className="muted">Metadados históricos não registrados nesta versão.</p>}
      {current.file && !currentIsClean && <Feedback tone={['REJECTED', 'ERROR'].includes(current.file.scanStatus) ? 'danger' : 'warning'}>{current.file.scanStatus === 'REJECTED' ? 'O arquivo foi rejeitado na verificação.' : current.file.scanStatus === 'PENDING' ? 'O arquivo está em verificação. O acesso aguarda a liberação.' : 'Não há confirmação de liberação do arquivo.'}</Feedback>}
      <div className="actions">
        {hasVersionAction('documents.download', 'PREVIEW', false) && <Button variant="secondary" disabled={!currentIsClean || downloadMutation.isPending} onClick={() => requestDownload('PREVIEW')}><Eye size={16} aria-hidden="true" />Visualizar arquivo</Button>}
        {hasVersionAction('documents.download', 'DOWNLOAD', false) && <Button variant="secondary" disabled={!currentIsClean || downloadMutation.isPending} onClick={() => requestDownload('DOWNLOAD')}><Download size={16} aria-hidden="true" />Solicitar download</Button>}
        {hasVersionAction('documents.write', 'SUBMIT_REVIEW') && <Button disabled={!currentIsClean || !policyReady} onClick={() => openCommand('submit-review')}><Send size={16} aria-hidden="true" />Enviar para revisão</Button>}
        {hasVersionAction('documents.review', 'REVIEW') && <Button disabled={!currentIsClean || !policyReady} onClick={() => openCommand('review')}><ClipboardCheck size={16} aria-hidden="true" />Registrar revisão</Button>}
        {hasVersionAction('documents.approve', 'APPROVE') && <Button disabled={!currentIsClean || !policyReady} onClick={() => openCommand('approve')}><Check size={16} aria-hidden="true" />Aprovar versão</Button>}
        {hasVersionAction('documents.write', 'ADD_SIGNATURE_EVIDENCE') && <Button variant="secondary" disabled={!policyReady} onClick={() => openCommand('signature')}><Signature size={16} aria-hidden="true" />Registrar assinatura</Button>}
        {hasVersionAction('documents.publish', 'PUBLISH') && <Button disabled={!currentIsClean || !policyReady} onClick={() => openCommand('publish')}><FileCheck size={16} aria-hidden="true" />Publicar versão</Button>}
      </div>
      {current.review && <Feedback tone="info">Revisão: {current.review.decision === 'ACCEPT' ? 'aceita' : 'correções solicitadas'}. {current.review.comment}</Feedback>}
      {current.approval && <Feedback tone="success">Aprovação registrada{current.approval.approvedAt ? ` em ${formatDate(current.approval.approvedAt)}` : ''}. {current.approval.comment}</Feedback>}
      <h3>Evidências de assinatura</h3>{current.signatureEvidences.length === 0 ? <p className="muted">Nenhuma evidência registrada nesta versão.</p> : current.signatureEvidences.map((evidence) => <div className={styles.evidence} key={evidence.id}><div><strong>{evidence.signerName}</strong><p className="muted">{formatDate(evidence.signedAt)} · {evidence.file.name}</p><div className="actions"><DocumentStatus status={evidence.file.scanStatus} /><DocumentStatus status={evidence.verificationStatus} /></div></div><div className="actions">
        {can('documents.download') && <Button variant="secondary" disabled={evidence.file.scanStatus !== 'CLEAN' || downloadMutation.isPending} onClick={() => requestDownload('PREVIEW', evidence.id)}><Eye size={16} aria-hidden="true" />Consultar evidência</Button>}
        {hasVersionAction('documents.signatures.verify', 'VERIFY_SIGNATURE_EVIDENCE') && <Button disabled={evidence.file.scanStatus !== 'CLEAN' || !policyReady} onClick={() => openCommand('verify', evidence.id)}><ClipboardCheck size={16} aria-hidden="true" />Conferir evidência</Button>}
      </div></div>)}
      <small className="muted">Evidências registradas e conferidas pelo responsável. A interface não declara validação jurídica ou criptográfica da assinatura.</small>
    </>}</section>}
    {downloadError && <Feedback tone="danger">{downloadError}</Feedback>}
    <section className="panel stack" aria-label="Histórico do documento"><h2 className={styles.sectionTitle}><History size={18} aria-hidden="true" />Histórico</h2>{history.isPending ? <Spinner /> : history.isError ? <Feedback tone="danger">{errorMessage(history.error)} <Button variant="secondary" disabled={history.isFetching} onClick={() => void history.refetch()}>Tentar carregar histórico novamente</Button></Feedback> : !history.data?.items.length ? <p className="muted">Nenhum evento disponível para consulta.</p> : <>
      <ol className={styles.history}>{history.data.items.map((item) => <li key={item.id}><strong>{historyLabels[item.action] ?? item.action}</strong><span>{item.actor.displayName || 'Autor não identificado'} · {formatDate(item.occurredAt)}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol>
      <div className="toolbar"><span className="muted">Página {historyPage} · {history.data.total} evento(s)</span><div className="actions"><Button variant="secondary" disabled={historyPage <= 1} onClick={() => setHistoryPage(historyPage - 1)}>Histórico anterior</Button><Button variant="secondary" disabled={historyPage * 10 >= history.data.total} onClick={() => setHistoryPage(historyPage + 1)}>Próximos eventos</Button></div></div>
    </>}</section>
    <Modal open={Boolean(command && canCommand(command))} title={command ? commandLabels[command] : ''} onClose={() => { if (!mutation.isPending) setCommand(undefined); }}><form className="stack" onSubmit={submitCommand}>
      {command === 'archive' && <Feedback tone="warning">O documento será arquivado. Versões e histórico permanecem preservados.</Feedback>}
      {command === 'publish' && <Feedback tone="info">A publicação seguirá a política de vigência do documento. A alteração só será apresentada após a confirmação.</Feedback>}
      {command === 'review' && <Field label="Resultado da revisão"><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="ACCEPT">Revisão aceita</option><option value="REQUEST_CHANGES">Solicitar correções</option></select></Field>}
      {command === 'verify' && <><Feedback tone="info">Consulte o arquivo da evidência antes de registrar sua decisão.</Feedback><Field label="Resultado da conferência"><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="VERIFIED">Conferida pelo responsável</option><option value="REJECTED">Rejeitada</option></select></Field></>}
      {command === 'signature' && <><Field label="Nome do signatário *"><input value={signerName} maxLength={200} onChange={(event) => setSignerName(event.target.value)} /></Field><Field label="Data e hora da assinatura (Brasília) *"><input type="datetime-local" value={signedAt} onChange={(event) => setSignedAt(event.target.value)} /></Field><Field label="Arquivo da evidência *"><input type="file" accept={versionType?.allowedMimeTypes.join(',')} disabled={!policyReady} onChange={(event) => setFile(event.target.files?.[0])} />{versionType && <small className="muted">Limite: {formatBytes(versionType.maxFileSizeBytes)}.</small>}</Field></>}
      {command !== 'signature' && <Field label={command === 'archive' || command === 'review' || command === 'verify' ? 'Justificativa *' : 'Observação (opcional)'}><textarea value={comment} rows={4} maxLength={1000} onChange={(event) => setComment(event.target.value)} /></Field>}
      {localError && <Feedback tone="danger">{localError}</Feedback>}{mutation.isError && <Feedback tone="danger">{errorMessage(mutation.error)}</Feedback>}
      <div className="actions"><Button type="submit" variant={command === 'archive' ? 'danger' : 'primary'} disabled={mutation.isPending || command !== 'archive' && !policyReady}>{mutation.isPending ? 'Confirmando…' : 'Confirmar'}</Button><Button variant="secondary" type="button" disabled={mutation.isPending} onClick={() => setCommand(undefined)}>Cancelar</Button></div>
    </form></Modal>
    <Modal open={Boolean(download && download.readContext === currentRead.current && can('documents.download'))} title={preview ? 'Prévia autorizada' : 'Download autorizado'} onClose={() => setDownload(undefined)}>{download && <div className="stack"><p>{download.fileName}</p>{preview && download.mimeType === 'application/pdf' && <iframe className={styles.preview} title={`Prévia de ${download.fileName}`} src={download.url} sandbox="allow-same-origin" />}{preview && ['image/png', 'image/jpeg'].includes(download.mimeType) && <img className={styles.imagePreview} src={download.url} alt={`Prévia de ${download.fileName}`} />}{preview && !['application/pdf', 'image/png', 'image/jpeg'].includes(download.mimeType) && <p>Este formato pode ser consultado baixando o arquivo.</p>}<a className="button button--primary" href={download.url} target="_blank" rel="noopener noreferrer" download={download.fileName}>Abrir / baixar arquivo</a><small className="muted">Acesso temporário válido até {formatDate(download.expiresAt)}.</small></div>}</Modal>
  </div>;
}
