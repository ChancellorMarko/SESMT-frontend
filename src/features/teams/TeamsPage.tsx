import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Users } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { TeamDto } from '../../shared/contracts/work-permits';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { normalizedTeamText, teamErrorMessage } from './validation';
import styles from '../agenda/Agenda.module.css';

export function TeamsPage() {
  const { unitId, sessionKey, can } = useSession();
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const query = search.get('q') || '';
  const success = (location.state as { success?: string } | null)?.success;
  const teams = useQuery({ queryKey: ['teams', sessionKey, unitId], queryFn: ({ signal }) => api.get<TeamDto[]>('/teams', { signal, query: { unitId } }), enabled: can('teams.read') && Boolean(unitId) });
  const filtered = teams.data?.filter(team => team.unitId === unitId && normalizedTeamText([team.name, ...team.members.map(person => `${person.name} ${person.serviceFunction}`)].join(' ')).includes(normalizedTeamText(query))) || [];
  if (!can('teams.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso às equipes." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade de trabalho para consultar as equipes." />;
  return <div className="stack">
    <PageHeader eyebrow="Pessoas e serviço" title="Equipes de trabalho" description="Consulte o chefe e os participantes das equipes disponíveis na unidade." actions={<>{can('teams.write') && <Link className="button button--primary" to="/app/equipes/novo">Nova equipe</Link>}{can('appointments.write') && <Link className="button button--secondary" to="/app/agenda/novo">Agendar serviço</Link>}</>} />
    {success && <Feedback tone="success">{success}</Feedback>}
    <Feedback tone="info">As funções da equipe servem como referência. Ao agendar, confirme a função que cada pessoa exercerá naquele serviço para aplicar os requisitos corretos.</Feedback>
    <Field label="Buscar equipes"><input type="search" value={query} placeholder="Nome, participante ou função" onChange={event => { const next = new URLSearchParams(search); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setSearch(next, { replace: true }); }} /></Field>
    {teams.isPending ? <Spinner /> : teams.isError ? <div className="panel stack"><Feedback tone="danger">{teamErrorMessage(teams.error)}</Feedback><Button variant="secondary" onClick={() => void teams.refetch()}>Tentar novamente</Button></div> : !filtered.length ? <EmptyState title={query ? 'Nenhuma equipe encontrada' : 'Nenhuma equipe disponível'} description={query ? 'Revise os termos de busca para consultar as equipes desta unidade.' : 'Não há equipes vinculadas ao seu escopo nesta unidade.'} /> : <div className={styles.cards}>{filtered.map(team => <article className="panel stack" key={team.id} aria-label={team.name}>
      <div className={styles.cardHeader}><div><h2><Users size={17} aria-hidden="true" /> {team.name}</h2><p className="muted">{team.members.length} participante(s)</p></div><Badge>Revisão {team.revision}</Badge></div>
      <div>{team.members.map(person => <div className={styles.teamMember} key={person.workerId}><span>{person.name}{person.workerId === team.chiefId && <> <Badge tone="info">Chefe da equipe</Badge></>}</span><small>{person.serviceFunction}</small></div>)}</div>
      {!team.members.some(person => person.workerId === team.chiefId) && <p className="muted">Chefe vinculado ao cadastro da equipe.</p>}
      <div className="actions">{can('teams.write') && <Link className="button button--secondary" aria-label={`Editar equipe ${team.name}`} to={`/app/equipes/${team.id}/editar`}>Editar equipe</Link>}<Link className="button button--secondary" to={`/app/agenda?q=${encodeURIComponent(team.name)}`}>Consultar agenda desta equipe</Link></div>
    </article>)}</div>}
  </div>;
}
