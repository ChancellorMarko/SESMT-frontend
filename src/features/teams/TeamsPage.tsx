import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Users, Link2, Copy, Check, ExternalLink, Ban } from 'lucide-react';
import { api, API_MODE, ApiError, revisionEtag } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { TeamDto } from '../../shared/contracts/work-permits';
import type { TeamInviteDto } from '../../shared/contracts/teams';
import { formatDate } from '../../shared/lib/format';
import { isRecord, scopedQueryError, shortText } from '../../shared/lib/scoped-page';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { normalizedTeamText, teamErrorMessage } from './validation';
import styles from '../agenda/Agenda.module.css';

class TeamResponseError extends Error {
  constructor() { super('A resposta não corresponde à equipe ou ao convite solicitado. Atualize a consulta antes de continuar.'); }
}
const identifier = (value: unknown): value is string => shortText(value, 200) && Boolean(value.trim()) && !/[\u0000-\u0020\u007f/?#\\]/.test(value);
const isTeam = (value: unknown): value is TeamDto => isRecord(value) && identifier(value.id) && identifier(value.unitId) && identifier(value.companyId)
  && shortText(value.name, 500) && Boolean(value.name.trim()) && Number.isSafeInteger(value.revision) && Number(value.revision) > 0
  && (value.status === undefined || value.status === 'ACTIVE' || value.status === 'INACTIVE') && identifier(value.chiefId)
  && (value.inactiveReason === undefined || shortText(value.inactiveReason, 300))
  && Array.isArray(value.members) && value.members.every(member => isRecord(member) && identifier(member.workerId) && shortText(member.name, 500) && shortText(member.serviceFunction, 500));
function checkedTeams(value: unknown, unitId?: string): TeamDto[] {
  if (!Array.isArray(value) || value.some(team => !isTeam(team) || team.unitId !== unitId) || new Set(value.map(team => team.id)).size !== value.length) throw new TeamResponseError();
  return value;
}
function checkedInvite(value: unknown, team: TeamDto): TeamInviteDto {
  if (!isRecord(value) || !identifier(value.id) || !shortText(value.token, 512) || !value.token || /[\u0000-\u0020\u007f]/.test(value.token)
    || value.teamId !== team.id || value.unitId !== team.unitId || value.companyId !== team.companyId
    || !['ACTIVE', 'EXPIRED', 'REVOKED'].includes(String(value.status)) || !shortText(value.shareUrl, 3000)
    || !shortText(value.teamName, 500) || !shortText(value.unitName, 500) || !shortText(value.companyName, 500) || !shortText(value.createdByName, 500)
    || !shortText(value.createdAt, 100) || !Number.isFinite(Date.parse(value.createdAt)) || !shortText(value.expiresAt, 100) || !Number.isFinite(Date.parse(value.expiresAt))
    || !Number.isSafeInteger(value.membersCount) || Number(value.membersCount) < 0 || !Array.isArray(value.serviceFunctions) || !value.serviceFunctions.every(item => shortText(item, 500))
    || value.unavailableReason !== undefined && value.unavailableReason !== 'TEAM_INACTIVE') throw new TeamResponseError();
  let url: URL;
  try { url = new URL(value.shareUrl, window.location.origin); } catch { throw new TeamResponseError(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin || url.username || url.password || url.search || url.hash || url.pathname !== `/convite/${encodeURIComponent(value.token)}`) throw new TeamResponseError();
  return { ...value, shareUrl: url.href } as unknown as TeamInviteDto;
}
function checkedInvites(value: unknown, team: TeamDto) {
  if (!Array.isArray(value)) throw new TeamResponseError();
  const invites = value.map(item => checkedInvite(item, team));
  if (new Set(invites.map(item => item.id)).size !== invites.length) throw new TeamResponseError();
  return invites;
}
const accessError = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);

export function TeamsPage() {
  const { unitId, sessionKey, can } = useSession();
  return <TeamsContextPage key={JSON.stringify([sessionKey, unitId, can('teams.read'), can('teams.write')])} />;
}

function TeamsContextPage() {
  const { unitId, sessionKey, can } = useSession(); const queryClient = useQueryClient();
  const [search, setSearch] = useSearchParams(); const location = useLocation();
  const query = search.get('q') || '', statusFilter = search.get('status') || '';
  const success = (location.state as { success?: string } | null)?.success;
  const [inactivatingTeam, setInactivatingTeam] = useState<TeamDto | null>(null), [inactivationReason, setInactivationReason] = useState('');
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false), [statusActionError, setStatusActionError] = useState<string | null>(null), [statusActionNotice, setStatusActionNotice] = useState<string | null>(null);
  const [statusRequiresRefresh, setStatusRequiresRefresh] = useState(false);
  const [inviteModalTeam, setInviteModalTeam] = useState<TeamDto | null>(null);
  const active = useRef(true), statusRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; statusRequest.current?.abort(); }; }, []);
  const teams = useQuery({ queryKey: ['teams', sessionKey, unitId], queryFn: async ({ signal }) => checkedTeams(await api.get<unknown>('/teams', { signal, query: { unitId } }), unitId), enabled: can('teams.read') && Boolean(unitId) });
  const checked = useMemo(() => { try { return { data: teams.data === undefined ? undefined : checkedTeams(teams.data, unitId), error: undefined }; } catch (error) { return { data: undefined, error }; } }, [teams.data, unitId]);
  const teamError = teams.error ?? checked.error;
  const writable = can('teams.read') && can('teams.write') && Boolean(unitId) && !teams.isFetching && !teamError && !statusRequiresRefresh;
  const currentInviteTeam = inviteModalTeam ? checked.data?.find(team => team.id === inviteModalTeam.id && team.unitId === unitId && team.companyId === inviteModalTeam.companyId && team.status !== 'INACTIVE') : undefined;
  const currentStatusTeam = checked.data?.find(team => team.id === inactivatingTeam?.id);
  const staleStatus = Boolean(inactivatingTeam && (!currentStatusTeam || currentStatusTeam.revision !== inactivatingTeam.revision || currentStatusTeam.status !== inactivatingTeam.status));
  async function changeStatus(team: TeamDto, status: 'ACTIVE' | 'INACTIVE') {
    if (!writable || statusRequest.current || team.unitId !== unitId) return;
    const current = checked.data?.find(item => item.id === team.id && item.companyId === team.companyId);
    if (!current || current.revision !== team.revision || current.status !== team.status) { setStatusActionError('A equipe mudou. Atualize a consulta e confira sua situação antes de continuar.'); return; }
    const controller = new AbortController(); statusRequest.current = controller;
    setIsSubmittingStatus(true); setStatusActionError(null); setStatusActionNotice(null);
    try {
      const saved = await api.patch<unknown>(`/teams/${encodeURIComponent(team.id)}`, { status, ...(status === 'INACTIVE' ? { inactiveReason: inactivationReason.trim() || undefined } : {}) }, { etag: revisionEtag(team.revision), signal: controller.signal });
      if (!active.current || controller.signal.aborted) return;
      if (!isTeam(saved) || saved.id !== team.id || saved.unitId !== unitId || saved.companyId !== team.companyId || saved.status !== status || saved.revision <= team.revision) throw new TeamResponseError();
      await Promise.all(['teams', 'team-options', 'permit-options', 'team-invites'].map(resource => queryClient.invalidateQueries({ queryKey: [resource, sessionKey, unitId] })));
      if (!active.current || controller.signal.aborted) return;
      setInactivatingTeam(null); setInactivationReason('');
      setStatusActionNotice(`Equipe "${team.name}" ${status === 'INACTIVE' ? 'inativada' : 'reativada'} com sucesso.`);
    } catch (error) { if (active.current && !controller.signal.aborted) { setStatusActionError(scopedQueryError(error, 'equipes')); if (accessError(error) || error instanceof TeamResponseError) setStatusRequiresRefresh(true); } }
    finally { if (statusRequest.current === controller) { statusRequest.current = undefined; if (active.current) setIsSubmittingStatus(false); } }
  }
  function handleInactivate(event: FormEvent) { event.preventDefault(); if (inactivatingTeam && !staleStatus) void changeStatus(inactivatingTeam, 'INACTIVE'); }
  async function refreshTeams() { const result = await teams.refetch(); if (active.current && result.isSuccess) { setStatusRequiresRefresh(false); setStatusActionError(null); } }
  const filtered = teamError ? [] : checked.data?.filter(team => (!statusFilter || (team.status || 'ACTIVE') === statusFilter) && (!query || normalizedTeamText([team.name, ...team.members.map(person => `${person.name} ${person.serviceFunction}`)].join(' ')).includes(normalizedTeamText(query)))) || [];
  if (!can('teams.read')) return <EmptyState title="Acesso restrito" description="Seu perfil não possui acesso às equipes." />;
  if (!unitId) return <EmptyState title="Selecione uma unidade" description="Escolha a unidade de trabalho para consultar as equipes." />;
  return <div className="stack">
    <PageHeader eyebrow="Pessoas e serviço" title="Equipes de trabalho" description="Consulte o chefe, os participantes e a situação das equipes disponíveis na unidade." actions={<>{can('teams.write') && <Link className="button button--primary" to="/app/equipes/novo">Nova equipe</Link>}{can('appointments.write') && <Link className="button button--secondary" to="/app/agenda/novo">Agendar serviço</Link>}</>} />
    {success && <Feedback tone="success">{success}</Feedback>}{statusActionNotice && <Feedback tone="success">{statusActionNotice}</Feedback>}{statusActionError && <Feedback tone="danger">{statusActionError}</Feedback>}{statusRequiresRefresh && <Button variant="secondary" disabled={teams.isFetching || isSubmittingStatus} onClick={() => void refreshTeams()}>Atualizar equipes e conferir</Button>}
    <Feedback tone="info">As funções da equipe servem como referência. Ao agendar, confirme a função que cada pessoa exercerá naquele serviço para aplicar os requisitos corretos.</Feedback>
    <div className="toolbar"><Field label="Buscar equipes"><input type="search" value={query} placeholder="Nome, participante ou função" onChange={event => { const next = new URLSearchParams(search); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setSearch(next, { replace: true }); }} /></Field><Field label="Situação"><select value={statusFilter} onChange={event => { const next = new URLSearchParams(search); if (event.target.value) next.set('status', event.target.value); else next.delete('status'); setSearch(next, { replace: true }); }}><option value="">Todas as situações</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option></select></Field>{(query || statusFilter) && <Button type="button" variant="ghost" onClick={() => setSearch({}, { replace: true })}>Limpar filtros</Button>}</div>
    {inactivatingTeam && !teamError && <form className="panel stack" onSubmit={handleInactivate} style={{ border: '1px solid var(--color-warning-border, #f59e0b)' }}><h3>Inativar equipe: {inactivatingTeam.name}</h3><p className="muted">A inativação preserva o histórico de agendamentos e PTs anteriores, mas oculta esta equipe na criação de novos agendamentos.</p>{staleStatus && <Feedback tone="warning">A equipe mudou. Cancele esta confirmação e confira a situação atual.</Feedback>}<Field label="Motivo da inativação (opcional)"><input type="text" value={inactivationReason} disabled={isSubmittingStatus} onChange={event => setInactivationReason(event.target.value)} placeholder="Ex.: Equipe desmobilizada temporariamente" maxLength={300} /></Field><div className="actions"><Button type="submit" variant="primary" disabled={!writable || isSubmittingStatus || staleStatus}>{isSubmittingStatus ? 'Inativando...' : 'Confirmar inativação'}</Button><Button type="button" variant="secondary" disabled={isSubmittingStatus} onClick={() => { setInactivatingTeam(null); setInactivationReason(''); }}>Cancelar</Button></div></form>}
    {teams.isPending ? <Spinner /> : teamError ? <div className="panel stack"><Feedback tone="danger">{teamErrorMessage(teamError)}</Feedback><Button variant="secondary" onClick={() => void refreshTeams()}>Tentar novamente</Button></div> : !filtered.length ? <EmptyState title={query || statusFilter ? 'Nenhuma equipe encontrada' : 'Nenhuma equipe disponível'} description={query || statusFilter ? 'Revise os filtros de busca para consultar as equipes desta unidade.' : 'Não há equipes vinculadas ao seu escopo nesta unidade.'} /> : <div className={styles.cards}>{filtered.map(team => {
      const isInactive = team.status === 'INACTIVE';
      return <article className="panel stack" key={team.id} aria-label={team.name}><div className={styles.cardHeader}><div><h2><Users size={17} aria-hidden="true" /> {team.name}</h2><p className="muted">{team.members.length} participante(s)</p></div><div className="actions"><Badge tone={isInactive ? 'neutral' : 'success'}>{isInactive ? 'Inativa' : 'Ativa'}</Badge><Badge>Revisão {team.revision}</Badge></div></div>
        {isInactive && team.inactiveReason && <p className="muted" style={{ fontStyle: 'italic', fontSize: '0.85rem' }}>Motivo da inativação: {team.inactiveReason}</p>}
        <div>{team.members.map(person => <div className={styles.teamMember} key={person.workerId}><span>{person.name}{person.workerId === team.chiefId && <> <Badge tone="info">Chefe da equipe</Badge></>}</span><small>{person.serviceFunction}</small></div>)}</div>{!team.members.some(person => person.workerId === team.chiefId) && <p className="muted">Chefe vinculado ao cadastro da equipe.</p>}
        <div className="actions">{can('teams.write') && <><Link className="button button--secondary" aria-label={`Editar equipe ${team.name}`} to={`/app/equipes/${encodeURIComponent(team.id)}/editar`}>Editar equipe</Link>{isInactive ? <Button variant="secondary" disabled={!writable || isSubmittingStatus} onClick={() => void changeStatus(team, 'ACTIVE')}>Reativar equipe</Button> : <><Button variant="secondary" disabled={!writable || isSubmittingStatus} onClick={() => setInviteModalTeam(team)} aria-label={`Convites por link da equipe ${team.name}`}><Link2 size={15} aria-hidden="true" /> Convites por link</Button><Button variant="secondary" disabled={!writable || isSubmittingStatus} onClick={() => { setInactivatingTeam(team); setInactivationReason(''); setStatusActionError(null); }}>Inativar equipe</Button></>}</>}<Link className="button button--secondary" to={`/app/agenda?q=${encodeURIComponent(team.name)}`}>{isInactive ? 'Histórico na agenda' : 'Consultar agenda desta equipe'}</Link></div>
      </article>;
    })}</div>}
    {inviteModalTeam && currentInviteTeam && can('teams.write') && !teamError && <TeamInvitesModal key={JSON.stringify([sessionKey, unitId, currentInviteTeam.id])} team={currentInviteTeam} available={!teams.isFetching && !statusRequiresRefresh} onClose={() => setInviteModalTeam(null)} />}
  </div>;
}

