import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, Modal, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeUsers, nativeUserDetails, type NativeUser } from './native-users';
import { InvalidReadResponse } from '../../shared/lib/verified-read';
import { useEditorRequest } from './useEditorRequest';
import { useEditorProtection } from './useEditorProtection';
import styles from './NativeUsersPage.module.css';

export function NativeUsersPage() {
  const { sessionKey, can } = useSession();
  return <Users key={JSON.stringify([sessionKey, can('users.read'), can('users.edit'), can('users.deactivate')])}/>;
}
function Users() {
  const { sessionKey, can, me } = useSession(), client = useQueryClient();
  const allowed = can('users.read');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ user: NativeUser; action: 'edit' | 'deactivate' }>();
  const [confirmation, setConfirmation] = useState('');
  const users = useVerifiedRead({
    queryKey: ['native-users', sessionKey], enabled: allowed,
    request: signal => api.get<unknown>('/users', { signal }), validate: checkedNativeUsers,
  });
  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar usuários.</Feedback>;
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const matching = (users.data ?? []).filter(user => [user.name, user.email, ...user.roles].some(value => value.toLocaleLowerCase('pt-BR').includes(term)));
  const pageCount = Math.max(1, Math.ceil(matching.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visible = matching.slice((currentPage - 1) * 10, currentPage * 10);
  const failure = users.error instanceof ApiError && users.error.status === 403
    ? 'A API não autorizou a consulta de usuários. Solicite a conferência das permissões e dos escopos da conta.'
    : users.error instanceof ApiError && users.error.status === 404
      ? 'A consulta de usuários não está disponível nesta API.'
      : 'Não foi possível conferir a lista de usuários. Tente atualizar a consulta.';
  return <div className="stack">
    <PageHeader title="Usuários e acesso" description="Consulta das contas autorizadas pela API. A relação segue os escopos da sua conta e não é filtrada pela unidade selecionada no cabeçalho." actions={<Button variant="secondary" disabled={users.isFetching} onClick={() => void users.refetch()}>Atualizar usuários</Button>} />
    <div className={`panel ${styles.filters}`}><Field label="Buscar por nome, e-mail ou perfil"><input type="search" value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setPage(1); }} /></Field><Badge>{can('users.edit') || can('users.deactivate') ? 'Escopo da conta' : 'Escopo da conta · somente leitura'}</Badge></div>
    {confirmation && !users.isError && <Feedback tone="success">{confirmation}</Feedback>}
    {users.isPending ? <Spinner/> : users.isError ? <Feedback tone="danger">{failure}</Feedback> : users.data && <section className={styles.results} aria-label="Contas autorizadas" aria-busy={users.isFetching}>
      <p role="status" className={styles.count}>{matching.length} conta(s) encontrada(s)</p>
      {!matching.length ? <EmptyState title="Nenhuma conta encontrada" description="Ajuste a busca ou confira os acessos atribuídos na API." /> : <>
        <div className={styles.scroll}><table role="table" className={`data-table ${styles.table}`} aria-label="Lista de usuários"><thead role="rowgroup"><tr role="row"><th scope="col">Pessoa e e-mail</th><th scope="col">Perfis</th><th scope="col">Situação e ações</th></tr></thead><tbody role="rowgroup">{visible.map(user => <tr role="row" key={user.id}><td role="cell"><strong>{user.name}</strong><span className={styles.email}>{user.email}</span></td><td role="cell">{user.roles.length ? user.roles.join(' · ') : 'Sem perfil atribuído'}</td><td role="cell"><Badge tone={user.active ? 'success' : 'neutral'}>{user.active ? 'Ativo' : 'Inativo'}</Badge><div className={styles.commands}>{can('users.edit') && <Button variant="ghost" disabled={users.isFetching} aria-label={`Editar ${user.name}`} onClick={() => { setConfirmation(''); setSelected({ user, action: 'edit' }); }}>Editar</Button>}{can('users.deactivate') && user.active && user.id !== me?.user.id && <Button variant="ghost" disabled={users.isFetching} aria-label={`Desativar ${user.name}`} onClick={() => { setConfirmation(''); setSelected({ user, action: 'deactivate' }); }}>Desativar</Button>}</div></td></tr>)}</tbody></table></div>
        <nav className={styles.pagination} aria-label="Paginação de usuários"><span>Página {currentPage} de {pageCount}</span><div className="actions"><Button variant="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button><Button variant="secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</Button></div></nav>
      </>}
    </section>}
    {selected && users.data?.some(user => user.id === selected.user.id) && <NativeUserEditor key={`${selected.action}:${selected.user.id}`} user={selected.user} action={selected.action} onClose={() => setSelected(undefined)} onSaved={async () => { setSelected(undefined); setConfirmation(selected.action === 'edit' ? 'Dados atualizados.' : 'Conta desativada.'); await client.invalidateQueries({ queryKey: ['native-users', sessionKey] }); }}/>}
  </div>;
}

