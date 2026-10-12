import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ShieldCheck, ArrowRight, FileCheck2, Users, CalendarClock, Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useSession } from '../../shared/auth/SessionProvider';
import { API_MODE, api } from '../../shared/api/client';
import { Button, Feedback, Field, Spinner } from '../../shared/ui';
import type { MfaChallengeDto } from '../../shared/contracts';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import styles from './AuthPages.module.css';

export function AuthLayout({children}:{children:React.ReactNode}) {
  return <div className={styles.shell}>
    <section className={styles.story}>
      <Link to="/login" className={styles.brand} aria-label="Ampara SESMT — início"><BrandLogo tone="dark" className={styles.logo}/></Link>
      <div className={styles.storyCopy}>
        <p className={styles.kicker}><span aria-hidden="true"/>SEGURANÇA EM CADA ETAPA</p>
        <h1>Tecnologia que<br/>cuida de pessoas.</h1>
        <p>Uma rotina mais clara para acompanhar documentos, conectar equipes e cuidar de cada serviço.</p>
        <div className={styles.features}>
          <div><span className={styles.featureIcon}><FileCheck2 size={21} aria-hidden="true"/></span><span><strong>Documentos em dia</strong><small>Requisitos, versões e pendências em um lugar.</small></span></div>
          <div><span className={styles.featureIcon}><Users size={21} aria-hidden="true"/></span><span><strong>Pessoas conectadas</strong><small>Equipes, participantes e responsabilidades.</small></span></div>
          <div><span className={styles.featureIcon}><CalendarClock size={21} aria-hidden="true"/></span><span><strong>Cuidado em campo</strong><small>Agenda e permissões ao longo do trabalho.</small></span></div>
        </div>
      </div>
      <div className={styles.storyFooter}><ShieldCheck size={18} aria-hidden="true"/><small>Segurança e Saúde no Trabalho</small><span>AMPARA SESMT</span></div>
    </section>
    <main className={styles.formSide}>{children}<p className={styles.footer}>Acesso conforme perfil e unidade. Dados de saúde exigem autorização específica.</p></main>
  </div>;
}
export function LoginPage() {
  const session=useSession(); const navigate=useNavigate();
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [show,setShow]=useState(false); const [challenge,setChallenge]=useState<MfaChallengeDto|null>(null);
  const form=useForm<{email:string;password:string}>({defaultValues:{email:'',password:''}});
  const mfa=useForm<{code:string}>();
  if(session.status==='restoring') return <AuthLayout><div className={styles.card}><Spinner/></div></AuthLayout>;
  if(session.me) return <Navigate to="/app" replace/>;
  async function signIn(email:string,password:string) { setBusy(true);setError('');try {const c=await session.login(email,password);if(c)setChallenge(c);else navigate('/app',{replace:true});}catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar.');}finally{setBusy(false);} }
  return <AuthLayout><section className={styles.card}><p className="eyebrow">BEM-VINDO À AMPARA</p><h2>{challenge?'Verifique seu acesso':'Sua rotina, organizada.'}</h2><p className="muted">{challenge?'Informe o código do seu autenticador para continuar.':'Entre para acompanhar a agenda, as PTs e as pendências.'}</p>{session.sessionError&&<Feedback tone="warning">{session.sessionError}</Feedback>}{error&&<Feedback tone="danger">{error}</Feedback>}
  {challenge?<form onSubmit={mfa.handleSubmit(async ({code})=>{setBusy(true);setError('');try{await session.verifyMfa(challenge.challengeId,code);navigate('/app',{replace:true});}catch(e){setError(e instanceof Error?e.message:'Código inválido.');}finally{setBusy(false);}})} className="stack"><Field label="Código de verificação" error={mfa.formState.errors.code?.message}><input autoComplete="one-time-code" inputMode="numeric" {...mfa.register('code',{required:'Informe o código.',pattern:{value:/^\d{6}$/,message:'Use os seis números do código.'}})}/></Field>{API_MODE==='demo'&&<Feedback>Na demonstração, use o código 123456. A validação real pertence ao serviço de identidade.</Feedback>}<Button type="submit" disabled={busy}>{busy?'Verificando…':'Verificar e entrar'}<ArrowRight size={17}/></Button><Button variant="ghost" onClick={()=>setChallenge(null)}>Voltar ao login</Button></form>:<><form onSubmit={form.handleSubmit(v=>signIn(v.email,v.password))} className="stack"><Field label="E-mail" error={form.formState.errors.email?.message}><input type="email" autoComplete="username" placeholder="seu.nome@empresa.com" {...form.register('email',{required:'Informe seu e-mail.'})}/></Field><Field label="Senha" error={form.formState.errors.password?.message}><span className={styles.password}><input type={show?'text':'password'} autoComplete="current-password" placeholder="Informe sua senha" {...form.register('password',{required:'Informe sua senha.'})}/><button type="button" onClick={()=>setShow(!show)} aria-label={show?'Ocultar senha':'Mostrar senha'}>{show?<EyeOff size={19}/>:<Eye size={19}/>}</button></span></Field><Link className={styles.recover} to="/recuperar-acesso">Esqueci minha senha</Link><Button type="submit" disabled={busy}>{busy?'Entrando…':'Entrar na plataforma'}<ArrowRight size={17}/></Button></form>{API_MODE==='demo'&&<div className={styles.demo}><span className={styles.demoLabel}>AMBIENTE DE DEMONSTRAÇÃO</span><p>Explore com dados fictícios. As alterações duram até recarregar a página.</p><div className={styles.demoButtons}>{[['tecnico','Técnico de segurança'],['bombeiro','Bombeiro'],['gestor','Engenheiro'],['gestor','Gestor SESMT'],['rh','RH'],['auditor','Auditor'],['admin','Administrador'],['trabalhador','Trabalhador']].map(([role,label])=><Button key={label} variant="secondary" disabled={busy} onClick={()=>signIn(`${role}@demo.sesmt.local`,'Demo123!')}>{label}</Button>)}</div></div>}</>}
  </section></AuthLayout>;
}
export function RecoveryPage() {
  const [message,setMessage]=useState(''); const [error,setError]=useState('');const [busy,setBusy]=useState(false);const form=useForm<{email:string}>();
  return <AuthLayout><section className={styles.card}><p className="eyebrow">RECUPERAR ACESSO</p><h2>Vamos ajudar você a voltar.</h2><p className="muted">Informe o e-mail associado ao seu acesso.</p>{message&&<Feedback tone="success">{message}</Feedback>}{error&&<Feedback tone="danger">{error}</Feedback>}<form className="stack" onSubmit={form.handleSubmit(async v=>{setBusy(true);setError('');try{const r=await api.post<{message:string}>('/auth/password/forgot',v);setMessage(r.message);}catch(e){setError(e instanceof Error?e.message:'Falha no envio.');}finally{setBusy(false);}})}><Field label="E-mail" error={form.formState.errors.email?.message}><input type="email" autoComplete="email" {...form.register('email',{required:'Informe seu e-mail.'})}/></Field><Button type="submit" disabled={busy}>{busy?'Enviando…':'Solicitar recuperação'}</Button><Link to="/login">Voltar ao login</Link></form>{API_MODE==='demo'&&<p className="muted">Demonstração: nenhuma mensagem é enviada. <Link to="/redefinir-senha">Experimentar redefinição</Link>.</p>}</section></AuthLayout>;
}
export function ResetPasswordPage() {
  const [error,setError]=useState('');const[done,setDone]=useState(false);const[busy,setBusy]=useState(false);
  const form=useForm<{token:string;password:string;confirm:string}>({defaultValues:{token:API_MODE==='demo'?'demo-reset':'',password:'',confirm:''}});
  return <AuthLayout><section className={styles.card}><p className="eyebrow">REDEFINIR SENHA</p><h2>Um novo acesso.</h2><p className="muted">Use o código recebido pelo serviço de identidade. Ele não será salvo no navegador.</p>{error&&<Feedback tone="danger">{error}</Feedback>}{done?<Feedback tone="success">Senha redefinida. <Link to="/login">Voltar ao login</Link></Feedback>:<form className="stack" onSubmit={form.handleSubmit(async v=>{if(v.password!==v.confirm){form.setError('confirm',{message:'As senhas devem ser iguais.'});return;}setBusy(true);setError('');try{await api.post('/auth/password/reset',{token:v.token,newPassword:v.password});form.reset();setDone(true);}catch(e){setError(e instanceof Error?e.message:'Não foi possível redefinir.');}finally{setBusy(false);}})}><Field label="Código de recuperação" error={form.formState.errors.token?.message}><input autoComplete="off" {...form.register('token',{required:'Informe o código recebido.'})}/></Field><Field label="Nova senha" error={form.formState.errors.password?.message}><input type="password" autoComplete="new-password" {...form.register('password',{required:'Informe uma senha.'})}/></Field><Field label="Confirmar nova senha" error={form.formState.errors.confirm?.message}><input type="password" autoComplete="new-password" {...form.register('confirm',{required:'Confirme a senha.'})}/></Field><Button type="submit" disabled={busy}>{busy?'Salvando…':'Redefinir senha'}</Button><Link to="/login">Voltar ao login</Link></form>}</section></AuthLayout>;
}
