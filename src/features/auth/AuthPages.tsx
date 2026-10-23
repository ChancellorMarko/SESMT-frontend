import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, Flame, HardHat, HeartPulse, KeyRound, LoaderCircle, LockKeyhole, Mail, ScanEye, Settings2, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useSession } from '../../shared/auth/SessionProvider';
import { API_MODE, api } from '../../shared/api/client';
import { Feedback, Field, Spinner } from '../../shared/ui';
import type { MfaChallengeDto } from '../../shared/contracts';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { LoginPreloader, useLoginArrival, type LoginArrivalPhase } from './LoginArrival';
import styles from './AuthPages.module.css';

const inputClass = styles.input;
const formClass = styles.form;
const profiles: { role: string; label: string; icon: LucideIcon }[] = [
  { role: 'tecnico', label: 'Técnico de segurança', icon: HardHat },
  { role: 'bombeiro', label: 'Bombeiro', icon: Flame },
  { role: 'gestor', label: 'Engenheiro', icon: ShieldCheck },
  { role: 'gestor', label: 'Gestor SESMT', icon: BriefcaseBusiness },
  { role: 'rh', label: 'RH', icon: HeartPulse },
  { role: 'auditor', label: 'Auditor', icon: ScanEye },
  { role: 'admin', label: 'Administrador', icon: Settings2 },
  { role: 'trabalhador', label: 'Trabalhador', icon: UserRound },
];

function AuthButton({ children, variant = 'primary', busy = false, className = '', ...props }: Omit<HTMLMotionProps<'button'>, 'children'> & { children: ReactNode; variant?: 'primary' | 'ghost'; busy?: boolean }) {
  const reducedMotion = useAppReducedMotion();
  return <motion.button
    type="button"
    whileHover={reducedMotion || props.disabled ? undefined : { y: -1 }}
    whileTap={reducedMotion || props.disabled ? undefined : { scale: .985 }}
    {...props}
    aria-busy={busy || undefined}
    className={`${styles.button} ${variant === 'primary' ? styles.primary : styles.ghost} ${className}`}
  >{busy && <LoaderCircle size={16} className={styles.buttonSpinner} aria-hidden="true" />}{children}</motion.button>;
}

