import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { ArrowRight, BriefcaseBusiness, Check, ChevronDown, Eye, EyeOff, Flame, HardHat, HeartPulse, KeyRound, LoaderCircle, LockKeyhole, Mail, ScanEye, Settings2, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useSession } from '../../shared/auth/SessionProvider';
import { API_MODE, api, obtainCsrf } from '../../shared/api/client';
import { AUTH_CONTRACT } from '../../shared/api/auth-contract';
import { Feedback, Field, Spinner } from '../../shared/ui';
import type { MfaChallengeDto } from '../../shared/contracts';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { LoginPreloader, useLoginArrival, type LoginArrivalPhase } from './LoginArrival';
import { LoginBackground } from './LoginBackground';
import { getDemoAccessUrl } from './demo-access';
import styles from './AuthPages.module.css';
import { checkedRecoveryMessage, passwordResetTokenFromHash, validPasswordResetToken } from './password-recovery';

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

export function AuthButton({ children, variant = 'primary', busy = false, className = '', ...props }: Omit<HTMLMotionProps<'button'>, 'children'> & { children: ReactNode; variant?: 'primary' | 'ghost'; busy?: boolean }) {
  return <motion.button
    type="button"
    {...props}
    aria-busy={busy || undefined}
    className={`${styles.button} ${variant === 'primary' ? styles.primary : styles.ghost} ${className}`}
  >{busy && <LoaderCircle size={16} className={styles.buttonSpinner} aria-hidden="true" />}{children}</motion.button>;
}

export function PasswordVisibility({ shown, onToggle, label = 'senha' }: { shown: boolean; onToggle: () => void; label?: string }) {
  return <button className={styles.showPassword} type="button" onClick={onToggle} aria-label={`${shown ? 'Ocultar' : 'Mostrar'} ${label}`} aria-pressed={shown}>{shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>;
}

export function AuthCard({ title, description, eyebrow, icon: Icon = LockKeyhole, children }: { title: string; description?: string; eyebrow?: string; icon?: LucideIcon; children: ReactNode }) {
  return <section className={styles.card}>
    <div className={styles.cardHeader}>
      {eyebrow && <p className={styles.cardEyebrow}><Icon size={12} aria-hidden="true" /> {eyebrow}</p>}
      <h1 className={styles.title}>{title}</h1>
      {description && <p className={styles.description}>{description}</p>}
    </div>
    <div className={styles.content}>{children}</div>
  </section>;
}

export function AuthLayout({ children, arrival = 'ready', featured = false }: { children: ReactNode; arrival?: LoginArrivalPhase; featured?: boolean }) {
  const entering = arrival !== 'ready';
  return <div className={`${styles.root} ${featured ? styles.featuredRoot : ''}`}>
    {featured && <LoginBackground />}
    {entering && <LoginPreloader leaving={arrival === 'leaving'} />}
    <div className={styles.scene} data-auth-scene data-arrival={arrival} inert={entering} aria-hidden={entering || undefined}>
      <header className={styles.masthead}>
        <Link to="/login" className={styles.brandLink} aria-label="Ampara SESMT — início"><BrandLogo priority className={styles.brand} /></Link>
      </header>
      <main className={`${styles.main} ${featured ? styles.featuredMain : ''}`}>
        {featured && <section className={styles.story} aria-labelledby="login-story-title">
          <p className={styles.storyEyebrow}>SEGURANÇA DO TRABALHO</p>
          <h2 id="login-story-title"><span>A rotina de SST,</span>{' '}<span>mais organizada.</span></h2>
          <p className={styles.storyDescription}>Documentos, equipes e informações da operação reunidos em um espaço de trabalho.</p>
        </section>}
        <div className={styles.surface} data-auth-surface>{children}</div>
      </main>
    </div>
  </div>;
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const reducedMotion = useAppReducedMotion();
  const arrival = useLoginArrival();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [demoOpen, setDemoOpen] = useState(() => API_MODE === 'demo' && new URLSearchParams(location.search).get('demonstracao') === 'perfis');
  const demoPanelId = useId();
  const demoUrl = API_MODE === 'api' ? getDemoAccessUrl(import.meta.env.VITE_DEMO_URL, window.location.href) : undefined;
  const [returningToLogin, setReturningToLogin] = useState(false);
  const pending = useRef(false);
  const codeHintId = useId();
  const [challenge, setChallenge] = useState<MfaChallengeDto | null>(null);
  const form = useForm<{ email: string; password: string }>({ defaultValues: { email: '', password: '' } });
  const mfa = useForm<{ code: string }>({ defaultValues: { code: '' } });
  if (session.status === 'restoring') return <AuthLayout featured arrival={arrival}><AuthCard title="Entrar na sua conta"><Spinner /></AuthCard></AuthLayout>;
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

  return <AuthLayout featured arrival={arrival}><AuthCard
    title={challenge ? 'Verifique seu acesso' : 'Entrar na sua conta'}
    description={challenge ? 'Informe o código do seu autenticador.' : undefined}
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
      <p id={codeHintId} className={styles.fieldHint}>{API_MODE === 'demo' ? 'Código de acesso: 123456.' : 'Digite os 6 números do aplicativo autenticador.'}</p>
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
      {API_MODE === 'demo' ? <div className={styles.demoAccess}>
        <button type="button" className={styles.demoTrigger} aria-expanded={demoOpen} aria-controls={demoPanelId} disabled={busy} onClick={() => setDemoOpen(open => !open)}>Ver demonstrações<ChevronDown size={13} aria-hidden="true" /></button>
        {demoOpen && <div className={styles.demo} id={demoPanelId}>
        <h2 className={styles.quickAccessTitle}>Escolha um perfil</h2>
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
      </div>}</div> : demoUrl && <a className={styles.demoTrigger} href={demoUrl} target="_blank" rel="noopener noreferrer" aria-description="Abre o ambiente de demonstração em outra aba.">Ver demonstrações<ArrowRight size={12} aria-hidden="true" /></a>}
    </div>}
  </AuthCard></AuthLayout>;
}

