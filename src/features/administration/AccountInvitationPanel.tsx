import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Clock3, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { UserDto } from '../../shared/contracts';
import type { AccountInvitationSummaryDto } from '../../shared/contracts/account-invitations';
import { Badge, Button, Feedback, Spinner } from '../../shared/ui';
import { formatDate } from '../../shared/lib/format';
import { accountInvitationsEnabled } from '../auth/account-invitations';
import styles from './AccountInvitationPanel.module.css';

const statuses = { PENDING: 'Aguardando ativação', ACCEPTED: 'Convite utilizado', EXPIRED: 'Convite expirado', REVOKED: 'Convite revogado' };
const deliveries = { PENDING: 'Envio aguardando processamento', SENT: 'Envio registrado pela API', FAILED: 'Falha no envio', SIMULATED: 'Demonstração · nenhum e-mail enviado' };

function checkedSummary(value: unknown, user: UserDto): AccountInvitationSummaryDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Não foi possível conferir os dados deste convite.');
  const data = value as AccountInvitationSummaryDto;
  const safePath = data.demoActivationPath === undefined || typeof data.demoActivationPath === 'string' && /^\/ativar-acesso#token=[A-Za-z0-9_-]{16,512}$/.test(data.demoActivationPath);
  if (data.userId !== user.id || data.userRevision !== user.revision || !Object.hasOwn(statuses, data.status) || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || data.mfaRequired !== user.mfaRequired || !Object.hasOwn(deliveries, data.deliveryStatus) || !safePath || API_MODE !== 'demo' && data.demoActivationPath !== undefined) {
    throw new Error('Os dados do convite não correspondem ao acesso consultado. Feche esta janela e atualize a lista de usuários.');
  }
  return data;
}

export function AccountAccessOverview() {
  return <section className={styles.overview} aria-labelledby="account-access-title">
    <div className={styles.overviewHeading}><span className={styles.mark}><KeyRound size={19} aria-hidden="true" /></span><div><h2 id="account-access-title">Cada pessoa, seu próprio acesso.</h2><p>O administrador convida. A pessoa define a senha e entra com as permissões concedidas.</p></div></div>
    <ol className={styles.overviewSteps} aria-label="Como funciona o primeiro acesso"><li><UserRound size={16} aria-hidden="true" /><span>1. Cadastrar e convidar</span></li><li><KeyRound size={16} aria-hidden="true" /><span>2. Definir a própria senha</span></li><li><ShieldCheck size={16} aria-hidden="true" /><span>3. Entrar com seu perfil</span></li></ol>
    <p className={styles.overviewNote}>Cadastro de trabalhador e convite de equipe são independentes da conta de acesso.</p>
  </section>;
}

export function AccountInvitationPanel({ user, onNavigate }: { user: UserDto; onNavigate?: () => void }) {
  const { sessionKey, unitId, can } = useSession();
  const allowed = can('users.manage');
  return <AccountInvitationContent key={JSON.stringify([sessionKey, unitId, allowed, user.id, user.revision])} user={user} allowed={allowed} onNavigate={onNavigate} />;
}

