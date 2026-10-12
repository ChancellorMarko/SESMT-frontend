import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { MatrixRuleDto, RequirementMatrixDto } from '../../shared/contracts/requirements';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { emptyRule, matrixErrorMessage, matrixFormSchema, publishMatrixSchema, ruleFormValue, type MatrixFormValues, type PublishMatrixValues } from './support';
import styles from './requirements.module.css';

const queryKey = (sessionKey: string, unitId?: string) => ['requirement-matrix', sessionKey, unitId];
const eventLabels: Record<string, string> = { MATRIX_DRAFT_SAVED: 'Rascunho salvo', MATRIX_PUBLISHED: 'Matriz publicada', REQUIREMENT_MATRIX_DRAFT_SAVED: 'Rascunho salvo', REQUIREMENT_MATRIX_PUBLISHED: 'Matriz publicada' };

function RuleSummary({ rule, matrix }: { rule: MatrixRuleDto; matrix: RequirementMatrixDto }) {
  return <article className={styles.viewRule}><h3>{rule.label} {rule.restricted && <Badge tone="info">Conferência restrita</Badge>}</h3><p>{rule.restricted ? 'Somente a situação administrativa do requisito é exibida nos atendimentos. Arquivos, datas e detalhes clínicos não são apresentados nesta consulta.' : rule.description}</p><dl className={styles.metadata}><div><dt>Serviço</dt><dd>{matrix.services.find(service => service.id === rule.serviceTypeId)?.name || 'Serviço vinculado'}</dd></div><div><dt>Função no serviço</dt><dd>{rule.serviceFunction === '*' ? 'Todas as funções' : rule.serviceFunction}</dd></div><div><dt>Local</dt><dd>{rule.locationContains ? `Contém “${rule.locationContains}”` : 'Todos os locais'}</dd></div></dl>{!rule.restricted && <p className="muted">Datas exigidas: {[rule.validFromRequired && 'início da vigência', rule.validUntilRequired && 'fim da vigência'].filter(Boolean).join(' e ') || 'nenhuma'}. A exigência de uma data não define um prazo legal.</p>}</article>;
}

export function RequirementMatrixPage() {
  const { can, sessionKey, unitId } = useSession();
  const allowed = can('requirements.read') || can('requirements.write');
  const matrix = useQuery({ queryKey: queryKey(sessionKey, unitId), queryFn: ({ signal }) => api.get<RequirementMatrixDto>('/requirement-matrix', { signal, query: { unitId } }), enabled: allowed && Boolean(unitId), refetchOnWindowFocus: false });
  if (!allowed) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso à matriz de requisitos." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade de trabalho para consultar a matriz." />;
  if (matrix.isPending) return <Spinner />;
  if (matrix.isError && !matrix.data) return <div className="panel stack"><Feedback tone="danger">{matrixErrorMessage(matrix.error)}</Feedback><Button variant="secondary" onClick={() => void matrix.refetch()}>Tentar novamente</Button></div>;
  if (!matrix.data) return null;
  if (matrix.data.unitId !== unitId) return <EmptyState title="Matriz de outra unidade" description="Selecione a unidade correspondente para consultar este registro." />;
  return <MatrixWorkspace key={`${sessionKey}-${unitId}`} matrix={matrix.data} refreshError={matrix.error} />;
}

