import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError, revisionEtag } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AccessClass, DocumentTypeDto, PageDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { documentTypePayload, documentTypeSchema, knownDocumentFields, type DocumentTypeForm } from './schemas';
import { useEditorProtection, type EditorState } from './useEditorProtection';
import { useEditorRequest } from './useEditorRequest';
import styles from './administration.module.css';

const accessLabels: Record<AccessClass, string> = { INTERNAL: 'Interno', RESTRICTED: 'Restrito', MEDICAL: 'Médico' };
const fieldLabels: Record<string, string> = { title: 'Título', code: 'Código', typeId: 'Tipo', companyId: 'Empresa', unitId: 'Unidade', sectorId: 'Setor', ownerId: 'Proprietário', accessClass: 'Classificação de acesso', issueDate: 'Emissão', validFrom: 'Início de vigência', validUntil: 'Fim de vigência', workerIds: 'Trabalhadores vinculados', responsibleIds: 'Responsáveis', keywords: 'Palavras-chave' };
const baseRequired = ['typeId', 'ownerId', 'accessClass', 'issueDate'];

function defaults(type?: DocumentTypeDto): DocumentTypeForm {
  return { code: type?.code ?? '', name: type?.name ?? '', category: type?.category ?? '', requiredFields: (type?.requiredFields ?? ['title', 'code']) as DocumentTypeForm['requiredFields'], allowedAccessClasses: type?.allowedAccessClasses ?? ['INTERNAL', 'RESTRICTED'], defaultAccessClass: type?.defaultAccessClass ?? 'INTERNAL', mimeTypes: type?.allowedMimeTypes.join('\n') ?? 'application/pdf', maxSizeMb: type ? type.maxFileSizeBytes / (1024 * 1024) : 10, renewalEnabled: type?.renewalPolicy.enabled ?? false, noticeDays: type?.renewalPolicy.noticeDays ?? 0, periodMonths: type?.renewalPolicy.periodMonths ?? 0, retentionCode: type?.retentionPolicyReference.code ?? '', retentionVersion: type?.retentionPolicyReference.version ?? '', retentionSource: type?.retentionPolicyReference.source ?? '', reviewRequired: type?.workflow.reviewRequired ?? true, signatureRequired: type?.workflow.signatureRequired ?? false, allowSelfApproval: type?.workflow.allowSelfApproval ?? false, allowMultipleActiveVersions: type?.workflow.allowMultipleActiveVersions ?? false };
}

