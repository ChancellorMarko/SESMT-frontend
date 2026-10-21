import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import { ArrowRight, BriefcaseBusiness, Eye, EyeOff, Flame, HardHat, HeartPulse, LockKeyhole, ScanEye, Settings2, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useSession } from '../../shared/auth/SessionProvider';
import { API_MODE, api } from '../../shared/api/client';
import { Feedback, Field, Spinner } from '../../shared/ui';
import type { MfaChallengeDto } from '../../shared/contracts';
import { BrandLogo } from '../../shared/brand/BrandLogo';

const inputClass = 'h-[48px] rounded-2xl border-slate-200 bg-white/85 px-4 text-[13px] text-slate-800 shadow-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:outline-2 focus:outline-blue-200 focus:outline-offset-0';
const formClass = 'mt-2 grid gap-4 [&_.field]:gap-2 [&_.field]:text-xs [&_.field]:font-medium [&_.field]:text-slate-600';
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

function AuthButton({ children, variant = 'primary', className = '', ...props }: HTMLMotionProps<'button'> & { variant?: 'primary' | 'ghost' }) {
  const reducedMotion = useAppReducedMotion();
  return <motion.button
    type="button"
    whileHover={reducedMotion || props.disabled ? undefined : { y: -1 }}
    whileTap={reducedMotion || props.disabled ? undefined : { scale: .985 }}
    {...props}
    className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-semibold leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variant === 'primary' ? 'border-blue-600 bg-blue-600 text-white shadow-[0_8px_22px_-9px_rgba(70,121,238,.65)] hover:border-blue-700 hover:bg-blue-700' : 'border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800'} ${className}`}
  >{children}</motion.button>;
}

function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="px-6 pb-7 sm:px-9 sm:pb-9">
    <div className="mb-6 text-center">
      <p className="mb-2 text-[10px] font-semibold tracking-[.15em] text-blue-600">ACESSO AO SISTEMA</p>
      <h1 className="mb-2 text-[25px] font-semibold tracking-[-.04em] text-slate-900 sm:text-[28px]">{title}</h1>
      {description && <p className="m-0 text-[13px] leading-6 text-slate-500">{description}</p>}
    </div>
    <div className="grid gap-3 [&_.feedback]:rounded-2xl">{children}</div>
  </section>;
}

export function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const reducedMotion = useAppReducedMotion();
  return <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#eff2f8] text-slate-800">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-28 size-[560px] rounded-full bg-blue-200/40 blur-[110px]" />
      <div className="absolute -right-48 top-1/3 size-[560px] rounded-full bg-indigo-200/40 blur-[110px]" />
      <div className="absolute bottom-0 left-1/3 size-96 rounded-full bg-sky-100/70 blur-[100px]" />
    </div>
    <main className="flex w-full flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: .4, ease: [.22, 1, .36, 1] }}
        className={`w-full rounded-[28px] border border-white/80 bg-white/75 shadow-[0_24px_80px_-30px_rgba(63,91,170,.3)] backdrop-blur-md ${wide ? 'max-w-[860px]' : 'max-w-[484px]'}`}
      >
        <header className="flex flex-col items-center px-6 pb-6 pt-7 sm:px-9 sm:pt-8">
          <Link to="/login" className="flex rounded-xl" aria-label="Ampara SESMT — início"><BrandLogo className="w-[170px] rounded-none" /></Link>
          <span className="mt-2 text-center text-[11px] tracking-[.02em] text-slate-500">Segurança e saúde no trabalho</span>
          <div className="mt-5 h-px w-full bg-slate-200/75" />
        </header>
        {children}
      </motion.div>
    </main>
    <footer className="mx-auto flex max-w-[600px] items-start justify-center gap-2 px-6 pb-7 text-center text-[10px] leading-5 text-slate-500">
      <LockKeyhole size={13} className="mt-1 shrink-0 text-slate-400" aria-hidden="true" />
      <p className="m-0">Acesso conforme perfil e unidade. Dados de saúde exigem autorização específica.</p>
    </footer>
  </div>;
}

export function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const reducedMotion = useAppReducedMotion();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallengeDto | null>(null);
  const form = useForm<{ email: string; password: string }>({ defaultValues: { email: '', password: '' } });
  const mfa = useForm<{ code: string }>();
  if (session.status === 'restoring') return <AuthLayout><Spinner /></AuthLayout>;
  if (session.me) return <Navigate to="/app" replace />;

  async function signIn(email: string, password: string) {
    setBusy(true);
    setError('');
    try {
      const nextChallenge = await session.login(email, password);
      if (nextChallenge) setChallenge(nextChallenge);
      else navigate('/app', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout wide={API_MODE === 'demo' && !challenge}><AuthCard
    title={challenge ? 'Verifique seu acesso' : 'Entrar na sua conta'}
    description={challenge ? 'Informe o código do seu autenticador para continuar.' : 'Use suas credenciais para acessar o ambiente de trabalho.'}
  >
    {session.sessionError && <Feedback tone="warning">{session.sessionError}</Feedback>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    {challenge ? <form className={formClass} onSubmit={mfa.handleSubmit(async ({ code }) => {
      setBusy(true); setError('');
      try { await session.verifyMfa(challenge.challengeId, code); navigate('/app', { replace: true }); }
      catch (e) { setError(e instanceof Error ? e.message : 'Código inválido.'); }
      finally { setBusy(false); }
    })}>
      <Field required label="Código de verificação" error={mfa.formState.errors.code?.message}>
        <input className={`${inputClass} text-center tracking-[.4em]`} autoComplete="one-time-code" inputMode="numeric" {...mfa.register('code', { required: 'Informe o código.', pattern: { value: /^\d{6}$/, message: 'Use os seis números do código.' } })} />
      </Field>
      {API_MODE === 'demo' && <Feedback>Na demonstração, use o código 123456. A validação real pertence ao serviço de identidade.</Feedback>}
      <AuthButton type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Verificar e entrar'}<ArrowRight size={17} aria-hidden="true" /></AuthButton>
      <AuthButton variant="ghost" onClick={() => setChallenge(null)}>Voltar ao login</AuthButton>
    </form> : <div className={API_MODE === 'demo' ? 'grid gap-7 md:grid-cols-2 md:gap-8' : ''}>
      <form className={formClass} onSubmit={form.handleSubmit(v => signIn(v.email, v.password))}>
        <Field required label="E-mail" error={form.formState.errors.email?.message}>
          <input className={inputClass} type="email" autoComplete="username" placeholder="seu.nome@empresa.com" {...form.register('email', { required: 'Informe seu e-mail.' })} />
        </Field>
        <Field required label="Senha" error={form.formState.errors.password?.message}>
          <span className="relative flex">
            <input className={`${inputClass} pr-12`} type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Informe sua senha" {...form.register('password', { required: 'Informe sua senha.' })} />
            <button className="absolute right-0 top-0 grid size-[48px] place-items-center rounded-2xl border-0 bg-transparent p-0 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600" type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={show}>{show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
          </span>
        </Field>
        <Link className="mb-1 justify-self-end text-xs font-medium text-blue-600 no-underline hover:text-blue-800 hover:underline" to="/recuperar-acesso">Esqueci minha senha</Link>
        <AuthButton type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar na plataforma'}<ArrowRight size={17} aria-hidden="true" /></AuthButton>
      </form>
      {API_MODE === 'demo' && <div className="border-t border-slate-200/80 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-2">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><ShieldCheck size={16} aria-hidden="true" /></span>
          <div>
            <span className="block text-[10px] font-semibold tracking-[.08em] text-slate-600">AMBIENTE DE DEMONSTRAÇÃO</span>
            <p className="mb-0 mt-1 text-[11px] leading-[1.6] text-slate-500">Explore com dados fictícios. As alterações duram até recarregar a página.</p>
          </div>
        </div>
        <motion.div
          initial={reducedMotion ? false : 'hidden'}
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: .035 } } }}
          className="grid grid-cols-2 gap-2"
        >
          {profiles.map(({ role, label, icon: Icon }) => <motion.button
            key={label}
            type="button"
            disabled={busy}
            variants={{ hidden: { opacity: 0, y: reducedMotion ? 0 : 5 }, visible: { opacity: 1, y: 0 } }}
            whileHover={reducedMotion || busy ? undefined : { y: -2 }}
            whileTap={reducedMotion || busy ? undefined : { scale: .98 }}
            onClick={() => signIn(`${role}@demo.sesmt.local`, 'Demo123!')}
            className="group flex min-h-[48px] min-w-0 items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-left text-[11px] font-medium leading-[1.5] text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          ><Icon size={15} className="shrink-0 text-slate-400 transition-colors group-hover:text-blue-500" aria-hidden="true" /><span>{label}</span></motion.button>)}
        </motion.div>
      </div>}
    </div>}
  </AuthCard></AuthLayout>;
}

export function RecoveryPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<{ email: string }>();
  return <AuthLayout><AuthCard title="Recuperar acesso" description="Informe o e-mail associado à sua conta.">
    {message && <Feedback tone="success">{message}</Feedback>}
    {error && <Feedback tone="danger">{error}</Feedback>}
    <form className={formClass} onSubmit={form.handleSubmit(async v => {
      setBusy(true); setError('');
      try { const result = await api.post<{ message: string }>('/auth/password/forgot', v); setMessage(result.message); }
      catch (e) { setError(e instanceof Error ? e.message : 'Falha no envio.'); }
      finally { setBusy(false); }
    })}>
      <Field required label="E-mail" error={form.formState.errors.email?.message}><input className={inputClass} type="email" autoComplete="email" {...form.register('email', { required: 'Informe seu e-mail.' })} /></Field>
      <AuthButton type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Solicitar recuperação'}<ArrowRight size={17} aria-hidden="true" /></AuthButton>
      <Link className="justify-self-center py-2 text-xs font-medium text-blue-600 no-underline hover:underline" to="/login">Voltar ao login</Link>
    </form>
    {API_MODE === 'demo' && <p className="mb-0 mt-2 text-xs leading-6 text-slate-500">Demonstração: nenhuma mensagem é enviada. <Link className="text-blue-600" to="/redefinir-senha">Experimentar redefinição</Link>.</p>}
  </AuthCard></AuthLayout>;
}

export function ResetPasswordPage() {
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useForm<{ token: string; password: string; confirm: string }>({ defaultValues: { token: API_MODE === 'demo' ? 'demo-reset' : '', password: '', confirm: '' } });
  return <AuthLayout><AuthCard title="Definir nova senha" description="Use o código recebido pelo serviço de identidade. Ele não será salvo no navegador.">
    {error && <Feedback tone="danger">{error}</Feedback>}
    {done ? <Feedback tone="success">Senha redefinida. <Link to="/login">Voltar ao login</Link></Feedback> : <form className={formClass} onSubmit={form.handleSubmit(async v => {
      if (v.password !== v.confirm) { form.setError('confirm', { message: 'As senhas devem ser iguais.' }); return; }
      setBusy(true); setError('');
      try { await api.post('/auth/password/reset', { token: v.token, newPassword: v.password }); form.reset(); setDone(true); }
      catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível redefinir.'); }
      finally { setBusy(false); }
    })}>
      <Field required label="Código de recuperação" error={form.formState.errors.token?.message}><input className={inputClass} autoComplete="off" {...form.register('token', { required: 'Informe o código recebido.' })} /></Field>
      <Field required label="Nova senha" error={form.formState.errors.password?.message}><input className={inputClass} type="password" autoComplete="new-password" {...form.register('password', { required: 'Informe uma senha.' })} /></Field>
      <Field required label="Confirmar nova senha" error={form.formState.errors.confirm?.message}><input className={inputClass} type="password" autoComplete="new-password" {...form.register('confirm', { required: 'Confirme a senha.' })} /></Field>
      <AuthButton type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Redefinir senha'}<ArrowRight size={17} aria-hidden="true" /></AuthButton>
      <Link className="justify-self-center py-2 text-xs font-medium text-blue-600 no-underline hover:underline" to="/login">Voltar ao login</Link>
    </form>}
  </AuthCard></AuthLayout>;
}