function MatrixWorkspace({ matrix, refreshError }: { matrix: RequirementMatrixDto; refreshError?: unknown }) {
  const client = useQueryClient();
  const { can, sessionKey, unitId } = useSession();
  const [reference, setReference] = useState(matrix);
  const [latest, setLatest] = useState<RequirementMatrixDto>();
  const [saveError, setSaveError] = useState<unknown>();
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishIntent, setPublishIntent] = useState<{ revision: number; version: string }>();
  const [publishError, setPublishError] = useState<unknown>();
  const checkingRequest = useRef<AbortController | null>(null);
  const form = useForm<MatrixFormValues>({ resolver: zodResolver(matrixFormSchema), defaultValues: { rules: (matrix.draft?.rules || matrix.published.rules).map(ruleFormValue) } });
  const publishForm = useForm<PublishMatrixValues>({ resolver: zodResolver(publishMatrixSchema), defaultValues: { reason: '', confirmed: false } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rules' });
  const rules = form.watch('rules');
  const busy = saving || publishing || checking;
  const dirty = form.formState.isDirty || Boolean(publishIntent && publishForm.formState.isDirty);
  const conflict = reviewRequired || matrix.revision !== reference.revision || (saveError instanceof ApiError && [412, 428].includes(saveError.status));
  const canEdit = can('requirements.write') && reference.availableActions.includes('EDIT_DRAFT');
  const canPublish = can('requirements.write') && reference.availableActions.includes('PUBLISH') && Boolean(reference.draft);
  const publishChanged = Boolean(publishIntent && (publishIntent.revision !== matrix.revision || publishIntent.revision !== reference.revision));

  useEffect(() => () => checkingRequest.current?.abort(), []);

  useEffect(() => {
    if (!dirty && !busy) return;
    const contextChange = (event: Event) => {
      if (busy) { event.preventDefault(); setSaveError(new Error('Aguarde a confirmação da ação em andamento antes de mudar de unidade.')); }
      else if (!window.confirm('Há alterações da matriz ainda não salvas. Deseja trocar de unidade e descartá-las?')) event.preventDefault();
    };
    window.addEventListener('sesmt:before-context-change', contextChange);
    return () => window.removeEventListener('sesmt:before-context-change', contextChange);
  }, [dirty, busy]);

  function adopt(saved: RequirementMatrixDto) {
    if (saved.unitId !== unitId) throw new Error('A resposta pertence a outra unidade. Seu preenchimento foi mantido.');
    setReference(saved);
    client.setQueryData(queryKey(sessionKey, unitId), saved);
    form.reset({ rules: (saved.draft?.rules || saved.published.rules).map(ruleFormValue) });
    setLatest(undefined);
    setSaveError(undefined);
    setReviewRequired(false);
  }

  async function save(values: MatrixFormValues) {
    if (!canEdit || busy || conflict) return;
    setSaving(true); setSaveError(undefined); setSuccess('');
    try {
      const saved = await api.patch<RequirementMatrixDto>('/requirement-matrix/draft', values, { etag: revisionEtag(reference.revision), query: { unitId } });
      adopt(saved);
      setSuccess('Rascunho salvo. A matriz publicada continua em uso nos atendimentos.');
    } catch (error) {
      setSaveError(error);
      if (error instanceof ApiError && [412, 428].includes(error.status)) setReviewRequired(true);
      if (error instanceof ApiError) error.fieldErrors?.forEach((item, index) => {
        if (item.field === 'rules' || item.field.startsWith('rules.')) form.setError(item.field as FieldPath<MatrixFormValues>, { message: item.message }, { shouldFocus: index === 0 });
      });
    } finally { setSaving(false); }
  }

  async function checkCurrent() {
    if (busy) return;
    const controller = new AbortController();
    checkingRequest.current = controller;
    setChecking(true);
    try {
      const current = await api.get<RequirementMatrixDto>('/requirement-matrix', { query: { unitId }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (current.unitId !== unitId) throw new Error('A resposta pertence a outra unidade. Seu preenchimento foi mantido.');
      setLatest(current);
      client.setQueryData(queryKey(sessionKey, unitId), current);
    } catch (error) { if (!controller.signal.aborted) setSaveError(error); }
    finally { if (!controller.signal.aborted) setChecking(false); checkingRequest.current = null; }
  }

  function keepLocal(current: RequirementMatrixDto) {
    const local = form.getValues();
    form.reset({ rules: (current.draft?.rules || current.published.rules).map(ruleFormValue) });
    form.reset(local, { keepDefaultValues: true });
    setReference(current); setLatest(undefined); setSaveError(undefined); setReviewRequired(false);
    setSuccess('Referência atualizada após conferência. Seu preenchimento foi mantido; salve para registrar o rascunho.');
  }

  async function publish(values: PublishMatrixValues) {
    if (!publishIntent || !canPublish || busy || conflict || publishChanged || form.formState.isDirty) return;
    setPublishing(true); setPublishError(undefined); setSuccess('');
    try {
      const saved = await api.post<RequirementMatrixDto>('/requirement-matrix/publish', { reason: values.reason }, { etag: revisionEtag(publishIntent.revision), query: { unitId } });
      adopt(saved);
      setPublishIntent(undefined);
      publishForm.reset({ reason: '', confirmed: false });
      setSuccess('Matriz publicada. A prontidão dos atendimentos abertos será reavaliada; esta ação não libera nem inicia uma PT.');
      await Promise.all(['documentary-readiness', 'eligibility', 'work-permits', 'work-permit', 'appointments', 'appointment', 'permit-dashboard', 'permit-options', 'work-authorizations', 'work-authorization', 'authorization-options'].map(key => client.invalidateQueries({ queryKey: [key] })));
    } catch (error) {
      setPublishError(error);
      if (error instanceof ApiError && [412, 428].includes(error.status)) { setSaveError(error); setReviewRequired(true); }
      if (error instanceof ApiError) error.fieldErrors?.forEach(item => { if (item.field === 'reason') publishForm.setError('reason', { message: item.message }, { shouldFocus: true }); });
    } finally { setPublishing(false); }
  }

  const versions = [matrix.published, ...matrix.versions].filter((version, index, entries) => entries.findIndex(item => item.version === version.version) === index);
  return <div className="stack">
    <UnsavedChanges dirty={dirty} busy={busy} />
    <PageHeader eyebrow="CONFIGURAÇÕES" title="Matriz de requisitos documentais" description="Configure requisitos por serviço, função e local, mantendo a publicação e os registros anteriores separados do rascunho." actions={<Link className="button button--secondary" to="/app/agenda">Consultar agenda</Link>} />
    <Feedback tone="info">Os critérios demonstram conferências administrativas. Datas exigidas são parâmetros da matriz e não representam prazos legais universais. Dados clínicos e arquivos restritos permanecem separados desta configuração.</Feedback>
    {Boolean(refreshError) && <Feedback tone="warning">Não foi possível atualizar a matriz. Seu rascunho local foi preservado. {matrixErrorMessage(refreshError)}</Feedback>}
    {success && <Feedback tone="success">{success}</Feedback>}
    <section className="panel stack" aria-label="Matriz publicada"><div className={styles.inlineLabel}><h2>Matriz publicada</h2><Badge tone="success">{matrix.published.version}</Badge></div><dl className={styles.metadata}><div><dt>Publicado em</dt><dd>{formatDate(matrix.published.publishedAt)}</dd></div><div><dt>Requisitos</dt><dd>{matrix.published.rules.length}</dd></div><div><dt>Rascunho salvo</dt><dd>{matrix.draft ? formatDate(matrix.draft.savedAt) : 'Nenhum'}</dd></div></dl><details className={styles.version}><summary>Consultar requisitos em uso</summary><div className={`stack ${styles.rules}`}>{matrix.published.rules.map(rule => <RuleSummary key={rule.id} rule={rule} matrix={matrix} />)}</div></details></section>
    {can('requirements.write') ? <form className="panel stack" onSubmit={form.handleSubmit(save)} noValidate aria-label="Rascunho da matriz"><div className={styles.inlineLabel}><h2>Rascunho da matriz</h2><Badge tone="warning">{form.formState.isDirty ? 'Alterações não salvas' : reference.draft ? 'Rascunho salvo' : 'Base da publicação atual'}</Badge></div><Feedback tone="info">Editar e salvar o rascunho não altera a matriz em uso. A publicação será confirmada separadamente, com motivo, e reavaliará os atendimentos abertos sem liberar automaticamente a execução.</Feedback><Feedback tone="warning">Alterar os critérios de uma regra gera uma nova identificação. Os comprovantes da regra anterior permanecem registrados e não são transferidos automaticamente para a regra alterada.</Feedback>
      {saveError !== undefined && <Feedback tone={conflict ? 'warning' : 'danger'}>{matrixErrorMessage(saveError)}</Feedback>}
      {conflict && <Feedback tone="warning">A matriz foi atualizada enquanto você preenchia. Seu rascunho local foi mantido. <Button variant="secondary" disabled={busy} onClick={() => void checkCurrent()}>{checking ? 'Consultando…' : 'Conferir matriz atual'}</Button></Feedback>}
      {latest && <section className={`stack ${styles.conflict}`} aria-label="Conferência da matriz atual"><h2>Registro atual · revisão {latest.revision}</h2><p>Publicação: {latest.published.version}. {latest.draft ? `Rascunho salvo com ${latest.draft.rules.length} regra(s).` : 'Sem rascunho salvo.'}</p><details><summary>Comparar composição atual</summary><div className="stack">{(latest.draft?.rules || latest.published.rules).map(rule => <RuleSummary key={rule.id} rule={rule} matrix={latest} />)}</div></details><p className={styles.notice}>Manter seu preenchimento substitui a composição do rascunho salvo quando você confirmar o próximo salvamento.</p><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => keepLocal(latest)}>Usar revisão atual e manter meu preenchimento</Button><Button variant="ghost" disabled={busy} onClick={() => { adopt(latest); setSuccess('Cadastro atual carregado. O preenchimento local anterior foi descartado.'); }}>Carregar matriz atual e descartar preenchimento</Button></div></section>}
      {!canEdit && <Feedback tone="warning">O servidor não disponibilizou a edição deste rascunho no estado atual.</Feedback>}
      {typeof form.formState.errors.rules?.message === 'string' && <Feedback tone="danger">{form.formState.errors.rules.message}</Feedback>}
      <div className={styles.rules}>{fields.map((field, index) => {
        const rule = rules[index];
        const errors = form.formState.errors.rules?.[index];
        return <fieldset className={styles.rule} key={field.id} disabled={busy || !canEdit || Boolean(publishIntent)}><legend>Regra {index + 1}</legend><div className={styles.ruleHeader}><p className="muted">{rule?.id ? 'Regra já identificada no cadastro' : 'Nova regra'}</p><Button variant="danger" aria-label={`Remover regra ${index + 1}`} onClick={() => remove(index)}>Remover regra</Button></div><div className="form-grid">
          <Field label={`Serviço da regra ${index + 1} *`} error={errors?.serviceTypeId?.message}><select {...form.register(`rules.${index}.serviceTypeId`)}><option value="">Selecione</option>{matrix.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field>
          <div><Field label={`Função da regra ${index + 1} *`} error={errors?.serviceFunction?.message}><input {...form.register(`rules.${index}.serviceFunction`)} maxLength={80} placeholder="* para todas as funções" /></Field><p className={styles.help}>Use * para todas as funções ou informe a função registrada no agendamento.</p></div>
          <div className={styles.wide}><Field label={`Local da regra ${index + 1}`} error={errors?.locationContains?.message}><input {...form.register(`rules.${index}.locationContains`)} maxLength={200} placeholder="Deixe vazio para todos os locais" /></Field><p className={styles.help}>Preencha uma parte do nome do local para restringir a aplicação desta regra.</p></div>
          <div className={styles.wide}><Field label={`Título da regra ${index + 1} *`} error={errors?.label?.message}><input {...form.register(`rules.${index}.label`)} maxLength={160} /></Field></div>
          <div className={styles.wide}><Field label={`Descrição da regra ${index + 1} *`} error={errors?.description?.message}><textarea {...form.register(`rules.${index}.description`)} maxLength={2000} /></Field></div>
          <div className={styles.wide}><label className={styles.check}><input type="checkbox" {...form.register(`rules.${index}.restricted`)} onChange={event => { form.setValue(`rules.${index}.restricted`, event.target.checked, { shouldDirty: true, shouldValidate: form.formState.isSubmitted }); if (event.target.checked) { form.setValue(`rules.${index}.validFromRequired`, false, { shouldDirty: true }); form.setValue(`rules.${index}.validUntilRequired`, false, { shouldDirty: true }); } }} /><span>Conferência restrita da regra {index + 1}</span></label>{errors?.restricted?.message && <p className="field-error" role="alert">{errors.restricted.message}</p>}{rule?.restricted ? <p className={styles.help}>A conferência comum exibe somente a situação administrativa. Datas e informações clínicas não são configuradas nem expostas aqui.</p> : <div className={styles.checks}><label className={styles.check}><input type="checkbox" {...form.register(`rules.${index}.validFromRequired`)} /><span>Exigir início da vigência na regra {index + 1}</span></label><label className={styles.check}><input type="checkbox" {...form.register(`rules.${index}.validUntilRequired`)} /><span>Exigir fim da vigência na regra {index + 1}</span></label></div>}</div>
        </div></fieldset>;
      })}</div><Button variant="secondary" disabled={busy || !canEdit || fields.length >= 100 || Boolean(publishIntent)} onClick={() => append(emptyRule(matrix.services[0]?.id))}>Adicionar regra</Button><div className={styles.footer}><div className="actions"><Button type="submit" disabled={busy || !canEdit || conflict || Boolean(latest) || Boolean(publishIntent)}>{saving ? 'Salvando…' : 'Salvar rascunho'}</Button><Button variant="secondary" disabled={busy || !canPublish || dirty || conflict || Boolean(latest)} onClick={() => { publishForm.reset({ reason: publishForm.getValues('reason'), confirmed: false }); setPublishError(undefined); setPublishIntent({ revision: reference.revision, version: reference.published.version }); }}>Publicar rascunho salvo</Button></div>{form.formState.isDirty && <p className={styles.help}>Salve as alterações antes de publicar.</p>}</div></form> : <Feedback tone="info">Consulta da matriz publicada e de suas versões. Seu perfil não possui permissão para alterar requisitos.</Feedback>}
    <section className="panel stack" aria-label="Versões da matriz"><h2>Versões publicadas</h2>{versions.map(version => <details className={styles.version} key={version.version}><summary>{version.version} · {formatDate(version.publishedAt)} · {version.rules.length} requisito(s)</summary><p className={styles.description}>{version.reason}</p><div className={styles.rules}>{version.rules.map(rule => <RuleSummary key={rule.id} rule={rule} matrix={matrix} />)}</div></details>)}</section>
    <section className="panel stack" aria-label="Histórico da matriz"><h2>Histórico</h2>{matrix.history.length ? <ol className={styles.history}>{matrix.history.map(event => <li key={event.id}><strong>{eventLabels[event.action] || 'Atualização da matriz'}</strong><p>{event.actorName} · {formatDate(event.occurredAt)}</p>{event.reason && <p>{event.reason}</p>}</li>)}</ol> : <p className="muted">Nenhum evento disponível.</p>}</section>
    <Modal open={Boolean(publishIntent)} title="Publicar matriz de requisitos" onClose={() => { if (!publishing) setPublishIntent(undefined); }}><form className="stack" onSubmit={publishForm.handleSubmit(publish)} noValidate><Feedback tone="warning">Você publicará o rascunho salvo da unidade selecionada. Os atendimentos abertos terão a elegibilidade reavaliada, incluindo comprovantes associados a regras alteradas. Esta ação não libera, inicia ou retoma uma PT.</Feedback><p>Cada serviço precisa de pelo menos uma regra geral, com função * e local vazio, antes de publicar.</p><p className="muted">Publicação em uso: {publishIntent?.version}. Revisão carregada: {publishIntent?.revision}.</p>{publishChanged && <Feedback tone="danger">A matriz mudou enquanto esta janela estava aberta. Feche a confirmação e confira o registro atual; seu motivo foi mantido.</Feedback>}{publishError !== undefined && <Feedback tone="danger">{matrixErrorMessage(publishError)}</Feedback>}<Field label="Motivo da publicação *" error={publishForm.formState.errors.reason?.message}><textarea {...publishForm.register('reason')} maxLength={2000} disabled={publishing} autoFocus /></Field><label className={styles.check}><input type="checkbox" {...publishForm.register('confirmed')} disabled={publishing} /><span>Conferi o rascunho salvo e confirmo sua publicação para esta unidade.</span></label>{publishForm.formState.errors.confirmed?.message && <p className="field-error" role="alert">{publishForm.formState.errors.confirmed.message}</p>}<div className="actions"><Button type="submit" disabled={publishing || publishChanged || conflict || form.formState.isDirty}>{publishing ? 'Publicando…' : 'Confirmar publicação'}</Button><Button variant="secondary" disabled={publishing} onClick={() => setPublishIntent(undefined)}>Cancelar</Button></div></form></Modal>
  </div>;
}