function PasswordVisibility({ shown, onToggle, label = 'senha' }: { shown: boolean; onToggle: () => void; label?: string }) {
  return <button className={styles.showPassword} type="button" onClick={onToggle} aria-label={`${shown ? 'Ocultar' : 'Mostrar'} ${label}`} aria-pressed={shown}>{shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>;
}

function AuthCard({ title, description, eyebrow = 'ACESSO AO SISTEMA', icon: Icon = LockKeyhole, children }: { title: string; description?: string; eyebrow?: string; icon?: LucideIcon; children: ReactNode }) {
  return <section className={styles.card}>
    <div className={styles.cardHeader}>
      <p className={styles.cardEyebrow}><Icon size={12} aria-hidden="true" /> {eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
    </div>
    <div className={styles.content}>{children}</div>
  </section>;
}

export function AuthLayout({ children, showcase = false, arrival = 'ready' }: { children: ReactNode; showcase?: boolean; arrival?: LoginArrivalPhase }) {
  const entering = arrival !== 'ready';
  return <div className={styles.root}>
    <div className={styles.ambient} aria-hidden="true" />
    {entering && <LoginPreloader leaving={arrival === 'leaving'} />}
    <div className={styles.scene} data-auth-scene data-arrival={arrival} inert={entering} aria-hidden={entering || undefined}>
      <header className={styles.masthead}>
        <Link to="/login" className={styles.brandLink} aria-label="Ampara SESMT — início"><BrandLogo className={styles.brand} /></Link>
        <span className={styles.mastheadNote}>Segurança que acompanha você.</span>
      </header>
      <main className={`${styles.main} ${showcase ? styles.showcaseLayout : ''}`}>
        {showcase && <aside className={styles.story} aria-label="Tecnologia que cuida de pessoas">
          <p className={styles.eyebrow}>SEU ESPAÇO DE SEGURANÇA</p>
          <h2 className={styles.storyTitle}>Segurança começa<br />com <span>cuidado.</span></h2>
          <p className={styles.storyDescription}>Pessoas, documentos e rotinas.<br />Tudo mais próximo, em um só lugar.</p>
          <div className={styles.sculpture} aria-hidden="true">
            <div className={styles.sculptureHalo} /><div className={styles.sculptureOrbit} /><div className={styles.sculptureShadow} />
            <div className={styles.sculpturePlate} data-auth-artwork><BrandLogo compact className={styles.sculptureMark} /></div>
          </div>
          <p className={styles.storySignature}>TECNOLOGIA QUE CUIDA DE PESSOAS</p>
        </aside>}
        <div className={styles.surface} data-auth-surface>{children}</div>
      </main>
      <footer className={styles.footer}>
        <LockKeyhole size={12} aria-hidden="true" />
        <p>Acesso conforme perfil e unidade. Dados de saúde exigem autorização específica.</p>
      </footer>
    </div>
  </div>;
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const reducedMotion = useAppReducedMotion();
  const arrival = useLoginArrival();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [returningToLogin, setReturningToLogin] = useState(false);
  const pending = useRef(false);
  const codeHintId = useId();
  const [challenge, setChallenge] = useState<MfaChallengeDto | null>(null);
  const form = useForm<{ email: string; password: string }>({ defaultValues: { email: '', password: '' } });
  const mfa = useForm<{ code: string }>({ defaultValues: { code: '' } });
  if (session.status === 'restoring') return <AuthLayout showcase arrival={arrival}><AuthCard title="Entrar na sua conta" description="Preparando seu acesso."><Spinner /></AuthCard></AuthLayout>;
  if (session.me) return <Navigate to="/app" replace />;

  async function signIn(email: string, password: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const nextChallenge = await session.login(email, password);
      if (nextChallenge) { mfa.reset({ code: '' }); setChallenge(nextChallenge); }
      else navigate('/app', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function returnToLogin() {
    if (pending.current) return;
    mfa.reset({ code: '' });
    setError('');
    setShow(false);
    setReturningToLogin(true);
    setChallenge(null);
  }

  return <AuthLayout showcase arrival={arrival}><AuthCard
    title={challenge ? 'Verifique seu acesso' : 'Entrar na sua conta'}
    description={challenge ? 'Informe o código do seu autenticador para continuar.' : 'Entre para acompanhar sua operação.'}
    eyebrow={challenge ? 'VERIFICAÇÃO EM DUAS ETAPAS' : undefined}
    icon={challenge ? ShieldCheck : LockKeyhole}
  >
    {session.sessionError && <Feedback tone="warning">{session.sessionError}</Feedback>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    {challenge ? <form key="verification" className={`${formClass} ${styles.step}`} onSubmit={mfa.handleSubmit(async ({ code }) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true); setError('');
      try { await session.verifyMfa(challenge.challengeId, code); navigate('/app', { replace: true }); }
      catch (e) { setError(e instanceof Error ? e.message : 'Código inválido.'); }
      finally { pending.current = false; setBusy(false); }
    })}>
      <ol className={styles.accessSteps} aria-label="Etapas do acesso">
        <li><span><Check size={12} aria-hidden="true" /></span>Sua conta<span className="sr-only">: concluída</span></li>
        <li aria-current="step"><span>2</span>Verificação</li>
      </ol>
      <Field required label="Código de verificação" error={mfa.formState.errors.code?.message}>
        <input className={`${inputClass} ${styles.codeInput}`} autoFocus autoComplete="one-time-code" inputMode="numeric" placeholder="000000" spellCheck={false} readOnly={busy} aria-describedby={codeHintId}
          {...mfa.register('code', { required: 'Informe o código.', pattern: { value: /^\d{6}$/, message: 'Use os seis números do código.' }, onChange: event => {
            const normalized = String(event.target.value).replace(/\D/g, '').slice(0, 6);
            mfa.setValue('code', normalized, { shouldValidate: mfa.formState.isSubmitted });
          } })}
          onPaste={event => {
            if (pending.current) return;
            const code = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (!code) return;
            event.preventDefault();
            mfa.setValue('code', code, { shouldDirty: true, shouldValidate: mfa.formState.isSubmitted });
          }} />
      </Field>
      <p id={codeHintId} className={styles.fieldHint}>Digite os 6 números do aplicativo autenticador.</p>
      {API_MODE === 'demo' && <Feedback>Ambiente de demonstração: use o código <strong>123456</strong> para continuar.</Feedback>}
      <AuthButton type="submit" disabled={busy} busy={busy}>{busy ? 'Verificando…' : <>Verificar e entrar<ArrowRight size={17} aria-hidden="true" /></>}</AuthButton>
      <AuthButton variant="ghost" disabled={busy} onClick={returnToLogin}>Voltar ao login</AuthButton>
    </form> : <div key="credentials" className={`${styles.loginContent} ${styles.step}`}>
      <form className={formClass} onSubmit={form.handleSubmit(v => signIn(v.email, v.password))}>
        <Field required label="E-mail" error={form.formState.errors.email?.message}>
          <input className={inputClass} type="email" autoComplete="username" placeholder="seu.nome@empresa.com" {...form.register('email', { required: 'Informe seu e-mail.' })} />
        </Field>
        <Field required label="Senha" error={form.formState.errors.password?.message}>
          <span className={styles.password}>
            <input className={`${inputClass} ${styles.passwordInput}`} type={show ? 'text' : 'password'} autoFocus={returningToLogin} autoComplete="current-password" placeholder="Informe sua senha" {...form.register('password', { required: 'Informe sua senha.' })} />
            <PasswordVisibility shown={show} onToggle={() => setShow(!show)} />
          </span>
        </Field>
        <Link className={styles.recoveryLink} to="/recuperar-acesso">Esqueci minha senha</Link>
        <AuthButton type="submit" disabled={busy} busy={busy}>{busy ? 'Entrando…' : <>Entrar na plataforma<ArrowRight size={17} aria-hidden="true" /></>}</AuthButton>
      </form>
      {API_MODE === 'demo' && <div className={styles.demo}>
        <div className={styles.demoHeader}>
          <span className={styles.demoIcon}><ShieldCheck size={15} aria-hidden="true" /></span>
          <div>
            <span className={styles.demoTitle}>AMBIENTE DE DEMONSTRAÇÃO</span>
            <p className={styles.demoDescription}>Explore com dados fictícios. As alterações duram até recarregar a página.</p>
          </div>
        </div>
        <motion.div
          initial={reducedMotion ? false : 'hidden'}
          animate={arrival === 'ready' ? 'visible' : 'hidden'}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: .035 } } }}
          className={styles.profiles}
        >
          {profiles.map(({ role, label, icon: Icon }) => <motion.button
            key={label}
            type="button"
            disabled={busy}
            variants={{ hidden: { opacity: 0, y: reducedMotion ? 0 : 5 }, visible: { opacity: 1, y: 0 } }}
            whileHover={reducedMotion || busy ? undefined : { y: -2 }}
            whileTap={reducedMotion || busy ? undefined : { scale: .98 }}
            onClick={() => signIn(`${role}@demo.sesmt.local`, 'Demo123!')}
            className={styles.profile}
          ><Icon size={15} aria-hidden="true" /><span>{label}</span></motion.button>)}
        </motion.div>
      </div>}
    </div>}
  </AuthCard></AuthLayout>;
}

