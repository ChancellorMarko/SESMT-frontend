import { useState } from 'react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { InvalidReadResponse, useVerifiedRead } from '../../shared/lib/verified-read';
import { Button, Feedback, Field, Modal, Spinner } from '../../shared/ui';
import { NativeCommandDialog, NativeContextConflict, NativeFormError } from '../native-operations/NativeCommandDialog';
import { checkedNativeUsers, checkedUserAccess, checkedUserContext, nativeUserDetails, sameUserSelection, type UserManagementContext } from './native-users';
import styles from './NativeUsersPage.module.css';

export function NativeUserAccessEditor({ userId, onClose, onSaved }: { userId?: string; onClose: () => void; onSaved: (created: boolean) => Promise<void> }) {
  const { sessionKey, can } = useSession();
  const action = userId ? 'editar' : 'criar', allowed = can(userId ? 'users.edit' : 'usuario:criar');
  const snapshot = useVerifiedRead({ queryKey: ['native-user-management', sessionKey, action, userId ?? 'new'], enabled: allowed,
    request: signal => api.get<unknown>('/users/management-context', { query: { action, userId }, signal }),
    validate: value => checkedUserContext(value, action, userId) });
  if (allowed && snapshot.data) return <AccessForm context={snapshot.data} refreshing={snapshot.isFetching} onClose={onClose} onSaved={onSaved}/>;
  return <Modal open title={userId ? 'Acessos da conta' : 'Cadastrar usuário'} onClose={onClose}>
    {snapshot.isPending ? <Spinner/> : <Feedback tone="warning">Não foi possível consultar os perfis e locais autorizados para esta conta. Confira a autorização e atualize a lista.</Feedback>}
    <Button variant="secondary" onClick={onClose}>Fechar</Button>
  </Modal>;
}

