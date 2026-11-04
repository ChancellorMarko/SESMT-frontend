import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';
import { consultationNavigation } from '../../shared/lib/consultation-navigation';
import type { DocumentDto, DocumentTypeDto, DocumentVersionDto, DocumentWriteDto } from '../../shared/contracts';
import { EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { DocumentMetadataForm } from './DocumentMetadataForm';
import { errorMessage, formatBytes, validateUpload } from './validation';
import { expirationNavigation } from './expiry-navigation';
import { notificationNavigation } from '../notifications/notification-navigation';
import { documentNavigation } from './document-navigation';
import { workerDocumentNavigation } from '../workers/worker-document-navigation';

export function VersionFormPage() {
  const { id } = useParams();
  const { sessionKey, unitId, can } = useSession();
  const document = useQuery({ queryKey: ['document', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<DocumentDto>(`/documents/${id}`, { signal }), enabled: Boolean(id) && can('documents.write') });
  if (!can('documents.write')) return <EmptyState title="Nova versão indisponível" description="Seu perfil não permite criar versões de documentos." />;
  if (document.isPending) return <Spinner />;
  if (document.isError && !document.data) return <Feedback tone="danger">{errorMessage(document.error)}</Feedback>;
  if (!document.data || !document.data.availableActions.includes('CREATE_VERSION') || (document.data.accessClass === 'MEDICAL' && !can('documents.medical.write'))) return <EmptyState title="Nova versão indisponível" description="Seu acesso ou o estado atual deste documento não permite criar uma versão." />;
  return <VersionEditor key={`${sessionKey}:${unitId}:${id}`} current={document.data} />;
}

function VersionEditor({ current }: { current: DocumentDto }) {
  const [initial] = useState(current);
  const { sessionKey, unitId, can } = useSession();
  const location = useLocation();
  const documentOrigin = (can('notifications.read') ? notificationNavigation(location.state, unitId) : undefined) ?? expirationNavigation(location.state, unitId) ?? consultationNavigation(location.state, unitId) ?? workerDocumentNavigation(location.state, sessionKey, unitId, can('workers.read'), can('eligibility.read')) ?? documentNavigation(location.state, unitId, can('dashboard.read'));
  const latestDocumentOrigin = useRef(documentOrigin);
  latestDocumentOrigin.current = documentOrigin;
  const id = initial.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File>();
  const [reason, setReason] = useState('');
  const [fileError, setFileError] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [type, setType] = useState<DocumentTypeDto>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({ mutationFn: async (metadata: DocumentWriteDto) => {
    const uploadError = validateUpload(file, type);
    setFileError(uploadError ?? '');
    if (!reason.trim()) setReasonError('Informe a justificativa desta versão.');
    else setReasonError('');
    if (uploadError || !reason.trim()) throw new Error('Confira o arquivo e a justificativa antes de continuar.');
    const body = new FormData(); body.append('file', file!); body.append('reason', reason.trim()); body.append('metadata', JSON.stringify(metadata));
    return api.post<DocumentVersionDto>(`/documents/${id}/versions`, body, { etag: revisionEtag(initial.revision), idempotencyKey: crypto.randomUUID() });
  }, onSuccess: async (_saved, metadata) => {
    if (!mounted.current) return;
    const refresh = Promise.all([
      ...[...new Set([unitId, initial.unitId, metadata.unitId])].map(affectedUnitId => queryClient.invalidateQueries({ queryKey: ['worker-documents', sessionKey, affectedUnitId] })),
      queryClient.invalidateQueries({ queryKey: ['documents', sessionKey, unitId] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', sessionKey, unitId] }),
      queryClient.invalidateQueries({ queryKey: ['documents', 'expirations', sessionKey, unitId] }),
      queryClient.invalidateQueries({ queryKey: ['document', sessionKey, unitId, id], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['document-versions', sessionKey, unitId, id] }),
      queryClient.invalidateQueries({ queryKey: ['document-history', sessionKey, unitId, id] }),
      invalidateConsultation(queryClient, 'documents', { sessionKey, unitId }),
    ]);
    navigate(`/app/documentos/${id}`, { state: latestDocumentOrigin.current });
    await refresh;
  } });
  return <div className="stack"><PageHeader eyebrow={initial.code} title="Anexar nova versão" description="O arquivo anterior permanece no histórico. A nova versão só ficará disponível depois da verificação." actions={<Link className="button button--secondary" to={`/app/documentos/${id}`} state={documentOrigin}>Voltar ao documento</Link>} />{initial.revision !== current.revision && <Feedback tone="warning">O documento foi atualizado durante o preenchimento. O arquivo e sua justificativa foram mantidos; confira a versão atual antes de enviar.</Feedback>}<DocumentMetadataForm navigationState={{ state: documentOrigin }} initial={initial} pending={mutation.isPending} additionalDirty={Boolean(file) || Boolean(reason)} submitLabel="Enviar nova versão" onTypeChange={setType} onSave={async (values) => { await mutation.mutateAsync(values); }}>
    <Field label="Arquivo da versão *" error={fileError}><input type="file" accept={type?.allowedMimeTypes.join(',')} onChange={(event) => { setFile(event.target.files?.[0]); setFileError(''); }} />{type && <small className="muted">Limite: {formatBytes(type.maxFileSizeBytes)}. Formatos: {type.allowedMimeTypes.map((mime) => mime.split('/').at(-1)).join(', ')}.</small>}</Field>
    <Field label="Justificativa da versão *" error={reasonError}><textarea value={reason} rows={3} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Descreva a alteração ou o motivo do primeiro envio." /></Field>
  </DocumentMetadataForm></div>;
}
