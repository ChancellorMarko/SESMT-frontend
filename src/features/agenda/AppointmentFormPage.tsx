import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, AppointmentWriteDto, ParticipantDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { isRecord, scopedQueryError, shortText } from '../../shared/lib/scoped-page';
import { appointmentFormSchema, appointmentInstant, participantError, type AppointmentFormValues } from './support';
import styles from './Agenda.module.css';

class AppointmentReferenceError extends Error {
  constructor() { super('As opções retornadas não correspondem à unidade atual. Atualize a consulta; seu preenchimento foi preservado.'); }
}
const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value.trim()) && !/[\u0000-\u0020\u007f/?#\\]/.test(value);
const validParticipant = (value: unknown): value is ParticipantDto => isRecord(value) && identifier(value.workerId) && shortText(value.name, 500) && shortText(value.serviceFunction, 100);
const uniqueIds = (values: { id: string }[]) => new Set(values.map(value => value.id)).size === values.length;
const validInstant = (value: unknown): value is string => shortText(value, 100) && Number.isFinite(Date.parse(value));
function checkedOptions(value: unknown, unitId: string): PermitOptionsDto {
  if (!isRecord(value) || !Array.isArray(value.teams) || !Array.isArray(value.services) || !Array.isArray(value.responsibles)
    || value.teams.some(team => !isRecord(team) || !identifier(team.id) || team.unitId !== unitId || !identifier(team.companyId) || !identifier(team.chiefId)
      || !shortText(team.name, 500) || !Number.isSafeInteger(team.revision) || Number(team.revision) < 1 || !Array.isArray(team.members) || !team.members.every(validParticipant)
      || new Set(team.members.map(person => person.workerId)).size !== team.members.length || team.status !== undefined && team.status !== 'ACTIVE')
    || value.services.some(service => !isRecord(service) || !identifier(service.id) || !shortText(service.name, 500) || !shortText(service.description, 4000) || !shortText(service.templateVersion, 100) || !shortText(service.requirementVersion, 100))
    || value.responsibles.some(person => !isRecord(person) || !identifier(person.id) || !shortText(person.name, 500))
    || !uniqueIds(value.teams) || !uniqueIds(value.services) || !uniqueIds(value.responsibles)) throw new AppointmentReferenceError();
  return value as unknown as PermitOptionsDto;
}
function checkedReceipt(value: unknown, payload: AppointmentWriteDto, companyId: string): AppointmentDto {
  if (isRecord(value) && value.unitId !== payload.unitId) throw new Error('O agendamento retornado pertence a outra unidade. Seu preenchimento foi preservado.');
  if (!isRecord(value) || !identifier(value.id) || value.unitId !== payload.unitId || value.teamId !== payload.teamId || value.responsibleId !== payload.responsibleId
    || value.companyId !== undefined && value.companyId !== companyId || value.serviceTypeId !== payload.serviceTypeId
    || !Array.isArray(value.serviceTypeIds ?? [value.serviceTypeId]) || JSON.stringify(value.serviceTypeIds ?? [value.serviceTypeId]) !== JSON.stringify(payload.serviceTypeIds)
    || !validInstant(value.startsAt) || !validInstant(value.endsAt) || Date.parse(value.startsAt) !== Date.parse(payload.startsAt) || Date.parse(value.endsAt) !== Date.parse(payload.endsAt)
    || value.location !== payload.location || value.notes !== undefined && !shortText(value.notes, 2000) || (value.notes ?? '') !== (payload.notes ?? '')
    || !Array.isArray(value.participants) || !value.participants.every(validParticipant) || value.participants.length !== payload.participants.length
    || new Set(value.participants.map(person => person.workerId)).size !== value.participants.length
    || value.participants.some(person => !payload.participants.some(sent => sent.workerId === person.workerId && sent.serviceFunction === person.serviceFunction))
    || !shortText(value.code, 200) || !value.code.trim() || !shortText(value.teamName, 500) || !shortText(value.responsibleName, 500) || !shortText(value.serviceLabel, 2000)
    || !['REQUESTED', 'CONFIRMED', 'ATTENDANCE_OPENED', 'CANCELED'].includes(String(value.status)) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !Array.isArray(value.availableActions) || !value.availableActions.every(action => shortText(action, 200)) || !Array.isArray(value.history)
    || value.history.some(event => !isRecord(event) || !identifier(event.id) || !shortText(event.action, 200) || !shortText(event.actorName, 500) || !validInstant(event.occurredAt))) throw new Error('A resposta não corresponde ao agendamento enviado. Seu preenchimento foi preservado.');
  return value as unknown as AppointmentDto;
}
const deniedReferences = (error: unknown) => error instanceof AppointmentReferenceError || error instanceof ApiError && [401, 403, 404].includes(error.status);
const emptyOptions: PermitOptionsDto = { teams: [], services: [], responsibles: [] };

export function AppointmentFormPage() {
  const { sessionKey, unitId, can } = useSession();
  if (!can('appointments.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode agendar serviços." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade antes de agendar um serviço." />;
  return <AppointmentContext key={JSON.stringify([sessionKey, unitId, can('appointments.write')])} unitId={unitId} />;
}

function AppointmentContext({ unitId }: { unitId: string }) {
  const { sessionKey } = useSession(); const client = useQueryClient(); const admitted = useRef(false);
  const key = ['permit-options', sessionKey, unitId], denialKey = ['appointment-reference-denial', sessionKey, unitId];
  const denial = useQuery<{ error: unknown; revision: number } | null>({ queryKey: denialKey, enabled: false, queryFn: async () => null, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const options = useQuery({ queryKey: key, queryFn: async ({ signal }) => checkedOptions(await api.get<unknown>('/permit-options', { signal, query: { unitId } }), unitId), refetchOnMount: 'always' });
  const checked = useMemo(() => { try { return { data: options.data === undefined ? undefined : checkedOptions(options.data, unitId), error: undefined }; } catch (error) { return { data: undefined, error }; } }, [options.data, unitId]);
  const referenceError = options.error ?? checked.error;
  useEffect(() => { if (deniedReferences(referenceError)) client.setQueryData(denialKey, { error: referenceError, revision: client.getQueryState(key)?.dataUpdateCount || 0 }); }, [referenceError]);
  const fresh = Boolean(denial.data && !referenceError && options.isSuccess && !options.isFetching && (client.getQueryState(key)?.dataUpdateCount || 0) > denial.data.revision);
  useEffect(() => { if (fresh) client.setQueryData(denialKey, null); }, [client, fresh]);
  const blockedError = referenceError ?? (!fresh ? denial.data?.error : undefined);
  const available = !blockedError && checked.data;
  if (available) admitted.current = true;
  if (!admitted.current) return blockedError ? <div className="panel stack"><Feedback tone="danger">{scopedQueryError(blockedError, 'opções de agendamento')}</Feedback><Button variant="secondary" disabled={options.isFetching} onClick={() => void options.refetch()}>Tentar novamente</Button></div> : <Spinner />;
  return <AppointmentForm options={available || emptyOptions} unitId={unitId} referencesVerified={Boolean(available) && !options.isFetching} referenceError={blockedError} referencesFetching={options.isFetching} retryReferences={() => void options.refetch()} />;
}

function AppointmentForm({ options, unitId, referencesVerified, referenceError, referencesFetching, retryReferences }: { options: PermitOptionsDto; unitId: string; referencesVerified: boolean; referenceError: unknown; referencesFetching: boolean; retryReferences: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { sessionKey } = useSession();
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [participantMessage, setParticipantMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  const pendingRequest = useRef<AbortController | undefined>(undefined), active = useRef(true);
  const references = useRef({ options, referencesVerified }); references.current = { options, referencesVerified };
  useEffect(() => { active.current = true; return () => { active.current = false; pendingRequest.current?.abort(); }; }, []);
  const form = useForm<AppointmentFormValues>({ resolver: zodResolver(appointmentFormSchema), defaultValues: { teamId: '', serviceTypeId: '', serviceTypeIds: [], responsibleId: '', location: '', startsAt: '', endsAt: '', notes: '' } });
  const selectedTeam = options.teams.find(team => team.id === form.watch('teamId') && team.unitId === unitId);
  const selectedResponsible = form.watch('responsibleId');
  const selectedServices = form.watch('serviceTypeIds') || [];
  const unavailableServices = selectedServices.filter(id => !options.services.some(service => service.id === id));
  const error = (name: keyof AppointmentFormValues) => form.formState.errors[name]?.message;
  const busy = saving || form.formState.isSubmitting;
  async function submit(value: AppointmentFormValues) {
    if (!active.current || pendingRequest.current) return;
    setSaveError(''); setParticipantMessage('');
    if (!references.current.referencesVerified) { setSaveError('Atualize as opções antes de salvar. Seu preenchimento foi preservado.'); return; }
    const options = references.current.options;
    const serviceTypeIds = value.serviceTypeIds || [];
    if (!serviceTypeIds.length || serviceTypeIds.some(id => !options.services.some(service => service.id === id))) { form.setError('serviceTypeIds', { type: 'validate', message: 'Selecione serviços disponíveis para esta unidade.' }); return; }
    const message = participantError(participants, value.teamId, unitId, options);
    if (message) { setParticipantMessage(message); return; }
    if (!options.responsibles.some(responsible => responsible.id === value.responsibleId)) { setSaveError('Selecione um responsável disponível para esta unidade.'); return; }
    const payload: AppointmentWriteDto = { ...value, serviceTypeIds, serviceTypeId: serviceTypeIds[0], unitId, startsAt: appointmentInstant(value.startsAt)!, endsAt: appointmentInstant(value.endsAt)!, participants: participants.map(person => ({ ...person, serviceFunction: person.serviceFunction.trim() })) };
    const serialized = JSON.stringify(payload);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    const controller = new AbortController(); pendingRequest.current = controller; setSaving(true);
    function referencesStillAvailable() {
      const current = references.current;
      return current.referencesVerified && !participantError(payload.participants, payload.teamId, unitId, current.options)
        && current.options.teams.some(team => team.id === payload.teamId && team.companyId === options.teams.find(team => team.id === payload.teamId)!.companyId)
        && serviceTypeIds.every(id => current.options.services.some(service => service.id === id))
        && current.options.responsibles.some(person => person.id === payload.responsibleId);
    }
    try {
      const value = await api.post<unknown>('/appointments', payload, { idempotencyKey: lastRequest.current.key, signal: controller.signal });
      if (!active.current || controller.signal.aborted) return;
      const saved = checkedReceipt(value, payload, options.teams.find(team => team.id === payload.teamId)!.companyId);
      if (!referencesStillAvailable()) throw new Error('O envio retornou, mas as opções precisam ser conferidas novamente. Atualize as opções antes de repetir; seu preenchimento foi preservado.');
      await Promise.all(['appointments', 'permit-dashboard'].map(resource => client.invalidateQueries({ queryKey: [resource, sessionKey, unitId] })));
      if (!active.current || controller.signal.aborted) return;
      if (!referencesStillAvailable()) throw new Error('O agendamento pode ter sido registrado. Atualize as opções antes de continuar; seu preenchimento foi preservado.');
      navigate(`/app/agenda/${encodeURIComponent(saved.id)}`, { state: { success: 'Serviço agendado. Confira as pendências antes da execução.' } });
    } catch (failure) { if (active.current && !controller.signal.aborted) setSaveError(scopedQueryError(failure, 'agendamentos')); }
    finally { if (pendingRequest.current === controller) { pendingRequest.current = undefined; if (active.current) setSaving(false); } }
  }
  function toggleParticipant(person: ParticipantDto, selected: boolean) {
    setParticipants(current => selected ? [...current, { ...person }] : current.filter(item => item.workerId !== person.workerId)); setParticipantMessage('');
  }
  function toggleService(id: string, selected: boolean) {
    const next = selected ? [...new Set([...selectedServices, id])] : selectedServices.filter(value => value !== id);
    setServices(next);
  }
  function setServices(next: string[]) {
    form.setValue('serviceTypeIds', next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    form.setValue('serviceTypeId', next[0] || '', { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  }
  return <div className="stack">
    <UnsavedChanges dirty={form.formState.isDirty || participants.length > 0} busy={busy} protectContext />
    <PageHeader eyebrow="Agenda de serviços" title="Agendar serviço" description="Reúna os serviços do atendimento e defina a função que cada pessoa vai exercer." actions={<Link className="button button--secondary" to="/app/agenda">Voltar à agenda</Link>} />
    <Feedback>É possível agendar com documentos pendentes. A conferência documental, o checklist e as ciências serão exigidos antes da liberação na PT.</Feedback>
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError && <Feedback tone="danger">{saveError}</Feedback>}
      {!referencesVerified && <Feedback tone={referenceError ? 'danger' : 'info'}>{referenceError ? scopedQueryError(referenceError, 'opções de agendamento') : 'As opções estão sendo atualizadas.'} Seu preenchimento foi preservado. Confirme as opções antes de salvar.<div className="actions"><Button type="button" variant="secondary" disabled={busy || referencesFetching} onClick={retryReferences}>Atualizar opções</Button></div></Feedback>}
      <fieldset className={`stack ${styles.formFields}`} disabled={busy} aria-label="Dados do agendamento">
      <input type="hidden" {...form.register('serviceTypeId')} />
      <div className="form-grid">
        <Field label="Equipe *" error={error('teamId')}><select {...form.register('teamId')} value={form.watch('teamId')} disabled={!referencesVerified} onChange={event => { form.setValue('teamId', event.target.value, { shouldDirty: true }); setParticipants([]); setParticipantMessage(''); }}><option value="">Selecione a equipe</option>{form.watch('teamId') && !selectedTeam && <option value={form.watch('teamId')}>Equipe selecionada · confirme a disponibilidade</option>}{options.teams.filter(team => team.unitId === unitId).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>
        <Field label="Local do serviço *" error={error('location')}><input maxLength={200} placeholder="Ex.: Galpão A, acesso à cobertura" {...form.register('location')} /></Field>
        <Field label="Responsável pelo atendimento *" error={error('responsibleId')}><select {...form.register('responsibleId')} value={selectedResponsible} disabled={!referencesVerified}><option value="">Selecione o responsável</option>{selectedResponsible && !options.responsibles.some(person => person.id === selectedResponsible) && <option value={selectedResponsible}>Responsável selecionado · confirme a disponibilidade</option>}{options.responsibles.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
        <Field label="Início previsto *" error={error('startsAt')}><input type="datetime-local" {...form.register('startsAt')} /></Field>
        <Field label="Término previsto *" error={error('endsAt')}><input type="datetime-local" {...form.register('endsAt')} /></Field>
      </div>
      <p className={styles.legend}>Datas e horas no fuso de Brasília (America/Sao_Paulo).</p>
      <fieldset className={styles.serviceFields} disabled={!referencesVerified} aria-describedby="appointment-services-help appointment-services-error">
        <legend>Serviços do atendimento *</legend>
        <p id="appointment-services-help" className="muted">Selecione um ou mais serviços. Os requisitos documentais e os checklists serão reunidos para o atendimento.</p>
        <div className={styles.serviceChoices}>{options.services.map(service => <div className={`${styles.serviceChoice} ${selectedServices.includes(service.id) ? styles.serviceSelected : ''}`} key={service.id}>
          <label className={styles.checkLabel}><input type="checkbox" checked={selectedServices.includes(service.id)} disabled={!selectedServices.includes(service.id) && selectedServices.length >= 7} aria-describedby={`appointment-service-${service.id}`} aria-invalid={Boolean(error('serviceTypeIds') || error('serviceTypeId'))} onChange={event => toggleService(service.id, event.target.checked)} />{service.name}</label>
          <div id={`appointment-service-${service.id}`} className={styles.serviceDescription}>{service.description && <p>{service.description}</p>}<small>Checklist v{service.templateVersion} · Requisitos v{service.requirementVersion}</small></div>
        </div>)}</div>
        {referencesVerified && unavailableServices.length > 0 && <Feedback tone="warning">Um serviço selecionado deixou de estar disponível. Remova os serviços indisponíveis e confira a seleção antes de enviar.<div className="actions"><Button variant="secondary" onClick={() => setServices(selectedServices.filter(id => !unavailableServices.includes(id)))}>Remover serviços indisponíveis</Button></div></Feedback>}
        <p className={styles.legend} aria-live="polite">{selectedServices.length} serviço(s) selecionado(s) · Até sete serviços por atendimento.</p>
        <div id="appointment-services-error">{(error('serviceTypeIds') || error('serviceTypeId')) && <Feedback tone="danger">{error('serviceTypeIds') || error('serviceTypeId')}</Feedback>}</div>
      </fieldset>
      <div className="stack"><div><h2>Participantes e funções no serviço</h2><p className="muted">A função neste atendimento pode ser diferente do cargo do cadastro. Ela determina os requisitos aplicáveis à pessoa.</p></div>
        {!selectedTeam ? <p className="muted">Selecione a equipe para consultar os participantes.</p> : !selectedTeam.members.length ? <Feedback tone="warning">Esta equipe ainda não possui participantes disponíveis.</Feedback> : selectedTeam.members.map(person => {
          const participant = participants.find(item => item.workerId === person.workerId);
          return <div className={styles.participantChoice} key={person.workerId}><label className={styles.checkLabel}><input type="checkbox" checked={Boolean(participant)} onChange={event => toggleParticipant(person, event.target.checked)} />{person.name}</label><Field label={`Função de ${person.name} neste serviço`} required={Boolean(participant)}><input maxLength={100} disabled={!participant} value={participant?.serviceFunction || ''} onChange={event => { setParticipants(current => current.map(item => item.workerId === person.workerId ? { ...item, serviceFunction: event.target.value } : item)); setParticipantMessage(''); }} placeholder="Informe a função no serviço" /></Field></div>;
        })}
        {participantMessage && <Feedback tone="danger">{participantMessage}</Feedback>}
      </div>
      <Field label="Observações do atendimento" error={error('notes')}><textarea maxLength={2000} {...form.register('notes')} placeholder="Orientações de acesso, contexto e observações necessárias." /></Field>
      </fieldset>
      <div className="actions"><Button type="submit" disabled={busy || !referencesVerified || !options.teams.length || !options.services.length || !options.responsibles.length}>{busy ? 'Agendando…' : 'Salvar agendamento'}</Button><Link className="button button--secondary" to="/app/agenda">Cancelar</Link></div>
    </form>
  </div>;
}
