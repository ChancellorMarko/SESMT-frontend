import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { DocumentDto, DocumentWriteDto } from '../../shared/contracts';
import { EmptyState, Feedback, PageHeader, Spinner } from '../../shared/ui';
import { DocumentMetadataForm } from './DocumentMetadataForm';
import { errorMessage } from './validation';

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: async (values: DocumentWriteDto) => initial ? api.patch<DocumentDto>(`/documents/${initial.id}`, values, { etag: revisionEtag(initial.revision), idempotencyKey: crypto.randomUUID() }) : api.post<DocumentDto>('/documents', values, { idempotencyKey: crypto.randomUUID() }), onSuccess: async (saved) => { await queryClient.invalidateQueries({ queryKey: ['documents'] }); queryClient.setQueriesData({ queryKey: ['document'], predicate: query => query.queryKey.includes(saved.id) }, saved); navigate(`/app/documentos/${saved.id}`); } });
  return <div className="stack"><PageHeader eyebrow="METADADOS" title={initial ? 'Editar documento' : 'Novo documento'} description="Defina o contexto, os responsáveis e a política de acesso antes de anexar uma versão." actions={<Link to={initial ? `/app/documentos/${initial.id}` : '/app/documentos'}>Voltar</Link>} />{initial && current && initial.revision !== current.revision && <Feedback tone="warning">O documento foi atualizado durante o preenchimento. Suas alterações foram mantidas; confira a versão atual antes de salvar.</Feedback>}<DocumentMetadataForm initial={initial} pending={mutation.isPending} submitLabel={initial ? 'Salvar alterações' : 'Criar documento'} onSave={async (values) => { await mutation.mutateAsync(values); }} /></div>;
}