function AccessForm({ context, refreshing, onClose, onSaved }: { context: UserManagementContext; refreshing: boolean; onClose: () => void; onSaved: (created: boolean) => Promise<void> }) {
  const { can } = useSession();
  const target = context.target, creating = !target;
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [roles, setRoles] = useState(target?.roles ?? []), [scopeIds, setScopeIds] = useState(target?.scopeIds ?? []);
  const [confirmed, setConfirmed] = useState(false), [search, setSearch] = useState('');
  // Preserve the revision reviewed when this form opened, including after a background refetch.
  const [opening] = useState(context);
  const dirty = creating ? Boolean(name || email || roles.length || scopeIds.length) : !sameUserSelection(roles, opening.target!.roles) || !sameUserSelection(scopeIds, opening.target!.scopeIds);
  const ready = opening.roles.length > 0 && opening.scopes.length > 0;
  const visibleScopes = opening.scopes.filter(scope => `${scope.name} ${scope.companyName}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];

  async function perform(signal: AbortSignal) {
    if (!can(creating ? 'usuario:criar' : 'users.edit')) throw new NativeContextConflict('Seu acesso mudou. Atualize a consulta.');
    if (!confirmed || !roles.length || !scopeIds.length) throw new NativeFormError('Selecione ao menos um perfil e um local e confirme os acessos.');
    const details = nativeUserDetails.safeParse({ name, email });
    if (creating && !details.success) throw new NativeFormError(details.error.issues[0].message);
    const fresh = checkedUserContext(await api.get<unknown>('/users/management-context', { query: { action: opening.action, userId: target?.id }, signal }), opening.action, target?.id);
    if (!roles.every(code => fresh.roles.some(role => role.code === code)) || !scopeIds.every(id => fresh.scopes.some(scope => scope.id === id))
      || !creating && (fresh.accessVersion !== opening.accessVersion || fresh.target?.name !== opening.target?.name || fresh.target?.email !== opening.target?.email))
      throw new NativeContextConflict('A conta ou os acessos disponíveis mudaram. Seus dados foram mantidos; feche e consulte novamente.');
    let storedId: string;
    if (creating && details.success) {
      let receipt: unknown;
      try { receipt = await api.post<unknown>('/users', { ...details.data, roles, scopeIds }, { signal, idempotencyKey: undefined }); }
      catch (error) { if (error instanceof ApiError && error.status === 409 && error.code === 'DUPLICATE_EMAIL') throw new NativeFormError('Já existe uma conta com este e-mail. Confira a lista ou informe outro e-mail.'); throw error; }
      const saved = checkedNativeUsers([receipt])[0];
      if (saved.name !== details.data.name || saved.email !== details.data.email || !saved.active || !sameUserSelection(saved.roles, roles) || !sameUserSelection(saved.scopeIds, scopeIds)) throw new InvalidReadResponse();
      storedId = saved.id;
    } else if (target && opening.accessVersion) {
      const saved = checkedUserAccess(await api.put<unknown>(`/users/${target.id}/access`, { roles, scopeIds, expectedVersion: opening.accessVersion, confirmation: true }, { signal, idempotencyKey: undefined }), target.id, roles, scopeIds, opening.accessVersion);
      storedId = saved.user.id;
    } else throw new InvalidReadResponse();
    const stored = checkedNativeUsers(await api.get<unknown>('/users', { signal })).find(user => user.id === storedId);
    if (!stored || !stored.active || !sameUserSelection(stored.roles, roles) || !sameUserSelection(stored.scopeIds, scopeIds)) throw new InvalidReadResponse();
  }

  return <NativeCommandDialog title={creating ? 'Cadastrar usuário' : `Acessos de ${opening.target!.name}`} dirty={dirty} disabled={!ready || refreshing || !dirty || !confirmed}
    onClose={onClose} onDone={() => onSaved(creating)} perform={perform} submitLabel={creating ? 'Cadastrar usuário' : 'Salvar acessos'}>{busy => <>
    {creating ? <div className={styles.identityFields}><Field label="Nome" required><input value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)}/></Field><Field label="E-mail" required><input type="email" value={email} maxLength={200} disabled={busy} onChange={event => setEmail(event.target.value)}/></Field></div> : <p className={styles.accessHint}>{opening.target!.email}</p>}
    {!ready ? <Feedback tone="warning">{!opening.scopes.length ? 'Não há locais disponíveis. Cadastre a estrutura da organização ou solicite acesso a uma empresa ou unidade.' : 'Não há perfis ativos disponíveis para atribuição.'}</Feedback> : <>
      <fieldset className={styles.selection}><legend>Perfis de acesso</legend><div className={styles.options}>{opening.roles.map(role => <label key={role.code} className={styles.option}><input type="checkbox" checked={roles.includes(role.code)} disabled={busy} onChange={() => { setRoles(toggle(roles, role.code)); setConfirmed(false); }}/><span>{role.name}<small>{role.description}</small></span></label>)}</div></fieldset>
      <fieldset className={styles.selection}><legend>Locais autorizados</legend><Field label="Filtrar locais"><input type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)}/></Field><div className={styles.options}>{visibleScopes.map(scope => <label key={scope.id} className={styles.option}><input type="checkbox" checked={scopeIds.includes(scope.id)} disabled={busy} onChange={() => { setScopeIds(toggle(scopeIds, scope.id)); setConfirmed(false); }}/><span>{scope.name}<small>{scope.type === 'EMPRESA' ? 'Empresa inteira' : `${scope.type === 'UNIDADE' ? 'Unidade' : 'Setor'} · ${scope.companyName}`}</small></span></label>)}{!visibleScopes.length && <p>Nenhum local encontrado.</p>}</div><p className={styles.accessHint}>{scopeIds.length} local(is) selecionado(s). A seleção de uma empresa abrange seus locais.</p></fieldset>
      <label className={styles.option}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/><span>Confirmo os {roles.length} perfil(is) e {scopeIds.length} local(is) selecionados para esta conta.</span></label>
    </>}
    <p className={styles.accessHint}>{creating ? 'Após o cadastro, a pessoa define a senha em “Esqueci minha senha”. O envio depende do serviço de e-mail configurado.' : 'A pessoa deve entrar novamente para atualizar o menu e as permissões da sessão.'}</p>
  </>}</NativeCommandDialog>;
}
