import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AppointmentDto, AppointmentWriteDto, ParticipantDto, PermitOptionsDto } from '../../shared/contracts/work-permits';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { appointmentFormSchema, appointmentInstant, errorMessage, participantError, type AppointmentFormValues } from './support';
import styles from './Agenda.module.css';

export function AppointmentFormPage() {
  const { sessionKey, unitId, can } = useSession();
  const options = useQuery({ queryKey: ['permit-options', sessionKey, unitId], queryFn: ({ signal }) => api.get<PermitOptionsDto>('/permit-options', { signal, query: { unitId } }), enabled: can('appointments.write') && Boolean(unitId) });
  if (!can('appointments.write')) return <EmptyState title="Acesso restrito" description="Seu perfil não pode agendar serviços." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade antes de agendar um serviço." />;
  if (options.isPending) return <Spinner />;
  if (options.isError && !options.data) return <div className="panel stack"><Feedback tone="danger">{errorMessage(options.error)}</Feedback><Button variant="secondary" onClick={() => void options.refetch()}>Tentar novamente</Button></div>;
  if (!options.data || !unitId) return <EmptyState title="Selecione uma unidade" />;
  return <AppointmentForm options={options.data} unitId={unitId} key={`${sessionKey}-${unitId}`} />;
}

function AppointmentForm({ options, unitId }: { options: PermitOptionsDto; unitId: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [participantMessage, setParticipantMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const lastRequest = useRef<{ payload: string; key: string } | undefined>(undefined);
  const form = useForm<AppointmentFormValues>({ resolver: zodResolver(appointmentFormSchema), defaultValues: { teamId: '', serviceTypeId: '', serviceTypeIds: [], responsibleId: '', location: '', startsAt: '', endsAt: '', notes: '' } });
  const selectedTeam = options.teams.find(team => team.id === form.watch('teamId') && team.unitId === unitId);
  const selectedServices = form.watch('serviceTypeIds') || [];
  const unavailableServices = selectedServices.filter(id => !options.services.some(service => service.id === id));
  const error = (name: keyof AppointmentFormValues) => form.formState.errors[name]?.message;
  async function submit(value: AppointmentFormValues) {
    setSaveError(''); setParticipantMessage('');
    const serviceTypeIds = value.serviceTypeIds || [];
    if (!serviceTypeIds.length || serviceTypeIds.some(id => !options.services.some(service => service.id === id))) { form.setError('serviceTypeIds', { type: 'validate', message: 'Selecione serviços disponíveis para esta unidade.' }); return; }
    const message = participantError(participants, value.teamId, unitId, options);
    if (message) { setParticipantMessage(message); return; }
    if (!options.responsibles.some(responsible => responsible.id === value.responsibleId)) { setSaveError('Selecione um responsável disponível para esta unidade.'); return; }
    const payload: AppointmentWriteDto = { ...value, serviceTypeIds, serviceTypeId: serviceTypeIds[0], unitId, startsAt: appointmentInstant(value.startsAt)!, endsAt: appointmentInstant(value.endsAt)!, participants: participants.map(person => ({ ...person, serviceFunction: person.serviceFunction.trim() })) };
    const serialized = JSON.stringify(payload);
    if (lastRequest.current?.payload !== serialized) lastRequest.current = { payload: serialized, key: crypto.randomUUID() };
    try {
      const saved = await api.post<AppointmentDto>('/appointments', payload, { idempotencyKey: lastRequest.current.key });
      if (saved.unitId !== unitId) throw new Error('O agendamento retornado pertence a outra unidade. Seu preenchimento foi preservado.');
      await client.invalidateQueries({ queryKey: ['appointments'] });
      await client.invalidateQueries({ queryKey: ['permit-dashboard'] });
      navigate(`/app/agenda/${saved.id}`, { state: { success: 'Serviço agendado. Confira as pendências antes da execução.' } });
    } catch (failure) { setSaveError(errorMessage(failure)); }
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
    <UnsavedChanges dirty={form.formState.isDirty || participants.length > 0} busy={form.formState.isSubmitting} protectContext />
    <PageHeader eyebrow="Agenda de serviços" title="Agendar serviço" description="Reúna os serviços do atendimento e defina a função que cada pessoa vai exercer." actions={<Link className="button button--secondary" to="/app/agenda">Voltar à agenda</Link>} />
    <Feedback>É possível agendar com documentos pendentes. A conferência documental, o checklist e as ciências serão exigidos antes da liberação na PT.</Feedback>
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError && <Feedback tone="danger">{saveError}</Feedback>}
      <fieldset className={`stack ${styles.formFields}`} disabled={form.formState.isSubmitting} aria-label="Dados do agendamento">
      <input type="hidden" {...form.register('serviceTypeId')} />
      <div className="form-grid">
        <Field label="Equipe *" error={error('teamId')}><select {...form.register('teamId')} onChange={event => { form.setValue('teamId', event.target.value, { shouldDirty: true }); setParticipants([]); setParticipantMessage(''); }}><option value="">Selecione a equipe</option>{options.teams.filter(team => team.unitId === unitId).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field>
        <Field label="Local do serviço *" error={error('location')}><input maxLength={200} placeholder="Ex.: Galpão A, acesso à cobertura" {...form.register('location')} /></Field>
        <Field label="Responsável pelo atendimento *" error={error('responsibleId')}><select {...form.register('responsibleId')}><option value="">Selecione o responsável</option>{options.responsibles.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
        <Field label="Início previsto *" error={error('startsAt')}><input type="datetime-local" {...form.register('startsAt')} /></Field>
        <Field label="Término previsto *" error={error('endsAt')}><input type="datetime-local" {...form.register('endsAt')} /></Field>
      </div>
      <p className={styles.legend}>Datas e horas no fuso de Brasília (America/Sao_Paulo).</p>
      <fieldset className={styles.serviceFields} aria-describedby="appointment-services-help appointment-services-error">
        <legend>Serviços do atendimento *</legend>
        <p id="appointment-services-help" className="muted">Selecione um ou mais serviços. Os requisitos documentais e os checklists serão reunidos para o atendimento.</p>
        <div className={styles.serviceChoices}>{options.services.map(service => <div className={`${styles.serviceChoice} ${selectedServices.includes(service.id) ? styles.serviceSelected : ''}`} key={service.id}>
          <label className={styles.checkLabel}><input type="checkbox" checked={selectedServices.includes(service.id)} disabled={!selectedServices.includes(service.id) && selectedServices.length >= 7} aria-describedby={`appointment-service-${service.id}`} aria-invalid={Boolean(error('serviceTypeIds') || error('serviceTypeId'))} onChange={event => toggleService(service.id, event.target.checked)} />{service.name}</label>
          <div id={`appointment-service-${service.id}`} className={styles.serviceDescription}>{service.description && <p>{service.description}</p>}<small>Checklist v{service.templateVersion} · Requisitos v{service.requirementVersion}</small></div>
        </div>)}</div>
        {unavailableServices.length > 0 && <Feedback tone="warning">Um serviço selecionado deixou de estar disponível. Remova os serviços indisponíveis e confira a seleção antes de enviar.<div className="actions"><Button variant="secondary" onClick={() => setServices(selectedServices.filter(id => !unavailableServices.includes(id)))}>Remover serviços indisponíveis</Button></div></Feedback>}
        <p className={styles.legend} aria-live="polite">{selectedServices.length} serviço(s) selecionado(s) · Até sete serviços por atendimento.</p>
        <div id="appointment-services-error">{(error('serviceTypeIds') || error('serviceTypeId')) && <Feedback tone="danger">{error('serviceTypeIds') || error('serviceTypeId')}</Feedback>}</div>
      </fieldset>
      <div className="stack"><div><h2>Participantes e funções no serviço</h2><p className="muted">A função neste atendimento pode ser diferente do cargo do cadastro. Ela determina os requisitos aplicáveis à pessoa.</p></div>
        {!selectedTeam ? <p className="muted">Selecione a equipe para consultar os participantes.</p> : !selectedTeam.members.length ? <Feedback tone="warning">Esta equipe ainda não possui participantes disponíveis.</Feedback> : selectedTeam.members.map(person => {
          const participant = participants.find(item => item.workerId === person.workerId);
          return <div className={styles.participantChoice} key={person.workerId}><label className={styles.checkLabel}><input type="checkbox" checked={Boolean(participant)} onChange={event => toggleParticipant(person, event.target.checked)} />{person.name}</label><Field label={`Função de ${person.name} neste serviço`}><input maxLength={100} disabled={!participant} value={participant?.serviceFunction || ''} onChange={event => { setParticipants(current => current.map(item => item.workerId === person.workerId ? { ...item, serviceFunction: event.target.value } : item)); setParticipantMessage(''); }} placeholder="Informe a função no serviço" /></Field></div>;
        })}
        {participantMessage && <Feedback tone="danger">{participantMessage}</Feedback>}
      </div>
      <Field label="Observações do atendimento" error={error('notes')}><textarea maxLength={2000} {...form.register('notes')} placeholder="Orientações de acesso, contexto e observações necessárias." /></Field>
      </fieldset>
      <div className="actions"><Button type="submit" disabled={form.formState.isSubmitting || !options.teams.length || !options.services.length || !options.responsibles.length}>{form.formState.isSubmitting ? 'Agendando…' : 'Salvar agendamento'}</Button><Link className="button button--secondary" to="/app/agenda">Cancelar</Link></div>
    </form>
  </div>;
}