export function RecoveryPage() {
  const restoring = useSession().status === 'restoring';
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const form = useForm<{ email: string }>();
  return <AuthLayout><AuthCard title="Recuperar acesso" eyebrow="VAMOS AJUDAR VOCÊ" icon={Mail} description="Informe o e-mail associado à sua conta para solicitar as instruções de recuperação.">
    {message && <Feedback tone="success">{message}</Feedback>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    <form className={formClass} onSubmit={form.handleSubmit(async v => {
      if (pending.current || restoring) return;
      pending.current = true;
      setBusy(true); setError(''); setMessage('');
      try { const result = await api.post<{ message: string }>('/auth/password/forgot', v); setMessage(result.message); }
      catch (e) { setError(e instanceof Error ? e.message : 'Falha no envio.'); }
      finally { pending.current = false; setBusy(false); }
    })}>
      <Field required label="E-mail" error={form.formState.errors.email?.message}><input className={inputClass} type="email" autoComplete="email" placeholder="seu.nome@empresa.com" readOnly={busy} {...form.register('email', { required: 'Informe seu e-mail.' })} /></Field>
      <AuthButton type="submit" disabled={busy || restoring} busy={busy || restoring}>{restoring ? 'Preparando acesso…' : busy ? 'Enviando…' : <>Solicitar recuperação<ArrowRight size={17} aria-hidden="true" /></>}</AuthButton>
      <Link className={styles.backLink} to="/login">Voltar ao login</Link>
    </form>
    {API_MODE === 'demo' && <p className={styles.demoNote}>Demonstração: nenhuma mensagem é enviada. <Link to="/redefinir-senha">Experimentar redefinição</Link>.</p>}
  </AuthCard></AuthLayout>;
}

export function ResetPasswordPage() {
  const restoring = useSession().status === 'restoring';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const pending = useRef(false);
  const successAction = useRef<HTMLAnchorElement>(null);
  const form = useForm<{ token: string; password: string; confirm: string }>({ defaultValues: { token: API_MODE === 'demo' ? 'demo-reset' : '', password: '', confirm: '' } });
  useEffect(() => { if (done) successAction.current?.focus({ preventScroll: true }); }, [done]);
  return <AuthLayout><AuthCard title={done ? 'Tudo pronto.' : 'Definir nova senha'} eyebrow={done ? 'ACESSO RECUPERADO' : 'UM NOVO COMEÇO'} icon={done ? ShieldCheck : KeyRound} description={done ? 'Sua senha foi atualizada. Você já pode acessar sua conta.' : 'Use seu código de recuperação e escolha a nova senha de acesso.'}>
    {error && <Feedback tone="danger">{error}</Feedback>}
    {done ? <div className={`${styles.successState} ${styles.step}`}>
      <span className={styles.successMark} aria-hidden="true"><Check size={27} strokeWidth={1.8} /></span>
      <Feedback tone="success">Senha redefinida.</Feedback>
      <Link ref={successAction} className={`${styles.button} ${styles.primary}`} to="/login">Voltar ao login<ArrowRight size={17} aria-hidden="true" /></Link>
    </div> : <form className={formClass} onSubmit={form.handleSubmit(async v => {
      if (pending.current || restoring) return;
      if (v.password !== v.confirm) { form.setError('confirm', { message: 'As senhas devem ser iguais.' }); return; }
      pending.current = true;
      setBusy(true); setError('');
      try { await api.post('/auth/password/reset', { token: v.token, newPassword: v.password }); form.reset(); setDone(true); }
      catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível redefinir.'); }
      finally { pending.current = false; setBusy(false); }
    })}>
      <Field required label="Código de recuperação" error={form.formState.errors.token?.message}><input className={inputClass} autoComplete="off" readOnly={busy} {...form.register('token', { required: 'Informe o código recebido.' })} /></Field>
      <Field required label="Nova senha" error={form.formState.errors.password?.message}><span className={styles.password}>
        <input className={`${inputClass} ${styles.passwordInput}`} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Digite a nova senha" readOnly={busy} {...form.register('password', { required: 'Informe uma senha.' })} />
        <PasswordVisibility shown={show} onToggle={() => setShow(!show)} label="nova senha" />
      </span></Field>
      <Field required label="Confirmar nova senha" error={form.formState.errors.confirm?.message}><span className={styles.password}>
        <input className={`${inputClass} ${styles.passwordInput}`} type={showConfirm ? 'text' : 'password'} autoComplete="new-password" placeholder="Repita a nova senha" readOnly={busy} {...form.register('confirm', { required: 'Confirme a senha.' })} />
        <PasswordVisibility shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} label="confirmação da senha" />
      </span></Field>
      <AuthButton type="submit" disabled={busy || restoring} busy={busy || restoring}>{restoring ? 'Preparando acesso…' : busy ? 'Salvando…' : <>Redefinir senha<ArrowRight size={17} aria-hidden="true" /></>}</AuthButton>
      <Link className={styles.backLink} to="/login">Voltar ao login</Link>
    </form>}
    {API_MODE === 'demo' && <p className={styles.demoNote}>Demonstração: esta alteração é simulada e não muda a senha dos perfis de teste.</p>}
  </AuthCard></AuthLayout>;
}
