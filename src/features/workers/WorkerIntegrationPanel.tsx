import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DownloadUrlDto, IntegrationStatus, WorkerDto, WorkerIntegrationEvidenceDto, WorkerIntegrationOptionsDto, WorkerIntegrationWriteDto } from '../../shared/contracts';
import { Badge, Button, Feedback, Field, Modal, Spinner } from '../../shared/ui';
import { triggerDownload } from '../../shared/lib/downloads';
import { formatDate } from '../../shared/lib/format';
import { dateLabel, errorMessage, integrationStatusLabels, integrationStatusTone, todayCivil, validCivil } from './support';
import { UnsavedChanges } from './UnsavedChanges';
import styles from './WorkerIntegrationPanel.module.css';

const evidenceLabels = { PENDING: 'Aguardando conferência', APPROVED: 'Comprovante conferido', REJECTED: 'Comprovante rejeitado' };
const integrationDependentQueries = new Set([
  'eligibility', 'documentary-readiness', 'appointment', 'appointments', 'permit-dashboard',
  'work-permit', 'work-permits', 'consulta-permits', 'work-authorization', 'work-authorizations',
  'authorization-options', 'audit',
]);
type ProofMode = 'NONE' | 'UPLOAD' | 'DOCUMENT_VERSION' | 'EXISTING';
export function integrationFileError(file: File, policy?: WorkerIntegrationOptionsDto['policy']) {
  const limit = Math.min(policy?.maxFileSizeBytes || 10 * 1024 * 1024, 10 * 1024 * 1024);
  if (!file.size) return 'O arquivo está vazio.';
  if (file.size > limit) return `Use um arquivo de até ${Math.floor(limit / 1024 / 1024)} MB.`;
  const formats: Record<string, RegExp> = { 'application/pdf': /\.pdf$/i, 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i };
  if (!formats[file.type]?.test(file.name) || policy && !policy.allowedMimeTypes.includes(file.type)) return 'Use um arquivo PDF, PNG ou JPEG permitido pela política.';
  return undefined;
}
function headerValid(bytes: Uint8Array, type: string) {
  if (type === 'application/pdf') return [37, 80, 68, 70, 45].every((value, index) => bytes[index] === value);
  if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

export function WorkerIntegrationPanel({ worker }: { worker: WorkerDto }) {
  const { sessionKey, unitId, can } = useSession();
  if (!can('workers.read') || unitId && worker.unitId !== unitId) return null;
  return <IntegrationPanel key={`${sessionKey}:${unitId}:${worker.id}`} worker={worker} />;
}

function IntegrationPanel({ worker }: { worker: WorkerDto }) {
  const { sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const base = `/workers/${worker.id}/integration`;
  const workerKey = ['worker', sessionKey, unitId, worker.id];
  const options = useQuery({ queryKey: ['worker-integration-options', sessionKey, unitId, worker.id], queryFn: ({ signal }) => api.get<WorkerIntegrationOptionsDto>(`${base}/options`, { signal }), enabled: can('workers.read') });
  const evidences = useQuery({ queryKey: ['worker-integration-evidences', sessionKey, unitId, worker.id], queryFn: ({ signal }) => api.get<WorkerIntegrationEvidenceDto[]>(`${base}/evidences`, { signal }), retry: false, refetchInterval: query => query.state.status !== 'error' && query.state.data?.some(item => item.file.scanStatus === 'PENDING') ? 1000 : false });
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<IntegrationStatus>('PENDING');
  const [integratedAt, setIntegratedAt] = useState(todayCivil);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<ProofMode>('NONE');
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState('');
  const [checking, setChecking] = useState(false);
  const [documentVersion, setDocumentVersion] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [draftRevision, setDraftRevision] = useState(worker.revision);
  const [policyVersion, setPolicyVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [writeConflict, setWriteConflict] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [review, setReview] = useState<{ evidence: WorkerIntegrationEvidenceDto; decision: 'APPROVE' | 'REJECT' }>();
  const [comment, setComment] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const reader = useRef<FileReader | undefined>(undefined);
  const fileGeneration = useRef(0);
  const uploaded = useRef<WorkerIntegrationEvidenceDto | undefined>(undefined);
  const requestKey = useRef(crypto.randomUUID());
  const registrationKey = useRef<{ payload: string; key: string } | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { operation.current?.abort(); reader.current?.abort(); fileGeneration.current++; }, []);
  const evidenceList = (evidences.isError ? [] : evidences.data || []).filter(item => item.workerId === worker.id && item.unitId === worker.unitId && item.companyId === worker.companyId);
  const canReview = can('workers.read') && can('eligibility.review') && Boolean(options.data) && !options.isError;
  const selectedEvidence = mode === 'EXISTING' ? evidenceList.find(item => item.id === evidenceId) : uploaded.current;
  const policyChanged = Boolean(open && options.data && policyVersion !== options.data.policy.version);
  const conflict = writeConflict || open && draftRevision !== worker.revision || policyChanged;
  const currentReviewEvidence = review && evidenceList.find(item => item.id === review.evidence.id);
  const reviewConflict = Boolean(review && (!currentReviewEvidence || currentReviewEvidence.revision !== review.evidence.revision || currentReviewEvidence.status !== 'PENDING'));

  function clearProof(resetInput = true) {
    fileGeneration.current++; reader.current?.abort(); reader.current = undefined;
    setChecking(false); setFile(undefined); setFileError(''); setDocumentVersion(''); setEvidenceId(''); uploaded.current = undefined; requestKey.current = crypto.randomUUID();
    if (resetInput && inputRef.current) inputRef.current.value = '';
  }
  function start() {
    if (busy || !can('workers.write') || !options.data) return;
    clearProof(); registrationKey.current = undefined; setOpen(true); setStatus('PENDING'); setIntegratedAt(todayCivil()); setValidUntil(''); setNotes(''); setMode('NONE'); setDraftRevision(worker.revision); setPolicyVersion(options.data.policy.version); setFailure(''); setNotice(''); setWriteConflict(false);
  }
  async function chooseFile(candidate?: File) {
    clearProof(false);
    if (!candidate) return;
    const error = integrationFileError(candidate, options.data?.policy);
    if (error) { setFileError(error); return; }
    const generation = fileGeneration.current;
    const fileReader = new FileReader(); reader.current = fileReader; setChecking(true);
    try {
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        fileReader.onload = () => resolve(new Uint8Array(fileReader.result as ArrayBuffer));
        fileReader.onerror = () => reject(new Error('Não foi possível ler o arquivo. Selecione novamente.'));
        fileReader.onabort = () => reject(new DOMException('Leitura cancelada.', 'AbortError'));
        fileReader.readAsArrayBuffer(candidate.slice(0, 12));
      });
      if (generation !== fileGeneration.current) return;
      if (!headerValid(bytes, candidate.type)) { setFileError('O conteúdo do arquivo não corresponde ao formato informado.'); return; }
      setFile(candidate);
    } catch (error) { if (generation === fileGeneration.current) setFileError(errorMessage(error)); }
    finally { if (generation === fileGeneration.current) { setChecking(false); reader.current = undefined; } }
  }
  function updateWorker(updated: WorkerDto) {
    if (updated.id !== worker.id || updated.unitId !== worker.unitId || updated.companyId !== worker.companyId) throw new Error('O registro retornado pertence a outro contexto. Seu preenchimento foi preservado.');
    client.setQueryData(workerKey, updated);
  }
  function invalidateIntegrationDependents() {
    // Some worker selectors put their purpose before the session and unit in the key.
    // Keep those lists current without touching another authenticated context.
    void client.invalidateQueries({ predicate: ({ queryKey }) => {
      const [family, first, second, third] = queryKey;
      if (family === 'worker') return first === sessionKey && second === unitId && third === worker.id;
      if (family === 'workers') {
        if (first === 'document-form' || first === 'document-filter' || first === 'consulta-filter') return second === sessionKey && third === unitId;
        return first === sessionKey && second === unitId;
      }
      return typeof family === 'string' && integrationDependentQueries.has(family) && first === sessionKey && second === unitId;
    } });
  }
  async function refresh() {
    if (busy || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setFailure('');
    try {
      const current = await api.get<WorkerDto>(`/workers/${worker.id}`, { signal: controller.signal });
      const currentOptions = await api.get<WorkerIntegrationOptionsDto>(`${base}/options`, { signal: controller.signal });
      const currentEvidence = await api.get<WorkerIntegrationEvidenceDto[]>(`${base}/evidences`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      updateWorker(current); setAccessDenied(false); client.setQueryData(['worker-integration-evidences', sessionKey, unitId, worker.id], currentEvidence);
      if (currentOptions) client.setQueryData(['worker-integration-options', sessionKey, unitId, worker.id], currentOptions);
      setDraftRevision(current.revision); setPolicyVersion(currentOptions?.policy.version || policyVersion); setWriteConflict(false);
      setNotice('Dados atuais carregados. O preenchimento foi preservado; confira os dados antes de enviar novamente.');
    } catch (error) { if (!controller.signal.aborted) { setFailure(errorMessage(error)); if ([401, 403, 404].includes((error as { status?: number }).status || 0)) setAccessDenied(true); } }
    finally { if (!controller.signal.aborted) { setBusy(false); operation.current = undefined; } }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || checking || operation.current || conflict || !can('workers.write') || !options.data) return;
    setFailure(''); setNotice('');
    if (!validCivil(integratedAt) || integratedAt < worker.admissionDate || integratedAt > todayCivil() || validUntil && (!validCivil(validUntil) || validUntil < integratedAt)) { setFailure('Informe datas válidas; a realização deve estar entre a admissão e hoje e a validade não pode ser anterior.'); return; }
    if (status === 'INTEGRATED' && validUntil && validUntil < todayCivil()) { setFailure('A validade deve cobrir a data atual para registrar a integração concluída.'); return; }
    if (notes.length > 2000) { setFailure('Use até 2.000 caracteres nas observações.'); return; }
    if (status === 'NOT_APPLICABLE' && !options.data.policy.allowNotApplicable) { setFailure('A política desta unidade não permite registrar integração como não aplicável.'); return; }
    const proofDocument = options.data.documents.find(document => document.versions.some(version => version.id === documentVersion));
    if (mode === 'UPLOAD' && !file || mode === 'DOCUMENT_VERSION' && !proofDocument || mode === 'EXISTING' && !selectedEvidence) { setFailure('Selecione um comprovante disponível para este trabalhador.'); return; }
    if (status === 'INTEGRATED' && (options.data.policy.evidenceRequired || mode !== 'NONE') && (!selectedEvidence || selectedEvidence.status !== 'APPROVED' || selectedEvidence.file.scanStatus !== 'CLEAN')) { setFailure('Para registrar Integrado, selecione um comprovante conferido e liberado para consulta.'); return; }
    const controller = new AbortController(); operation.current = controller; setBusy(true);
    try {
      let proof = selectedEvidence;
      if (!proof && (mode === 'UPLOAD' || mode === 'DOCUMENT_VERSION')) {
        let body: FormData | { documentId: string; documentVersionId: string };
        if (mode === 'UPLOAD') { body = new FormData(); body.append('file', file!); }
        else body = { documentId: proofDocument!.documentId, documentVersionId: documentVersion };
        proof = await api.post<WorkerIntegrationEvidenceDto>(`${base}/evidences`, body, { signal: controller.signal, etag: revisionEtag(draftRevision), idempotencyKey: requestKey.current });
        if (controller.signal.aborted) return;
        if (proof.workerId !== worker.id || proof.unitId !== worker.unitId || proof.companyId !== worker.companyId) throw new Error('O comprovante retornado pertence a outro contexto.');
        uploaded.current = proof;
        void evidences.refetch();
      }
      const body: WorkerIntegrationWriteDto = { status, integratedAt, validUntil: validUntil || undefined, notes: notes.trim() || undefined, evidenceId: proof?.id, policyVersion };
      const serialized = JSON.stringify(body);
      if (registrationKey.current?.payload !== serialized) registrationKey.current = { payload: serialized, key: crypto.randomUUID() };
      const updated = await api.post<WorkerDto>(base, body, { signal: controller.signal, etag: revisionEtag(draftRevision), idempotencyKey: registrationKey.current.key });
      if (controller.signal.aborted) return;
      updateWorker(updated); setOpen(false); clearProof(); setNotice('Integração administrativa registrada. A execução continua dependendo das verificações e da liberação explícita na PT.');
      invalidateIntegrationDependents();
    } catch (error) { if (!controller.signal.aborted) { setFailure(errorMessage(error)); if ([409, 412, 428].includes((error as { status?: number }).status || 0)) setWriteConflict(true); } }
    finally { if (!controller.signal.aborted) { setBusy(false); operation.current = undefined; } }
  }
  async function reviewProof() {
    if (!review || busy || operation.current || reviewConflict || !canReview) return;
    const minimum = review.decision === 'REJECT' ? 5 : 3;
    if (!confirmed || comment.trim().length < minimum || comment.length > 2000) { setFailure(`Informe a justificativa e confirme explicitamente a conferência. Use de ${minimum} a 2.000 caracteres.`); return; }
    const controller = new AbortController(); operation.current = controller; setBusy(true); setFailure('');
    try {
      const updated = await api.post<WorkerIntegrationEvidenceDto>(`${base}/evidences/${review.evidence.id}/review`, { decision: review.decision, comment: comment.trim(), confirmed: true }, { signal: controller.signal, etag: revisionEtag(review.evidence.revision) });
      if (controller.signal.aborted) return;
      if (updated.id !== review.evidence.id || updated.workerId !== worker.id || updated.unitId !== worker.unitId || updated.companyId !== worker.companyId) throw new Error('O comprovante retornado pertence a outro contexto.');
      client.setQueryData(['worker-integration-evidences', sessionKey, unitId, worker.id], (previous?: WorkerIntegrationEvidenceDto[]) => previous?.map(item => item.id === updated.id ? updated : item));
      setReview(undefined); setNotice('Conferência registrada. A aprovação do comprovante não muda a situação de integração nem libera a execução. Registre a integração quando aplicável.');
      invalidateIntegrationDependents();
    } catch (error) { if (!controller.signal.aborted) setFailure(errorMessage(error)); }
    finally { if (!controller.signal.aborted) { setBusy(false); operation.current = undefined; } }
  }
  async function download(evidence: WorkerIntegrationEvidenceDto) {
    if (busy || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setFailure('');
    try {
      const dto = await api.post<DownloadUrlDto>(`${base}/evidences/${evidence.id}/download`, {}, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!(Date.parse(dto.expiresAt) > Date.now())) throw new Error('O link do arquivo expirou. Solicite um novo download.');
      triggerDownload(dto.url, dto.fileName);
    } catch (error) { if (!controller.signal.aborted) setFailure(errorMessage(error)); }
    finally { if (!controller.signal.aborted) { setBusy(false); operation.current = undefined; } }
  }
  if (accessDenied) return <section className="panel stack"><UnsavedChanges dirty={open || Boolean(review)} busy={busy || checking} protectContext /><h2>Integração administrativa</h2><Feedback tone="danger">{failure || 'Integração indisponível no seu acesso atual.'}</Feedback><Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Atualizar integração</Button></section>;
  return <section className="panel stack" aria-labelledby="worker-integration-heading">
    <UnsavedChanges dirty={open || Boolean(review)} busy={busy || checking} protectContext />
    <div className="toolbar"><div><h2 id="worker-integration-heading">Integração administrativa</h2><p className="muted">Registro administrativo, comprovantes vinculados e conferência.</p></div><div className="actions"><Badge tone={integrationStatusTone[worker.integrationStatus || 'PENDING']}>{integrationStatusLabels[worker.integrationStatus || 'PENDING']}</Badge>{can('workers.write') && !open && <Button variant="secondary" disabled={busy || !options.data} onClick={start}>Registrar nova integração</Button>}<Button variant="ghost" disabled={busy || checking} onClick={() => void refresh()}>Atualizar integração</Button></div></div>
    <Feedback>A prova enviada fica pendente de conferência. Conferir o comprovante e registrar a integração são ações separadas. Nenhuma delas libera automaticamente o trabalhador ou cria uma PT.</Feedback>
    {notice && <Feedback tone="success">{notice}</Feedback>}{failure && !review && <Feedback tone="danger">{failure}</Feedback>}
    <dl className={styles.metadata}><div><dt className="muted">Situação atual</dt><dd><strong>{integrationStatusLabels[worker.integrationStatus || 'PENDING']}</strong></dd></div><div><dt className="muted">Data realizada</dt><dd>{worker.integratedAt ? dateLabel(worker.integratedAt) : 'Não realizada'}</dd></div><div><dt className="muted">Validade</dt><dd>{worker.integrationValidUntil ? dateLabel(worker.integrationValidUntil) : 'Sem expiração definida'}</dd></div><div><dt className="muted">Responsável</dt><dd>{worker.integrationResponsibleName || 'Não registrado'}</dd></div><div><dt className="muted">Evidência registrada</dt><dd>{worker.integrationEvidence?.file.name || worker.integrationEvidenceFileName || 'Nenhum comprovante vinculado'}{!worker.integrationEvidence && worker.integrationEvidenceFileName && <p className={`muted ${styles.readWarning}`}>Referência antiga sem arquivo vinculado</p>}</dd></div></dl>
    {options.isError && <Feedback tone="warning">Não foi possível consultar as regras e os documentos permitidos. <Button variant="secondary" onClick={() => void options.refetch()}>Tentar novamente</Button></Feedback>}
    {open && options.data && <form className="stack" onSubmit={event => void save(event)} noValidate>
      <h3>Registrar nova integração</h3><p className="muted">{options.data.policy.description}</p>
      {conflict && <Feedback tone="warning">O cadastro ou a política mudou. O preenchimento foi preservado. Atualize a integração e confira os dados antes de enviar.</Feedback>}
      <fieldset className={`stack ${styles.formFields}`} disabled={busy || checking}>
        <legend>Dados da integração</legend><div className="form-grid"><Field label="Situação da integração *"><select value={status} onChange={event => setStatus(event.target.value as IntegrationStatus)}><option value="PENDING">Pendente</option><option value="INTEGRATED">{options.data.policy.evidenceRequired ? 'Integrado (exige comprovante conferido)' : 'Integrado'}</option>{options.data.policy.allowNotApplicable && <option value="NOT_APPLICABLE">Não aplicável</option>}</select></Field><Field label="Data de realização *"><input type="date" min={worker.admissionDate} max={todayCivil()} value={integratedAt} onChange={event => setIntegratedAt(event.target.value)} /></Field><Field label="Validade da integração"><input type="date" min={integratedAt || undefined} value={validUntil} onChange={event => setValidUntil(event.target.value)} /></Field></div>
        <Field label="Origem do comprovante"><select value={mode} onChange={event => { clearProof(); setMode(event.target.value as ProofMode); }}><option value="NONE">{options.data.policy.evidenceRequired ? 'Sem comprovante (registro pendente)' : 'Sem comprovante (permitido pela política)'}</option><option value="UPLOAD">Enviar arquivo</option><option value="DOCUMENT_VERSION">Vincular versão documental deste trabalhador</option><option value="EXISTING">Usar comprovante já vinculado</option></select></Field>
        {mode === 'UPLOAD' && <Field label="Arquivo do comprovante *" error={fileError}><input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={event => void chooseFile(event.target.files?.[0])} /><small className="muted">PDF, PNG ou JPEG, até 10 MB. A API verifica o arquivo antes da consulta.</small>{file && <p className={styles.fileName}>Selecionado: {file.name}</p>}</Field>}
        {mode === 'DOCUMENT_VERSION' && <Field label="Versão documental do trabalhador *"><select value={documentVersion} onChange={event => { uploaded.current = undefined; requestKey.current = crypto.randomUUID(); setDocumentVersion(event.target.value); }}><option value="">Selecione a versão</option>{options.data.documents.flatMap(document => document.versions.map(version => <option key={version.id} value={version.id}>{document.code} · {document.title} · versão {version.versionNumber} · {version.file.name}</option>))}</select></Field>}
        {mode === 'EXISTING' && <Field label="Comprovante já vinculado *"><select value={evidenceId} onChange={event => setEvidenceId(event.target.value)}><option value="">Selecione o comprovante</option>{evidenceList.map(item => <option key={item.id} value={item.id}>{item.file.name} · {evidenceLabels[item.status]}</option>)}</select></Field>}
        <Field label="Observações operacionais"><textarea rows={3} value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} /></Field><p className="muted">A autoria do registro é obtida da sua conta. Datas e regras seguem a política administrativa da unidade.</p>
      </fieldset>{checking && <Spinner />}
      <div className="actions"><Button type="submit" disabled={busy || checking || conflict || !can('workers.write')}>{busy ? 'Registrando…' : 'Salvar integração'}</Button><Button variant="secondary" disabled={busy} onClick={() => { clearProof(); setOpen(false); setFailure(''); }}>Cancelar</Button></div>
    </form>}
    <div className="stack"><h3>Comprovantes vinculados</h3>{evidences.isPending ? <Spinner /> : evidences.isError ? <Feedback tone="warning">Não foi possível consultar os comprovantes. Atualize a integração para tentar novamente.</Feedback> : !evidenceList.length ? <p className="muted">Nenhum arquivo de integração vinculado.</p> : <ul className={styles.history}>{evidenceList.map(item => <li className={`stack ${styles.record}`} key={item.id}><div className="toolbar"><strong className={styles.fileName}>{item.file.name}</strong><Badge tone={item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' ? 'danger' : 'warning'}>{evidenceLabels[item.status]}</Badge></div><p className="muted">{item.source === 'UPLOAD' ? 'Arquivo enviado' : 'Versão documental vinculada'} · {formatDate(item.submittedAt)} · {item.submittedByName}</p>{item.file.scanStatus !== 'CLEAN' && <p className="muted">{item.file.scanStatus === 'REJECTED' ? 'Arquivo bloqueado na verificação.' : 'Arquivo aguardando verificação para consulta.'}</p>}{item.reviewComment && <p>{item.reviewComment}</p>}{item.reviewedByName && <p className="muted">Conferência: {item.reviewedByName} · {formatDate(item.reviewedAt)}</p>}<div className="actions"><Button variant="secondary" disabled={busy || item.file.scanStatus !== 'CLEAN'} onClick={() => void download(item)}>Consultar arquivo {item.file.name}</Button>{canReview && item.status === 'PENDING' && !open && <><Button disabled={busy || item.file.scanStatus !== 'CLEAN'} onClick={() => { setReview({ evidence: item, decision: 'APPROVE' }); setComment(''); setConfirmed(false); setFailure(''); }}>Conferir comprovante {item.file.name}</Button><Button variant="danger" disabled={busy} onClick={() => { setReview({ evidence: item, decision: 'REJECT' }); setComment(''); setConfirmed(false); setFailure(''); }}>Rejeitar comprovante {item.file.name}</Button></>}</div></li>)}</ul>}</div>
    {worker.integrationHistory?.length ? <div className="stack"><h3>Histórico de integrações</h3><ul className={styles.history}>{worker.integrationHistory.map(entry => <li className={`stack ${styles.record}`} key={entry.id}><div className="toolbar"><strong>{dateLabel(entry.integratedAt)}</strong><Badge tone={integrationStatusTone[entry.status]}>{integrationStatusLabels[entry.status]}</Badge></div><p>Validade: {entry.validUntil ? dateLabel(entry.validUntil) : 'Sem expiração definida'} · Responsável: {entry.responsibleName}</p><p>{entry.evidence?.file.name || entry.evidenceFileName || 'Sem comprovante vinculado'}</p>{!entry.evidence && entry.evidenceFileName && <p className="muted">Referência antiga sem arquivo vinculado</p>}{entry.notes && <p>{entry.notes}</p>}</li>)}</ul></div> : null}
    <Modal open={Boolean(review)} title={review?.decision === 'APPROVE' ? 'Conferir comprovante de integração' : 'Rejeitar comprovante de integração'} onClose={() => { if (!busy) { setReview(undefined); setFailure(''); } }}>
      {review && <form className="stack" onSubmit={event => { event.preventDefault(); void reviewProof(); }}><p><strong>{review.evidence.file.name}</strong> · {worker.fullName}</p><Feedback>A decisão se aplica somente a este comprovante. O histórico anterior permanece registrado e a integração não será concluída automaticamente.</Feedback>{failure && <Feedback tone="danger">{failure}</Feedback>}{reviewConflict && <Feedback tone="warning">O comprovante mudou. Feche a janela, atualize a integração e confira a situação atual antes de decidir.</Feedback>}<Field label="Justificativa da conferência *"><textarea maxLength={2000} rows={3} disabled={busy} value={comment} onChange={event => setComment(event.target.value)} /></Field><label><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Confirmo explicitamente a decisão para este comprovante.</label><div className="actions"><Button type="submit" variant={review.decision === 'REJECT' ? 'danger' : 'primary'} disabled={busy || reviewConflict || !canReview}>{busy ? 'Registrando…' : 'Registrar conferência'}</Button><Button variant="secondary" disabled={busy} onClick={() => { setReview(undefined); setFailure(''); }}>Voltar</Button></div></form>}
    </Modal>
  </section>;
}
