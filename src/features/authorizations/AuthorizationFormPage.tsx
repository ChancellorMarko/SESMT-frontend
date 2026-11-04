import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AuthorizationOptionDto, AuthorizationOptionsDto, AuthorizationWriteDto, WorkAuthorizationDto } from '../../shared/contracts/work-authorizations';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { AT_CONTROLS, AT_SOURCE, createAuthorizationPreparation, validateAuthorizationPreparation } from './model';
import { AuthorizationAppointment, AuthorizationSourceChecks } from './AuthorizationCommon';
import { authorizationDraftSchema, authorizationError, authorizationKey, identificationLabels, useAuthorizationContextGuard } from './support';
import { assertAuthorizationResponse, invalidateAuthorizationContext } from './request-safety';
import { preparationListPath, preparationOrigin } from '../../shared/lib/preparation-navigation';
import styles from './authorizations.module.css';

export function AuthorizationFormPage() {
  const { id } = useParams(); const session = useSession();
  const [search] = useSearchParams();
  const options = useQuery({ queryKey: ['authorization-options', session.sessionKey, session.unitId], queryFn: ({ signal }) => api.get<AuthorizationOptionsDto>('/authorization-options', { query: { unitId: session.unitId }, signal }), enabled: session.can('at.write') && Boolean(session.unitId) });
  const record = useQuery({ queryKey: authorizationKey(session.sessionKey, session.unitId, id), queryFn: async ({ signal }) => {
    const value = await api.get<WorkAuthorizationDto>(`/work-authorizations/${id}`, { signal, query: { unitId: session.unitId } });
    assertAuthorizationResponse(value, { id, unitId: session.unitId, companyId: value.companyId, appointmentId: value.appointment?.id || '' });
    return value;
  }, enabled: session.can('at.write') && Boolean(id && session.unitId), refetchOnWindowFocus: false });
  const context = `${session.sessionKey}:${session.unitId}:${id || 'new'}`;
  const admission = useRef({ context, opened: false });
  if (admission.current.context !== context) admission.current = { context, opened: false };
  const referencesVerified = options.isSuccess && !options.isFetching && (!id || record.isSuccess && !record.isFetching);
  if (referencesVerified) admission.current.opened = true;
  const refreshError = record.error || options.error;
  const retryReferences = () => { void options.refetch(); if (id) void record.refetch(); };
  if (!session.can('at.write')) { admission.current.opened = false; return <EmptyState title="Acesso restrito" description="Seu perfil não pode preparar ATs." />; }
  if (!session.unitId) { admission.current.opened = false; return <EmptyState title="Selecione uma unidade" />; }
  if ((id ? record.isPending : options.isPending) || !admission.current.opened && (options.isFetching || id && record.isFetching)) return <Spinner />;
  if (refreshError && !admission.current.opened) return <div className="panel stack"><Feedback tone="danger">{authorizationError(refreshError)}</Feedback><Button variant="secondary" onClick={retryReferences}>Tentar novamente</Button></div>;
  if (id && (!record.data || record.data.id !== id || record.data.unitId !== session.unitId || record.data.appointment.unitId !== session.unitId)) { admission.current.opened = false; return <EmptyState title="AT fora da unidade atual" />; }
  return <AuthorizationEditor key={context} options={options.data?.appointments || []} record={id ? record.data : undefined} initialAppointmentId={search.get('appointmentId') || undefined} refreshError={refreshError} referencesVerified={referencesVerified} retryReferences={retryReferences} />;
}

