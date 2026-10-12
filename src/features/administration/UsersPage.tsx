import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, ApiError, revisionEtag } from '../../shared/api';
import { useSession } from '../../shared/auth/SessionProvider';
import type { OrganizationDto, PageDto, RoleDto, UserDto } from '../../shared/contracts';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { delegatedScope, userAccessSchema, type UserAccessForm } from './schemas';
import { useEditorProtection, type EditorState } from './useEditorProtection';
import styles from './administration.module.css';

function UserForm({ user, onClose, onSaved, onStateChange }: { user?: UserDto; onClose: () => void; onSaved: () => void; onStateChange: (state: EditorState) => void }) {
  const { me, sessionKey, can } = useSession();
  const client = useQueryClient();
  const roles = useQuery({ queryKey: ['roles', sessionKey], queryFn: ({ signal }) => api.get<RoleDto[]>('/roles', { signal }) });
  const organization = useQuery({ queryKey: ['organization', sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }), enabled: can('organization.read') });
  const form = useForm<UserAccessForm>({ resolver: zodResolver(userAccessSchema), defaultValues: { displayName: user?.displayName ?? '', email: user?.email ?? '', roles: user?.roles ?? [], unitIds: user?.scope.unitIds ?? [], ownOnly: user?.scope.ownOnly ?? false, status: user?.status ?? 'INVITED', expiresAt: user?.scope.expiresAt ? localDateInput(user.scope.expiresAt) : '' } });
  const save = useMutation({ mutationFn: async (value: UserAccessForm) => {
    if (!me) throw new Error('Sua sessão não está disponível.');
    const allowedRoles = (roles.data ?? []).filter((role) => !role.permissions.some((permission) => permission.startsWith('documents.medical.') && !can(permission))).map((role) => role.code);
    if (value.roles.some((role) => !allowedRoles.includes(role))) throw new Error('O perfil escolhido não pode ser atribuído pelo seu acesso.');
    const scope = delegatedScope(value, me, user?.scope);
    if (user) return api.patch<UserDto>(`/users/${encodeURIComponent(user.id)}/access`, { roles: value.roles, scope, status: value.status }, { etag: revisionEtag(user.revision) });
    return api.post<UserDto>('/users', { displayName: value.displayName, email: value.email, roles: value.roles, scope }, { idempotencyKey: crypto.randomUUID() });
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: ['users', sessionKey] }); onSaved(); }, onError: (error) => {
    if (!(error instanceof ApiError)) return;
    if (error.status === 412 || error.status === 428) void client.invalidateQueries({ queryKey: ['users', sessionKey] });
    const fields: Record<string, keyof UserAccessForm> = { displayName: 'displayName', email: 'email', roles: 'roles', 'scope.unitIds': 'unitIds', 'scope.expiresAt': 'expiresAt', status: 'status' };
    for (const issue of error.fieldErrors ?? []) { const field = fields[issue.field]; if (field) form.setError(field, { type: 'server', message: issue.message }, { shouldFocus: true }); }
  } });
  useEffect(() => { onStateChange({ dirty: form.formState.isDirty, busy: save.isPending }); return () => onStateChange({ dirty: false, busy: false }); }, [form.formState.isDirty, save.isPending, onStateChange]);
  const visibleRoles = (roles.data ?? []).filter((role) => !role.permissions.some((permission) => permission.startsWith('documents.medical.') && !can(permission)));
  const permittedUnits = organization.data?.units.filter((unit) => me?.scope.unitIds.includes(unit.id)) ?? me?.scope.unitIds.map((id) => ({ id, name: id })) ?? [];
  return <form className="stack" aria-busy={save.isPending} onSubmit={form.handleSubmit((value) => { if (!save.isPending) save.mutate(value); })}><fieldset className="stack" disabled={save.isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <Feedback tone="info">Perfis e escopos são revalidados pela API. Administração não concede acesso médico automaticamente.</Feedback>
    <div className="form-grid"><Field label="Nome" error={form.formState.errors.displayName?.message}><input {...form.register('displayName')} readOnly={!!user} autoComplete="name" /></Field><Field label="E-mail" error={form.formState.errors.email?.message}><input {...form.register('email')} type="email" readOnly={!!user} autoComplete="email" /></Field></div>
    <fieldset className={styles.fieldset}><legend>Perfis autorizados</legend>{roles.isPending && <Spinner />}{roles.isError && <Feedback tone="danger">{roles.error.message}</Feedback>}<div className={styles.options}>{visibleRoles.map((role) => <label key={role.code}><input type="checkbox" value={role.code} {...form.register('roles')} />{role.label}</label>)}</div>{form.formState.errors.roles && <span role="alert" className="field-error">{form.formState.errors.roles.message}</span>}</fieldset>
    <fieldset className={styles.fieldset}><legend>Unidades do escopo</legend><div className={styles.options}>{permittedUnits.map((unit) => <label key={unit.id}><input type="checkbox" value={unit.id} {...form.register('unitIds')} />{unit.name}</label>)}</div>{form.formState.errors.unitIds && <span role="alert" className="field-error">{form.formState.errors.unitIds.message}</span>}</fieldset>
    <label className={styles.check}><input type="checkbox" {...form.register('ownOnly')} />Restringir aos dados próprios</label>
    <div className="form-grid"><Field label="Concessão válida até (horário local)" error={form.formState.errors.expiresAt?.message}><input type="datetime-local" {...form.register('expiresAt')} /></Field>{user && <Field label="Situação"><select {...form.register('status')}><option value="ACTIVE">Ativo</option><option value="DISABLED">Desabilitado</option><option value="INVITED">Convidado</option></select></Field>}</div>
    {save.isError && <Feedback tone="danger">{save.error.message} A alteração não foi confirmada. Reabra o usuário se houver conflito de revisão.</Feedback>}
    <div className="actions"><Button type="submit" disabled={save.isPending || !roles.data}>{save.isPending ? 'Salvando…' : user ? 'Salvar acesso' : 'Enviar convite'}</Button><Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Cancelar</Button></div>
  </fieldset></form>;
}

