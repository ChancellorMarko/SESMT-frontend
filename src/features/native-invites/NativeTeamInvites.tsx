import { useState } from 'react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, Spinner } from '../../shared/ui';
import { NativeCommandDialog } from '../native-operations/NativeCommandDialog';
import type { NativeTeam } from '../native-operations/contracts';
import { checkedInviteCreated, checkedInviteList, inviteLifetimes, inviteStatusLabels, type NativeInviteSummary } from './contracts';
import styles from '../../shared/ui/NativeRecords.module.css';

type Team = NativeTeam & { companyId: string; localId: string };
export function canManageInvites(team: NativeTeam, can: (permission: string) => boolean): team is Team {
  return can('agenda:editar') && Boolean(team.companyId && team.localId && team.active);
}

/**
 * Invites let someone without an account request an appointment for this team. The API returns the link only
 * once, at creation; afterwards the listing shows status and validity so an invite can still be revoked.
 */
export function NativeTeamInvites({ team, onClose }: { team: Team; onClose: () => void }) {
  const { sessionKey } = useSession();
  const [hours, setHours] = useState<number>(inviteLifetimes[0].hours);
  const [link, setLink] = useState<{ url: string; expiresAt: string }>();
  const [copied, setCopied] = useState(false), [creating, setCreating] = useState(false), [error, setError] = useState('');
  const [revoking, setRevoking] = useState<NativeInviteSummary>(), [notice, setNotice] = useState('');
  const invites = useVerifiedRead({
    queryKey: ['native-team-invites', sessionKey, team.companyId, team.id], enabled: true,
    request: signal => api.get<unknown>('/invites', { query: { companyId: team.companyId, teamId: team.id }, signal }),
    validate: value => checkedInviteList(value, { companyId: team.companyId, teamId: team.id }),
  });

  async function create() {
    if (creating) return;
    setCreating(true); setError(''); setNotice(''); setCopied(false); setLink(undefined);
    // Whole seconds in UTC, as the API compares the echoed validity exactly.
    const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + hours * 3600000).toISOString();
    try {
      const value = await api.post<unknown>('/invites', { companyId: team.companyId, teamId: team.id, locationId: team.localId, expiresAt });
      const created = checkedInviteCreated(value, { teamId: team.id, expiresAt });
      setLink({ url: new URL(`/convite/${created.token}`, window.location.origin).toString(), expiresAt: created.expiresAt });
    } catch (failure) {
      setError(failure instanceof ApiError && [403, 404].includes(failure.status) ? 'A API não autorizou gerar convites para esta equipe. Confira o perfil de configuração de PT na empresa.'
        : failure instanceof InvalidReadResponse ? 'A resposta não confirmou o convite. Atualize a lista antes de gerar outro.'
        : 'Não foi possível confirmar a criação do convite. Atualize a lista antes de gerar outro.');
    } finally {
      setCreating(false); void invites.refetch();
    }
  }
  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setCopied(false); setError('Não foi possível copiar automaticamente. Selecione o link e copie manualmente.'); }
  }

  // The confirmation replaces the invites window instead of stacking a second modal over it.
  if (revoking) return <NativeCommandDialog title="Revogar convite" dirty={false} submitLabel="Confirmar revogação" onClose={() => setRevoking(undefined)}
    perform={async signal => { await api.post<unknown>(`/invites/${revoking.id}/revoke`, { expectedVersion: revoking.version }, { signal }); }}
    onDone={async () => { setRevoking(undefined); setNotice('Convite revogado. O link deixou de aceitar solicitações.'); await invites.refetch(); }}>
    {() => <p>Revogar o convite válido até <strong>{formatDate(revoking.expiresAt)}</strong>? Quem tiver o link não poderá mais solicitar agendamentos nem consultar pedidos feitos por ele.</p>}
  </NativeCommandDialog>;
  return <Modal open title={`Convites · ${team.name}`} onClose={onClose}>
    <div className="stack">
      <Feedback>Quem receber o link pode solicitar um agendamento para esta equipe sem ter conta. A solicitação depende de confirmação e não libera a execução. O link é exibido somente agora: copie e envie por um canal confiável.</Feedback>
      <div className="form-grid">
        <Field label="Validade do convite"><select value={hours} disabled={creating} onChange={event => setHours(Number(event.target.value))}>{inviteLifetimes.map(option => <option key={option.hours} value={option.hours}>{option.label}</option>)}</select></Field>
      </div>
      <div className="actions"><Button disabled={creating} onClick={() => void create()}>{creating ? 'Gerando convite…' : 'Gerar convite'}</Button></div>
      {error && <Feedback tone="danger">{error}</Feedback>}
      {link && <div className="stack">
        <Field label="Link do convite"><input readOnly value={link.url} onFocus={event => event.currentTarget.select()}/></Field>
        <div className="actions"><Button variant="secondary" onClick={() => void copy()}>Copiar link</Button>{copied && <span role="status">Link copiado.</span>}</div>
        <small className="muted">Válido até {formatDate(link.expiresAt)}.</small>
      </div>}
      {notice && <Feedback tone="success">{notice}</Feedback>}
      <section className="stack" aria-label="Convites da equipe">
        <div className="toolbar"><h3>Convites gerados</h3><Button variant="secondary" disabled={invites.isFetching} onClick={() => void invites.refetch()}>Atualizar convites</Button></div>
        {invites.isPending ? <Spinner/> : invites.isError ? <Feedback tone="warning">Não foi possível conferir os convites desta equipe.</Feedback>
          : !invites.data?.length ? <EmptyState title="Nenhum convite" description="Gere um convite para receber solicitações sem conta."/>
          : <div className={styles.scroll} role="region" aria-label="Tabela de convites" tabIndex={0}><table className={`data-table ${styles.table}`}><thead><tr><th scope="col">Gerado em</th><th scope="col">Validade</th><th scope="col">Situação e ações</th></tr></thead><tbody>
            {invites.data.map(invite => <tr key={invite.id}><td>{formatDate(invite.createdAt)}</td><td>{formatDate(invite.expiresAt)}</td><td><div className="actions">
              <Badge tone={invite.status === 'ACTIVE' ? 'success' : invite.status === 'REVOKED' ? 'warning' : 'neutral'}>{inviteStatusLabels[invite.status]}</Badge>
              {invite.status === 'ACTIVE' && <Button variant="secondary" onClick={() => { setNotice(''); setRevoking(invite); }} aria-label={`Revogar convite gerado em ${formatDate(invite.createdAt)}`}>Revogar</Button>}
            </div></td></tr>)}
          </tbody></table></div>}
      </section>
    </div>
  </Modal>;
}