function AuthorizationEditor({ options, record, initialAppointmentId, refreshError, referencesVerified, retryReferences }: { options: AuthorizationOptionDto[]; record?: WorkAuthorizationDto; initialAppointmentId?: string; refreshError?: unknown; referencesVerified: boolean; retryReferences: () => void }) {
  const { sessionKey, unitId } = useSession(); const client = useQueryClient(); const navigate = useNavigate(); const location = useLocation();
  const listNavigation = preparationOrigin(location.state, unitId, 'ats');
  const initialOption = options.find(item => item.appointment.id === initialAppointmentId && item.appointment.unitId === unitId && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(item.appointment.status));
  const [selectedId, setSelectedId] = useState(record?.appointment.id || initialOption?.appointment.id || '');
  const [reference, setReference] = useState(record); const [latest, setLatest] = useState<WorkAuthorizationDto>();
  const [failure, setFailure] = useState<unknown>(); const [saving, setSaving] = useState(false); const [checking, setChecking] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const active = useRef(true); const pendingRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; pendingRequest.current?.abort(); }; }, []);
  const selectedOption = options.find(item => item.appointment.id === selectedId);
  const appointment = record?.appointment || selectedOption?.appointment;
  const appointmentAvailable = Boolean(appointment && appointment.unitId === unitId && (record || ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(appointment.status)));
  const blank: AuthorizationWriteDto = { identification: { serviceManagement: '', serviceProvider: '', activityDescription: '', workFront: '', areaManagement: '', riskAnalysisReference: '', notes: '' }, foremanId: '', controls: [], additionalControls: '', checks: [], permitId: null };
  const form = useForm<AuthorizationWriteDto>({ resolver: zodResolver(authorizationDraftSchema), defaultValues: record ? { ...record.preparation, permitId: record.permitId || null } : initialOption ? { ...createAuthorizationPreparation(initialOption.appointment), permitId: null } : blank });
  const values = form.watch(); const busy = saving || checking;
  const editable = !record || record.status === 'DRAFT' && record.availableActions.includes('EDIT');
  const dirty = form.formState.isDirty || Boolean(!record && selectedId);
  const conflict = reviewRequired || Boolean(reference && record?.revision !== reference.revision) || failure instanceof ApiError && [412, 428].includes(failure.status);
  useAuthorizationContextGuard(dirty, busy, setFailure);
  const errors = form.formState.errors;

  function selectAppointment(value: string) {
    if (busy || pendingRequest.current) return;
    if (dirty && !window.confirm('Trocar o atendimento descarta a preparação local desta AT. Deseja continuar?')) return;
    setSelectedId(value); setFailure(undefined);
    const next = options.find(item => item.appointment.id === value);
    form.reset(next ? { ...createAuthorizationPreparation(next.appointment), permitId: null } : blank);
  }
  function adopt(current: WorkAuthorizationDto, keep = false) {
    if (busy || pendingRequest.current) return;
    try {
      const cached = client.getQueryData<WorkAuthorizationDto>(authorizationKey(sessionKey, unitId, current.id));
      assertAuthorizationResponse(current, { id: reference?.id, unitId, companyId: reference?.companyId || current.companyId, appointmentId: reference?.appointment.id || current.appointment.id, minimumRevision: Math.max(reference?.revision || 0, record?.revision || 0, cached?.revision || 0) });
    } catch (error) { setFailure(error); return; }
    const local = structuredClone(form.getValues());
    form.reset({ ...current.preparation, permitId: current.permitId || null });
    if (keep) form.reset(local, { keepDefaultValues: true });
    client.setQueryData(authorizationKey(sessionKey, unitId, current.id), current);
    setReference(current); setLatest(undefined); setFailure(undefined); setReviewRequired(false);
  }
  async function checkCurrent() {
    if (!reference || busy || pendingRequest.current) return;
    const controller = new AbortController(); pendingRequest.current = controller;
    setChecking(true); setFailure(undefined);
    try {
      const current = await api.get<WorkAuthorizationDto>(`/work-authorizations/${reference.id}`, { signal: controller.signal, query: { unitId } });
      if (!active.current || controller.signal.aborted) return;
      const cached = client.getQueryData<WorkAuthorizationDto>(authorizationKey(sessionKey, unitId, reference.id));
      assertAuthorizationResponse(current, { id: reference.id, unitId, companyId: reference.companyId, appointmentId: reference.appointment.id, minimumRevision: Math.max(reference.revision, record?.revision || 0, cached?.revision || 0) });
      setLatest(current);
    } catch (error) { if (active.current && !controller.signal.aborted) setFailure(error); }
    finally { if (pendingRequest.current === controller) { pendingRequest.current = undefined; if (active.current) setChecking(false); } }
  }
  async function save(input: AuthorizationWriteDto) {
    if (busy || pendingRequest.current || conflict || latest || !referencesVerified || !editable || !appointment || !appointmentAvailable) return;
    if (reference && (reference.status !== 'DRAFT' || !reference.availableActions.includes('EDIT'))) return;
    const invalid = validateAuthorizationPreparation(input);
    if (invalid) { setFailure(new Error(invalid)); return; }
    const controller = new AbortController(); pendingRequest.current = controller;
    setSaving(true); setFailure(undefined);
    let responseReceived = false;
    try {
      input = { ...input, permitId: input.permitId || null };
      const saved = reference ? await api.patch<WorkAuthorizationDto>(`/work-authorizations/${reference.id}`, input, { signal: controller.signal, etag: revisionEtag(reference.revision), query: { unitId } }) : await api.post<WorkAuthorizationDto>('/work-authorizations', { appointmentId: appointment.id, ...input }, { signal: controller.signal, query: { unitId } });
      if (!active.current || controller.signal.aborted) return;
      responseReceived = true;
      const cached = reference ? client.getQueryData<WorkAuthorizationDto>(authorizationKey(sessionKey, unitId, reference.id)) : undefined;
      assertAuthorizationResponse(saved, { id: reference?.id, unitId, companyId: reference?.companyId || appointment.companyId, appointmentId: appointment.id, minimumRevision: Math.max(record?.revision || 0, cached?.revision || 0), advancedFrom: reference?.revision });
      client.setQueryData(authorizationKey(sessionKey, unitId, saved.id), saved);
      void invalidateAuthorizationContext(client, sessionKey, unitId, ['work-authorizations', 'authorization-options']);
      form.reset({ ...saved.preparation, permitId: saved.permitId || null });
      navigate(`/app/ats/${saved.id}`, { state: { ...listNavigation, success: 'Rascunho da AT salvo. A autorização exige uma confirmação separada.' } });
    } catch (error) {
      if (!active.current || controller.signal.aborted) return;
      setFailure(error);
      if (responseReceived && reference || error instanceof ApiError && [412, 428].includes(error.status)) setReviewRequired(true);
      if (error instanceof ApiError) error.fieldErrors?.forEach((item, index) => form.setError(item.field as FieldPath<AuthorizationWriteDto>, { message: item.message }, { shouldFocus: index === 0 }));
    } finally { if (pendingRequest.current === controller) { pendingRequest.current = undefined; if (active.current) setSaving(false); } }
  }

  return <div className="stack"><UnsavedChanges dirty={dirty} busy={busy} /><PageHeader eyebrow="RI-S-36002" title={record ? `Preparar ${record.code}` : 'Criar Autorização de Trabalho'} description="Registre o contexto, os controles e as respostas do modelo recebido. Um rascunho pode ser salvo com campos ainda pendentes." actions={<Link className="button button--secondary" state={listNavigation} to={record ? `/app/ats/${record.id}` : preparationListPath(listNavigation, 'ats')}>Voltar</Link>} />
    <Feedback tone="info">Salvar esta preparação não autoriza a atividade nem libera uma PT.</Feedback>
    {Boolean(refreshError) && <Feedback tone="warning">Não foi possível atualizar a consulta. Seu preenchimento local foi preservado. {authorizationError(refreshError)} <Button variant="secondary" disabled={busy} onClick={retryReferences}>Atualizar referências da AT</Button></Feedback>}
    {!editable && <Feedback tone="warning">A preparação desta AT está preservada e já não permite edição. Seu preenchimento local permanece visível para conferência.</Feedback>}
    {!record && <section className="panel"><Field label="Atendimento da AT *"><select value={selectedId} disabled={busy} onChange={event => selectAppointment(event.target.value)}><option value="">Selecione um atendimento confirmado ou aberto</option>{options.filter(item => item.appointment.unitId === unitId && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(item.appointment.status)).map(item => <option key={item.appointment.id} value={item.appointment.id}>{item.appointment.code} · {item.appointment.serviceLabel} · {item.appointment.teamName}</option>)}</select></Field>{!options.length && <p className="muted">Nenhum atendimento confirmado disponível nesta unidade.</p>}</section>}
    {appointment && <><AuthorizationAppointment appointment={appointment} /><form className="panel stack" onSubmit={form.handleSubmit(save)} noValidate aria-label="Preparação da AT">
      {failure !== undefined && <Feedback tone="danger">{authorizationError(failure)}</Feedback>}
      {conflict && <Feedback tone="warning">Seu preenchimento foi mantido. <Button disabled={busy} variant="secondary" onClick={() => void checkCurrent()}>Conferir AT atual</Button></Feedback>}
      {latest && <section className="stack" aria-label="Conferência da AT atual"><h2>AT atual · revisão {latest.revision}</h2><p>Estado: {latest.status}. Preparação registrada: {latest.preparation.identification.activityDescription || 'Ainda não preenchida'}.</p><div className="actions"><Button disabled={busy || latest.status !== 'DRAFT' || !latest.availableActions.includes('EDIT')} variant="secondary" onClick={() => adopt(latest, true)}>Usar revisão atual e manter preenchimento</Button><Button disabled={busy} variant="ghost" onClick={() => adopt(latest)}>Carregar AT atual e descartar preenchimento</Button></div></section>}
      <fieldset className={styles.fieldset} disabled={busy || Boolean(latest) || !editable}><legend>Identificação e preparação</legend><div className="form-grid">
        <Field label="PT vinculada (opcional)" error={errors.permitId?.message}><select {...form.register('permitId')}><option value="">Sem PT vinculada</option>{selectedOption?.permits.map(permit => <option key={permit.id} value={permit.id}>{permit.code}</option>)}{record?.permitId && !selectedOption?.permits.some(item => item.id === record.permitId) && <option value={record.permitId}>{record.permitCode || 'PT vinculada'}</option>}</select></Field>
        <Field label="Encarregado da equipe" error={errors.foremanId?.message}><select {...form.register('foremanId')}><option value="">Selecione um participante</option>{appointment.participants.map(person => <option key={person.workerId} value={person.workerId}>{person.name}</option>)}</select></Field>
        {(Object.keys(identificationLabels) as (keyof typeof identificationLabels)[]).map(key => <Field key={key} label={identificationLabels[key]} error={errors.identification?.[key]?.message}>{key === 'activityDescription' || key === 'notes' ? <textarea {...form.register(`identification.${key}`)} maxLength={2000} rows={3} /> : <input {...form.register(`identification.${key}`)} maxLength={2000} />}</Field>)}
      </div></fieldset>
      <fieldset className={styles.fieldset} disabled={busy || Boolean(latest) || !editable}><legend>Controles gerais do modelo · {values.controls.length} selecionados</legend><div className={styles.selection}>{AT_CONTROLS.map(control => <label className={styles.check} key={control.id}><input type="checkbox" checked={values.controls.includes(control.id)} onChange={event => form.setValue('controls', event.target.checked ? [...values.controls, control.id] : values.controls.filter(id => id !== control.id), { shouldDirty: true })} />{control.label}</label>)}</div></fieldset>
      <Field label="Controles adicionais" error={errors.additionalControls?.message}><textarea {...form.register('additionalControls')} maxLength={4000} disabled={busy || Boolean(latest) || !editable} /></Field>
      <div><h2>Verificações do modelo</h2><p className="muted">Responda as 11 questões antes de autorizar. Não e Não aplicável exigem justificativa; a comunicação entre envolvidos sempre exige um registro.</p></div>
      <AuthorizationSourceChecks checks={values.checks} prefix="at-preparation" disabled={busy || Boolean(latest) || !editable} onChange={checks => form.setValue('checks', checks, { shouldDirty: true })} />
      <small className={styles.hash}>Origem: {AT_SOURCE.sourceId} · revisão {AT_SOURCE.sourceRevision}. As questões sobre comunicação de emergência e composição/liderança usam rótulos adaptados; os textos originais permanecem no catálogo de origem.</small>
      {!appointmentAvailable && <Feedback tone="warning">Este atendimento já não está confirmado ou aberto nesta unidade. Seu preenchimento foi preservado.</Feedback>}
      <div className="actions"><Button type="submit" disabled={busy || conflict || Boolean(latest) || !referencesVerified || !appointmentAvailable || !editable}>{saving ? 'Salvando…' : 'Salvar rascunho da AT'}</Button><Link className="button button--secondary" state={listNavigation} to={record ? `/app/ats/${record.id}` : preparationListPath(listNavigation, 'ats')}>Cancelar preenchimento</Link></div>
    </form></>}
  </div>;
}