function localDateInput(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }

export function UsersPage() {
  const { sessionKey, unitId, can } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [selected, setSelected] = useState<UserDto | 'new' | null>(null);
  const [success, setSuccess] = useState('');
  const [editor, setEditor] = useState<EditorState>({ dirty: false, busy: false });
  const closeEditor = useEditorProtection(editor, () => setSelected(null));
  useEffect(() => { setPage(1); setSelected(null); setSuccess(''); }, [sessionKey, unitId]);
  const users = useQuery({ queryKey: ['users', sessionKey, unitId, page, q], queryFn: ({ signal }) => api.get<PageDto<UserDto>>('/users', { query: { unitId, page, pageSize: 20, q: q || undefined }, signal }), enabled: can('users.manage') });
  if (!can('users.manage')) return <Feedback tone="warning">Seu acesso não permite administrar usuários.</Feedback>;
  return <div className="stack"><PageHeader eyebrow="ADMINISTRAÇÃO" title="Usuários e acesso" description="Convites, perfis e concessões no escopo autorizado." actions={<Button onClick={() => { setSuccess(''); setSelected('new'); }}>Convidar usuário</Button>} />
    <form className="panel toolbar" onSubmit={(event) => { event.preventDefault(); setQ(draftQ.trim()); setPage(1); }}><Field label="Pesquisar nome ou e-mail"><input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} /></Field><Button type="submit" variant="secondary">Buscar</Button></form>
    {success && <Feedback tone="success">{success}</Feedback>}{users.isPending && <Spinner />}{users.isError && <Feedback tone="danger">{users.error.message} <Button variant="ghost" onClick={() => users.refetch()}>Tentar novamente</Button></Feedback>}
    {users.data && !users.isError && <section className="panel stack"><div className="table-wrap"><table className="data-table"><thead><tr><th>Usuário</th><th>Perfis</th><th>Escopo</th><th>MFA</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{users.data.items.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><br /><span className="muted">{user.email}</span></td><td>{user.roles.join(', ')}</td><td>{user.scope.unitIds.length} unidades{user.scope.ownOnly && <><br /><small>Somente dados próprios</small></>}{user.scope.expiresAt && <><br /><small>Até {new Date(user.scope.expiresAt).toLocaleDateString('pt-BR')}</small></>}</td><td>{user.mfaRequired ? 'Obrigatório' : 'Conforme política'}</td><td><Badge tone={user.status === 'ACTIVE' ? 'success' : user.status === 'DISABLED' ? 'neutral' : 'info'}>{user.status === 'ACTIVE' ? 'Ativo' : user.status === 'DISABLED' ? 'Desabilitado' : 'Convidado'}</Badge></td><td><Button variant="ghost" onClick={() => { setSuccess(''); setSelected(user); }}>Alterar acesso</Button></td></tr>)}</tbody></table></div>{!users.data.items.length && <EmptyState title="Nenhum usuário encontrado" description="Revise o nome, e-mail ou unidade selecionada." />}<div className="actions"><span className="muted">{users.data.total} usuários · página {page}</span><Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button variant="ghost" disabled={page * users.data.pageSize >= users.data.total} onClick={() => setPage(page + 1)}>Próxima</Button></div></section>}
    <Modal open={selected !== null} title={selected === 'new' ? 'Convidar usuário' : 'Alterar acesso'} onClose={closeEditor}>{selected !== null && <UserForm key={selected === 'new' ? 'new' : selected.id} user={selected === 'new' ? undefined : selected} onStateChange={setEditor} onClose={closeEditor} onSaved={() => { setSuccess(selected === 'new' ? 'Convite confirmado pela API.' : 'Acesso atualizado pela API.'); setSelected(null); }} />}</Modal>
  </div>;
}