function RecoverySteps({ current }: { current: number }) {
  return <ol className={styles.recoverySteps} aria-label="Etapas da recuperação de acesso">{['E-mail', 'Nova senha', 'Entrar'].map((label, index) => <li key={label} aria-current={current === index ? 'step' : undefined} data-complete={index < current}><span aria-hidden="true">{index < current ? <Check size={12} /> : index + 1}</span>{label}</li>)}</ol>;
}

/** Cancel a write if this screen or its access context changes while CSRF is loading. */
function useRecoveryCommand() {
  const session = useSession(), location = useLocation();
  const context = `${session.sessionKey}:${location.key}:${location.hash}`;
  const contextRef = useRef(context); contextRef.current = context;
  const mounted = useRef(true);
  type Operation = { context: string; controller: AbortController; running: boolean };
  const operation = useRef<Operation | null>(null);
  const [busyContext, setBusyContext] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.controller.abort(); }; }, []);
  useEffect(() => () => { if (operation.current?.context === context) operation.current.controller.abort(); }, [context]);
  const current = (value: Operation) => mounted.current && operation.current === value && contextRef.current === value.context && !value.controller.signal.aborted;
  async function post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    operation.current?.controller.abort();
    const value: Operation = { context, controller: new AbortController(), running: true };
    operation.current = value; setBusyContext(context);
    try {
      await obtainCsrf();
      if (!current(value)) throw new DOMException('Contexto de recuperação alterado.', 'AbortError');
      const result = await api.post<T>(path, body, { signal: value.controller.signal, ...(idempotencyKey ? { idempotencyKey } : {}) });
      if (!current(value)) throw new DOMException('Contexto de recuperação alterado.', 'AbortError');
      return result;
    } catch (error) {
      if (!current(value)) throw new DOMException('Contexto de recuperação alterado.', 'AbortError');
      throw error;
    } finally {
      value.running = false;
      if (current(value)) setBusyContext(null);
    }
  }
  return { post, busy: busyContext === context, pending: () => !!operation.current && operation.current.running && current(operation.current) };
}
const recoveryCanceled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function RecoveryPage() {
  const session = useSession();
  const restoring = session.status === 'restoring';
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [address, setAddress] = useState('');
  const command = useRecoveryCommand();
  const { busy } = command;
  const editRequested = useRef(false), successAction = useRef<HTMLAnchorElement>(null);
  const form = useForm<{ email: string }>({ defaultValues: { email: '' } });
  useEffect(() => {
    if (message) successAction.current?.focus({ preventScroll: true });
    else if (editRequested.current) { editRequested.current = false; form.setFocus('email'); }
  }, [message, form.setFocus]);
  if (session.me) return <Navigate to="/app" replace />;
  return <AuthLayout><AuthCard title={message ? 'Confira seu e-mail' : 'Recuperar acesso'} icon={Mail} description={message ? 'Confira a caixa de entrada e a pasta de spam.' : 'Informe o e-mail da sua conta.'}>
    <RecoverySteps current={message ? 1 : 0} />
    {error && <Feedback tone="danger">{error}</Feedback>}
    <form className={formClass} noValidate aria-busy={busy} onSubmit={form.handleSubmit(async v => {
      if (command.pending() || restoring) return;
      setError(''); setMessage('');
      const email = v.email.trim();
      try {
        const result = await command.post<unknown>(AUTH_CONTRACT.forgotPasswordPath, { email });
        setAddress(email); setMessage(checkedRecoveryMessage(result));
      } catch (e) { if (!recoveryCanceled(e)) setError(e instanceof Error ? e.message : 'Não foi possível solicitar a recuperação. Tente novamente.'); }
    })}>
      {message ? <div className={`${styles.successState} ${styles.step}`}>
        <span className={styles.successMark} aria-hidden="true"><Mail size={26} /></span>
        <Feedback tone="success">{message}</Feedback>
        <div className={styles.recoveryAddress}><span>Endereço informado</span><strong>{address}</strong></div>
        <p className={styles.recoveryHint}>Se não receber as instruções, confira o endereço ou solicite novamente.</p>
        <Link ref={successAction} className={`${styles.button} ${styles.primary}`} to="/redefinir-senha">Já tenho o código<ArrowRight size={17} aria-hidden="true" /></Link>
      </div> : <Field required label="E-mail" error={form.formState.errors.email?.message}><input className={inputClass} type="email" autoComplete="email" maxLength={254} placeholder="seu.nome@empresa.com" readOnly={busy} {...form.register('email', { required: 'Informe seu e-mail.', validate: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Informe um e-mail válido.' })} /></Field>}
      <AuthButton type="submit" variant={message ? 'ghost' : 'primary'} disabled={busy || restoring} busy={busy || restoring}>{restoring ? 'Preparando acesso…' : busy ? 'Enviando…' : <>Solicitar recuperação<ArrowRight size={17} aria-hidden="true" /></>}</AuthButton>
      {message && <AuthButton variant="ghost" onClick={() => { editRequested.current = true; setMessage(''); setError(''); }}>Usar outro e-mail</AuthButton>}
      <Link className={styles.backLink} to="/login">Voltar ao login</Link>
    </form>
    {!message && <Link className={styles.backLink} to="/redefinir-senha">Já tenho um código de recuperação</Link>}
  </AuthCard></AuthLayout>;
}

export function ResetPasswordPage() {
  const location = useLocation();
  return <ResetPasswordContent key={`${location.key}:${location.hash}`} />;
}

function ResetPasswordContent() {
  const session = useSession(), location = useLocation();
  const restoring = session.status === 'restoring';
  const initial = passwordResetTokenFromHash(location.hash);
  const [fromLink, setFromLink] = useState(!!initial.token);
  const [error, setError] = useState(initial.invalid ? 'O código no link está incompleto ou inválido. Informe outro código ou solicite uma nova recuperação.' : '');
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [focusCode, setFocusCode] = useState(0);
  const command = useRecoveryCommand();
  const { busy } = command;
  const successAction = useRef<HTMLAnchorElement>(null);
  const codeHintId = useId();
  const passwordHintId = useId();
  const attempted = useRef<{ token: string; password: string; key: string } | null>(null);
  const form = useForm<{ token: string; password: string; confirm: string }>({ defaultValues: { token: initial.token || (!initial.invalid && API_MODE === 'demo' ? 'demo-reset' : ''), password: '', confirm: '' } });
  const tokenProps = form.register('token', { required: 'Informe o código recebido.', validate: value => validPasswordResetToken(value) || 'Confira o código recebido ou solicite uma nova recuperação.' });
  useEffect(() => { if (done) successAction.current?.focus({ preventScroll: true }); }, [done]);
  useEffect(() => { if (focusCode) form.setFocus('token'); }, [focusCode, form.setFocus]);
  if (session.me) return <Navigate to="/app" replace />;
  return <AuthLayout><AuthCard title={done ? 'Tudo pronto.' : 'Definir nova senha'} icon={done ? ShieldCheck : KeyRound} description={done ? 'Sua senha foi atualizada. Entre para continuar.' : 'Informe o código de recuperação e a nova senha.'}>
    <RecoverySteps current={done ? 2 : 1} />
    {error && <Feedback tone="danger">{error}</Feedback>}
    {done ? <div className={`${styles.successState} ${styles.step}`}>
      <span className={styles.successMark} aria-hidden="true"><Check size={27} strokeWidth={1.8} /></span>
      <Feedback tone="success">Senha redefinida.</Feedback>
      <Link ref={successAction} className={`${styles.button} ${styles.primary}`} to="/login">Voltar ao login<ArrowRight size={17} aria-hidden="true" /></Link>
    </div> : <form className={formClass} noValidate aria-busy={busy} onSubmit={form.handleSubmit(async v => {
      if (command.pending() || restoring) return;
      if (v.password !== v.confirm) { form.setError('confirm', { message: 'As senhas devem ser iguais.' }); return; }
      setError('');
      if (!attempted.current || attempted.current.token !== v.token || attempted.current.password !== v.password) attempted.current = { token: v.token, password: v.password, key: crypto.randomUUID() };
      try { await command.post(AUTH_CONTRACT.resetPasswordPath, { token: v.token, newPassword: v.password }, attempted.current.key); attempted.current = null; form.reset({ token: '', password: '', confirm: '' }); setShow(false); setShowConfirm(false); setDone(true); }
      catch (e) { if (!recoveryCanceled(e)) setError(e instanceof Error ? e.message : 'Não foi possível redefinir a senha. Tente novamente.'); }
    })}>
      {fromLink && <div className={styles.recoveryLinkReady}><ShieldCheck size={17} aria-hidden="true" /><div><strong>Código do link preparado</strong><span>Defina sua nova senha para continuar. A validade será conferida ao enviar.</span></div></div>}
      <Field required label="Código de recuperação" error={form.formState.errors.token?.message}><input className={inputClass} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={512} aria-describedby={codeHintId} readOnly={busy} {...tokenProps} onChange={event => { void tokenProps.onChange(event); setFromLink(false); setError(''); }} /></Field>
      <p id={codeHintId} className={styles.fieldHint}>Use o código recebido. Não é a senha da sua conta.</p>
      <AuthButton variant="ghost" disabled={busy || restoring} onClick={() => { attempted.current = null; form.reset({ token: '', password: '', confirm: '' }); setFromLink(false); setShow(false); setShowConfirm(false); setError(''); setFocusCode(value => value + 1); }}>Usar outro código</AuthButton>
      <Field required label="Nova senha" error={form.formState.errors.password?.message}><span className={styles.password}>
        <input className={`${inputClass} ${styles.passwordInput}`} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Digite a nova senha" minLength={12} aria-describedby={passwordHintId} readOnly={busy} {...form.register('password', { required: 'Informe uma senha.', minLength: { value: 12, message: 'Use pelo menos 12 caracteres.' } })} />
        <PasswordVisibility shown={show} onToggle={() => setShow(!show)} label="nova senha" />
      </span></Field>
      <p id={passwordHintId} className={styles.fieldHint}>Use pelo menos 12 caracteres. Você pode criar uma frase fácil de lembrar.</p>
      <Field required label="Confirmar nova senha" error={form.formState.errors.confirm?.message}><span className={styles.password}>
        <input className={`${inputClass} ${styles.passwordInput}`} type={showConfirm ? 'text' : 'password'} autoComplete="new-password" placeholder="Repita a nova senha" readOnly={busy} {...form.register('confirm', { required: 'Confirme a senha.' })} />
        <PasswordVisibility shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} label="confirmação da senha" />
      </span></Field>
      <AuthButton type="submit" disabled={busy || restoring} busy={busy || restoring}>{restoring ? 'Preparando acesso…' : busy ? 'Salvando…' : <>Redefinir senha<ArrowRight size={17} aria-hidden="true" /></>}</AuthButton>
      <Link className={styles.recoveryHelp} to="/recuperar-acesso">Precisa de um novo código? Solicitar recuperação</Link>
      <Link className={styles.backLink} to="/login">Voltar ao login</Link>
    </form>}
  </AuthCard></AuthLayout>;
}
