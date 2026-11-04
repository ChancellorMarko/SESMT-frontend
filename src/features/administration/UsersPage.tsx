import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError, revisionEtag } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { OrganizationDto, PageDto, RoleDto, UserDto } from '../../shared/contracts';
import type { TeamDto } from '../../shared/contracts/work-permits';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { delegatedScope, userAccessSchema, type UserAccessForm } from './schemas';
import { useEditorProtection, type EditorState } from './useEditorProtection';
import { useEditorRequest } from './useEditorRequest';
import { appointmentLocal } from '../agenda/support';
import { formatDate } from '../../shared/lib/format';
import { accountInvitationsEnabled } from '../auth/account-invitations';
import { AccountAccessOverview, AccountInvitationPanel } from './AccountInvitationPanel';
import styles from './administration.module.css';

function UserForm({ user, onClose, onSaved, onStateChange }: { user?: UserDto; onClose: () => void; onSaved: () => void; onStateChange: (state: EditorState) => void }) {
  const { me, sessionKey, can } = useSession();
  const client = useQueryClient();
  const request = useEditorRequest();
  const roles = useQuery({ queryKey: ['roles', sessionKey], queryFn: ({ signal }) => api.get<RoleDto[]>('/roles', { signal }) });
  const organization = useQuery({ queryKey: ['organization', sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }), enabled: can('organization.read') });
  const teams = useQuery({ queryKey: ['access-teams', sessionKey], queryFn: ({ signal }) => api.get<TeamDto[]>('/teams', { signal }), enabled: can('teams.read') });
  const [confirmation, setConfirmation] = useState<UserAccessForm | null>(null);
  const [conflict, setConflict] = useState(false);
  const form = useForm<UserAccessForm>({ resolver: zodResolver(userAccessSchema), defaultValues: { displayName: user?.displayName ?? '', email: user?.email ?? '', roles: user?.roles ?? [], companyIds: user?.scope.companyIds ?? [], unitIds: user?.scope.unitIds ?? [], teamIds: user?.scope.teamIds ?? me?.scope.teamIds ?? [], ownOnly: user?.scope.ownOnly ?? me?.scope.ownOnly ?? false, status: user?.status ?? 'INVITED', expiresAt: (user?.scope.expiresAt ?? me?.scope.expiresAt) ? localDateInput((user?.scope.expiresAt ?? me!.scope.expiresAt)!) : '' } });
  const save = useMutation({ mutationFn: (value: UserAccessForm) => request.run(async signal => {
    if (!me) throw new Error('Sua sessão não está disponível.');
    const allowedRoles = (roles.data ?? []).filter((role) => !role.permissions.some((permission) => permission.startsWith('documents.medical.') && !can(permission))).map((role) => role.code);
    if (value.roles.some((role) => !allowedRoles.includes(role))) throw new Error('O perfil escolhido não pode ser atribuído pelo seu acesso.');
    if (!organization.data || organization.isError || organization.isFetching || !can('organization.read')) throw new Error('Aguarde a consulta atual de empresas e unidades antes de salvar.');
    if (roles.isFetching || roles.isError) throw new Error('Aguarde a consulta atual dos perfis antes de salvar.');
    if (value.teamIds.length && (!teams.data || teams.isError || teams.isFetching || !can('teams.read'))) throw new Error('Aguarde a consulta atual de equipes antes de salvar.');
    if (!manageable) throw new Error('O acesso existente contém restrições fora da sua autoridade.');
    if (user?.status === 'INVITED' && value.status === 'ACTIVE') throw new Error('A pessoa precisa definir a própria senha pelo convite antes de ativar a conta.');
    const scope = delegatedScope(value, me, user?.scope, organization.data, teams.data);
    if (user) return api.patch<UserDto>(`/users/${encodeURIComponent(user.id)}/access`, { roles: value.roles, scope: { ...scope, ...(user.scope.expiresAt && !scope.expiresAt ? { expiresAt: null } : {}) }, status: value.status }, { etag: revisionEtag(user.revision), signal });
    return api.post<UserDto>('/users', { displayName: value.displayName, email: value.email, roles: value.roles, scope }, { idempotencyKey: crypto.randomUUID(), signal });
  }), onSuccess: async () => { if (!request.isActive()) return; await client.invalidateQueries({ queryKey: ['users', sessionKey] }); if (request.isActive()) onSaved(); }, onError: (error) => {
    if (!request.isActive() || !(error instanceof ApiError)) return;
    if (error.status === 412 || error.status === 428) { setConflict(true); setConfirmation(null); void client.invalidateQueries({ queryKey: ['users', sessionKey] }); }
    const fields: Record<string, keyof UserAccessForm> = { displayName: 'displayName', email: 'email', roles: 'roles', 'scope.companyIds': 'companyIds', 'scope.unitIds': 'unitIds', 'scope.teamIds': 'teamIds', 'scope.expiresAt': 'expiresAt', 'scope.ownOnly': 'ownOnly', status: 'status' };
    for (const issue of error.fieldErrors ?? []) { const field = fields[issue.field]; if (field) form.setError(field, { type: 'server', message: issue.message }, { shouldFocus: true }); }
  } });
  useEffect(() => { onStateChange({ dirty: form.formState.isDirty || !!confirmation, busy: save.isPending || !!confirmation }); return () => onStateChange({ dirty: false, busy: false }); }, [form.formState.isDirty, save.isPending, confirmation, onStateChange]);
  const visibleRoles = (roles.data ?? []).filter((role) => !role.permissions.some((permission) => permission.startsWith('documents.medical.') && !can(permission)));
  const companyIds = form.watch('companyIds'); const unitIds = form.watch('unitIds'); const teamIds = form.watch('teamIds');
  const restrictedSubset = (child: string[], authority: string[]) => !authority.length || child.length > 0 && child.every(id => authority.includes(id));
  const manageable = !user || !!me && user.scope.companyIds.every(id => me.scope.companyIds.includes(id)) && user.scope.unitIds.every(id => me.scope.unitIds.includes(id)) && restrictedSubset(user.scope.teamIds, me.scope.teamIds) && restrictedSubset(user.scope.sectorIds, me.scope.sectorIds) && (!me.scope.ownOnly || user.scope.ownOnly);
  const permittedCompanies = organization.data?.companies.filter(company => me?.scope.companyIds.includes(company.id) && (company.status === 'ACTIVE' || user?.scope.companyIds.includes(company.id))) ?? [];
  const permittedUnits = organization.data?.units.filter(unit => me?.scope.unitIds.includes(unit.id) && companyIds.includes(unit.companyId ?? '') && (unit.status === 'ACTIVE' || user?.scope.unitIds.includes(unit.id))) ?? [];
  const permittedTeams = teams.data?.filter(team => me?.scope.companyIds.includes(team.companyId) && me.scope.unitIds.includes(team.unitId) && (!me.scope.teamIds.length || me.scope.teamIds.includes(team.id)) && companyIds.includes(team.companyId) && unitIds.includes(team.unitId) && (team.status !== 'INACTIVE' || user?.scope.teamIds.includes(team.id))) ?? [];
  const orphanUnits = unitIds.filter(id => !permittedUnits.some(unit => unit.id === id)); const orphanTeams = teamIds.filter(id => !permittedTeams.some(team => team.id === id));
  const ready = !!roles.data && !roles.isError && !roles.isFetching && !!organization.data && !organization.isError && !organization.isFetching && can('organization.read') && (!teamIds.length || !!teams.data && !teams.isError && !teams.isFetching && can('teams.read')) && manageable && !conflict;
  const closeConfirmation = () => { if (!save.isPending && !request.isPending()) setConfirmation(null); };
  return <><form className="stack" aria-busy={save.isPending} onSubmit={form.handleSubmit((value) => {
    if (!ready || save.isPending || request.isPending() || confirmation) return;
    if (user && user.status !== 'DISABLED' && value.status === 'DISABLED') setConfirmation(structuredClone(value));
    else save.mutate(value);
  })}><fieldset className="stack" disabled={save.isPending || !!confirmation || !manageable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <Feedback tone="info">Perfis e escopos são revalidados pela API. Administração não concede acesso médico automaticamente.</Feedback>
    <div className="form-grid"><Field required label="Nome" error={form.formState.errors.displayName?.message}><input {...form.register('displayName')} readOnly={!!user} autoComplete="name" /></Field><Field required label="E-mail" error={form.formState.errors.email?.message}><input {...form.register('email')} type="email" readOnly={!!user} autoComplete="email" /></Field></div>
    <fieldset className={styles.fieldset}><legend>Perfis autorizados</legend>{roles.isPending && <Spinner />}{roles.isError && <Feedback tone="danger">{roles.error.message}</Feedback>}<div className={styles.options}>{visibleRoles.map((role) => <label key={role.code}><input type="checkbox" value={role.code} {...form.register('roles')} />{role.label}</label>)}</div>{form.formState.errors.roles && <span role="alert" className="field-error">{form.formState.errors.roles.message}</span>}</fieldset>
    {organization.isPending && can('organization.read') && <Spinner />}{organization.isError && <Feedback tone="danger">{organization.error.message} <Button variant="ghost" onClick={() => organization.refetch()}>Consultar organização novamente</Button></Feedback>}
    {!can('organization.read') && <Feedback tone="warning">É necessário acesso à organização para conferir a concessão.</Feedback>}
    {!manageable && <Feedback tone="warning">O acesso existente contém restrições fora da sua autoridade. Peça a alteração a um administrador com o escopo completo.</Feedback>}
    <fieldset className={styles.fieldset}><legend>Empresas autorizadas</legend><div className={styles.options}>{permittedCompanies.map(company => <label key={company.id}><input type="checkbox" value={company.id} {...form.register('companyIds')} />{company.name}{company.status === 'INACTIVE' ? ' · inativa' : ''}</label>)}</div>{form.formState.errors.companyIds && <span role="alert" className="field-error">{form.formState.errors.companyIds.message}</span>}</fieldset>
    <fieldset className={styles.fieldset}><legend>Unidades do escopo</legend><div className={styles.options}>{permittedUnits.map((unit) => <label key={unit.id}><input type="checkbox" value={unit.id} {...form.register('unitIds')} />{unit.name}</label>)}</div>{form.formState.errors.unitIds && <span role="alert" className="field-error">{form.formState.errors.unitIds.message}</span>}</fieldset>
    {!!orphanUnits.length && <Feedback tone="warning">Há unidades selecionadas incompatíveis com as empresas atuais. Recoloque a empresa ou remova a unidade explicitamente.<div className={styles.options}>{orphanUnits.map(id => <label key={id}><input type="checkbox" value={id} {...form.register('unitIds')} />Unidade incompatível · {organization.data?.units.find(unit => unit.id === id)?.name ?? id}</label>)}</div></Feedback>}
    <fieldset className={styles.fieldset}><legend>Equipes autorizadas</legend>{teams.isPending && can('teams.read') && <Spinner />}{teams.isError && <Feedback tone="danger">{teams.error.message} <Button variant="ghost" onClick={() => teams.refetch()}>Consultar equipes novamente</Button></Feedback>}<p className="muted">{me?.scope.teamIds.length ? 'Selecione ao menos uma equipe do seu escopo.' : 'Sem seleção, o acesso abrange todas as equipes das empresas e unidades escolhidas.'}</p><div className={styles.options}>{permittedTeams.map(team => <label key={team.id}><input type="checkbox" value={team.id} {...form.register('teamIds')} />{team.name}{team.status === 'INACTIVE' ? ' · inativa' : ''}</label>)}</div>{form.formState.errors.teamIds && <span role="alert" className="field-error">{form.formState.errors.teamIds.message}</span>}</fieldset>
    {!!orphanTeams.length && <Feedback tone="warning">Há equipes selecionadas incompatíveis. Recoloque a empresa e a unidade ou remova a equipe explicitamente.<div className={styles.options}>{orphanTeams.map(id => <label key={id}><input type="checkbox" value={id} {...form.register('teamIds')} />Equipe incompatível · {teams.data?.find(team => team.id === id)?.name ?? id}</label>)}</div></Feedback>}
    {!!(user?.scope.sectorIds.length ?? me?.scope.sectorIds.length) && <p className="muted">A restrição existente de setores será preservada nas unidades selecionadas.</p>}
    <label className={styles.check}><input type="checkbox" {...form.register('ownOnly')} />Restringir aos dados próprios</label>
    <div className="form-grid"><Field required={Boolean(me?.scope.expiresAt) || form.watch('status') !== 'DISABLED' && form.watch('roles').includes('AUDITOR')} label="Concessão válida até (São Paulo)" error={form.formState.errors.expiresAt?.message}><input type="datetime-local" {...form.register('expiresAt')} /></Field>{user && <Field required label="Situação"><select {...form.register('status')}><option value="ACTIVE" disabled={user.status === 'INVITED'}>Ativo</option><option value="DISABLED">Desabilitado</option><option value="INVITED">Convidado</option></select></Field>}</div>
    {user?.status === 'INVITED' && <p className="muted small">A ativação é concluída pela pessoa ao definir a senha pelo convite. Você pode ajustar a concessão ou desabilitar o acesso.</p>}
    {save.isError && <Feedback tone="danger">{save.error.message} A alteração não foi confirmada. Reabra o usuário se houver conflito de revisão.</Feedback>}
    {conflict && <Feedback tone="warning">Seu preenchimento foi preservado. Feche e reabra o cadastro para conferir a revisão atual antes de reenviar.</Feedback>}
    <div className="actions"><Button type="submit" disabled={save.isPending || !ready}>{save.isPending ? 'Salvando…' : user ? 'Salvar acesso' : 'Enviar convite'}</Button><Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Cancelar</Button></div>
  </fieldset></form><Modal open={!!confirmation} title="Confirmar desativação do acesso" onClose={closeConfirmation}>{confirmation && user && <div className="stack">
    <Feedback tone="warning">Ao confirmar, esta pessoa perde o acesso à plataforma. A API deve revogar suas sessões ativas.</Feedback>
    <dl className={styles.detail}><dt>Pessoa</dt><dd>{user.displayName} · {user.email}</dd><dt>Empresas</dt><dd>{confirmation.companyIds.map(id => organization.data?.companies.find(company => company.id === id)?.name ?? id).join(', ')}</dd><dt>Unidades</dt><dd>{confirmation.unitIds.map(id => organization.data?.units.find(unit => unit.id === id)?.name ?? id).join(', ')}</dd><dt>Equipes</dt><dd>{confirmation.teamIds.length ? confirmation.teamIds.map(id => teams.data?.find(team => team.id === id)?.name ?? id).join(', ') : 'Todas as equipes do escopo selecionado'}</dd><dt>Revisão conferida</dt><dd>{user.revision}</dd></dl>
    {save.isError && <Feedback tone="danger">{save.error.message} A desativação não foi confirmada.</Feedback>}
    <div className="actions"><Button variant="secondary" onClick={closeConfirmation} disabled={save.isPending}>Voltar à edição</Button><Button variant="danger" onClick={() => { if (!save.isPending && !request.isPending() && !conflict) save.mutate(confirmation); }} disabled={save.isPending || conflict}>{save.isPending ? 'Desativando…' : 'Confirmar desativação'}</Button></div>
  </div>}</Modal></>;
}

