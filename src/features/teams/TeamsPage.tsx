import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Users, Link2, Copy, Check, ExternalLink, Ban } from 'lucide-react';
import { api, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { TeamDto } from '../../shared/contracts/work-permits';
import type { TeamInviteDto } from '../../shared/contracts/teams';
import { formatDate } from '../../shared/lib/format';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { normalizedTeamText, teamErrorMessage } from './validation';
import styles from '../agenda/Agenda.module.css';

export function TeamsPage() {
  const { unitId, sessionKey, can } = useSession();
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const query = search.get('q') || '';
  const statusFilter = search.get('status') || '';
  const success = (location.state as { success?: string } | null)?.success;

  // Inactivation modal state
  const [inactivatingTeam, setInactivatingTeam] = useState<TeamDto | null>(null);
  const [inactivationReason, setInactivationReason] = useState('');
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [statusActionError, setStatusActionError] = useState<string | null>(null);
  const [statusActionNotice, setStatusActionNotice] = useState<string | null>(null);

  // Team invite modal state
  const [inviteModalTeam, setInviteModalTeam] = useState<TeamDto | null>(null);
  const [validityHours, setValidityHours] = useState<number>(48);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);

  const teams = useQuery({
    queryKey: ['teams', sessionKey, unitId],
    queryFn: ({ signal }) => api.get<TeamDto[]>('/teams', { signal, query: { unitId } }),
    enabled: can('teams.read') && Boolean(unitId),
  });

  const filtered = teams.data?.filter(team => {
    if (team.unitId !== unitId) return false;
    if (statusFilter && (team.status || 'ACTIVE') !== statusFilter) return false;
    if (query) {
      const matchText = [team.name, ...team.members.map(person => `${person.name} ${person.serviceFunction}`)].join(' ');
      if (!normalizedTeamText(matchText).includes(normalizedTeamText(query))) return false;
    }
    return true;
  }) || [];

  async function handleInactivate(event: FormEvent) {
    event.preventDefault();
    if (!inactivatingTeam) return;
    setIsSubmittingStatus(true);
    setStatusActionError(null);
    try {
      await api.patch<TeamDto>(
        `/teams/${inactivatingTeam.id}`,
        {
          status: 'INACTIVE',
          inactiveReason: inactivationReason.trim() || undefined,
        },
        { etag: revisionEtag(inactivatingTeam.revision) }
      );
      await queryClient.invalidateQueries({ queryKey: ['teams', sessionKey, unitId] });
      setInactivatingTeam(null);
      setInactivationReason('');
      setStatusActionNotice(`Equipe "${inactivatingTeam.name}" inativada com sucesso.`);
    } catch (err) {
      setStatusActionError(teamErrorMessage(err));
    } finally {
      setIsSubmittingStatus(false);
    }
  }

  async function handleReactivate(team: TeamDto) {
    setIsSubmittingStatus(true);
    setStatusActionError(null);
    setStatusActionNotice(null);
    try {
      await api.patch<TeamDto>(
        `/teams/${team.id}`,
        { status: 'ACTIVE' },
        { etag: revisionEtag(team.revision) }
      );
      await queryClient.invalidateQueries({ queryKey: ['teams', sessionKey, unitId] });
      setStatusActionNotice(`Equipe "${team.name}" reativada com sucesso.`);
    } catch (err) {
      setStatusActionError(teamErrorMessage(err));
    } finally {
      setIsSubmittingStatus(false);
    }
  }

  const teamInvites = useQuery({
    queryKey: ['team-invites', sessionKey, inviteModalTeam?.id],
    queryFn: ({ signal }) =>
      api.get<TeamInviteDto[]>('/team-invites', { signal, query: { teamId: inviteModalTeam!.id, unitId } }),
    enabled: Boolean(inviteModalTeam?.id && can('teams.read')),
  });

  async function handleCreateInvite(event: FormEvent) {
    event.preventDefault();
    if (!inviteModalTeam) return;
    setIsGeneratingInvite(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const created = await api.post<TeamInviteDto>('/team-invites', {
        teamId: inviteModalTeam.id,
        validityHours,
      });
      await queryClient.invalidateQueries({ queryKey: ['team-invites', sessionKey, inviteModalTeam.id] });
      setInviteSuccess('Novo link de convite gerado com sucesso!');
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(created.shareUrl);
          setCopiedInviteId(created.id);
        } catch {
          // ignore clipboard errors
        }
      }
    } catch (err) {
      setInviteError(teamErrorMessage(err));
    } finally {
      setIsGeneratingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!inviteModalTeam) return;
    setRevokingInviteId(inviteId);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      await api.post(`/team-invites/${inviteId}/revoke`, {});
      await queryClient.invalidateQueries({ queryKey: ['team-invites', sessionKey, inviteModalTeam.id] });
      setInviteSuccess('Convite revogado com sucesso.');
    } catch (err) {
      setInviteError(teamErrorMessage(err));
    } finally {
      setRevokingInviteId(null);
    }
  }

  async function handleCopyLink(invite: TeamInviteDto) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(invite.shareUrl);
        setCopiedInviteId(invite.id);
        setTimeout(() => setCopiedInviteId(prev => (prev === invite.id ? null : prev)), 3000);
      }
    } catch {
      setInviteError('Não foi possível copiar o link.');
    }
  }

  if (!can('teams.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso às equipes." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade de trabalho para consultar as equipes." />;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Pessoas e serviço"
        title="Equipes de trabalho"
        description="Consulte o chefe, os participantes e a situação das equipes disponíveis na unidade."
        actions={
          <>
            {can('teams.write') && <Link className="button button--primary" to="/app/equipes/novo">Nova equipe</Link>}
            {can('appointments.write') && <Link className="button button--secondary" to="/app/agenda/novo">Agendar serviço</Link>}
          </>
        }
      />
      {success && <Feedback tone="success">{success}</Feedback>}
      {statusActionNotice && <Feedback tone="success">{statusActionNotice}</Feedback>}
      {statusActionError && <Feedback tone="danger">{statusActionError}</Feedback>}

      <Feedback tone="info">
        As funções da equipe servem como referência. Ao agendar, confirme a função que cada pessoa exercerá naquele serviço para aplicar os requisitos corretos.
      </Feedback>

      <div className="toolbar">
        <Field label="Buscar equipes">
          <input
            type="search"
            value={query}
            placeholder="Nome, participante ou função"
            onChange={event => {
              const next = new URLSearchParams(search);
              if (event.target.value) next.set('q', event.target.value);
              else next.delete('q');
              setSearch(next, { replace: true });
            }}
          />
        </Field>
        <Field label="Situação">
          <select
            value={statusFilter}
            onChange={event => {
              const next = new URLSearchParams(search);
              if (event.target.value) next.set('status', event.target.value);
              else next.delete('status');
              setSearch(next, { replace: true });
            }}
          >
            <option value="">Todas as situações</option>
            <option value="ACTIVE">Ativas</option>
            <option value="INACTIVE">Inativas</option>
          </select>
        </Field>
        {(query || statusFilter) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSearch({}, { replace: true })}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      {inactivatingTeam && (
        <form className="panel stack" onSubmit={handleInactivate} style={{ border: '1px solid var(--color-warning-border, #f59e0b)' }}>
          <h3>Inativar equipe: {inactivatingTeam.name}</h3>
          <p className="muted">
            A inativação preserva o histórico de agendamentos e PTs anteriores, mas oculta esta equipe na criação de novos agendamentos.
          </p>
          <Field label="Motivo da inativação (opcional)">
            <input
              type="text"
              value={inactivationReason}
              onChange={event => setInactivationReason(event.target.value)}
              placeholder="Ex.: Equipe desmobilizada temporariamente"
              maxLength={300}
            />
          </Field>
          <div className="actions">
            <Button type="submit" variant="primary" disabled={isSubmittingStatus}>
              {isSubmittingStatus ? 'Inativando...' : 'Confirmar inativação'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isSubmittingStatus}
              onClick={() => { setInactivatingTeam(null); setInactivationReason(''); }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {teams.isPending ? (
        <Spinner />
      ) : teams.isError ? (
        <div className="panel stack">
          <Feedback tone="danger">{teamErrorMessage(teams.error)}</Feedback>
          <Button variant="secondary" onClick={() => void teams.refetch()}>Tentar novamente</Button>
        </div>
      ) : !filtered.length ? (
        <EmptyState
          title={query || statusFilter ? 'Nenhuma equipe encontrada' : 'Nenhuma equipe disponível'}
          description={
            query || statusFilter
              ? 'Revise os filtros de busca para consultar as equipes desta unidade.'
              : 'Não há equipes vinculadas ao seu escopo nesta unidade.'
          }
        />
      ) : (
        <div className={styles.cards}>
          {filtered.map(team => {
            const isInactive = team.status === 'INACTIVE';
            return (
              <article className="panel stack" key={team.id} aria-label={team.name}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2><Users size={17} aria-hidden="true" /> {team.name}</h2>
                    <p className="muted">{team.members.length} participante(s)</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Badge tone={isInactive ? 'neutral' : 'success'}>
                      {isInactive ? 'Inativa' : 'Ativa'}
                    </Badge>
                    <Badge>Revisão {team.revision}</Badge>
                  </div>
                </div>

                {isInactive && team.inactiveReason && (
                  <p className="muted" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>
                    Motivo da inativação: {team.inactiveReason}
                  </p>
                )}

                <div>
                  {team.members.map(person => (
                    <div className={styles.teamMember} key={person.workerId}>
                      <span>
                        {person.name}
                        {person.workerId === team.chiefId && <> <Badge tone="info">Chefe da equipe</Badge></>}
                      </span>
                      <small>{person.serviceFunction}</small>
                    </div>
                  ))}
                </div>

                {!team.members.some(person => person.workerId === team.chiefId) && (
                  <p className="muted">Chefe vinculado ao cadastro da equipe.</p>
                )}

                <div className="actions">
                  {can('teams.write') && (
                    <>
                      <Link
                        className="button button--secondary"
                        aria-label={`Editar equipe ${team.name}`}
                        to={`/app/equipes/${team.id}/editar`}
                      >
                        Editar equipe
                      </Link>
                      {isInactive ? (
                        <Button
                          variant="secondary"
                          disabled={isSubmittingStatus}
                          onClick={() => void handleReactivate(team)}
                        >
                          Reativar equipe
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setInviteModalTeam(team);
                              setInviteError(null);
                              setInviteSuccess(null);
                              setCopiedInviteId(null);
                            }}
                            aria-label={`Convites por link da equipe ${team.name}`}
                          >
                            <Link2 size={15} aria-hidden="true" /> Convites por link
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={isSubmittingStatus}
                            onClick={() => {
                              setInactivatingTeam(team);
                              setInactivationReason('');
                              setStatusActionError(null);
                            }}
                          >
                            Inativar equipe
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  <Link
                    className="button button--secondary"
                    to={`/app/agenda?q=${encodeURIComponent(team.name)}`}
                  >
                    {isInactive ? 'Histórico na agenda' : 'Consultar agenda desta equipe'}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {inviteModalTeam && (
        <Modal
          open={Boolean(inviteModalTeam)}
          title={`Convites da equipe: ${inviteModalTeam.name}`}
          onClose={() => {
            setInviteModalTeam(null);
            setInviteError(null);
            setInviteSuccess(null);
            setCopiedInviteId(null);
          }}
        >
          <div className="stack" style={{ gap: '1.25rem' }}>
            <p className="muted">
              Gere links públicos com validade pré-definida para que executantes ou encarregados consultem o escopo, membros e orientações da equipe sem exigir login completo.
            </p>

            {inviteSuccess && <Feedback tone="success">{inviteSuccess}</Feedback>}
            {inviteError && <Feedback tone="danger">{inviteError}</Feedback>}

            {can('teams.write') && (
              <form onSubmit={handleCreateInvite} className="panel stack" style={{ background: 'var(--color-bg-subtle, #f8fafc)' }}>
                <h4>Gerar novo convite por link</h4>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <Field label="Validade do link">
                    <select
                      value={validityHours}
                      onChange={e => setValidityHours(Number(e.target.value))}
                      disabled={isGeneratingInvite}
                    >
                      <option value={24}>24 horas (1 dia)</option>
                      <option value={48}>48 horas (2 dias - padrão)</option>
                      <option value={72}>72 horas (3 dias)</option>
                      <option value={168}>7 dias (1 semana)</option>
                    </select>
                  </Field>
                  <Button type="submit" variant="primary" disabled={isGeneratingInvite}>
                    {isGeneratingInvite ? 'Gerando link...' : 'Gerar link de convite'}
                  </Button>
                </div>
              </form>
            )}

            <div>
              <h4>Links gerados para esta equipe</h4>
              {teamInvites.isPending ? (
                <Spinner />
              ) : teamInvites.isError ? (
                <Feedback tone="danger">{teamErrorMessage(teamInvites.error)}</Feedback>
              ) : !teamInvites.data?.length ? (
                <p className="muted">Nenhum convite gerado para esta equipe até o momento.</p>
              ) : (
                <div className="stack" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>
                  {teamInvites.data.map(inv => {
                    const isCopied = copiedInviteId === inv.id;
                    const isExpired = new Date(inv.expiresAt).getTime() < Date.now();
                    const tone = inv.status === 'REVOKED' ? 'neutral' : isExpired ? 'warning' : 'success';
                    const statusText = inv.status === 'REVOKED' ? 'Revogado' : isExpired ? 'Expirado' : 'Ativo';

                    return (
                      <div
                        key={inv.id}
                        className="panel"
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                          padding: '0.85rem',
                          background: inv.status === 'ACTIVE' && !isExpired ? '#fff' : 'var(--color-bg-subtle, #f9fafb)',
                          border: '1px solid var(--color-border, #e5e7eb)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <Badge tone={tone}>{statusText}</Badge>
                            <small className="muted">
                              Expira em: {formatDate(inv.expiresAt)}
                            </small>
                          </div>
                          <small className="muted">
                            Criado em {formatDate(inv.createdAt)} por {inv.createdByName}
                          </small>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="text"
                            readOnly
                            value={inv.shareUrl}
                            style={{ flex: 1, minWidth: '220px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                            aria-label={`Link de convite ${inv.token}`}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleCopyLink(inv)}
                            aria-label={isCopied ? 'Link copiado' : 'Copiar link'}
                          >
                            {isCopied ? (
                              <>
                                <Check size={14} aria-hidden="true" style={{ color: '#10b981' }} /> Copiado!
                              </>
                            ) : (
                              <>
                                <Copy size={14} aria-hidden="true" /> Copiar link
                              </>
                            )}
                          </Button>
                          <a
                            href={inv.shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="button button--ghost"
                            aria-label="Abrir convite em nova aba"
                          >
                            <ExternalLink size={14} aria-hidden="true" /> Abrir
                          </a>
                          {can('teams.write') && inv.status === 'ACTIVE' && !isExpired && (
                            <Button
                              type="button"
                              variant="danger"
                              disabled={revokingInviteId === inv.id}
                              onClick={() => void handleRevokeInvite(inv.id)}
                              aria-label="Revogar convite"
                            >
                              <Ban size={14} aria-hidden="true" /> {revokingInviteId === inv.id ? 'Revogando...' : 'Revogar'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