function TypeForm({ type, onClose, onSaved, onStateChange }: { type?: DocumentTypeDto; onClose: () => void; onSaved: () => void; onStateChange: (state: EditorState) => void }) {
  const { sessionKey } = useSession();
  const client = useQueryClient();
  const request = useEditorRequest();
  const form = useForm<DocumentTypeForm>({ resolver: zodResolver(documentTypeSchema), defaultValues: defaults(type) });
  const renewalEnabled = form.watch('renewalEnabled');
  const save = useMutation({ mutationFn: (value: DocumentTypeForm) => request.run(signal => type ? api.patch<DocumentTypeDto>(`/document-types/${encodeURIComponent(type.id)}`, documentTypePayload(value), { etag: revisionEtag(type.revision), signal }) : api.post<DocumentTypeDto>('/document-types', documentTypePayload(value), { idempotencyKey: crypto.randomUUID(), signal })), onSuccess: async () => { if (!request.isActive()) return; await client.invalidateQueries({ queryKey: ['document-types', sessionKey] }); if (request.isActive()) onSaved(); }, onError: (error) => {
    if (!request.isActive() || !(error instanceof ApiError)) return;
    if (error.status === 412 || error.status === 428) void client.invalidateQueries({ queryKey: ['document-types', sessionKey] });
    const fields: Record<string, keyof DocumentTypeForm> = { code: 'code', name: 'name', category: 'category', requiredFields: 'requiredFields', allowedAccessClasses: 'allowedAccessClasses', defaultAccessClass: 'defaultAccessClass', allowedMimeTypes: 'mimeTypes', maxFileSizeBytes: 'maxSizeMb', 'renewalPolicy.noticeDays': 'noticeDays', 'renewalPolicy.periodMonths': 'periodMonths', 'retentionPolicyReference.code': 'retentionCode', 'retentionPolicyReference.version': 'retentionVersion', 'retentionPolicyReference.source': 'retentionSource' };
    for (const issue of error.fieldErrors ?? []) { const field = fields[issue.field]; if (field) form.setError(field, { type: 'server', message: issue.message }, { shouldFocus: true }); }
  } });
  const error = form.formState.errors;
  useEffect(() => { onStateChange({ dirty: form.formState.isDirty, busy: save.isPending }); return () => onStateChange({ dirty: false, busy: false }); }, [form.formState.isDirty, save.isPending, onStateChange]);
  return <form className="stack" aria-busy={save.isPending} onSubmit={form.handleSubmit((value) => { if (!save.isPending && !request.isPending()) save.mutate(value); })}><fieldset className="stack" disabled={save.isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <Feedback tone="info">Prazos e guarda devem seguir políticas aprovadas pela organização. Esta configuração não define obrigações legais.</Feedback>
    <div className="form-grid"><Field required label="Código" error={error.code?.message}><input {...form.register('code')} /></Field><Field required label="Nome" error={error.name?.message}><input {...form.register('name')} /></Field><Field required label="Categoria" error={error.category?.message}><input {...form.register('category')} /></Field><Field required label="Classificação padrão" error={error.defaultAccessClass?.message}><select {...form.register('defaultAccessClass')}>{Object.entries(accessLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></Field></div>
    <fieldset className={styles.fieldset}><legend>Classificações permitidas</legend><div className={styles.options}>{Object.entries(accessLabels).map(([code, label]) => <label key={code}><input type="checkbox" value={code} {...form.register('allowedAccessClasses')} />{label}</label>)}</div>{error.allowedAccessClasses && <span role="alert" className="field-error">{error.allowedAccessClasses.message}</span>}<p className="muted">Classificar como médico não concede acesso clínico a administradores.</p></fieldset>
    <fieldset className={styles.fieldset}><legend>Campos obrigatórios</legend><div className={styles.options}>{knownDocumentFields.map((field) => baseRequired.includes(field) ? <label key={field}><input type="checkbox" checked disabled />{fieldLabels[field]}</label> : <label key={field}><input type="checkbox" value={field} {...form.register('requiredFields')} />{fieldLabels[field]}</label>)}</div><p className="muted">Tipo, proprietário, emissão e classificação são obrigatórios pela RN-001.</p></fieldset>
    <div className="form-grid"><Field required label="Tipos MIME permitidos (um por linha)" error={error.mimeTypes?.message}><textarea rows={4} {...form.register('mimeTypes')} /></Field><Field required label="Tamanho máximo por arquivo (MB)" error={error.maxSizeMb?.message}><input type="number" step="0.1" min="0.1" {...form.register('maxSizeMb', { valueAsNumber: true })} /></Field></div>
    <fieldset className={`stack ${styles.fieldset}`}><legend>Fluxo documental</legend><div className={styles.options}><label><input type="checkbox" {...form.register('reviewRequired')} />Revisão obrigatória</label><label><input type="checkbox" {...form.register('signatureRequired')} />Evidência de assinatura obrigatória</label><label><input type="checkbox" {...form.register('allowSelfApproval')} />Permitir autoaprovação</label><label><input type="checkbox" {...form.register('allowMultipleActiveVersions')} />Exceção: múltiplas versões vigentes</label></div><p className="muted">Exceções e autoaprovação requerem autorização no servidor. Aprovação e publicação seguem a proposta pendente D-01.</p></fieldset>
    <fieldset className={`stack ${styles.fieldset}`}><legend>Renovação e alertas</legend><label className={styles.check}><input type="checkbox" {...form.register('renewalEnabled')} />Habilitar renovação periódica</label><div className="form-grid"><Field required label="Antecedência do aviso (dias)" error={error.noticeDays?.message}><input type="number" min="0" {...form.register('noticeDays', { valueAsNumber: true })} /></Field><Field required={renewalEnabled} label="Periodicidade aprovada (meses)" error={error.periodMonths?.message}><input type="number" min="0" {...form.register('periodMonths', { valueAsNumber: true })} readOnly={!renewalEnabled} /></Field></div></fieldset>
    <fieldset className={`stack ${styles.fieldset}`}><legend>Referência da política de guarda</legend><div className="form-grid"><Field required label="Código da política" error={error.retentionCode?.message}><input {...form.register('retentionCode')} /></Field><Field required label="Versão" error={error.retentionVersion?.message}><input {...form.register('retentionVersion')} /></Field><Field required label="Fonte validada" error={error.retentionSource?.message}><input {...form.register('retentionSource')} /></Field></div></fieldset>
    {save.isError && <Feedback tone="danger">{save.error.message} Nenhuma alteração foi confirmada. Em conflito, feche e reabra o tipo atualizado.</Feedback>}
    <div className="actions"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : type ? 'Salvar política' : 'Criar tipo'}</Button><Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Cancelar</Button></div>
  </fieldset></form>;
}

export function DocumentTypesPage() {
  const { sessionKey, unitId, can } = useSession();
  return <DocumentTypesPageContent key={`${sessionKey}:${unitId}:${can('documentTypes.write')}:${can('documents.read')}`} />;
}

function DocumentTypesPageContent() {
  const { sessionKey, unitId, can } = useSession();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DocumentTypeDto | 'new' | null>(null);
  const [success, setSuccess] = useState('');
  const [editor, setEditor] = useState<EditorState>({ dirty: false, busy: false });
  const closeEditor = useEditorProtection(editor, () => setSelected(null));
  const types = useQuery({ queryKey: ['document-types', sessionKey, unitId, page], queryFn: ({ signal }) => api.get<PageDto<DocumentTypeDto>>('/document-types', { query: { page, pageSize: 20 }, signal }), enabled: can('documentTypes.write') || can('documents.read') });
  const unavailable = types.isError && types.error instanceof ApiError && [401, 403, 404].includes(types.error.status);
  useEffect(() => { if (unavailable) setSelected(null); }, [unavailable]);
  if (!can('documentTypes.write') && !can('documents.read')) return <Feedback tone="warning">Seu acesso não permite consultar tipos documentais.</Feedback>;
  if (unavailable) return <Feedback tone="danger">{types.error!.message} <Button variant="ghost" onClick={() => types.refetch()}>Tentar novamente</Button></Feedback>;
  return <div className="stack"><PageHeader eyebrow="CONFIGURAÇÕES" title="Tipos documentais" description="Categorias, formatos, fluxo e referências de políticas para cada tipo." actions={can('documentTypes.write') ? <Button onClick={() => { setSuccess(''); setSelected('new'); }}>Novo tipo</Button> : <Badge tone="neutral">Somente leitura</Badge>} />
    {success && <Feedback tone="success">{success}</Feedback>}{types.isPending && <Spinner />}{types.isError && <Feedback tone="danger">{types.error.message} <Button variant="ghost" onClick={() => types.refetch()}>Tentar novamente</Button></Feedback>}
    {types.data && !types.isError && <section className="panel stack"><div className="table-wrap"><table className="data-table"><thead><tr><th>Tipo</th><th>Categoria</th><th>Acesso</th><th>Arquivo</th><th>Fluxo</th>{can('documentTypes.write') && <th>Ações</th>}</tr></thead><tbody>{types.data.items.map((type) => <tr key={type.id}><td><strong>{type.name}</strong><br /><span className="muted">{type.code}</span></td><td>{type.category}</td><td>{accessLabels[type.defaultAccessClass]}</td><td>{(type.maxFileSizeBytes / 1024 / 1024).toLocaleString('pt-BR')} MB<br /><small className="muted">{type.allowedMimeTypes.join(', ')}</small></td><td>{type.workflow.reviewRequired ? 'Com revisão' : 'Revisão facultativa'}<br /><small>{type.workflow.signatureRequired ? 'Exige assinatura' : 'Assinatura conforme necessidade'}</small></td>{can('documentTypes.write') && <td><Button variant="ghost" onClick={() => { setSuccess(''); setSelected(type); }}>Editar política</Button></td>}</tr>)}</tbody></table></div>{!types.data.items.length && <EmptyState title="Nenhum tipo cadastrado" description="Crie tipos antes de cadastrar documentos controlados." />}<div className="actions"><span className="muted">{types.data.total} tipos · página {page}</span><Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="ghost" disabled={page * types.data.pageSize >= types.data.total} onClick={() => setPage(page + 1)}>Próxima</Button></div></section>}
    <Modal open={selected !== null} title={selected === 'new' ? 'Novo tipo documental' : 'Editar política documental'} onClose={closeEditor}>{selected !== null && <TypeForm key={selected === 'new' ? 'new' : `${selected.id}-${selected.revision}`} type={selected === 'new' ? undefined : selected} onStateChange={setEditor} onClose={closeEditor} onSaved={() => { setSuccess('Política documental confirmada pela API.'); setSelected(null); }} />}</Modal>
  </div>;
}
