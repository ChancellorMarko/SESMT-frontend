import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { ServiceCatalogDto, ServiceTemplateDto, ServiceTemplateQuestionDto } from '../../shared/contracts/service-templates';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { emptyQuestion, publicationSchema, templateErrorMessage, templateSchema, type PublicationValues, type TemplateValues } from './support';
import styles from './service-templates.module.css';

const queryKey = (sessionKey: string, unitId?: string) => ['service-templates', sessionKey, unitId];
function QuestionSummary({ question }: { question: ServiceTemplateQuestionDto }) {
  return <article className={styles.summary}><h3>{question.label}</h3><p>{question.required ? 'Obrigatória' : 'Opcional'} · {question.blockingAnswers.length ? `Bloqueia ao responder ${question.blockingAnswers[0] === 'NO' ? 'Não' : 'Sim'}` : 'Sem resposta bloqueadora'}</p></article>;
}

export function ServiceTemplatesPage() {
  const { can, sessionKey, unitId } = useSession();
  const allowed = can('requirements.read') || can('requirements.write');
  const catalog = useQuery({ queryKey: queryKey(sessionKey, unitId), queryFn: ({ signal }) => api.get<ServiceCatalogDto>('/service-templates', { signal, query: { unitId } }), enabled: allowed && Boolean(unitId), refetchOnWindowFocus: false });
  if (!allowed) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à configuração dos serviços." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha uma unidade para consultar os serviços e seus templates." />;
  if (catalog.isPending) return <Spinner />;
  if (catalog.isError && !catalog.data) return <div className="panel stack"><Feedback tone="danger">{templateErrorMessage(catalog.error)}</Feedback><Button variant="secondary" onClick={() => void catalog.refetch()}>Tentar novamente</Button></div>;
  if (!catalog.data) return null;
  if (catalog.data.unitId !== unitId || catalog.data.templates.some(template => template.unitId !== unitId)) return <EmptyState title="Catálogo de outra unidade" description="A resposta não pertence à unidade selecionada." />;
  return <CatalogWorkspace key={`${sessionKey}-${unitId}`} catalog={catalog.data} refreshError={catalog.error} />;
}

function CatalogWorkspace({ catalog, refreshError }: { catalog: ServiceCatalogDto; refreshError?: unknown }) {
  const [selectedId, setSelectedId] = useState(catalog.templates[0]?.service.id);
  const selected = catalog.templates.find(template => template.service.id === selectedId);
  if (!selected) return <EmptyState title="Nenhum serviço disponível" description="Não há templates cadastrados para esta unidade." />;
  return <TemplateEditor key={selectedId} template={selected} catalog={catalog} onSelect={setSelectedId} refreshError={refreshError} />;
}

