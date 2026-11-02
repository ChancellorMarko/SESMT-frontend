import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { nativeId } from '../native-operations/contracts';
import { checkedNativePerson, loadNativeTeamPeople } from '../native-operations/directory';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedEditableTeam, checkedTeamContext, checkedTeamEditor, sameRoster, teamFields, teamReturnPage, type TeamScope } from './contracts';
import { NativeTeamRoster, type TeamPerson } from './NativeTeamRoster';

export function NativeTeamFormPage() {
  const { id } = useParams(), { sessionKey, unitId } = useSession();
  return <Workspace key={`${sessionKey}:${unitId}:${id ?? 'new'}`} id={id}/>;
}
function Workspace({ id }: { id?: string }) {
  const { me, unitId, sessionKey, can } = useSession(), navigate = useNavigate(), location = useLocation(), client = useQueryClient();
  const companyIds = me?.scope.companyIds ?? [], scope = { unitId: unitId ?? '', companyIds };
  const allowed = Boolean(me && !me.scope.ownOnly && can('equipe:ler') && can(id ? 'equipe:editar' : 'equipe:criar') && can('workers.read'));
  const validContext = Boolean(unitId && me?.scope.unitIds.includes(unitId) && companyIds.length && (!id || nativeId.safeParse(id).success));
  const action = id ? 'editar' : 'criar';
  const snapshot = useVerifiedRead({ queryKey: ['native-team-editor', sessionKey, unitId, id ?? 'new', companyIds], enabled: allowed && validContext,
    request: async signal => {
      const context = checkedTeamContext(await api.get<unknown>('/teams/management-context', { query: { locationId: unitId, action }, signal }), scope);
      const team = id ? checkedEditableTeam(await api.get<unknown>(`/teams/${id}`, { signal }), id, scope) : undefined;
      return { context, team, people: team ? await loadNativeTeamPeople(team, signal) : [] };
    }, validate: value => checkedTeamEditor(value, scope, id) });
  const returnState = { nativeTeamReturnTo: { unitId, sessionKey, page: teamReturnPage(location.state, unitId, sessionKey) } };
  return <div className="stack"><PageHeader title={id ? 'Editar equipe' : 'Nova equipe'}/>{!allowed ? <Feedback tone="warning">Seu acesso não permite esta operação com equipes.</Feedback>
    : !validContext ? <Feedback tone="warning">Selecione uma unidade autorizada para gerenciar a equipe.</Feedback>
    : snapshot.isError ? <Feedback tone="danger">Não foi possível conferir a equipe e seu contexto. Retorne à lista e atualize os dados.</Feedback>
    : snapshot.data ? <Editor initial={snapshot.data} scope={scope} refreshing={snapshot.isFetching} onClose={() => void navigate('/app/equipes', { replace: true, state: returnState })}
      onDone={async () => { await Promise.all(['native-teams', 'native-team-editor', 'native-creation-teams', 'native-team-people', 'native-agenda', 'native-dashboard'].map(key => client.invalidateQueries({ queryKey: [key, sessionKey] }))); void navigate('/app/equipes', { replace: true, state: { ...returnState, nativeTeamSaved: true } }); }}/>
    : snapshot.isPending ? <Spinner/> : null}</div>;
}

function Editor({ initial, scope, refreshing, onClose, onDone }: { initial: ReturnType<typeof checkedTeamEditor>; scope: TeamScope; refreshing: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  // Keep the original revision and selection when a background read sees a newer record.
  const [snapshot] = useState(initial), { context, team } = snapshot;
  const [name, setName] = useState(team?.name ?? ''), [description, setDescription] = useState(team?.description ?? '');
  const [chiefId, setChief] = useState(team?.chiefId ?? ''), [participants, setParticipants] = useState(team?.participantIds.filter(id => id !== team.chiefId) ?? []);
  const [people, setPeople] = useState<TeamPerson[]>(snapshot.people);
  const originalParticipants = team?.participantIds.filter(id => id !== team.chiefId) ?? [];
  const dirty = name !== (team?.name ?? '') || description !== (team?.description ?? '') || chiefId !== (team?.chiefId ?? '') || !sameRoster(participants, originalParticipants);
  async function perform(signal: AbortSignal) {
    const fields = teamFields(name, description, chiefId, participants);
    const freshContext = checkedTeamContext(await api.get<unknown>('/teams/management-context', { query: { locationId: scope.unitId, action: team ? 'editar' : 'criar' }, signal }), scope);
    if (JSON.stringify(freshContext) !== JSON.stringify(context)) throw new NativeContextConflict('O contexto da unidade foi alterado. Atualize os dados antes de salvar a equipe.');
    if (team) {
      const fresh = checkedEditableTeam(await api.get<unknown>(`/teams/${team.id}`, { signal }), team.id, scope);
      if (JSON.stringify(fresh) !== JSON.stringify(team)) throw new NativeContextConflict('A equipe foi alterada. Seus dados foram mantidos. Feche a janela e atualize a lista antes de salvar.');
    }
    const members = await Promise.all([chiefId, ...participants].map(async id => checkedNativePerson(await api.get<unknown>(`/workers/${id}`, { signal }), { id, companyId: context.companyId })));
    if (members.some(person => person.status !== 'ACTIVE')) throw new NativeFormError('Substitua o chefe ou remova os participantes com vínculo encerrado.');
    let value: unknown;
    try {
      value = team ? await api.patch<unknown>(`/teams/${team.id}`, { ...fields, clearDescription: fields.description === null, expectedVersion: team.version }, { signal, idempotencyKey: undefined })
        : await api.post<unknown>('/teams', { ...fields, organizationId: context.organizationId, companyId: context.companyId, localId: context.localId }, { signal, idempotencyKey: undefined });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'DUPLICATE') throw new NativeFormError('Já existe uma equipe com esse nome na organização. Escolha outro nome.');
      throw error;
    }
    const returnedId = team?.id ?? (value as { id?: string } | null)?.id;
    if (!returnedId) throw new InvalidReadResponse();
    const saved = checkedEditableTeam(value, returnedId, scope);
    if (saved.companyId !== context.companyId || saved.localId !== context.localId || saved.organizationId !== (team?.organizationId ?? context.organizationId)
      || saved.version !== (team ? team.version + 1 : 1) || saved.name !== fields.name || saved.description !== fields.description
      || saved.chiefId !== fields.chiefId || !sameRoster(saved.participantIds, fields.participantIds)) throw new InvalidReadResponse();
    const stored = checkedEditableTeam(await api.get<unknown>(`/teams/${saved.id}`, { signal }), saved.id, scope);
    if (JSON.stringify(stored) !== JSON.stringify(saved)) throw new InvalidReadResponse();
  }
  return <NativeCommandDialog title={team ? 'Editar equipe' : 'Cadastrar equipe'} dirty={dirty} disabled={refreshing || !dirty} submitLabel={team ? 'Salvar' : 'Cadastrar'} onClose={onClose} onDone={onDone} perform={perform}>{busy => <>
    <p>{context.companyName} · {context.localName}</p>
    <Field label="Nome da equipe" required><input maxLength={150} value={name} disabled={busy} onChange={e => setName(e.target.value)}/></Field>
    <Field label="Descrição"><textarea maxLength={1000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)}/></Field>
    <NativeTeamRoster context={context} initialPeople={snapshot.people} chiefId={chiefId} participants={participants} people={people} onPeople={setPeople} busy={busy}
      onChief={id => { setChief(id); setParticipants(current => current.filter(member => member !== id)); }} onParticipants={setParticipants}/>
  </>}</NativeCommandDialog>;
}
