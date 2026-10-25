import { Link } from 'react-router';
import { Check, LockKeyhole, LogOut, PlugZap } from 'lucide-react';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { useSession } from '../../shared/auth/SessionProvider';
import { Button } from '../../shared/ui';
import styles from './ConnectedAccountPage.module.css';

export function ConnectedAccountPage() {
  const session = useSession();
  if (!session.me) return null;
  const hasModules = session.me.permissions.length > 0;
  return <main className={styles.page}>
    <header className={styles.header}><BrandLogo /><Button variant="secondary" onClick={() => void session.logout()}><LogOut size={16} aria-hidden="true" />Sair da conta</Button></header>
    <section className={styles.card} aria-labelledby="connection-title">
      <span className={styles.icon}><PlugZap size={28} aria-hidden="true" /></span>
      <p className="eyebrow">AMPARA · INTEGRAÇÃO</p>
      <h1 id="connection-title">Sua conta está conectada.</h1>
      <p className={styles.description}>Olá, {session.me.user.displayName}. Seu acesso foi confirmado pelo servidor.</p>
      <dl className={styles.identity}><div><dt>Conta</dt><dd>{session.me.user.email}</dd></div><div><dt>Perfis cadastrados</dt><dd>{session.me.roles.length ? session.me.roles.join(' · ') : 'Nenhum perfil atribuído'}</dd></div></dl>
      <div className={styles.status}><Check size={18} aria-hidden="true" /><span>Login e sessão conectados ao backend</span></div>
      {hasModules ? <Link to="/app" className="button button--primary">Abrir meu espaço de trabalho</Link> : <div className={styles.pending}><LockKeyhole size={20} aria-hidden="true" /><div><h2>Módulos em preparação</h2><p>A integração dos documentos, equipes e permissões de trabalho está em andamento. As áreas serão disponibilizadas conforme a conexão e as regras de acesso de cada uma forem validadas.</p></div></div>}
      <p className={styles.note}>Esta é a versão de integração. Os dados de demonstração ficam no ambiente demonstrativo.</p>
    </section>
  </main>;
}
