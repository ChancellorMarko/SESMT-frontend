import { useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, EmptyState, Feedback, InfoButton, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeTeam, type NativeTeam } from './contracts';
import { loadNativeTeams } from './queries';
import styles from '../../shared/ui/NativeRecords.module.css';
import operationStyles from './NativeForms.module.css';

export function NativeTeamsPage() {
  const { sessionKey, unitId } = useSession();
  return <Teams key={JSON.stringify([sessionKey, unitId])}/>;
}
function Teams() {
  const { sessionKey, unitId, me, can } = useSession(), [page, setPage] = useState(1);
  const allowed = can('equipe:ler'), companyIds = me?.scope.companyIds ?? [], validContext = Boolean(unitId && me?.scope.unitIds.includes(unitId) && companyIds.length);
  const context = { unitId: unitId ?? '', companyIds, page };
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
  return <div className="stack"><PageHeader title="Equipes" description="Equipes da unidade selecionada. A consulta confere empresa e local de cada equipe antes de mostrar os dados. A API fornece páginas sem total geral." actions={<Button variant="secondary" disabled={!validContext || teams.isFetching} onClick={() => void teams.refetch()}>Atualizar equipes</Button>}/>
    {!validContext ? <EmptyState title="Selecione uma unidade autorizada" description="A consulta precisa de unidade selecionada e empresa informadas nos acessos da conta."/> : teams.isPending ? <Spinner/> : teams.isError ? <Feedback tone="danger">Não foi possível conferir as equipes e o contexto desta unidade. Atualize a consulta ou confira os acessos da conta.</Feedback> : teams.data && <section className={styles.results} aria-label="Equipes da unidade">
      {!teams.data.items.length ? <EmptyState title="Nenhuma equipe nesta página" description="Volte à página anterior ou atualize a consulta."/> : <div className={styles.scroll} role="region" aria-label="Tabela de equipes" tabIndex={0}><table className={`data-table ${operationStyles.compactTable}`}><thead><tr><th scope="col">Equipe</th><th scope="col">Pessoas</th><th scope="col"><span className="sr-only">Detalhes</span></th></tr></thead><tbody>{teams.data.items.map(team => <tr key={team.id}><td><strong>{team.name}</strong><small>{team.description}</small></td><td>{new Set([...team.participantIds, ...(team.chiefId ? [team.chiefId] : [])]).size}</td><td><InfoButton title={`Equipe: ${team.name}`}><dl className={styles.details}><dt>Equipe</dt><dd>{team.name}</dd><dt>Identificador</dt><dd>{team.id}</dd><dt>Empresa</dt><dd>{team.companyId}</dd><dt>Local</dt><dd>{team.localId}</dd><dt>Chefe (trabalhador)</dt><dd>{team.chiefId ?? 'Não informado'}</dd><dt>Participantes</dt><dd>{team.participantIds.join(' · ') || 'Não informados'}</dd></dl></InfoButton></td></tr>)}</tbody></table></div>}
      <nav className={styles.footer} aria-label="Paginação de equipes"><span>{teams.data.count} equipe(s) nesta página · página {page}</span>{(page>1||teams.data.count===10)&&<div className="actions"><Button variant="secondary" disabled={page <= 1 || teams.isFetching} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="secondary" disabled={teams.data.count < 10 || teams.isFetching || page >= Math.floor(2147483647 / 10)} onClick={() => setPage(page + 1)}>Próxima</Button></div>}</nav>
    </section>}
  </div>;
}
export function NativeTeamCommandUnavailable() {
  return <div className="stack"><PageHeader title="Equipes"/><Feedback tone="warning">Esta operação não está disponível para esta conta.</Feedback><Link className="button button--secondary" to="/app/equipes">Voltar às equipes</Link></div>;
}