function AccountInvitationContent({ user, allowed, onNavigate }: { user: UserDto; allowed: boolean; onNavigate?: () => void }) {
  const [data, setData] = useState<AccountInvitationSummaryDto | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const enabled = accountInvitationsEnabled();
  useEffect(() => {
    if (!allowed || !enabled) return;
    const controller = new AbortController();
    setData(null); setError(''); setLoading(true);
    void api.get<unknown>(`/users/${encodeURIComponent(user.id)}/invitation`, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setData(checkedSummary(value, user)); setNow(Date.now());
    }).catch(reason => {
      if (controller.signal.aborted) return;
      setData(null);
      setError(reason instanceof ApiError && [401, 403, 404].includes(reason.status)
        ? 'Este convite não está disponível para o seu acesso atual. Confira a lista de usuários.'
        : reason instanceof Error ? reason.message : 'Não foi possível consultar o convite. Tente novamente.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [allowed, enabled, user.id, user.revision, attempt]);
  useEffect(() => {
    if (!data || data.status !== 'PENDING') return;
    const remaining = Date.parse(data.expiresAt) - now;
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [data, now]);

  if (!allowed) return <Feedback tone="warning">Seu acesso não permite consultar convites de conta.</Feedback>;
  if (!enabled) return <Feedback tone="info">A consulta de convites de conta ainda não está disponível neste ambiente.</Feedback>;
  if (loading) return <Spinner />;
  if (error) return <div className="stack"><Feedback tone="warning">{error}</Feedback><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Consultar convite novamente</Button></div>;
  if (!data) return null;
  const status = data.status === 'PENDING' && Date.parse(data.expiresAt) <= now ? 'EXPIRED' : data.status;
  return <div className={styles.panel}>
    <header className={styles.person}><span className={styles.mark}><UserRound size={20} aria-hidden="true" /></span><div><h3>{user.displayName}</h3><p>{user.email}</p></div><Badge tone={status === 'PENDING' ? 'info' : status === 'ACCEPTED' ? 'success' : 'warning'}>{statuses[status]}</Badge></header>
    <ol className={styles.steps} aria-label="Etapas do primeiro acesso"><li data-complete="true"><span>1</span><div><strong>Cadastro</strong><small>Identidade e permissões concedidas</small></div></li><li aria-current={status === 'PENDING' ? 'step' : undefined} data-complete={status === 'ACCEPTED'}><span>2</span><div><strong>Definir senha</strong><small>A própria pessoa conclui pelo convite</small></div></li><li aria-current={status === 'ACCEPTED' ? 'step' : undefined}><span>3</span><div><strong>Entrar</strong><small>{data.mfaRequired ? 'Com verificação em duas etapas' : 'Com seu perfil e unidade'}</small></div></li></ol>
    <dl className={styles.facts}><div><dt><Clock3 size={14} aria-hidden="true" />Validade do convite</dt><dd>{formatDate(data.expiresAt)} <small>São Paulo</small></dd></div><div><dt><Mail size={14} aria-hidden="true" />Envio</dt><dd>{deliveries[data.deliveryStatus]}</dd></div></dl>
    {status === 'PENDING' ? <p className={styles.note}>O convite permite definir uma senha pessoal. Cadastrar a conta não ativa o acesso automaticamente e o administrador não precisa conhecer essa senha.</p> : <Feedback tone={status === 'ACCEPTED' ? 'info' : 'warning'}>{status === 'ACCEPTED' ? 'Este convite já foi utilizado. A pessoa deve entrar com sua conta; não reutilize o link para alterar a senha.' : 'Este convite não pode mais ser utilizado. Solicite a regularização ao administrador responsável pelo acesso.'}</Feedback>}
    {data.mfaRequired && <p className={styles.mfa}><ShieldCheck size={16} aria-hidden="true" /><span>Uma conta administrativa só pode acessar o sistema depois de configurar e verificar o autenticador. Essa configuração depende da integração de identidade.</span></p>}
    {user.scope.ownOnly && <p className={styles.mfa}><UserRound size={16} aria-hidden="true" /><span>O acesso aos dados próprios depende do vínculo da conta com o trabalhador. Esse vínculo precisa ser confirmado antes de entrar.</span></p>}
    {status === 'PENDING' && API_MODE === 'demo' && data.demoActivationPath && <div className={styles.demo}><span>Demonstração local</span><p>Explore a definição da senha com este convite fictício. Você sairá da conta atual antes de continuar.</p><Link className="button button--secondary" to={data.demoActivationPath} onClick={onNavigate}>Explorar primeiro acesso<ArrowRight size={16} aria-hidden="true" /></Link></div>}
  </div>;
}