function NativeUserEditor({ user, action, onClose, onSaved }: { user: NativeUser; action: 'edit' | 'deactivate'; onClose: () => void; onSaved: () => Promise<void> }) {
  const { can, me } = useSession(), request = useEditorRequest();
  const [name, setName] = useState(user.name), [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const editing = action === 'edit', dirty = editing && (name !== user.name || email !== user.email);
  const close = useEditorProtection({ dirty, busy }, onClose);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (request.isPending() || blocked || !can(editing ? 'users.edit' : 'users.deactivate') || !editing && (!user.active || user.id === me?.user.id)) return;
    const parsed = nativeUserDetails.safeParse({ name, email });
    if (editing && !parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError('');
    try {
      await request.run(async signal => {
        if (editing && parsed.success) {
          const response = checkedNativeUsers([await api.patch<unknown>(`/users/${encodeURIComponent(user.id)}`, parsed.data, { signal })])[0];
          if (response.id !== user.id || response.name !== parsed.data.name || response.email.toLowerCase() !== parsed.data.email) throw new InvalidReadResponse();
        } else {
          const response = await api.post<unknown>(`/users/${encodeURIComponent(user.id)}/deactivate`, undefined, { signal });
          if (response !== undefined) throw new InvalidReadResponse();
        }
      });
      if (request.isActive()) await onSaved();
    } catch (failure) {
      if (!request.isActive()) return;
      const denied = failure instanceof ApiError && [401, 403, 404].includes(failure.status) || failure instanceof InvalidReadResponse;
      setBlocked(denied);
      setError(denied ? 'Não foi possível confirmar a autorização ou a resposta desta operação. Feche a janela e atualize a lista antes de tentar novamente.'
        : failure instanceof ApiError && failure.status === 409 ? editing ? 'Este e-mail já está em uso ou o cadastro mudou. Confira os dados antes de tentar novamente.' : 'A API recusou a desativação desta conta. Atualize a lista antes de tentar novamente.'
        : 'Não foi possível concluir a operação. Seus dados foram mantidos para uma nova tentativa.');
    } finally { if (request.isActive()) setBusy(false); }
  }
  return <Modal open title={editing ? 'Editar usuário' : 'Desativar conta'} onClose={close}><form onSubmit={event => void save(event)} className="stack">
    {editing ? <><Field label="Nome" required><input value={name} disabled={busy} maxLength={200} onChange={event => setName(event.target.value)}/></Field><Field label="E-mail" required><input type="email" value={email} disabled={busy} maxLength={254} onChange={event => setEmail(event.target.value)}/></Field></> : <p>Desativar a conta de <strong>{user.name}</strong> ({user.email})? A pessoa perderá o acesso à plataforma.</p>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    <div className="actions"><Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button><Button type="submit" variant={editing ? 'primary' : 'danger'} disabled={busy || blocked || editing && !dirty}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Confirmar desativação'}</Button></div>
  </form></Modal>;
}
