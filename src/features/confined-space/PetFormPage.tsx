import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { ConfinedSpacePermitDto, PetAtmosphericReadingDto, PetOptionsDto, PetPersonDto, PetPreparationDto } from '../../shared/contracts/confined-space-permits';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { preparationListPath, preparationOrigin } from '../../shared/lib/preparation-navigation';
import { invalidateConsultation } from '../../shared/lib/consultation-cache';
import { appointmentInstant, appointmentLocal } from '../agenda/support';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { canonicalPetPreparation, createPetPreparation, PET_CONTROLS, PET_EQUIPMENT, petIdentificationLabels, petRoleLabels, preparationPending, validatePetPreparation } from './model';
import { PetAppointment, PetSourceChecks } from './PetFormCommon';
import { petError, petKey } from './support';
import styles from './confined-space.module.css';

function allowedAppointment(appointment: AppointmentDto, unitId?: string) {
  return appointment.unitId === unitId && ['CONFIRMED', 'ATTENDANCE_OPENED'].includes(appointment.status);
}
function verifiedRecord(record: ConfinedSpacePermitDto, unitId: string | undefined, expected: { id?: string; companyId?: string; appointmentId?: string; minimumRevision?: number; afterRevision?: number } = {}) {
  if (!record.id || expected.id && record.id !== expected.id || expected.companyId && record.companyId !== expected.companyId || record.unitId !== unitId || record.appointment.unitId !== unitId || expected.appointmentId && record.appointment.id !== expected.appointmentId || record.appointment.companyId && record.companyId !== record.appointment.companyId) throw new Error('A resposta pertence a outro registro ou unidade. Seu preenchimento foi preservado.');
  if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error('A revisão recebida é inválida. Seu preenchimento foi preservado.');
  if (expected.minimumRevision !== undefined && record.revision < expected.minimumRevision) throw new Error('A revisão recebida é anterior à preparação consultada. Seu preenchimento foi preservado.');
  if (expected.afterRevision !== undefined && record.revision <= expected.afterRevision) throw new Error('O salvamento não confirmou uma nova revisão. Seu preenchimento foi preservado.');
  return record;
}
export function PetFormPage() {
  const { id } = useParams(); const session = useSession(); const [search] = useSearchParams();
  const options = useQuery({ queryKey: ['confined-space-permit-options', session.sessionKey, session.unitId], queryFn: ({ signal }) => api.get<PetOptionsDto>('/confined-space-permit-options', { query: { unitId: session.unitId }, signal }), enabled: session.can('pet.write') && Boolean(session.unitId) && !id });
  const record = useQuery({ queryKey: petKey(session.sessionKey, session.unitId, id), queryFn: async ({ signal }) => verifiedRecord(await api.get<ConfinedSpacePermitDto>(`/confined-space-permits/${id}`, { query: { unitId: session.unitId }, signal }), session.unitId, { id }), enabled: session.can('pet.write') && Boolean(id && session.unitId), refetchOnWindowFocus: false });
  const context = `${session.sessionKey}:${session.unitId}:${id || 'new'}`;
  const admission = useRef({ context, opened: false });
  if (admission.current.context !== context) admission.current = { context, opened: false };
  const source = id ? record : options;
  if (source.isSuccess && !source.isFetching) admission.current.opened = true;
  if (!session.can('pet.write')) { admission.current.opened = false; return <EmptyState title="Acesso restrito" description="Seu perfil não pode preparar rascunhos de PET." />; }
  if (!session.unitId) { admission.current.opened = false; return <EmptyState title="Selecione uma unidade" />; }
  if (source.isPending || !admission.current.opened && source.isFetching) { admission.current.opened = false; return <Spinner />; }
  const failure = source.error;
  if (failure && !admission.current.opened) return <div className="panel stack"><Feedback tone="danger">{petError(failure)}</Feedback><Button variant="secondary" disabled={source.isFetching} onClick={() => void source.refetch()}>Tentar novamente</Button></div>;
  if (id && (!record.data || record.data.id !== id || record.data.unitId !== session.unitId || record.data.appointment.unitId !== session.unitId)) { admission.current.opened = false; return <EmptyState title="PET fora da unidade atual" />; }
  return <PetEditor key={context} record={id ? record.data : undefined} options={options.data?.appointments || []} initialAppointmentId={search.get('appointmentId') || undefined} refreshError={failure} refreshing={source.isFetching} retry={() => void source.refetch()} />;
}

