import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';
import { consultationNavigation } from '../../shared/lib/consultation-navigation';
import type { DocumentDto, DocumentWriteDto } from '../../shared/contracts';
import { EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { DocumentMetadataForm } from './DocumentMetadataForm';
import { errorMessage } from './validation';
import { expirationNavigation } from './expiry-navigation';
import { notificationNavigation } from '../notifications/notification-navigation';
import { documentNavigation } from './document-navigation';
import { workerDocumentNavigation } from '../workers/worker-document-navigation';

export function DocumentFormPage() {
  const { id } = useParams();
  const { sessionKey, unitId, can } = useSession();
  const document = useQuery({ queryKey: ['document', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<DocumentDto>(`/documents/${id}`, { signal }), enabled: Boolean(id) && can('documents.write') });
  if (!can('documents.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não permite cadastrar ou editar documentos." />;
  if (id && document.isPending) return <Spinner />;
  if (document.isError && !document.data) return <Feedback tone="danger">{errorMessage(document.error)}</Feedback>;
  if (id && document.data && (!document.data.availableActions.includes('EDIT_METADATA') || (document.data.accessClass === 'MEDICAL' && !can('documents.medical.write')))) return <EmptyState title="Metadados protegidos" description="Este documento não permite edição de metadados. Quando autorizado, crie uma nova versão no detalhe." />;
  return <DocumentEditor key={`${sessionKey}:${unitId}:${id || 'new'}`} current={document.data} />;
}

function DocumentEditor({ current }: { current?: DocumentDto }) {
  // Keep the edited values and their revision together until the editor is reopened.
  const [initial] = useState(current);
  const { sessionKey, unitId, can } = useSession();
  const location = useLocation();
  const documentOrigin = (can('notifications.read') ? notificationNavigation(location.state, unitId) : undefined) ?? expirationNavigation(location.state, unitId) ?? consultationNavigation(location.state, unitId) ?? workerDocumentNavigation(location.state, sessionKey, unitId, can('workers.read'), can('eligibility.read')) ?? documentNavigation(location.state, unitId, can('dashboard.read'));
  const latestDocumentOrigin = useRef(documentOrigin);
  latestDocumentOrigin.current = documentOrigin;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const mutation = useMutation({ mutationFn: async (values: DocumentWriteDto) => initial ? api.patch<DocumentDto>(`/documents/${initial.id}`, values, { etag: revisionEtag(initial.revision), idempotencyKey: crypto.randomUUID() }) : api.post<DocumentDto>('/documents', values, { idempotencyKey: crypto.randomUUID() }), onSuccess: async (saved) => {
    if (!mounted.current) return;
    queryClient.setQueryData(['document', sessionKey, unitId, saved.id], saved);
    const affectedUnits = [...new Set([unitId, initial?.unitId, saved.unitId])];
    const refresh = Promise.all([
      ...affectedUnits.flatMap(affectedUnitId => [
        queryClient.invalidateQueries({ queryKey: ['documents', sessionKey, affectedUnitId] }),
        queryClient.invalidateQueries({ queryKey: ['worker-documents', sessionKey, affectedUnitId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', sessionKey, affectedUnitId] }),
        queryClient.invalidateQueries({ queryKey: ['documents', 'expirations', sessionKey, affectedUnitId] }),
        queryClient.invalidateQueries({ queryKey: ['document-history', sessionKey, affectedUnitId, saved.id] }),
        invalidateConsultation(queryClient, 'documents', { sessionKey, unitId: affectedUnitId }),
      ]),
    ]);
    navigate(`/app/documentos/${saved.id}`, { state: latestDocumentOrigin.current });
    await refresh;
  } });
  return <div className="stack"><PageHeader eyebrow="METADADOS" title={initial ? 'Editar documento' : 'Novo documento'} description="Defina o contexto, os responsáveis e a política de acesso antes de anexar uma versão." actions={<Link className="button button--secondary" to={initial ? `/app/documentos/${initial.id}` : '/app/documentos'} state={documentOrigin}>Voltar</Link>} />{initial && current && initial.revision !== current.revision && <Feedback tone="warning">O documento foi atualizado durante o preenchimento. Suas alterações foram mantidas; confira a versão atual antes de salvar.</Feedback>}<DocumentMetadataForm navigationState={{ state: documentOrigin }} initial={initial} pending={mutation.isPending} submitLabel={initial ? 'Salvar alterações' : 'Criar documento'} onSave={async (values) => { await mutation.mutateAsync(values); }} /></div>;
}