function TemplateEditor({ template, catalog, onSelect, refreshError }: { template: ServiceTemplateDto; catalog: ServiceCatalogDto; onSelect: (id: string) => void; refreshError?: unknown }) {
  const { can, sessionKey, unitId } = useSession();
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [reference, setReference] = useState(template);
  const [latest, setLatest] = useState<ServiceTemplateDto>();
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [error, setError] = useState<unknown>();
  const [publishError, setPublishError] = useState<unknown>();
  const [success, setSuccess] = useState('');
  const [publishRevision, setPublishRevision] = useState<number>();
  const form = useForm<TemplateValues>({ resolver: zodResolver(templateSchema), defaultValues: { questions: structuredClone(template.draft?.questions || template.published.questions) } });
  const publication = useForm<PublicationValues>({ resolver: zodResolver(publicationSchema), defaultValues: { reason: '', confirmed: false } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'questions', keyName: 'formKey' });
  const questions = form.watch('questions');
  const busy = saving || publishing || checking;
  const dirty = form.formState.isDirty || Boolean(publishRevision && publication.formState.isDirty);
  const conflict = reviewRequired || template.revision !== reference.revision;
  const canEdit = can('requirements.write') && reference.availableActions.includes('EDIT_DRAFT');
  const canPublish = canEdit && reference.availableActions.includes('PUBLISH') && Boolean(reference.draft);
  const publicationChanged = publishRevision !== undefined && (publishRevision !== template.revision || publishRevision !== reference.revision);

  function select(id: string) {
    if (id === template.service.id || busy) return;
    if (dirty && !window.confirm('Há alterações deste template ainda não salvas. Descartar o preenchimento e selecionar outro serviço?')) return;
    onSelect(id);
  }
  function adopt(saved: ServiceTemplateDto) {
    if (saved.unitId !== unitId || saved.service.id !== template.service.id) throw new Error('A resposta pertence a outro serviço ou unidade. Seu preenchimento foi mantido.');
    setReference(saved); setLatest(undefined); setError(undefined); setReviewRequired(false);
    form.reset({ questions: structuredClone(saved.draft?.questions || saved.published.questions) });
    client.setQueryData<ServiceCatalogDto>(queryKey(sessionKey, unitId), current => current && ({ ...current, templates: current.templates.map(entry => entry.service.id === saved.service.id ? saved : entry) }));
  }
  const path = `/service-templates/${reference.service.id}`;
  function fieldErrors(value: unknown) {
    if (value instanceof ApiError) value.fieldErrors?.forEach((item, index) => {
      if (item.field === 'questions' || item.field.startsWith('questions.')) form.setError(item.field as FieldPath<TemplateValues>, { message: item.message }, { shouldFocus: index === 0 });
    });
  }
  async function save(values: TemplateValues) {
    if (!canEdit || busy || inFlight.current || conflict || latest) return;
    inFlight.current = true;
    setSaving(true); setError(undefined); setSuccess('');
    try {
      const saved = await api.patch<ServiceTemplateDto>(`${path}/draft`, values, { etag: revisionEtag(reference.revision), query: { unitId } });
      adopt(saved); setSuccess('Rascunho salvo. O template publicado e as PTs abertas permanecem preservados.');
    } catch (value) { setError(value); fieldErrors(value); if (value instanceof ApiError && [412, 428].includes(value.status)) setReviewRequired(true); }
    finally { inFlight.current = false; setSaving(false); }
  }
  async function checkCurrent() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setChecking(true); setError(undefined);
    try {
      const current = await api.get<ServiceCatalogDto>('/service-templates', { query: { unitId } });
      const found = current.templates.find(entry => entry.service.id === template.service.id && entry.unitId === unitId);
      if (current.unitId !== unitId || !found) throw new Error('O serviço não foi encontrado na unidade selecionada.');
      setLatest(found); client.setQueryData(queryKey(sessionKey, unitId), current);
    } catch (value) { setError(value); } finally { inFlight.current = false; setChecking(false); }
  }
  function keepLocal(current: ServiceTemplateDto) {
    const values = form.getValues();
    form.reset({ questions: structuredClone(current.draft?.questions || current.published.questions) });
    form.reset(values, { keepDefaultValues: true });
    setReference(current); setLatest(undefined); setReviewRequired(false); setError(undefined);
    setSuccess('Revisão atual conferida. Seu preenchimento foi mantido; salve para substituir o rascunho atual.');
  }
  async function publish(values: PublicationValues) {
    if (!canPublish || busy || inFlight.current || conflict || publicationChanged || form.formState.isDirty || publishRevision === undefined) return;
    inFlight.current = true;
    setPublishing(true); setPublishError(undefined); setSuccess('');
    try {
      const saved = await api.post<ServiceTemplateDto>(`${path}/publish`, { reason: values.reason }, { etag: revisionEtag(publishRevision), query: { unitId } });
      adopt(saved); setPublishRevision(undefined); publication.reset({ reason: '', confirmed: false });
      setSuccess('Template publicado. Novas PTs usarão esta versão; as perguntas das PTs já abertas permanecem preservadas.');
      await client.invalidateQueries({ queryKey: ['permit-options'] });
    } catch (value) {
      setPublishError(value);
      if (value instanceof ApiError && [412, 428].includes(value.status)) { setReviewRequired(true); setError(value); }
      if (value instanceof ApiError) value.fieldErrors?.forEach(item => { if (item.field === 'reason') publication.setError('reason', { message: item.message }, { shouldFocus: true }); });
    } finally { inFlight.current = false; setPublishing(false); }
  }

  return <div className="stack">
    <UnsavedChanges dirty={dirty} busy={busy} protectContext />
    <PageHeader eyebrow="CONFIGURAÇÕES" title="Serviços e templates de PT" description="Configure perguntas por serviço e unidade, com rascunhos e versões publicadas." actions={<Link className="button button--secondary" to="/app/agenda">Consultar agenda</Link>} />
    <Feedback tone="info">Defina as perguntas e respostas bloqueadoras para cada serviço.</Feedback>
    <nav className={styles.catalog} aria-label="Selecionar serviço">{catalog.templates.map(entry => <button type="button" key={entry.service.id} className={styles.service} aria-pressed={entry.service.id === template.service.id} disabled={busy} onClick={() => select(entry.service.id)}><strong>{entry.service.name}</strong><small>{entry.published.version}</small><Badge tone={entry.draft ? 'warning' : 'success'}>{entry.draft ? 'Com rascunho' : 'Publicado'}</Badge></button>)}</nav>
    {Boolean(refreshError) && <Feedback tone="warning">Não foi possível atualizar o catálogo. Seu preenchimento foi preservado. {templateErrorMessage(refreshError)}</Feedback>}
    {success && <Feedback tone="success">{success}</Feedback>}
    <section className="panel stack" aria-label="Template publicado"><div className={styles.row}><h2>{template.service.name}</h2><Badge tone="success">{template.published.version}</Badge></div><p>{template.service.description}</p><dl className={styles.metadata}><div><dt>Publicado em</dt><dd>{formatDate(template.published.publishedAt)}</dd></div><div><dt>Perguntas</dt><dd>{template.published.questions.length}</dd></div><div><dt>Rascunho salvo</dt><dd>{template.draft ? formatDate(template.draft.savedAt) : 'Nenhum'}</dd></div></dl><details className={styles.version}><summary>Consultar perguntas em uso</summary><div className={`stack ${styles.questions}`}>{template.published.questions.map(question => <QuestionSummary key={question.id} question={question} />)}</div></details></section>
    {can('requirements.write') ? <form className="panel stack" aria-label="Rascunho do template" onSubmit={form.handleSubmit(save)} noValidate><div className={styles.row}><h2>Rascunho do template</h2><Badge tone="warning">{form.formState.isDirty ? 'Alterações não salvas' : reference.draft ? 'Rascunho salvo' : 'Base da publicação atual'}</Badge></div><p className={styles.help}>Salvar o rascunho mantém a publicação atual em uso. Para publicar, confira as perguntas e informe um motivo. Ao menos uma pergunta deve ser obrigatória e possuir resposta bloqueadora.</p>
      {error !== undefined && <Feedback tone={conflict ? 'warning' : 'danger'}>{templateErrorMessage(error)}</Feedback>}
      {!canEdit && <Feedback tone="warning">A edição deste template não está disponível no seu escopo.</Feedback>}
      {conflict && <Feedback tone="warning">O template mudou enquanto você preenchia. Seu rascunho local foi mantido. <Button variant="secondary" disabled={busy} onClick={() => void checkCurrent()}>{checking ? 'Consultando…' : 'Conferir template atual'}</Button></Feedback>}
      {latest && <section className={`stack ${styles.conflict}`} aria-label="Conferência do template atual"><h2>Registro atual · revisão {latest.revision}</h2><p>Publicação: {latest.published.version}. {latest.draft ? `Rascunho com ${latest.draft.questions.length} pergunta(s).` : 'Sem rascunho salvo.'}</p><details className={styles.version}><summary>Comparar perguntas atuais</summary><div className="stack">{(latest.draft?.questions || latest.published.questions).map(question => <QuestionSummary key={question.id} question={question} />)}</div></details><p>Manter seu preenchimento substituirá a composição do rascunho atual no próximo salvamento.</p><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => keepLocal(latest)}>Usar revisão atual e manter meu preenchimento</Button><Button variant="ghost" disabled={busy} onClick={() => { adopt(latest); setSuccess('Template atual carregado. O preenchimento anterior foi descartado.'); }}>Carregar template atual e descartar preenchimento</Button></div></section>}
      {typeof form.formState.errors.questions?.message === 'string' && <Feedback tone="danger">{form.formState.errors.questions.message}</Feedback>}
      <div className={styles.questions}>{fields.map((field, index) => <fieldset className={styles.question} key={field.formKey} disabled={busy || !canEdit || publishRevision !== undefined}><legend>Pergunta {index + 1}</legend><div className="stack"><Field label={`Texto da pergunta ${index + 1} *`} error={form.formState.errors.questions?.[index]?.label?.message}><textarea {...form.register(`questions.${index}.label`)} maxLength={500} /></Field><div className="form-grid"><label className={styles.check}><input type="checkbox" {...form.register(`questions.${index}.required`)} /><span>Pergunta {index + 1} obrigatória</span></label><Field label={`Resposta bloqueadora da pergunta ${index + 1}`} error={form.formState.errors.questions?.[index]?.blockingAnswers?.message}><select value={questions[index]?.blockingAnswers[0] || ''} onChange={event => form.setValue(`questions.${index}.blockingAnswers`, event.target.value ? [event.target.value as 'YES' | 'NO'] : [], { shouldDirty: true, shouldValidate: true })}><option value="">Nenhuma</option><option value="NO">Não</option><option value="YES">Sim</option></select></Field></div><Button variant="danger" aria-label={`Remover pergunta ${index + 1}`} onClick={() => remove(index)}>Remover pergunta</Button></div></fieldset>)}</div>
      <Button variant="secondary" disabled={busy || !canEdit || fields.length >= 30 || publishRevision !== undefined} onClick={() => append(emptyQuestion())}>Adicionar pergunta</Button><div className="actions"><Button type="submit" disabled={busy || !canEdit || conflict || Boolean(latest) || publishRevision !== undefined}>{saving ? 'Salvando…' : 'Salvar rascunho'}</Button><Button variant="secondary" disabled={busy || !canPublish || dirty || conflict || Boolean(latest)} onClick={() => { publication.reset({ reason: publication.getValues('reason'), confirmed: false }); setPublishError(undefined); setPublishRevision(reference.revision); }}>Publicar rascunho salvo</Button></div>{form.formState.isDirty && <p className={styles.help}>Salve as alterações antes de publicar.</p>}
    </form> : <Feedback tone="info">Seu perfil permite consultar os templates e suas versões publicadas.</Feedback>}
    <section className="panel stack" aria-label="Versões do template"><h2>Versões publicadas</h2>{[...template.versions].reverse().map(version => <details className={styles.version} key={version.version}><summary>{version.version} · {formatDate(version.publishedAt)} · {version.questions.length} pergunta(s)</summary><p>{version.reason}</p><div className="stack">{version.questions.map(question => <QuestionSummary key={question.id} question={question} />)}</div></details>)}</section>
    <section className="panel stack" aria-label="Histórico do template"><h2>Histórico</h2>{template.history.length ? <ol className={styles.history}>{template.history.map(event => <li key={event.id}><strong>{event.action === 'SERVICE_TEMPLATE_PUBLISHED' ? 'Template publicado' : 'Rascunho salvo'}</strong><p>{event.actorName} · {formatDate(event.occurredAt)}</p><p>{event.reason}</p></li>)}</ol> : <p className="muted">Nenhum evento disponível.</p>}</section>
    <Modal open={publishRevision !== undefined} title="Publicar template do serviço" onClose={() => { if (!publishing) setPublishRevision(undefined); }}><form className="stack" onSubmit={publication.handleSubmit(publish)} noValidate><Feedback tone="warning">Você publicará o rascunho salvo de {reference.service.name} para esta unidade. A nova versão será usada na abertura de PTs. PTs já abertas preservam o template registrado.</Feedback>{publicationChanged && <Feedback tone="danger">O template mudou enquanto esta janela estava aberta. Feche a confirmação e confira a versão atual; seu motivo foi mantido.</Feedback>}{publishError !== undefined && <Feedback tone="danger">{templateErrorMessage(publishError)}</Feedback>}<Field label="Motivo da publicação *" error={publication.formState.errors.reason?.message}><textarea {...publication.register('reason')} maxLength={2000} disabled={publishing} autoFocus /></Field><label className={styles.check}><input type="checkbox" {...publication.register('confirmed')} disabled={publishing} /><span>Conferi o rascunho salvo e confirmo a publicação deste template.</span></label>{publication.formState.errors.confirmed?.message && <p className="field-error" role="alert">{publication.formState.errors.confirmed.message}</p>}<div className="actions"><Button type="submit" disabled={publishing || publicationChanged || conflict || form.formState.isDirty}>{publishing ? 'Publicando…' : 'Confirmar publicação'}</Button><Button variant="secondary" disabled={publishing} onClick={() => setPublishRevision(undefined)}>Cancelar</Button></div></form></Modal>
  </div>;
}
