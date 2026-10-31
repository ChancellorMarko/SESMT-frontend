import { useState } from 'react';
import { api, ApiError } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { useVerifiedRead } from '../../shared/lib/verified-read';
import { Badge, Button, EmptyState, Feedback, Field, PageHeader, Spinner } from '../../shared/ui';
import { checkedNativeUsers } from './native-users';
import styles from './NativeUsersPage.module.css';

/** Reads the published native UserResponse; it never sends legacy invite/edit DTOs. */
export function NativeUsersPage() {
  const { sessionKey, can } = useSession();
  const allowed = can('users.read');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
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
    <div className={`panel ${styles.filters}`}><Field label="Buscar por nome, e-mail ou perfil"><input type="search" value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setPage(1); }} /></Field><Badge>Escopo da conta · somente leitura</Badge></div>
    {users.isPending ? <Spinner/> : users.isError ? <Feedback tone="danger">{failure}</Feedback> : users.data && <section className={styles.results} aria-label="Contas autorizadas" aria-busy={users.isFetching}>
      <p role="status" className={styles.count}>{matching.length} conta(s) encontrada(s)</p>
      {!matching.length ? <EmptyState title="Nenhuma conta encontrada" description="Ajuste a busca ou confira os acessos atribuídos na API." /> : <>
        <table role="table" className={`data-table ${styles.table}`} aria-label="Lista de usuários"><thead role="rowgroup"><tr role="row"><th scope="col">Pessoa e e-mail</th><th scope="col">Perfis</th><th scope="col">Situação</th></tr></thead><tbody role="rowgroup">{visible.map(user => <tr role="row" key={user.id}><td role="cell"><strong>{user.name}</strong><span className={styles.email}>{user.email}</span></td><td role="cell">{user.roles.length ? user.roles.join(' · ') : 'Sem perfil atribuído'}</td><td role="cell"><Badge tone={user.active ? 'success' : 'neutral'}>{user.active ? 'Ativo' : 'Inativo'}</Badge></td></tr>)}</tbody></table>
        <nav className={styles.pagination} aria-label="Paginação de usuários"><span>Página {currentPage} de {pageCount}</span><div className="actions"><Button variant="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button><Button variant="secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</Button></div></nav>
      </>}
    </section>}
  </div>;
}
