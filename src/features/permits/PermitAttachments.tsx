import { useNavigationGuard } from '../../app/navigation/NavigationProtection';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import {
  PERMIT_ATTACHMENT_CAPTION_MAX, PERMIT_ATTACHMENT_MAX_BYTES, PERMIT_ATTACHMENT_MAX_PER_PERMIT,
  PERMIT_ATTACHMENT_MAX_PER_VERSION, PERMIT_ATTACHMENT_MIME_TYPES,
  type PermitAttachmentCreatedDto, type PermitAttachmentDownloadDto, type PermitAttachmentDto,
} from '../../shared/contracts/permit-attachments';
import type { WorkPermitDto } from '../../shared/contracts/work-permits';
import { isDownloadUrlAllowed } from '../../shared/lib/downloads';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Spinner } from '../../shared/ui';
import { errorMessage } from './validation';
import styles from './PermitAttachments.module.css';

type DraftBase = { revision: number; version: number };
export function PermitAttachments({ permit, disabled = false, onBusyChange, sectionId }: {
  permit: WorkPermitDto; disabled?: boolean; onBusyChange?: (busy: boolean) => void; sectionId?: string;
}) {
  const { me, sessionKey, unitId, can } = useSession();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [caption, setCaption] = useState('');
  const [base, setBase] = useState<DraftBase>();
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [download, setDownload] = useState<PermitAttachmentDownloadDto & { attachmentId: string }>();
  const readable = can('permits.read') && permit.appointment.unitId === unitId;
  const writable = readable && can('permits.operate') && permit.appointment.responsibleId === me?.user.id
    && permit.operationStatus === 'EXECUTING' && permit.reviewStatus === 'NOT_SUBMITTED';
  const queryKey = ['permit-attachments', sessionKey, unitId, permit.id];
  const permitKey = ['work-permit', sessionKey, unitId, permit.id];
  const list = useQuery({ queryKey, queryFn: ({ signal }) => api.get<PermitAttachmentDto[]>(`/work-permits/${permit.id}/attachments`, { signal }), enabled: readable });
  const currentCount = list.data?.filter(value => value.version === permit.version).length || 0;
  const limitReached = currentCount >= PERMIT_ATTACHMENT_MAX_PER_VERSION || (list.data?.length || 0) >= PERMIT_ATTACHMENT_MAX_PER_PERMIT;
  const dirty = Boolean(file || caption);
  const stale = Boolean(base && (base.revision !== permit.revision || base.version !== permit.version));

  const upload = useMutation({ mutationFn: async () => {
    if (!writable || disabled) throw new Error('Aguarde e salve as alterações da PT antes de anexar.');
    if (!base || stale) throw new Error('A PT mudou. Atualize e confira a versão atual; seu arquivo e descrição serão preservados.');
    if (!file || file.size <= 0 || file.size > PERMIT_ATTACHMENT_MAX_BYTES) throw new Error('Selecione um arquivo não vazio de até 5 MB.');
    if (!PERMIT_ATTACHMENT_MIME_TYPES.some(value => value === file.type)) throw new Error('Envie um arquivo JPG, PNG ou PDF.');
    if (caption.trim().length < 3 || caption.length > PERMIT_ATTACHMENT_CAPTION_MAX) throw new Error('Descreva o anexo com 3 a 1.000 caracteres.');
    const data = new FormData(); data.set('file', file); data.set('caption', caption.trim()); data.set('version', String(base.version));
    return api.post<PermitAttachmentCreatedDto>(`/work-permits/${permit.id}/attachments`, data, { etag: revisionEtag(base.revision) });
  }, onSuccess: async () => {
    setFile(undefined); setCaption(''); setBase(undefined); setLocalError('');
    if (input.current) input.current.value = '';
    setNotice('Anexo registrado nesta versão da PT.');
    await Promise.all(['permit-attachments', 'work-permit', 'work-permits', 'permit-dashboard', 'pt-dashboard'].map(key => client.invalidateQueries({ queryKey: [key] })));
  } });
  const prepareDownload = useMutation({ mutationFn: async (attachment: PermitAttachmentDto) => {
    const result = await api.get<PermitAttachmentDownloadDto>(`/work-permits/${permit.id}/attachments/${attachment.id}/download`);
    if (!isDownloadUrlAllowed(result.url) || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error('O endereço de download retornado é inválido ou expirou.');
    return { ...result, attachmentId: attachment.id };
  }, onSuccess: result => setDownload(result) });
  const busy = upload.isPending || refreshing;
  useNavigationGuard({ dirty, busy });
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    setFile(undefined); setCaption(''); setBase(undefined); setLocalError(''); setNotice(''); setDownload(undefined);
    if (input.current) input.current.value = '';
    upload.reset(); prepareDownload.reset();
  }, [permit.id, sessionKey, unitId]);
  useEffect(() => {
    if (!download) return;
    const timer = setTimeout(() => setDownload(undefined), Math.max(0, Date.parse(download.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [download]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const allowLeave = () => {
      if (busy) { setLocalError('Aguarde a confirmação do envio antes de sair ou mudar a unidade.'); return false; }
      return window.confirm('Há um anexo ainda não enviado. Deseja sair e descartar o arquivo e a descrição?');
    };
    const beforeContextChange = (event: Event) => { if (!event.defaultPrevented && !allowLeave()) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!allowLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('sesmt:before-context-change', beforeContextChange);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('sesmt:before-context-change', beforeContextChange); document.removeEventListener('click', navigate, true); };
  }, [dirty, busy]);
  function startDraft() { if (!base) setBase({ revision: permit.revision, version: permit.version }); setNotice(''); setLocalError(''); upload.reset(); }
  async function refreshCurrent() {
    setRefreshing(true); setLocalError('');
    try {
      const latest = await client.fetchQuery({ queryKey: permitKey, queryFn: ({ signal }) => api.get<WorkPermitDto>(`/work-permits/${permit.id}`, { signal }), staleTime: 0 });
      setBase({ revision: latest.revision, version: latest.version }); upload.reset();
      await list.refetch(); setNotice('PT atualizada. Confira os dados atuais antes de reenviar; arquivo e descrição foram preservados.');
    } catch (error) { setLocalError(errorMessage(error)); }
    finally { setRefreshing(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); setLocalError(''); try { await upload.mutateAsync(); } catch { /* Preserve the selected file and caption. */ } }
  if (!readable) return null;
  const conflict = stale || upload.error instanceof ApiError && upload.error.status === 412;

  return <section id={sectionId} className="panel stack" aria-label="Anexos de acompanhamento da PT" aria-busy={busy}>
    <div className={styles.heading}><div><p className="eyebrow">Acompanhamento em campo</p><h2><Paperclip size={20} aria-hidden="true" /> Anexos da PT</h2><p className="muted">Fotos e arquivos preservados com a versão, a descrição e quem registrou.</p></div><Badge>{currentCount}/{PERMIT_ATTACHMENT_MAX_PER_VERSION} nesta versão</Badge></div>
    <p className="muted">Estes anexos registram o acompanhamento da atividade. A documentação e a elegibilidade dos participantes são conferidas na seção própria.</p>
    {notice && <Feedback tone="success">{notice}</Feedback>}
    {list.isPending ? <Spinner /> : list.isError ? <Feedback tone="danger">{errorMessage(list.error)} <Button variant="ghost" onClick={() => void list.refetch()}>Tentar novamente</Button></Feedback>
      : !list.data?.length ? <EmptyState title="Nenhum anexo registrado" description="O responsável pode registrar fotos e arquivos durante a execução." />
        : <ul className={styles.list}>{[...list.data].sort((a, b) => b.version - a.version || b.uploadedAt.localeCompare(a.uploadedAt)).map(attachment => <li className={styles.attachment} key={attachment.id}>
          <div className={styles.heading}><strong className={styles.fileName}>{attachment.fileName}</strong><Badge>Versão {attachment.version}</Badge></div>
          <p className={styles.caption}>{attachment.caption}</p><small className="muted">{attachment.uploadedByName} · {formatDate(attachment.uploadedAt)} · {(attachment.sizeBytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB</small>
          <div className="actions"><Button variant="secondary" disabled={prepareDownload.isPending} onClick={() => { setDownload(undefined); prepareDownload.mutate(attachment); }}>{prepareDownload.isPending && prepareDownload.variables?.id === attachment.id ? 'Preparando…' : `Preparar download de ${attachment.fileName}`}</Button>
            {download?.attachmentId === attachment.id && <a className="button button--secondary" href={download.url} download={download.fileName} target="_blank" rel="noopener noreferrer">Baixar arquivo</a>}</div>
        </li>)}</ul>}
    {prepareDownload.isError && <Feedback tone="danger">{errorMessage(prepareDownload.error)}</Feedback>}
    {download && <small className="muted">Download válido até {formatDate(download.expiresAt)}.</small>}
    {writable ? <form className={`stack ${styles.form}`} noValidate onSubmit={event => void submit(event)}>
      <h3>Registrar anexo na versão {permit.version}</h3>
      {disabled && <Feedback>Salve as alterações da PT e aguarde a confirmação antes de registrar um anexo.</Feedback>}
      {limitReached && <Feedback tone="warning">Limite de anexos atingido: até 10 por versão e 20 por PT.</Feedback>}
      <Field label="Arquivo de acompanhamento *"><input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" disabled={busy || disabled || limitReached} onChange={event => { startDraft(); setFile(event.target.files?.[0]); }} /></Field>
      {file && <p className="muted">Arquivo selecionado: {file.name}</p>}
      <small className="muted">JPG, PNG ou PDF não vazio, até 5 MB por arquivo.</small>
      <Field label="Descrição do anexo *"><textarea value={caption} maxLength={PERMIT_ATTACHMENT_CAPTION_MAX} rows={3} disabled={busy || disabled || limitReached} onChange={event => { startDraft(); setCaption(event.target.value); }} placeholder="Descreva o local e o que foi registrado." /></Field>
      {(localError || upload.isError) && <Feedback tone="danger">{localError || errorMessage(upload.error)}</Feedback>}
      {conflict && <Feedback tone="warning">A revisão da PT mudou. Atualize e confira os dados atuais antes de reenviar o anexo.<div className="actions"><Button variant="secondary" disabled={busy} onClick={() => void refreshCurrent()}>Atualizar PT e preservar anexo</Button></div></Feedback>}
      <div className="actions"><Button type="submit" disabled={busy || disabled || limitReached || list.isPending || list.isError || conflict}>{busy ? 'Registrando…' : 'Registrar anexo'}</Button>{dirty && <Button variant="secondary" disabled={busy} onClick={() => { setFile(undefined); setCaption(''); setBase(undefined); setLocalError(''); upload.reset(); if (input.current) input.current.value = ''; }}>Limpar anexo não enviado</Button>}</div>
    </form> : <><p className="muted">Anexos disponíveis para consulta. Novos registros são permitidos ao responsável operacional durante a execução.</p>{dirty && <div className="stack"><Feedback>{permit.operationStatus === 'SUSPENDED' ? 'Anexo local ainda não enviado, preservado enquanto a operação está suspensa. Confira a PT atual antes de registrar após a retomada.' : 'Anexo local ainda não enviado. Esta PT não aceita novos registros no estado atual; você pode consultar ou limpar o arquivo e a descrição.'}</Feedback>{file && <p className={styles.fileName}>Arquivo selecionado: {file.name}</p>}{caption && <p className={styles.caption}>{caption}</p>}<Button variant="secondary" disabled={busy} onClick={() => { setFile(undefined); setCaption(''); setBase(undefined); setLocalError(''); upload.reset(); }}>Limpar anexo não enviado</Button></div>}</>}
  </section>;
}
