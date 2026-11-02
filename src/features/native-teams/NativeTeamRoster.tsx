import { useState } from 'react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, Spinner } from '../../shared/ui';
import { checkedNativePeople } from '../native-operations/directory';
import type { TeamContext } from './contracts';
import styles from './NativeTeams.module.css';

export type TeamPerson = ReturnType<typeof checkedNativePeople>['items'][number];
export function NativeTeamRoster({ context, initialPeople, chiefId, participants, onChief, onParticipants, busy, people, onPeople }: {
  context: TeamContext; initialPeople: TeamPerson[]; chiefId: string; participants: string[]; onChief: (id: string) => void; onParticipants: (ids: string[]) => void;
  busy: boolean; people: TeamPerson[]; onPeople: (records: TeamPerson[]) => void;
}) {
  const { sessionKey } = useSession(), [q, setQ] = useState(''), [search, apply] = useState(''), [page, setPage] = useState(1);
  const lookup = useVerifiedRead({ queryKey: ['native-team-editor-lookup', sessionKey, context.localId, context.companyId, search, page], scope: ['native-team-editor-lookup', sessionKey, context.localId], enabled: true,
    request: signal => api.get<unknown>('/workers', { query: { unitId: context.localId, companyId: context.companyId, status: 'ACTIVE', q: search || undefined, page, pageSize: 20 }, signal }),
    validate: value => checkedNativePeople(value, { unitId: context.localId, companyId: context.companyId, page }) });
  function remember(person: TeamPerson) { onPeople([...people.filter(p => p.id !== person.id), person]); }
  function searchPeople() { apply(q.trim()); setPage(1); }
  const selectedIds = [...new Set([chiefId, ...participants].filter(Boolean))];
  return <div className="stack"><div className={styles.search}><Field label="Buscar trabalhador"><input maxLength={200} disabled={busy} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (!busy && !lookup.isFetching) searchPeople(); } }}/></Field>
    <Button variant="secondary" disabled={busy || lookup.isFetching} onClick={searchPeople}>Buscar trabalhadores</Button></div>
    {lookup.isPending && <Spinner/>}{lookup.isError && <Feedback tone="danger">Não foi possível conferir os trabalhadores desta unidade.</Feedback>}
    {lookup.data && <><ul className={`${styles.results} ${styles.available}`} aria-label="Trabalhadores disponíveis">{lookup.data.items.map(person => <li key={person.id}><span><strong>{person.fullName}</strong><small>{person.registration}</small></span><div className="actions">
      <Button variant="secondary" aria-label={`Definir ${person.fullName} como chefe`} disabled={busy || person.id === chiefId} onClick={() => { remember(person); onChief(person.id); }}>Chefe</Button>
      <Button variant="secondary" aria-label={`Adicionar ${person.fullName} à equipe`} disabled={busy || selectedIds.includes(person.id)} onClick={() => { remember(person); onParticipants([...participants, person.id]); }}>Adicionar</Button></div></li>)}</ul>
      {!lookup.data.items.length && <p>Nenhum trabalhador encontrado.</p>}
      {(page > 1 || lookup.data.total > 20) && <div className="actions"><Button variant="secondary" disabled={busy || lookup.isFetching || page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>Página {page}</span><Button variant="secondary" disabled={busy || lookup.isFetching || page * 20 >= lookup.data.total} onClick={() => setPage(p => p + 1)}>Próxima</Button></div>}</>}
    <h3>Integrantes selecionados</h3>{!selectedIds.length ? <p>Defina o chefe e adicione os participantes.</p> : <ul className={styles.results} aria-label="Integrantes selecionados">{selectedIds.map(id => {
      const person = people.find(p => p.id === id) ?? initialPeople.find(p => p.id === id);
      return <li key={id}><span><strong>{person?.fullName ?? 'Trabalhador indisponível'}</strong><small>{id === chiefId ? 'Chefe' : 'Participante'}{person?.status === 'TERMINATED' ? ' · vínculo encerrado' : ''}</small></span>{id !== chiefId && <Button variant="secondary" disabled={busy} aria-label={`Remover ${person?.fullName ?? 'participante'} da equipe`} onClick={() => onParticipants(participants.filter(p => p !== id))}>Remover</Button>}</li>;
    })}</ul>}
  </div>;
}