function localDateInput(value: string) { return appointmentLocal(value); }

export function UsersPage() {
  const { sessionKey, unitId, can } = useSession();
  return <UsersPageContent key={`${sessionKey}:${unitId}:${can('users.manage')}`} />;
}

function UsersPageContent() {
  const { sessionKey, unitId, can } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [selected, setSelected] = useState<UserDto | 'new' | null>(null);
  const [invitation, setInvitation] = useState<UserDto | null>(null);
  const [success, setSuccess] = useState('');
  const [editor, setEditor] = useState<EditorState>({ dirty: false, busy: false });
  const closeEditor = useEditorProtection(editor, () => setSelected(null));
  const users = useQuery({ queryKey: ['users', sessionKey, unitId, page, q], queryFn: ({ signal }) => api.get<PageDto<UserDto>>('/users', { query: { unitId, page, pageSize: 20, q: q || undefined }, signal }), enabled: can('users.manage') });
  const unavailable = users.isError && users.error instanceof ApiError && [401, 403, 404].includes(users.error.status);
  useEffect(() => { if (unavailable) { setSelected(null); setInvitation(null); } }, [unavailable]);
  if (!can('users.manage')) return <Feedback tone="warning">Seu acesso não permite administrar usuários.</Feedback>;
  if (unavailable) return <Feedback tone="danger">{users.error!.message} <Button variant="ghost" onClick={() => users.refetch()}>Tentar novamente</Button></Feedback>;
  return <div className="stack"><PageHeader eyebrow="ADMINISTRAÇÃO" title="Usuários e acesso" description="Convites, perfis e concessões no escopo autorizado." actions={<Button onClick={() => { setSuccess(''); setSelected('new'); }}>Convidar usuário</Button>} />
    <AccountAccessOverview />
    <form className="panel toolbar" onSubmit={(event) => { event.preventDefault(); setQ(draftQ.trim()); setPage(1); }}><Field label="Pesquisar nome ou e-mail"><input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} /></Field><Button type="submit" variant="secondary">Buscar</Button></form>
    {success && <Feedback tone="success">{success}</Feedback>}{users.isPending && <Spinner />}{users.isError && <Feedback tone="danger">{users.error.message} <Button variant="ghost" onClick={() => users.refetch()}>Tentar novamente</Button></Feedback>}
    {users.data && !users.isError && <section className="panel stack"><div className="table-wrap"><table className="data-table"><thead><tr><th>Usuário</th><th>Perfis</th><th>Escopo</th><th>MFA</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{users.data.items.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><br /><span className="muted">{user.email}</span></td><td>{user.roles.join(', ')}</td><td>{user.scope.unitIds.length} unidades{user.scope.ownOnly && <><br /><small>Somente dados próprios</small></>}{user.scope.expiresAt && <><br /><small>Até {formatDate(user.scope.expiresAt)}</small></>}</td><td>{user.mfaRequired ? 'Obrigatório' : 'Conforme política'}</td><td><Badge tone={user.status === 'ACTIVE' ? 'success' : user.status === 'DISABLED' ? 'neutral' : 'info'}>{user.status === 'ACTIVE' ? 'Ativo' : user.status === 'DISABLED' ? 'Desabilitado' : 'Convidado'}</Badge></td><td><div className="actions"><Button variant="ghost" onClick={() => { setSuccess(''); setSelected(user); }}>Alterar acesso</Button>{user.status === 'INVITED' && accountInvitationsEnabled() && <Button variant="secondary" onClick={() => setInvitation(user)}>Consultar convite</Button>}</div></td></tr>)}</tbody></table></div>{!users.data.items.length && <EmptyState title="Nenhum usuário encontrado" description="Revise o nome, e-mail ou unidade selecionada." />}<div className="actions"><span className="muted">{users.data.total} usuários · página {page}</span><Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="ghost" disabled={page * users.data.pageSize >= users.data.total} onClick={() => setPage(page + 1)}>Próxima</Button></div></section>}
    <Modal open={selected !== null} title={selected === 'new' ? 'Convidar usuário' : 'Alterar acesso'} onClose={closeEditor}>{selected !== null && <UserForm key={selected === 'new' ? 'new' : selected.id} user={selected === 'new' ? undefined : selected} onStateChange={setEditor} onClose={closeEditor} onSaved={() => { setSuccess(selected === 'new' ? 'Convite confirmado pela API.' : 'Acesso atualizado pela API.'); setSelected(null); }} />}</Modal>
    <Modal open={invitation !== null} title="Convite de conta" onClose={() => setInvitation(null)}>{invitation && (users.isFetching ? <Spinner /> : users.data?.items.some(user => user.id === invitation.id && user.revision === invitation.revision && user.status === 'INVITED') && !users.isError ? <AccountInvitationPanel user={invitation} onNavigate={() => setInvitation(null)} /> : <Feedback tone="warning">O cadastro deste convite mudou ou não está disponível na consulta atual. Feche esta janela e consulte a pessoa novamente.</Feedback>)}</Modal>
  </div>;
}
