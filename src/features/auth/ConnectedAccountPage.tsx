import { Link } from 'react-router';
import { Check, LockKeyhole, LogOut, PlugZap, RefreshCw } from 'lucide-react';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { useSession } from '../../shared/auth/SessionProvider';
import { Button, InfoButton } from '../../shared/ui';
import { homePath } from '../../app/navigation';
import { NATIVE_MODULES } from '../../shared/api/native-mode';
import styles from './ConnectedAccountPage.module.css';

export function ConnectedAccountPage() {
  const session = useSession();
  if (!session.me) return null;
  const target = homePath(session.can, NATIVE_MODULES);
  const hasModules = target !== '/app/conexao';
  const hasGrants = session.me.permissions.length > 0;
  return <main className={styles.page}>
    <header className={styles.header}><BrandLogo /><Button variant="secondary" onClick={() => void session.logout()}><LogOut size={16} aria-hidden="true" />Sair da conta</Button></header>
    <section className={styles.card} aria-labelledby="connection-title">
      <span className={styles.icon}><PlugZap size={28} aria-hidden="true" /></span>

      <h1 id="connection-title">Sua conta está conectada.</h1>
      <p className={styles.description}>{session.me.user.displayName}</p>
      <dl className={styles.identity}><div><dt>Conta</dt><dd>{session.me.user.email}</dd></div><div><dt>Perfis cadastrados</dt><dd>{session.me.roles.length ? session.me.roles.join(' · ') : 'Nenhum perfil atribuído'}</dd></div></dl>
      <div className={styles.status}><Check size={18} aria-hidden="true" /><span>Sessão ativa</span></div>
      {hasModules ? <Link to={target} className="button button--primary">Abrir meu espaço de trabalho</Link> : <div className={styles.pending}><LockKeyhole size={20} aria-hidden="true" /><div><h2>{hasGrants ? 'Nenhum módulo disponível para estes acessos' : 'Módulos não liberados'}</h2><p>{hasGrants ? 'A conta possui permissões, mas elas ainda não correspondem a uma tela disponível. Encaminhe os detalhes ao responsável pela integração.' : 'Solicite ao responsável a liberação dos módulos do seu perfil.'}</p></div></div>}
      <div className={`actions ${styles.accessActions}`}><Button variant="secondary" onClick={() => void session.restore()}><RefreshCw size={16} aria-hidden="true" />Atualizar acesso</Button><InfoButton title="Permissões da conta"><p>Estes são os acessos informados pela API para esta sessão. O perfil, por si só, não libera módulos.</p>{hasGrants ? <ul className={styles.permissions}>{session.me.permissions.map((permission, index) => <li key={`${permission}-${index}`}><code>{permission}</code></li>)}</ul> : <p>Nenhuma permissão foi retornada.</p>}</InfoButton></div>
    </section>
  </main>;
}
