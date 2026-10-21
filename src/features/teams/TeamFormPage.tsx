import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { TeamDto } from '../../shared/contracts/work-permits';
import type { TeamOptionsDto } from '../../shared/contracts/teams';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { UnsavedChanges } from '../workers/UnsavedChanges';
import { teamErrorMessage, teamFormSchema, type TeamFormValues } from './validation';
import styles from './Teams.module.css';

export function TeamFormPage() {
  const { id } = useParams();
  const { can, sessionKey, unitId } = useSession();
  const allowed = can('teams.write') && can('teams.read');
  const options = useQuery({ queryKey: ['team-options', sessionKey, unitId], queryFn: ({ signal }) => api.get<TeamOptionsDto>('/team-options', { signal, query: { unitId } }), enabled: allowed && Boolean(unitId) });
  const team = useQuery({ queryKey: ['team', sessionKey, unitId, id], queryFn: ({ signal }) => api.get<TeamDto>(`/teams/${id}`, { signal }), enabled: allowed && Boolean(unitId) && Boolean(id), refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (!allowed) return <EmptyState title="Acesso restrito" description="O cadastro de equipes exige permissão de consulta e edição." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade de trabalho para cadastrar uma equipe." />;
  if (options.isPending || (id && team.isPending)) return <Spinner />;
  if (options.isError && !options.data || id && team.isError && !team.data) return <div className="panel stack"><Feedback tone="danger">{teamErrorMessage(options.error || team.error)}</Feedback><Button variant="secondary" onClick={() => { void options.refetch(); if (id) void team.refetch(); }}>Tentar novamente</Button></div>;
  if (team.data && team.data.unitId !== unitId) return <EmptyState title="Equipe de outra unidade" description="Selecione a unidade desta equipe para alterar o cadastro." />;
  if (!options.data) return null;
  if (options.data.unitId !== unitId) return <EmptyState title="Participantes de outra unidade" description="Atualize o contexto para consultar os participantes desta unidade." />;
  return <TeamForm key={`${sessionKey}-${unitId}-${id || 'new'}`} options={options.data} team={team.data} referencesVerified={!options.isError && !options.isFetching && (!id || !team.isError && !team.isFetching)} retryReferences={() => { void options.refetch(); if (id) void team.refetch(); }} />;
}

function TeamForm({ options, team, referencesVerified, retryReferences }: { options: TeamOptionsDto; team?: TeamDto; referencesVerified: boolean; retryReferences: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sessionKey, unitId } = useSession();
  const [saveError, setSaveError] = useState<unknown>();
  const [revision, setRevision] = useState(team?.revision);
  const [latest, setLatest] = useState<TeamDto>();
  const [latestError, setLatestError] = useState<unknown>();
  const [checking, setChecking] = useState(false);
  const [referenceUpdated, setReferenceUpdated] = useState(false);
  const pendingRequest = useRef<AbortController | null>(null);
  const lastCreation = useRef<{ payload: string; key: string } | undefined>(undefined);
  useEffect(() => () => { pendingRequest.current?.abort(); pendingRequest.current = null; }, []);
  const form = useForm<TeamFormValues>({ resolver: zodResolver(teamFormSchema), defaultValues: {
    name: team?.name || '', unitId: options.unitId, chiefId: team?.chiefId || '',
    members: team?.members.map(member => ({ workerId: member.workerId, serviceFunction: member.serviceFunction })) || [{ workerId: '', serviceFunction: 'Executante' }],
  } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'members' });
  const members = form.watch('members');
  const chiefId = form.watch('chiefId');
  const companyId = team?.companyId || options.workers.find(worker => worker.id === members.find(member => member.workerId)?.workerId)?.companyId;
  const available = options.workers.filter(worker => worker.unitId === unitId && (!companyId || worker.companyId === companyId));
  const conflict = saveError instanceof ApiError && [412, 428].includes(saveError.status);
  const busy = form.formState.isSubmitting || checking;

  async function submit(input: TeamFormValues) {
    if (pendingRequest.current || conflict || latest) return;
    setSaveError(undefined);
    setLatestError(undefined);
    setLatest(undefined);
    if (!referencesVerified) { setSaveError(new Error('Confirme as opções e a equipe atuais antes de salvar. Seu preenchimento foi preservado.')); return; }
    if (input.unitId !== unitId) { setSaveError(new Error('A unidade do formulário mudou. Confira o contexto antes de salvar.')); return; }
    const unavailable = input.members.findIndex(member => !available.some(worker => worker.id === member.workerId));
    if (unavailable >= 0) { form.setError(`members.${unavailable}.workerId`, { message: 'Selecione um trabalhador ativo e disponível nesta unidade e empresa.' }, { shouldFocus: true }); return; }
    const controller = new AbortController(); pendingRequest.current = controller;
    const payload = JSON.stringify(input);
    if (lastCreation.current?.payload !== payload) lastCreation.current = { payload, key: crypto.randomUUID() };
    try {
      const saved = team ? await api.patch<TeamDto>(`/teams/${team.id}`, input, { etag: revisionEtag(revision!), signal: controller.signal }) : await api.post<TeamDto>('/teams', input, { idempotencyKey: lastCreation.current.key, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (saved.unitId !== unitId || team && saved.id !== team.id || companyId && saved.companyId !== companyId) throw new Error('O serviço retornou uma equipe de outro contexto. Seu preenchimento foi preservado.');
      form.reset(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teams'] }),
        queryClient.invalidateQueries({ queryKey: ['team-options'] }),
        queryClient.invalidateQueries({ queryKey: ['permit-options'] }),
      ]);
      if (controller.signal.aborted) return;
      queryClient.setQueryData(['team', sessionKey, unitId, saved.id], saved);
      navigate('/app/equipes', { state: { success: team ? 'Equipe atualizada.' : 'Equipe cadastrada.' } });
    } catch (error) {
      if (controller.signal.aborted) return;
      setSaveError(error);
      if (error instanceof ApiError) error.fieldErrors?.forEach((item, index) => {
        if (['name', 'unitId', 'chiefId', 'members'].includes(item.field.split('.')[0])) form.setError(item.field as FieldPath<TeamFormValues>, { message: item.message }, { shouldFocus: index === 0 });
      });
    } finally { if (pendingRequest.current === controller) pendingRequest.current = null; }
  }
  async function checkLatest() {
    if (!team || pendingRequest.current) return;
    const controller = new AbortController(); pendingRequest.current = controller;
    setLatestError(undefined);
    setChecking(true);
    try {
      const current = await api.get<TeamDto>(`/teams/${team.id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (current.id !== team.id || current.unitId !== unitId || current.companyId !== team.companyId) throw new Error('A equipe consultada pertence a outro contexto. Seu preenchimento foi preservado.');
      setLatest(current);
    } catch (error) { if (!controller.signal.aborted) setLatestError(error); }
    finally { if (pendingRequest.current === controller) { pendingRequest.current = null; setChecking(false); } }
  }
  const missing = members.filter(member => member.workerId && !available.some(worker => worker.id === member.workerId));
  return <div className="stack">
    <UnsavedChanges protectContext dirty={form.formState.isDirty} busy={busy} />
    <PageHeader eyebrow="Equipes" title={team ? 'Editar equipe' : 'Nova equipe'} description="Selecione os participantes ativos da unidade e indique quem coordena a equipe." actions={<Link className="button button--secondary" to="/app/equipes">Voltar às equipes</Link>} />
    <form className="panel stack" onSubmit={form.handleSubmit(submit)} noValidate>
      {saveError !== undefined && <Feedback tone={conflict ? 'warning' : 'danger'}>{teamErrorMessage(saveError)}{conflict && <p><Button variant="secondary" onClick={() => void checkLatest()} disabled={busy}>{checking ? 'Consultando…' : 'Conferir versão atual'}</Button></p>}</Feedback>}
      {latestError !== undefined && <Feedback tone="danger">{teamErrorMessage(latestError)}</Feedback>}
      {latest && <section className="stack" aria-label="Versão atual da equipe"><h2>Cadastro atual · revisão {latest.revision}</h2><p><strong>{latest.name}</strong></p><ul>{latest.members.map(member => <li key={member.workerId}>{member.name} · {member.serviceFunction}{member.workerId === latest.chiefId ? ' · chefe' : ''}</li>)}</ul><Feedback tone="warning">Compare o cadastro atual com seu preenchimento. Ao manter seu preenchimento, o próximo salvamento substituirá a composição e o nome acima.</Feedback><div className="actions"><Button variant="secondary" onClick={() => { setRevision(latest.revision); setLatest(undefined); setSaveError(undefined); setReferenceUpdated(true); }}>Usar revisão atual e manter meu preenchimento</Button><Button variant="ghost" onClick={() => { form.reset({ name: latest.name, unitId: latest.unitId, chiefId: latest.chiefId, members: latest.members.map(member => ({ workerId: member.workerId, serviceFunction: member.serviceFunction })) }); setRevision(latest.revision); setLatest(undefined); setSaveError(undefined); setReferenceUpdated(false); }}>Carregar cadastro atual</Button></div></section>}
      {referenceUpdated && <Feedback tone="info">Referência de revisão atualizada. Seu preenchimento foi mantido para conferência e salvamento.</Feedback>}
      {!referencesVerified && <Feedback tone="warning">As opções estão sendo atualizadas ou não puderam ser confirmadas. Seu preenchimento foi preservado.<Button variant="secondary" onClick={retryReferences} disabled={busy}>Atualizar opções</Button></Feedback>}
      {team?.status === 'INACTIVE' && <Feedback tone="warning">Esta equipe está inativa. Alterar o cadastro não a reativa para novos agendamentos.</Feedback>}
      <Feedback tone="info">A composição atual será usada em novos agendamentos. Participantes e funções já registrados em agendamentos e PTs permanecem preservados.</Feedback>
      {missing.length > 0 && <Feedback tone="warning">Há participante(s) sem vínculo ativo disponível nesta unidade. Substitua ou remova essas pessoas antes de salvar.</Feedback>}
      <Field label="Nome da equipe *" error={form.formState.errors.name?.message}><input {...form.register('name')} maxLength={120} autoComplete="off" disabled={busy} /></Field>
      <section className="stack" aria-label="Participantes da equipe">
        <div className={styles.sectionHead}><div><h2>Participantes</h2><p className="muted">A função é uma referência para o serviço e deve ser conferida em cada agendamento.</p></div><Badge>{members.length} participante(s)</Badge></div>
        {!options.workers.length && <Feedback tone="warning">Não há trabalhadores ativos disponíveis nesta unidade. Confira o cadastro de trabalhadores antes de montar a equipe.</Feedback>}
        {typeof form.formState.errors.members?.message === 'string' && <Feedback tone="danger">{form.formState.errors.members.message}</Feedback>}
        {fields.map((field, index) => {
          const currentId = members[index]?.workerId;
          const current = available.find(worker => worker.id === currentId);
          const old = team?.members.find(member => member.workerId === currentId);
          return <fieldset className={styles.member} key={field.id}><legend>Participante {index + 1}</legend><div className="form-grid">
            <Field label={`Trabalhador ${index + 1} *`} error={form.formState.errors.members?.[index]?.workerId?.message}><select {...form.register(`members.${index}.workerId`)} disabled={busy} onChange={event => {
              form.setValue(`members.${index}.workerId`, event.target.value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
              if (!chiefId || chiefId === currentId) form.setValue('chiefId', event.target.value, { shouldDirty: true });
            }}><option value="">Selecione</option>{currentId && !current && <option value={currentId}>Indisponível: {old?.name || options.workers.find(worker => worker.id === currentId)?.name || 'trabalhador vinculado'}</option>}{available.filter(worker => worker.id === currentId || !members.some(member => member.workerId === worker.id)).map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></Field>
            <Field label={`Função do participante ${index + 1} *`} error={form.formState.errors.members?.[index]?.serviceFunction?.message}><input {...form.register(`members.${index}.serviceFunction`)} disabled={busy} maxLength={80} list="team-service-functions" placeholder="Ex.: Executante, Apoio" /></Field>
          </div><Button variant="ghost" disabled={busy} aria-label={`Remover participante ${index + 1}`} onClick={() => { if (chiefId === currentId) form.setValue('chiefId', '', { shouldDirty: true }); remove(index); }}>Remover participante</Button></fieldset>;
        })}
        <datalist id="team-service-functions"><option value="Executante" /><option value="Apoio" /></datalist>
        <Button variant="secondary" disabled={busy || members.length >= 100 || !available.some(worker => !members.some(member => member.workerId === worker.id))} onClick={() => append({ workerId: '', serviceFunction: 'Executante' })}>Adicionar participante</Button>
      </section>
      <Field label="Chefe da equipe *" error={form.formState.errors.chiefId?.message}><select {...form.register('chiefId')} value={chiefId} disabled={busy}><option value="">Selecione um participante</option>{members.filter((member, index) => member.workerId && members.findIndex(person => person.workerId === member.workerId) === index).map(member => <option key={member.workerId} value={member.workerId}>{options.workers.find(worker => worker.id === member.workerId)?.name || team?.members.find(person => person.workerId === member.workerId)?.name || 'Participante indisponível'}</option>)}</select></Field>
      <div className="actions"><Button type="submit" disabled={busy || conflict || Boolean(latest) || !referencesVerified || Boolean(missing.length) || !available.length}>{form.formState.isSubmitting ? 'Salvando…' : 'Salvar equipe'}</Button><Link className="button button--secondary" to="/app/equipes">Cancelar</Link></div>
    </form>
  </div>;
}
