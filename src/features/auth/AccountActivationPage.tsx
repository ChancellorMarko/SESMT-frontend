import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useForm } from 'react-hook-form';
import { ArrowRight, Check, CheckCheck, Clock3, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { api, API_MODE, ApiError, obtainCsrf } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import type { AccountInvitationInspectDto, AccountInvitationAcceptDto } from '../../shared/contracts/account-invitations';
import { Feedback, Field, Spinner } from '../../shared/ui';
import { AuthButton, AuthCard, AuthLayout, PasswordVisibility } from './AuthPages';
import { accountInvitationsEnabled, checkedAcceptance, checkedInvitation, invitationTokenFromHash, validInvitationToken } from './account-invitations';
import auth from './AuthPages.module.css';
import styles from './AccountActivationPage.module.css';

export function AccountActivationPage() {
  const session = useSession(), location = useLocation();
  if (session.status === 'restoring') return <AuthLayout><AuthCard title="Preparando seu primeiro acesso" description="Conferindo se já existe uma conta aberta."><Spinner /></AuthCard></AuthLayout>;
  return <ActivationContent key={`${session.sessionKey}:${location.key}:${location.hash}`} />;
}

function ActivationContent() {
  const session = useSession(), location = useLocation();
  const initial = invitationTokenFromHash(location.hash);
  const [token, setToken] = useState(initial.token);
  const [invitation, setInvitation] = useState<AccountInvitationInspectDto | null>(null);
  const [receipt, setReceipt] = useState<AccountInvitationAcceptDto | null>(null);
  const [busy, setBusy] = useState(false), [expired, setExpired] = useState(false), [terminal, setTerminal] = useState(false);
  const [error, setError] = useState(initial.invalid ? 'O código no link está incompleto ou inválido. Cole o código do convite para continuar.' : '');
  const [show, setShow] = useState(false), [showConfirm, setShowConfirm] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null), passwordInput = useRef<HTMLInputElement | null>(null), successAction = useRef<HTMLAnchorElement>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0), pending = useRef(false);
  const attempted = useRef<{ token: string; password: string; key: string } | null>(null);
  const form = useForm<{ password: string; confirm: string }>({ defaultValues: { password: '', confirm: '' } });
  const enabled = accountInvitationsEnabled();
  const { ref: passwordRef, ...passwordProps } = form.register('password', {
    required: 'Defina sua senha.',
    validate: value => !invitation || value.length >= invitation.passwordPolicy.minLength && value.length <= invitation.passwordPolicy.maxLength || `Use entre ${invitation?.passwordPolicy.minLength} e ${invitation?.passwordPolicy.maxLength} caracteres.`,
  });
  useEffect(() => () => { generation.current++; controller.current?.abort(); pending.current = false; attempted.current = null; }, []);
  useEffect(() => { if (!session.me && enabled && initial.token) void inspect(initial.token); }, []);
  useEffect(() => {
    if (receipt) successAction.current?.focus({ preventScroll: true });
    else if (invitation) passwordInput.current?.focus({ preventScroll: true });
    else if (!busy && !session.me && enabled) tokenInput.current?.focus({ preventScroll: true });
  }, [invitation, receipt]);
  useEffect(() => {
    if (!invitation || receipt) return;
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      const remaining = Date.parse(invitation!.expiresAt) - Date.now();
      if (remaining <= 0) { setExpired(true); form.reset(); attempted.current = null; }
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    }
    check();
    return () => clearTimeout(timer);
  }, [invitation, receipt]);
  function startRequest() {
    controller.current?.abort(); controller.current = new AbortController();
    pending.current = true; setBusy(true); setError('');
    return { operation: ++generation.current, signal: controller.current.signal };
  }
  function current(operation: number) { return generation.current === operation && !controller.current?.signal.aborted; }
  async function inspect(candidate: string) {
    if (pending.current || session.me || !enabled) return;
    if (!validInvitationToken(candidate)) { setError('Confira o código recebido. Ele deve estar completo, sem espaços.'); tokenInput.current?.focus(); return; }
    const request = startRequest(); setTerminal(false); setExpired(false); setInvitation(null); form.reset(); attempted.current = null;
    try {
      await obtainCsrf(); if (!current(request.operation)) return;
      const next = checkedInvitation(await api.post<unknown>('/auth/invitations/inspect', { token: candidate }, { signal: request.signal }));
      if (current(request.operation)) setInvitation(next);
    } catch (failure) { if (current(request.operation)) setError(failure instanceof Error ? failure.message : 'Não foi possível conferir o convite. Tente novamente.'); }
    finally { if (current(request.operation)) { pending.current = false; setBusy(false); } }
  }
  async function accept(values: { password: string; confirm: string }) {
    if (pending.current || !invitation || expired || terminal || session.me || !enabled) return;
    if (Date.parse(invitation.expiresAt) <= Date.now()) { setExpired(true); form.reset(); return; }
    const request = startRequest();
    if (!attempted.current || attempted.current.token !== token || attempted.current.password !== values.password) attempted.current = { token, password: values.password, key: crypto.randomUUID() };
    try {
      await obtainCsrf(); if (!current(request.operation)) return;
      const next = checkedAcceptance(await api.post<unknown>('/auth/invitations/accept', { token, newPassword: values.password }, { signal: request.signal, idempotencyKey: attempted.current.key }), invitation.invitationId);
      if (current(request.operation)) { form.reset(); attempted.current = null; setShow(false); setShowConfirm(false); setReceipt(next); }
    } catch (failure) {
      if (!current(request.operation)) return;
      setError(failure instanceof Error ? failure.message : 'Não foi possível ativar a conta. Tente novamente.');
      if (failure instanceof ApiError) {
        for (const issue of failure.fieldErrors ?? []) if (issue.field === 'newPassword') form.setError('password', { message: issue.message }, { shouldFocus: true });
        if ([404, 410].includes(failure.status) || ['INVITATION_USED', 'INVITATION_UNAVAILABLE', 'ACCOUNT_DISABLED'].includes(failure.code)) { setTerminal(true); form.reset(); attempted.current = null; }
      }
    } finally { if (current(request.operation)) { pending.current = false; setBusy(false); } }
  }
  function changeCode() {
    if (pending.current) return;
    generation.current++; controller.current?.abort(); attempted.current = null;
    form.reset(); setInvitation(null); setToken(''); setError(''); setExpired(false); setTerminal(false); setShow(false); setShowConfirm(false);
  }
  if (!enabled) return <AuthLayout><AuthCard title="Ativação de conta" icon={UserRound} description="O primeiro acesso por convite ainda não está disponível neste ambiente."><Feedback>Solicite ao administrador as orientações para acessar sua conta.</Feedback><Link className={auth.backLink} to="/login">Voltar ao login</Link></AuthCard></AuthLayout>;
  if (session.me) return <AuthLayout><AuthCard title="Já existe uma conta aberta" icon={UserRound} description="Para definir a senha de uma nova conta, encerre o acesso atual primeiro."><div className={styles.identity}><UserRound size={18} aria-hidden="true" /><div><strong>{session.me.user.displayName}</strong><span>{session.me.user.email}</span></div></div>{error && <Feedback tone="danger">{error}</Feedback>}<AuthButton disabled={busy} busy={busy} onClick={async () => { if (pending.current) return; pending.current = true; setBusy(true); try { await session.logout(); } catch { setError('Não foi possível concluir a saída. Tente novamente.'); } finally { pending.current = false; setBusy(false); } }}>Sair e continuar<ArrowRight size={17} aria-hidden="true" /></AuthButton><Link className={auth.backLink} to="/app">Voltar para minha conta</Link></AuthCard></AuthLayout>;
  const needsMfa = receipt?.nextStep === 'MFA_SETUP_REQUIRED', needsWorker = receipt?.nextStep === 'WORKER_LINK_REQUIRED';
  return <AuthLayout><AuthCard title={receipt ? needsMfa || needsWorker ? 'Sua senha foi definida' : 'Sua conta está pronta' : 'Seu primeiro acesso'} eyebrow="BOAS-VINDAS AO AMPARA" icon={receipt ? ShieldCheck : KeyRound} description={receipt ? needsMfa ? 'Sua conta ainda precisa configurar o autenticador antes de acessar a plataforma.' : needsWorker ? 'O vínculo da sua conta com o cadastro de trabalhador ainda precisa ser confirmado.' : 'Agora você pode entrar com seu e-mail e a senha que acabou de definir.' : 'Um convite, uma senha só sua. Vamos preparar seu acesso.'}>
    <ol className={styles.steps} aria-label="Etapas do primeiro acesso">{['Conferir convite', 'Definir senha', 'Entrar'].map((label, index) => { const step = receipt ? 2 : invitation ? 1 : 0; return <li key={label} aria-current={step === index ? 'step' : undefined} data-complete={index < step}><span aria-hidden="true">{index < step ? <Check size={12} /> : index + 1}</span>{label}</li>; })}</ol>
    {receipt ? <div className={auth.successState}><span className={auth.successMark}><CheckCheck size={26} aria-hidden="true" /></span>{needsMfa && <Feedback tone="warning">A configuração inicial do autenticador ainda depende da liberação deste ambiente. Peça ao administrador a continuidade do primeiro acesso.</Feedback>}{needsWorker && <Feedback tone="warning">Peça ao administrador para confirmar o vínculo com o trabalhador. Até essa etapa ser concluída, o acesso aos dados próprios permanece bloqueado.</Feedback>}<Link ref={successAction} className={`${auth.button} ${auth.primary}`} to="/login">Ir para o login<ArrowRight size={17} aria-hidden="true" /></Link></div> : <>
      {error && <Feedback tone="danger">{error}</Feedback>}
      {invitation ? <>
        <div className={styles.identity}><UserRound size={20} aria-hidden="true" /><div><strong>{invitation.displayName}</strong><span><Mail size={12} aria-hidden="true" />{invitation.emailMasked}</span></div></div>
        <p className={styles.validity}><Clock3 size={13} aria-hidden="true" />Convite válido até {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(invitation.expiresAt))} (São Paulo)</p>
        {expired ? <Feedback tone="warning">O convite expirou. Solicite um novo convite ao administrador.</Feedback> : terminal ? <Feedback tone="warning">Este convite não está disponível para ativação. Solicite orientação ao administrador.</Feedback> : <form className={auth.form} noValidate onSubmit={form.handleSubmit(accept)}>
          <p id="activation-password-hint" className={styles.policy}>Use entre {invitation.passwordPolicy.minLength} e {invitation.passwordPolicy.maxLength} caracteres. A senha será definida por você.</p>
          <Field required label="Nova senha" error={form.formState.errors.password?.message}><span className={auth.password}><input ref={node => { passwordRef(node); passwordInput.current = node; }} className={`${auth.input} ${auth.passwordInput}`} type={show ? 'text' : 'password'} autoComplete="new-password" aria-describedby="activation-password-hint" readOnly={busy} {...passwordProps} /><PasswordVisibility shown={show} onToggle={() => setShow(!show)} label="nova senha" /></span></Field>
          <Field required label="Confirmar nova senha" error={form.formState.errors.confirm?.message}><span className={auth.password}><input className={`${auth.input} ${auth.passwordInput}`} type={showConfirm ? 'text' : 'password'} autoComplete="new-password" readOnly={busy} {...form.register('confirm', { required: 'Confirme sua senha.', validate: value => value === form.getValues('password') || 'As senhas devem ser iguais.' })} /><PasswordVisibility shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} label="confirmação da senha" /></span></Field>
          <AuthButton type="submit" disabled={busy} busy={busy}>{busy ? 'Preparando sua conta…' : 'Ativar minha conta'}<ArrowRight size={17} aria-hidden="true" /></AuthButton>
        </form>}
        <AuthButton variant="ghost" disabled={busy} onClick={changeCode}>Usar outro convite</AuthButton>
      </> : <form className={auth.form} noValidate onSubmit={event => { event.preventDefault(); void inspect(token.trim()); setToken(value => value.trim()); }}>
        <Field required label="Código do convite"><input ref={tokenInput} className={auth.input} type="password" autoComplete="off" spellCheck={false} value={token} maxLength={512} readOnly={busy} onChange={event => setToken(event.target.value)} aria-describedby="activation-code-hint" /></Field>
        <p id="activation-code-hint" className={styles.policy}>Use o link de ativação ou cole o código recebido no convite da sua conta.</p>
        <AuthButton type="submit" disabled={busy} busy={busy}>{busy ? 'Conferindo convite…' : 'Conferir convite'}<ArrowRight size={17} aria-hidden="true" /></AuthButton>
      </form>}
      <Link className={auth.backLink} to="/login">Já tenho acesso · voltar ao login</Link>
    </>}
    {API_MODE === 'demo' && <p className={auth.demoNote}>Demonstração em memória. Nenhum e-mail é enviado; recarregar a página restaura os dados de teste.</p>}
  </AuthCard></AuthLayout>;
}
