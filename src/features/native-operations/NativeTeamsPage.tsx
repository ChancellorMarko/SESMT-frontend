import { useState } from 'react';
import { plural } from '../../shared/lib/format';
import { Link, useLocation } from 'react-router';
import { Link2, Pencil, PowerOff } from 'lucide-react';
import { api } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, EmptyState, Feedback, InfoButton, PageHeader, Spinner, RefreshButton } from '../../shared/ui';
import { checkedNativeTeam, type NativeTeam } from './contracts';
import { loadNativeTeams } from './queries';
import { NativeCommandDialog } from './NativeCommandDialog';
import styles from '../../shared/ui/NativeRecords.module.css';
import teamStyles from '../native-teams/NativeTeams.module.css';
import { teamReturnPage } from '../native-teams/contracts';
import { canManageInvites, NativeTeamInvites } from '../native-invites/NativeTeamInvites';

export function NativeTeamsPage() {
  const { sessionKey, unitId } = useSession();
  return <Teams key={JSON.stringify([sessionKey, unitId])}/>;
}
function Teams() {
  const { sessionKey, unitId, me, can } = useSession(), location = useLocation(), [page, setPage] = useState(() => teamReturnPage(location.state, unitId, sessionKey));
  const [inviting, setInviting] = useState<NativeTeam>(), [deactivating, setDeactivating] = useState<NativeTeam>(), [deactivated, setDeactivated] = useState('');
  const allowed = can('equipe:ler'), companyIds = me?.scope.companyIds ?? [], validContext = Boolean(unitId && me?.scope.unitIds.includes(unitId) && companyIds.length);
  const context = { unitId: unitId ?? '', companyIds, page };
  const origin = { nativeTeamReturnTo: { unitId, sessionKey, page } };
  const writeContext = validContext && can('workers.read') && !me?.scope.ownOnly;
  function validate(value: unknown): { items: NativeTeam[]; count: number } {
    if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items) || !('count' in value)
      || !Number.isInteger(value.count) || value.count !== value.items.length || value.items.length > 10) throw new InvalidReadResponse();
    const items = value.items.map(item => checkedNativeTeam(item, { ...context, id: String(item?.id) }));
    if (new Set(items.map(item => item.id)).size !== items.length) throw new InvalidReadResponse();
    return { items, count: Number(value.count) };
  }
  const teams = useVerifiedRead({ queryKey: ['native-teams', sessionKey, unitId, companyIds, page], scope: ['native-teams', sessionKey, unitId], enabled: allowed && validContext,
    request: signal => loadNativeTeams(context, signal), validate });
  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar equipes.</Feedback>;
  return <div className="stack"><PageHeader title="Equipes" actions={<div className="actions">{writeContext && can('equipe:criar') && <Link className="button button--primary" to="/app/equipes/novo" state={origin}>Nova equipe</Link>}<RefreshButton label="Atualizar equipes" disabled={!validContext || teams.isFetching} onClick={() => void teams.refetch()}/></div>}/>
    {location.state?.nativeTeamSaved && teamReturnPage(location.state, unitId, sessionKey) === page && <Feedback tone="success">Equipe salva.</Feedback>}
    {!validContext ? <EmptyState title="Selecione uma unidade autorizada" description="A consulta precisa de unidade selecionada e empresa informadas nos acessos da conta."/> : teams.isPending ? <Spinner/> : teams.isError ? <Feedback tone="danger">Não foi possível conferir as equipes e o contexto desta unidade. Atualize a consulta ou confira os acessos da conta.</Feedback> : teams.data && <section className={styles.results} aria-label="Equipes da unidade">
      {!teams.data.items.length ? <EmptyState title="Nenhuma equipe nesta página" description="Volte à página anterior ou atualize a consulta."/> : <div className={styles.scroll} role="region" aria-label="Tabela de equipes" tabIndex={0}><table className={`data-table ${teamStyles.table}`}><thead><tr><th scope="col">Equipe</th><th scope="col">Pessoas</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead><tbody>{teams.data.items.map(team => <tr key={team.id}><td><strong>{team.name}</strong><small>{team.description}</small></td><td>{new Set([...team.participantIds, ...(team.chiefId ? [team.chiefId] : [])]).size}</td><td><div className={teamStyles.actions}><InfoButton title={`Equipe: ${team.name}`}><dl className={styles.details}><dt>Equipe</dt><dd>{team.name}</dd><dt>Identificador</dt><dd>{team.id}</dd><dt>Empresa</dt><dd>{team.companyId}</dd><dt>Local</dt><dd>{team.localId}</dd><dt>Chefe (trabalhador)</dt><dd>{team.chiefId ?? 'Não informado'}</dd><dt>Participantes</dt><dd>{team.participantIds.join(' · ') || 'Não informados'}</dd>{team.version && <><dt>Revisão</dt><dd>{team.version}</dd></>}</dl></InfoButton>
        {writeContext && can('equipe:editar') && team.version && <Link className={`button button--secondary ${teamStyles.edit}`} to={`/app/equipes/${team.id}/editar`} state={origin} aria-label={`Editar equipe ${team.name}`}><Pencil size={16} aria-hidden="true"/>Editar</Link>}
        {validContext && canManageInvites(team, can) && <Button variant="secondary" className={teamStyles.edit} onClick={() => setInviting(team)} aria-label={`Convites da equipe ${team.name}`}><Link2 size={16} aria-hidden="true"/>Convites</Button>}
        {writeContext && can('equipe:excluir') && <Button variant="danger" className={teamStyles.edit} onClick={() => { setDeactivated(''); setDeactivating(team); }} aria-label={`Desativar equipe ${team.name}`}><PowerOff size={16} aria-hidden="true"/>Desativar</Button>}</div></td></tr>)}</tbody></table></div>}
      <nav className={styles.footer} aria-label="Paginação de equipes"><span>{plural(teams.data.count, 'equipe nesta página', 'equipes nesta página')} · página {page}</span>{(page>1||teams.data.count===10)&&<div className="actions"><Button variant="secondary" disabled={page <= 1 || teams.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={teams.data.count < 10 || teams.isFetching || page >= Math.floor(2147483647 / 10)} onClick={() => setPage(page + 1)}>Próxima</Button></div>}</nav>
    </section>}
    {inviting && teams.data?.items.some(item => item.id === inviting.id) && canManageInvites(inviting, can) && <NativeTeamInvites team={inviting} onClose={() => setInviting(undefined)}/>}
    {deactivated && <Feedback tone="success">{deactivated}</Feedback>}
    {deactivating && teams.data?.items.some(item => item.id === deactivating.id) && can('equipe:excluir') && <NativeCommandDialog title="Desativar equipe" dirty={false} submitLabel="Confirmar desativação"
      onClose={() => setDeactivating(undefined)}
      perform={async signal => { await api.delete<unknown>(`/teams/${deactivating.id}`, { signal }); }}
      onDone={async () => { const name = deactivating.name; setDeactivating(undefined); setDeactivated(`Equipe ${name} desativada. O histórico foi preservado.`); await teams.refetch(); }}>
      {() => <div className="stack">
        <p>Desativar a equipe <strong>{deactivating.name}</strong>?</p>
        <Feedback tone="warning">A equipe deixa de aparecer nas consultas e não pode ser escolhida em novos agendamentos. Agendamentos já registrados mantêm a equipe no histórico; confira na agenda os que ainda não aconteceram. Convites desta equipe deixam de funcionar.</Feedback>
      </div>}
    </NativeCommandDialog>}
  </div>;
}