function TeamInvitesModal({ team, available, onClose }: { team: TeamDto; available: boolean; onClose: () => void }) {
  const { sessionKey, unitId, can } = useSession(); const client = useQueryClient();
  const [validityHours, setValidityHours] = useState(48), [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<unknown>(), [inviteSuccess, setInviteSuccess] = useState(''), [busy, setBusy] = useState('');
  const active = useRef(true), request = useRef<AbortController | undefined>(undefined), copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current); }; }, []);
  const key = ['team-invites', sessionKey, unitId, team.id], denialKey = [...key, 'access-denial'];
  const live = Boolean(unitId && unitId === team.unitId && can('teams.read') && can('teams.write'));
  const denial = useQuery<{ error: unknown; revision: number } | null>({ queryKey: denialKey, enabled: false, queryFn: async () => null, initialData: null, staleTime: Infinity, gcTime: Infinity });
  const teamInvites = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    const value = await api.get<unknown>('/team-invites', { signal, query: { teamId: team.id, unitId } });
    return checkedInvites(value, team);
  }, enabled: live });
  const checked = useMemo(() => { try { return { data: teamInvites.data === undefined ? undefined : checkedInvites(teamInvites.data, team), error: undefined }; } catch (error) { return { data: undefined, error }; } }, [teamInvites.data, team.id, team.unitId, team.companyId]);
  function rememberDenial(error: unknown) { client.setQueryData(denialKey, { error, revision: client.getQueryState(key)?.dataUpdateCount || 0 }); }
  const deniedError = checked.error ?? (accessError(teamInvites.error) || teamInvites.error instanceof TeamResponseError ? teamInvites.error : undefined);
  useEffect(() => { if (deniedError) rememberDenial(deniedError); }, [deniedError]);
  const fresh = denial.data && !deniedError && teamInvites.isSuccess && !teamInvites.isFetching && (client.getQueryState(key)?.dataUpdateCount || 0) > denial.data.revision;
  useEffect(() => { if (fresh) { client.setQueryData(denialKey, null); setInviteError(undefined); } }, [client, fresh]);
  const failed = teamInvites.isError || Boolean(checked.error) || Boolean(denial.data) || accessError(inviteError) || inviteError instanceof TeamResponseError;
  const ready = live && available && !failed && !teamInvites.isPending && !teamInvites.isFetching;
  function current(controller: AbortController) { return active.current && !controller.signal.aborted && request.current === controller; }
  async function retry() { const result = await teamInvites.refetch(); if (active.current && result.isSuccess) { client.setQueryData(denialKey, null); setInviteError(undefined); } }
  async function mutateInvite(event: FormEvent | undefined, invite?: TeamInviteDto) {
    event?.preventDefault();
    if (!ready || request.current || !can('teams.write') || !Number.isInteger(validityHours) || validityHours < 1 || validityHours > 168) return;
    if (invite && (invite.status !== 'ACTIVE' || Date.parse(invite.expiresAt) <= Date.now() || !checked.data?.some(item => item.id === invite.id))) return;
    const controller = new AbortController(); request.current = controller; setBusy(invite ? invite.id : 'create'); setInviteError(undefined); setInviteSuccess('');
    try {
      const value = invite ? await api.post<unknown>(`/team-invites/${encodeURIComponent(invite.id)}/revoke`, {}, { signal: controller.signal }) : await api.post<unknown>('/team-invites', { teamId: team.id, validityHours }, { signal: controller.signal });
      if (!current(controller)) return;
      const saved = checkedInvite(value, team);
      if (invite ? saved.id !== invite.id || saved.token !== invite.token || saved.status !== 'REVOKED' : saved.status !== 'ACTIVE' || Date.parse(saved.expiresAt) <= Date.now()) throw new TeamResponseError();
      const previousRevision = client.getQueryState(key)?.dataUpdateCount || 0;
      await client.invalidateQueries({ queryKey: key });
      if (!current(controller)) return;
      const refreshed = client.getQueryState(key);
      if (refreshed?.error) throw refreshed.error;
      if (refreshed?.status !== 'success' || refreshed.fetchStatus !== 'idle' || refreshed.dataUpdateCount <= previousRevision) throw new TeamResponseError();
      checkedInvites(refreshed.data, team);
      if (client.getQueryData(denialKey)) throw new TeamResponseError();
      setInviteSuccess(invite ? 'Convite revogado com sucesso.' : 'Novo link de convite gerado com sucesso!');
      if (!invite && navigator.clipboard) { try { if (!current(controller)) return; await navigator.clipboard.writeText(saved.shareUrl); if (current(controller)) setCopiedInviteId(saved.id); } catch { /* The confirmed invite remains available if copying is refused. */ } }
    } catch (error) { if (current(controller)) { setInviteError(error); if (accessError(error) || error instanceof TeamResponseError) rememberDenial(error); } }
    finally { if (request.current === controller) { request.current = undefined; if (active.current) setBusy(''); } }
  }
  async function copy(invite: TeamInviteDto) {
    if (!ready || request.current || !navigator.clipboard) return;
    const controller = new AbortController(); request.current = controller; setBusy('copy'); setInviteError(undefined);
    try {
      const checked = checkedInvite(invite, team); await navigator.clipboard.writeText(checked.shareUrl);
      if (!current(controller)) return;
      setCopiedInviteId(checked.id); if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { if (active.current) setCopiedInviteId(previous => previous === checked.id ? null : previous); }, 3000);
    } catch (error) { if (current(controller)) setInviteError(error instanceof TeamResponseError ? error : new Error('Não foi possível copiar o link.')); }
    finally { if (request.current === controller) { request.current = undefined; if (active.current) setBusy(''); } }
  }
  return <Modal open title={`Convites da equipe: ${team.name}`} onClose={onClose}><div className="stack" style={{ gap: '1.25rem' }}>
    <p className="muted">Gere links públicos com validade pré-definida para que executantes ou encarregados consultem o escopo, membros e orientações da equipe sem exigir login completo.</p>
    {inviteSuccess && !failed && <Feedback tone="success">{inviteSuccess}</Feedback>}{inviteError !== undefined && !failed && <Feedback tone="danger">{scopedQueryError(inviteError, 'convites')}</Feedback>}
    <form onSubmit={event => void mutateInvite(event)} className="panel stack" style={{ background: 'var(--color-bg-subtle, #f8fafc)' }}><h4>Gerar novo convite por link</h4><div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}><Field label="Validade do link"><select value={validityHours} onChange={event => setValidityHours(Number(event.target.value))} disabled={Boolean(busy) || !ready}><option value={24}>24 horas (1 dia)</option><option value={48}>48 horas (2 dias - padrão)</option><option value={72}>72 horas (3 dias)</option><option value={168}>7 dias (1 semana)</option></select></Field><Button type="submit" variant="primary" disabled={Boolean(busy) || !ready}>{busy === 'create' ? 'Gerando link...' : 'Gerar link de convite'}</Button></div></form>
    <div><h4>Links gerados para esta equipe</h4>{failed ? <div className="stack"><Feedback tone="danger">{scopedQueryError(teamInvites.error ?? checked.error ?? denial.data?.error ?? inviteError, 'convites')}</Feedback><Button variant="secondary" disabled={Boolean(busy) || teamInvites.isFetching} onClick={() => void retry()}>Tentar carregar convites novamente</Button></div> : teamInvites.isPending ? <Spinner /> : !checked.data?.length ? <p className="muted">Nenhum convite gerado para esta equipe até o momento.</p> : <div className="stack" style={{ gap: '0.75rem', marginTop: '0.5rem' }}>{checked.data!.map(inv => {
      const isCopied = copiedInviteId === inv.id, isExpired = Date.parse(inv.expiresAt) <= Date.now() || inv.status === 'EXPIRED';
      const statusText = inv.unavailableReason === 'TEAM_INACTIVE' ? 'Indisponível · equipe inativa' : inv.status === 'REVOKED' ? 'Revogado' : isExpired ? 'Expirado' : 'Ativo';
      return <div key={inv.id} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.85rem', background: inv.status === 'ACTIVE' && !isExpired ? '#fff' : 'var(--color-bg-subtle, #f9fafb)', border: '1px solid var(--color-border, #e5e7eb)' }}><div className="actions"><Badge tone={inv.status === 'REVOKED' ? 'neutral' : isExpired ? 'warning' : 'success'}>{statusText}</Badge><small className="muted">Expira em: {formatDate(inv.expiresAt)}</small><small className="muted">Criado em {formatDate(inv.createdAt)} por {inv.createdByName}</small></div><div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}><input type="text" readOnly value={inv.shareUrl} style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontFamily: 'monospace' }} aria-label={`Link de convite ${inv.token}`} /><Button type="button" variant="secondary" disabled={Boolean(busy) || !ready} onClick={() => void copy(inv)} aria-label={isCopied ? 'Link copiado' : 'Copiar link'}>{isCopied ? <><Check size={14} aria-hidden="true" /> Copiado!</> : <><Copy size={14} aria-hidden="true" /> Copiar link</>}</Button>{API_MODE === 'demo' ? <Link className="button button--ghost" to={`/convite/${encodeURIComponent(inv.token)}`} aria-label="Abrir convite"><ExternalLink size={14} aria-hidden="true" /> Abrir</Link> : <a href={inv.shareUrl} target="_blank" rel="noopener noreferrer" className="button button--ghost" aria-label="Abrir convite em nova aba"><ExternalLink size={14} aria-hidden="true" /> Abrir</a>}{inv.status === 'ACTIVE' && !isExpired && <Button type="button" variant="danger" disabled={Boolean(busy) || !ready} onClick={() => void mutateInvite(undefined, inv)} aria-label="Revogar convite"><Ban size={14} aria-hidden="true" /> {busy === inv.id ? 'Revogando...' : 'Revogar'}</Button>}</div></div>;
    })}</div>}</div>
  </div></Modal>;
}