function PetEditor({ record, options, initialAppointmentId, refreshError, refreshing, retry }: { record?: ConfinedSpacePermitDto; options: AppointmentDto[]; initialAppointmentId?: string; refreshError?: unknown; refreshing: boolean; retry: () => void }) {
  const { sessionKey, unitId } = useSession(); const client = useQueryClient(); const navigate = useNavigate(); const location = useLocation();
  const listNavigation = preparationOrigin(location.state, unitId, 'pets');
  const initial = options.find(item => item.id === initialAppointmentId && allowedAppointment(item, unitId));
  const [selectedId, setSelectedId] = useState(record?.appointment.id || initial?.id || '');
  const [reference, setReference] = useState(record); const [latest, setLatest] = useState<ConfinedSpacePermitDto>();
  const [values, setValues] = useState<PetPreparationDto>(() => record ? structuredClone(record.preparation) : createPetPreparation(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(values));
  const [failure, setFailure] = useState<unknown>(); const [saving, setSaving] = useState(false); const [checking, setChecking] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [participantId, setParticipantId] = useState(''); const [participantRole, setParticipantRole] = useState<PetPersonDto['role'] | ''>('');
  const active = useRef(true); const pendingRequest = useRef<AbortController | undefined>(undefined); const operationBusy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; pendingRequest.current?.abort(); }; }, []);
  const appointment = record?.appointment || options.find(item => item.id === selectedId);
  const busy = saving || checking; const dirty = JSON.stringify(values) !== baseline || Boolean(!record && selectedId);
  const consultationUnavailable = Boolean(refreshError) || refreshing;
  const editable = !reference || reference.status === 'DRAFT' && reference.availableActions.includes('EDIT');
  const failureStatus = (failure as { status?: number } | undefined)?.status;
  const conflict = reviewRequired || Boolean(reference && record?.revision !== reference.revision) || [412, 428].includes(failureStatus || 0);
  const locked = busy || Boolean(latest) || !editable;
  const pending = preparationPending(values);
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (event: Event) => {
      if (event.defaultPrevented) return;
      if (busy) { event.preventDefault(); setFailure(new Error('Aguarde a confirmação antes de mudar de unidade.')); }
      else if (!window.confirm('Há alterações da PET ainda não enviadas. Deseja trocar de unidade e descartá-las?')) event.preventDefault();
    };
    window.addEventListener('sesmt:before-context-change', guard);
    return () => window.removeEventListener('sesmt:before-context-change', guard);
  }, [dirty, busy]);
  function selectAppointment(value: string) {
    if (operationBusy.current || busy) return;
    if (dirty && !window.confirm('Trocar o atendimento descarta a preparação local da PET. Deseja continuar?')) return;
    const next = options.find(item => item.id === value && allowedAppointment(item, unitId));
    const preparation = createPetPreparation(next);
    setSelectedId(next?.id || ''); setValues(preparation); setBaseline(JSON.stringify(preparation)); setFailure(undefined); setParticipantId(''); setParticipantRole('');
  }
  function identification<K extends keyof PetPreparationDto['identification']>(key: K, value: string) {
    setValues(current => ({ ...current, identification: { ...current.identification, [key]: value } }));
  }
  function updatePerson(id: string, patch: Partial<PetPersonDto>) {
    setValues(current => ({ ...current, people: current.people.map(person => person.id === id ? { ...person, ...patch } : person) }));
  }
  function updateReading(id: string, patch: Partial<PetAtmosphericReadingDto>) {
    setValues(current => ({ ...current, atmosphere: current.atmosphere.map(reading => reading.id === id ? { ...reading, ...patch } : reading) }));
  }
  function localInstant(local: string) {
    if (!local) return '';
    const instant = appointmentInstant(local);
    if (!instant) { setFailure(new Error('Confira a data e hora informadas. Os horários usam o fuso de São Paulo.')); return undefined; }
    return instant;
  }
  function currentRevision() {
    const cached = reference && client.getQueryData<ConfinedSpacePermitDto>(petKey(sessionKey, unitId, reference.id));
    const revisions = [reference?.revision, record?.revision, cached && cached.id === reference?.id && cached.unitId === unitId ? cached.revision : undefined];
    return Math.max(0, ...revisions.filter((revision): revision is number => Number.isSafeInteger(revision) && (revision ?? 0) > 0));
  }
  async function checkCurrent() {
    if (!reference || operationBusy.current || busy) return;
    operationBusy.current = true; setChecking(true); setFailure(undefined);
    const controller = new AbortController(); pendingRequest.current = controller;
    try {
      const current = await api.get<ConfinedSpacePermitDto>(`/confined-space-permits/${reference.id}`, { signal: controller.signal, query: { unitId } });
      if (!active.current || controller.signal.aborted) return;
      verifiedRecord(current, unitId, { id: reference.id, companyId: reference.companyId, appointmentId: reference.appointment.id, minimumRevision: currentRevision() });
      setLatest(current);
    } catch (error) { if (active.current && !controller.signal.aborted) setFailure(error); }
    finally { operationBusy.current = false; if (active.current) setChecking(false); }
  }
  function adopt(current: ConfinedSpacePermitDto, keep: boolean) {
    if (busy) return;
    try { verifiedRecord(current, unitId, { id: reference?.id, companyId: reference?.companyId, appointmentId: reference?.appointment.id, minimumRevision: currentRevision() }); }
    catch (error) { setFailure(error); setReviewRequired(true); setLatest(undefined); return; }
    if (!keep && dirty && !window.confirm('Carregar a PET atual descarta seu preenchimento local. Deseja continuar?')) return;
    const preparation = structuredClone(current.preparation);
    if (!keep) setValues(preparation);
    setBaseline(JSON.stringify(preparation)); setReference(current); setLatest(undefined); setFailure(undefined); setReviewRequired(false);
    client.setQueryData(petKey(sessionKey, unitId, current.id), current);
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationBusy.current || busy || consultationUnavailable || conflict || latest || !editable || !appointment || !record && !allowedAppointment(appointment, unitId) || appointment.unitId !== unitId) return;
    const invalid = validatePetPreparation(values);
    if (invalid) { setFailure(new Error(invalid)); return; }
    const payload = canonicalPetPreparation(values);
    operationBusy.current = true; setSaving(true); setFailure(undefined);
    const controller = new AbortController(); pendingRequest.current = controller;
    try {
      const saved = reference ? await api.patch<ConfinedSpacePermitDto>(`/confined-space-permits/${reference.id}`, payload, { signal: controller.signal, etag: revisionEtag(reference.revision), query: { unitId } }) : await api.post<ConfinedSpacePermitDto>('/confined-space-permits', { appointmentId: appointment.id, ...payload }, { signal: controller.signal, query: { unitId } });
      if (!active.current || controller.signal.aborted) return;
      try { verifiedRecord(saved, unitId, { id: reference?.id, companyId: reference?.companyId || appointment.companyId, appointmentId: appointment.id, minimumRevision: currentRevision(), afterRevision: reference?.revision }); }
      catch (error) { if (reference) setReviewRequired(true); throw error; }
      client.setQueryData(petKey(sessionKey, unitId, saved.id), saved);
      void client.invalidateQueries({ queryKey: ['confined-space-permits', sessionKey, unitId] }); void client.invalidateQueries({ queryKey: ['confined-space-permit-options', sessionKey, unitId] });
      void invalidateConsultation(client, 'pets', { sessionKey, unitId });
      setValues(structuredClone(saved.preparation)); setBaseline(JSON.stringify(saved.preparation));
      navigate(`/app/pets/${saved.id}`, { state: { ...listNavigation, success: 'Rascunho da PET salvo. Este registro não autoriza a entrada.' } });
    } catch (error) { if (active.current && !controller.signal.aborted) { setFailure(error); if ([412, 428].includes((error as { status?: number })?.status || 0)) setReviewRequired(true); } }
    finally { operationBusy.current = false; if (active.current) setSaving(false); }
  }
  const returnPath = record ? `/app/pets/${record.id}` : preparationListPath(listNavigation, 'pets');
  return <div className="stack"><UnsavedChanges dirty={dirty} busy={busy} /><PageHeader eyebrow="PET · preparação" title={record ? `Preparar ${record.code}` : 'Preparar PET'} description="Organize a identificação do espaço confinado, as pessoas previstas e os registros do modelo recebido. O rascunho pode ser salvo incompleto." actions={<Link className="button button--secondary" aria-disabled={busy || undefined} to={returnPath} state={listNavigation}>Voltar</Link>} />
    <Feedback tone="info">Salvar o rascunho não autoriza entrada. A PET depende da avaliação e emissão pelos responsáveis.</Feedback>
    {Boolean(refreshError) && <Feedback tone="warning">Não foi possível atualizar a consulta. Seu preenchimento local foi preservado. Confira os dados antes de salvar novamente. {petError(refreshError)} <Button variant="secondary" disabled={busy || refreshing} onClick={retry}>Tentar atualizar consulta</Button></Feedback>}
    {refreshing && <p role="status">Conferindo os dados da preparação antes de permitir o salvamento…</p>}
    {!record && <section className="panel stack"><Field label="Atendimento da PET *"><select disabled={busy} value={selectedId} onChange={event => selectAppointment(event.target.value)}><option value="">Selecione um atendimento confirmado ou aberto</option>{options.filter(item => allowedAppointment(item, unitId)).map(item => <option key={item.id} value={item.id}>{item.code} · {item.serviceLabel} · {item.teamName}</option>)}</select></Field>{!options.some(item => allowedAppointment(item, unitId)) && <p className="muted">Nenhum atendimento confirmado ou aberto disponível nesta unidade.</p>}</section>}
    {appointment && <><PetAppointment appointment={appointment} /><form className="panel stack" aria-label="Preparação da PET" onSubmit={event => void save(event)} noValidate>
      {failure !== undefined && <Feedback tone="danger">{petError(failure)}</Feedback>}
      {!editable && <Feedback tone="warning">Este registro já não permite edição. Seu preenchimento local permanece visível para conferência.</Feedback>}
      {conflict && <Feedback tone="warning">Seu preenchimento foi mantido. Confira a revisão atual antes de enviar novamente. <Button variant="secondary" disabled={busy} onClick={() => void checkCurrent()}>Conferir PET atual</Button></Feedback>}
      {latest && <section className="stack" aria-label="Conferência da PET atual"><h2>PET atual · revisão {latest.revision}</h2><p>Tarefa registrada: {latest.preparation.identification.task || 'Ainda não preenchida'}. Código do espaço: {latest.preparation.identification.spaceCode || 'Ainda não preenchido'}.</p><div className="actions"><Button variant="secondary" disabled={busy || latest.status !== 'DRAFT' || !latest.availableActions.includes('EDIT')} onClick={() => adopt(latest, true)}>Usar revisão atual e manter preenchimento</Button><Button variant="ghost" disabled={busy} onClick={() => adopt(latest, false)}>Carregar PET atual e descartar preenchimento</Button></div></section>}
      <fieldset className={styles.fieldset} disabled={locked}><legend>Identificação do espaço e da tarefa</legend><div className="form-grid">
        {(Object.keys(petIdentificationLabels) as (keyof PetPreparationDto['identification'])[]).map(key => <Field label={petIdentificationLabels[key]} key={key}>{key === 'plannedStartAt' || key === 'plannedEndAt' ? <input type="datetime-local" step={60} value={appointmentLocal(values.identification[key])} onChange={event => { const value = localInstant(event.target.value); if (value !== undefined) identification(key, value); }} /> : ['spaceDescription', 'task', 'hazards', 'entryHazards', 'energyIsolation', 'notes'].includes(key) ? <textarea value={values.identification[key]} maxLength={2000} rows={3} onChange={event => identification(key, event.target.value)} /> : <input value={values.identification[key]} maxLength={2000} onChange={event => identification(key, event.target.value)} />}</Field>)}
      </div><p className={styles.help}>As datas usam o horário de São Paulo. O período planejado é um registro de preparação.</p></fieldset>
      <fieldset className={styles.fieldset} disabled={locked}><legend>Pessoas e papéis previstos</legend><p className="muted">Registre quem está previsto para cada papel. Nomes digitados são declarações de preparação; não representam ciência ou assinatura.</p>
        <div className="form-grid"><Field label="Participante do atendimento"><select value={participantId} onChange={event => setParticipantId(event.target.value)}><option value="">Selecione a pessoa cadastrada</option>{appointment.participants.filter(person => !values.people.some(item => item.workerId === person.workerId)).map(person => <option key={person.workerId} value={person.workerId}>{person.name} · {person.serviceFunction}</option>)}</select></Field><Field label="Papel previsto para o participante"><select value={participantRole} onChange={event => setParticipantRole(event.target.value as PetPersonDto['role'] | '')}><option value="">Selecione o papel previsto</option>{Object.entries(petRoleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></Field></div>
        <div className="actions"><Button variant="secondary" disabled={!participantId || !participantRole || values.people.length >= 100} onClick={() => {
          const person = appointment.participants.find(item => item.workerId === participantId);
          if (!person || !participantRole || values.people.some(item => item.workerId === person.workerId)) return;
          setValues(current => ({ ...current, people: [...current.people, { id: crypto.randomUUID(), workerId: person.workerId, name: person.name, registration: '', serviceFunction: person.serviceFunction, role: participantRole }] })); setParticipantId(''); setParticipantRole('');
        }}>Adicionar participante cadastrado</Button></div>
        <div className={styles.repeatable}>{values.people.map((person, index) => <fieldset className={styles.fieldset} key={person.id}><legend>Pessoa {index + 1}</legend><div className="form-grid">
        <Field label={`Nome da pessoa ${index + 1}`}><input value={person.name} maxLength={200} readOnly={Boolean(person.workerId)} onChange={event => updatePerson(person.id, { name: event.target.value })} /></Field>
        <Field label={`Matrícula da pessoa ${index + 1}`}><input value={person.registration} maxLength={100} readOnly={Boolean(person.workerId)} onChange={event => updatePerson(person.id, { registration: event.target.value })} /></Field>
        <Field label={`Função no serviço da pessoa ${index + 1}`}><input value={person.serviceFunction} maxLength={200} onChange={event => updatePerson(person.id, { serviceFunction: event.target.value })} /></Field>
        <Field label={`Papel previsto da pessoa ${index + 1}`}><select value={person.role} onChange={event => updatePerson(person.id, { role: event.target.value as PetPersonDto['role'] })}>{Object.entries(petRoleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></Field>
      </div>{person.workerId && <small className={styles.help}>Pessoa vinculada ao cadastro do atendimento. Nome e matrícula são conferidos ao salvar.</small>}<div className="actions"><Button variant="ghost" aria-label={`Remover pessoa ${index + 1}`} onClick={() => setValues(current => ({ ...current, people: current.people.filter(item => item.id !== person.id) }))}>Remover pessoa</Button></div></fieldset>)}</div><div className="actions"><Button variant="secondary" disabled={values.people.length >= 100} onClick={() => setValues(current => ({ ...current, people: [...current.people, { id: crypto.randomUUID(), name: '', registration: '', serviceFunction: '', role: 'ENTRANT' }] }))}>Adicionar pessoa prevista</Button></div></fieldset>
      <fieldset className={styles.fieldset} disabled={locked}><legend>Equipamentos previstos · {values.equipment.length} selecionados</legend><div className={styles.selection}>{PET_EQUIPMENT.map(item => <label className={styles.check} key={item.id}><input type="checkbox" checked={values.equipment.includes(item.id)} onChange={event => setValues(current => ({ ...current, equipment: event.target.checked ? [...current.equipment, item.id] : current.equipment.filter(value => value !== item.id) }))} />{item.label}</label>)}</div></fieldset>
      <fieldset className={styles.fieldset} disabled={locked}><legend>Controles previstos · {values.controls.length} selecionados</legend><div className={styles.selection}>{PET_CONTROLS.map(item => <label className={styles.check} key={item.id}><input type="checkbox" checked={values.controls.includes(item.id)} onChange={event => setValues(current => ({ ...current, controls: event.target.checked ? [...current.controls, item.id] : current.controls.filter(value => value !== item.id) }))} />{item.label}</label>)}</div><Field label="Controles adicionais"><textarea value={values.additionalControls} maxLength={4000} rows={3} onChange={event => setValues(current => ({ ...current, additionalControls: event.target.value }))} /></Field></fieldset>
      <div><h2>Verificações do modelo</h2><p className="muted">Registre as respostas e as justificativas para Não ou Não aplicável. Pendências podem permanecer no rascunho.</p></div><PetSourceChecks checks={values.checks} disabled={locked} onChange={checks => setValues(current => ({ ...current, checks }))} />
      <fieldset className={styles.fieldset} disabled={locked}><legend>Registros de avaliação atmosférica</legend><p className="muted">Transcreva leituras realizadas, instrumento, horário e responsável. O sistema não interpreta resultados nem define condições de entrada.</p><div className={styles.repeatable}>{values.atmosphere.map((reading, index) => <fieldset className={styles.fieldset} key={reading.id}><legend>Leitura {index + 1}</legend><div className="form-grid">
        <Field label={`Etapa da leitura ${index + 1}`}><select value={reading.phase} onChange={event => updateReading(reading.id, { phase: event.target.value as PetAtmosphericReadingDto['phase'] })}><option value="INITIAL">Avaliação inicial</option><option value="FOLLOW_UP">Acompanhamento</option></select></Field>
        <Field label={`Data e hora da leitura ${index + 1}`}><input type="datetime-local" step={60} value={appointmentLocal(reading.measuredAt)} onChange={event => { const value = localInstant(event.target.value); if (value !== undefined) updateReading(reading.id, { measuredAt: value }); }} /></Field>
        <Field label={`Instrumento da leitura ${index + 1}`}><input value={reading.instrument} maxLength={200} onChange={event => updateReading(reading.id, { instrument: event.target.value })} /></Field>
        <Field label={`Responsável pela leitura ${index + 1}`}><input value={reading.responsibleName} maxLength={200} onChange={event => updateReading(reading.id, { responsibleName: event.target.value })} /></Field>
        <Field label={`Oxigênio (%) da leitura ${index + 1}`}><input inputMode="decimal" value={reading.oxygenPercent} maxLength={40} onChange={event => updateReading(reading.id, { oxygenPercent: event.target.value })} /></Field>
        <Field label={`Monóxido de carbono (ppm) da leitura ${index + 1}`}><input inputMode="decimal" value={reading.carbonMonoxidePpm} maxLength={40} onChange={event => updateReading(reading.id, { carbonMonoxidePpm: event.target.value })} /></Field>
        <Field label={`Inflamabilidade (% LIE) da leitura ${index + 1}`}><input inputMode="decimal" value={reading.flammabilityPercentLel} maxLength={40} onChange={event => updateReading(reading.id, { flammabilityPercentLel: event.target.value })} /></Field>
        <Field label={`Outro agente da leitura ${index + 1}`}><input value={reading.otherAgent} maxLength={200} onChange={event => updateReading(reading.id, { otherAgent: event.target.value })} /></Field>
        <Field label={`Valor do outro agente da leitura ${index + 1}`}><input inputMode="decimal" value={reading.otherValue} maxLength={40} onChange={event => updateReading(reading.id, { otherValue: event.target.value })} /></Field>
        <Field label={`Unidade do outro agente da leitura ${index + 1}`}><input value={reading.otherUnit} maxLength={40} onChange={event => updateReading(reading.id, { otherUnit: event.target.value })} /></Field>
        <Field label={`Observações da leitura ${index + 1}`}><textarea value={reading.notes} maxLength={1000} rows={2} onChange={event => updateReading(reading.id, { notes: event.target.value })} /></Field>
      </div><div className="actions"><Button variant="ghost" aria-label={`Remover leitura ${index + 1}`} onClick={() => setValues(current => ({ ...current, atmosphere: current.atmosphere.filter(item => item.id !== reading.id) }))}>Remover leitura</Button></div></fieldset>)}</div><div className="actions"><Button variant="secondary" disabled={values.atmosphere.length >= 100} onClick={() => setValues(current => ({ ...current, atmosphere: [...current.atmosphere, { id: crypto.randomUUID(), phase: current.atmosphere.length ? 'FOLLOW_UP' : 'INITIAL', measuredAt: '', instrument: '', responsibleName: '', oxygenPercent: '', carbonMonoxidePpm: '', flammabilityPercentLel: '', otherAgent: '', otherValue: '', otherUnit: '', notes: '' }] }))}>Adicionar leitura atmosférica</Button></div></fieldset>
      <section className="stack" aria-label="Pendências da preparação"><h2>Pendências de preenchimento</h2>{pending.length ? <><p className="muted">{pending.length} itens ainda precisam de registro. Você pode salvar e continuar depois.</p><details><summary className={styles.summary}>Conferir pendências</summary><ul>{pending.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></details></> : <p className="muted">Os registros de preparação foram preenchidos. Este rascunho continua sem autorizar entrada.</p>}</section>
      <div className="actions"><Link className="button button--secondary" aria-disabled={busy || undefined} to={returnPath} state={listNavigation}>Cancelar preenchimento</Link><Button type="submit" disabled={busy || consultationUnavailable || conflict || Boolean(latest) || !editable || !record && !allowedAppointment(appointment, unitId)}>{saving ? 'Salvando…' : 'Salvar rascunho da PET'}</Button></div>
    </form></>}
  </div>;
}
