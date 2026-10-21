import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { LayoutDashboard, FolderOpen, Users, Building2, Bell, History, SlidersHorizontal, LogOut, Menu, ArrowUpRight, CircleHelp, CalendarDays, CalendarClock, ClipboardCheck, UsersRound, UserCheck, FileSearch, Search, Command, ShieldCheck, HeartPulse, HardHat, ChartNoAxesCombined, type LucideIcon } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { Button, Modal } from '../../shared/ui';
import type { OrganizationDto } from '../../shared/contracts';
import { HeaderNotifications } from './HeaderNotifications';
import { BorderGlow } from '../../shared/ui/BorderGlow';
import { canReadOperationsDashboard, dashboardPath } from '../navigation';
import styles from './AppLayout.module.css';
import { useProtectedLogout } from '../navigation/NavigationProtection';

const nav = [
  { to: 'dashboard', label: 'Visão geral', icon: LayoutDashboard, permission: 'dashboard.read' },
  { to: 'consulta', label: 'Consulta central', icon: FileSearch, permission: 'documents.read', alternativePermissions: ['permits.read', 'at.read', 'pet.read'] },
  { to: 'agenda', label: 'Agenda', icon: CalendarDays, permission: 'appointments.read' },
  { to: 'pendencias', label: 'Pendências documentais', icon: ClipboardCheck, permission: 'eligibility.read' },
  { to: 'ats', label: 'Autorizações de trabalho', icon: ClipboardCheck, permission: 'at.read' },
  { to: 'pts', label: 'Permissões de trabalho', icon: ClipboardCheck, permission: 'permits.read' },
  { to: 'designacoes', label: 'Designações', icon: UserCheck, permission: 'appointments.read' },
  { to: 'pets', label: 'PETs de espaços confinados', icon: ClipboardCheck, permission: 'pet.read' },
  { to: 'modelos-pt', label: 'Modelo da PT', icon: ClipboardCheck, permission: 'permits.read' },
  { to: 'equipes', label: 'Equipes', icon: UsersRound, permission: 'teams.read' },
  { to: 'documentos', label: 'Documentos', icon: FolderOpen, permission: 'documents.read' },
  { to: 'vencimentos', label: 'Vencimentos', icon: CalendarClock, permission: 'documents.read' },
  { to: 'trabalhadores', label: 'Trabalhadores', icon: Users, permission: 'workers.read' },
  { to: 'organizacao', label: 'Organização', icon: Building2, permission: 'organization.read' },
  { to: 'notificacoes', label: 'Notificações', icon: Bell, permission: 'notifications.read' },
  { to: 'auditoria', label: 'Auditoria', icon: History, permission: 'audit.read' },
];
const config = [
  { to: 'minha-representacao', label: 'Minha representação', permission: 'permits.review' },
  { to: 'configuracoes/servicos', label: 'Serviços e templates', permission: 'requirements.read' },
  { to: 'configuracoes/requisitos', label: 'Matriz de requisitos', permission: 'requirements.read' },
  { to: 'configuracoes/usuarios', label: 'Usuários e acessos', permission: 'users.manage' },
  { to: 'configuracoes/tipos-documentais', label: 'Tipos documentais', permission: 'documentTypes.write' },
  { to: 'configuracoes/parametros', label: 'Parâmetros', permission: 'documentTypes.write', alternativePermission: 'documents.read' },
];
const navigationGroups = [
  { label: 'Operação', routes: ['dashboard', 'agenda', 'pendencias', 'pts', 'ats', 'pets', 'designacoes'] },
  { label: 'Gestão documental', routes: ['consulta', 'documentos', 'vencimentos', 'modelos-pt'] },
  { label: 'Pessoas e organização', routes: ['equipes', 'trabalhadores', 'organizacao'] },
  { label: 'Controle', routes: ['notificacoes', 'auditoria'] },
];
const dockItems: { to: string; label: string; icon: LucideIcon; area?: string }[] = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/dashboard?area=inspecoes', label: 'Inspeções', icon: ShieldCheck, area: 'inspecoes' },
  { to: '/app/dashboard?area=saude', label: 'ASOs e NRs', icon: HeartPulse, area: 'saude' },
  { to: '/app/dashboard?area=epis', label: 'EPIs', icon: HardHat, area: 'epis' },
  { to: '/app/painel-documental', label: 'Relatórios', icon: ChartNoAxesCombined },
];
const dockGlow = { backgroundColor: '#ffffff', glowColor: '225 90 78', borderRadius: 18, glowRadius: 16, glowIntensity: 1, fillOpacity: 0 };

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

function WorkspaceNavigation({ canNavigate, canConfigure, onNavigate, search, overviewPath }: {
  canNavigate: (item: typeof nav[number]) => boolean;
  canConfigure: (item: typeof config[number]) => boolean;
  onNavigate: () => void;
  search: string;
  overviewPath: string;
}) {
  const query = normalize(search);
  const matches = (label: string, group: string) => !query || normalize(`${label} ${group}`).includes(query);
  const visibleConfig = config.filter(canConfigure).filter(item => matches(item.label, 'Administração'));
  const hasResults = nav.some(item => canNavigate(item) && matches(item.label, navigationGroups.find(group => group.routes.includes(item.to))?.label || '')) || visibleConfig.length > 0;
  const linkClasses = 'group flex min-h-11 items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-[13px] font-medium text-slate-600 transition-colors hover:border-indigo-100 hover:bg-indigo-50/70 hover:text-indigo-700 aria-[current=page]:bg-indigo-50 aria-[current=page]:text-indigo-700';
  return <>
    <nav aria-label="Menu principal" className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
      {navigationGroups.map(group => {
        const items = group.routes.map(route => nav.find(item => item.to === route)!).filter(canNavigate).filter(item => matches(item.label, group.label));
        if (!items.length) return null;
        return <div key={group.label}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">{group.label}</p>
          {items.map(item => <NavLink className={linkClasses} key={item.to} to={item.to === 'dashboard' ? overviewPath : `/app/${item.to}`} onClick={onNavigate}>
            <item.icon size={17} className="shrink-0 text-slate-400 transition-colors group-hover:text-indigo-500" aria-hidden="true" />
            <span className="min-w-0 flex-1">{item.label}</span>
            <ArrowUpRight size={13} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
          </NavLink>)}
        </div>;
      })}
    </nav>
    {visibleConfig.length > 0 && <nav aria-label="Configurações" className="mt-6 border-t border-slate-100 pt-5">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Administração</p>
      <div className="grid gap-x-6 sm:grid-cols-2">{visibleConfig.map(item => <NavLink className={linkClasses} key={item.to} to={`/app/${item.to}`} onClick={onNavigate}><SlidersHorizontal size={17} className="shrink-0 text-slate-400" aria-hidden="true" /><span>{item.label}</span></NavLink>)}</div>
    </nav>}
    {!hasResults && <p role="status" className="rounded-2xl bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">Nenhum módulo encontrado. Tente outro termo.</p>}
  </>;
}

export function AppLayout() {
  const s = useSession();
  const requestLogout = useProtectedLogout();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const canNavigate = (item: { permission: string; alternativePermissions?: string[] }) => s.can(item.permission) || Boolean(item.alternativePermissions?.some(permission => s.can(permission)));
  const canConfigure = (item: { permission: string; alternativePermission?: string }) => s.can(item.permission) || Boolean(item.alternativePermission && s.can(item.alternativePermission));
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState('');
  const closeMenu = () => { setOpen(false); setSearch(''); };

  useEffect(() => {
    setOpen(false); setSearch('');
    if (!location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname, s.unitId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"]'))) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const org = useQuery({ queryKey: ['shell-organization', s.sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }), enabled: s.can('organization.read') });
  const name = nav.find(n => location.pathname.startsWith(`/app/${n.to}`))?.label || config.find(n => location.pathname.startsWith(`/app/${n.to}`))?.label || (location.pathname.includes('painel-documental') ? 'Painel documental' : 'Início');
  const organization = org.data?.companies.find(company => company.id === org.data?.units.find(unit => unit.id === s.unitId)?.companyId)?.name || 'Espaço de trabalho';
  const initials = s.me?.user.displayName.split(' ').slice(0, 2).map(v => v[0]).join('');
  const role = s.me?.roles.includes('AUDITOR') ? 'Auditoria' : s.me?.roles.includes('HR') ? 'Recursos Humanos' : s.me?.roles.includes('WORKER') ? 'Meu acesso' : s.me?.roles.includes('ADMIN') ? 'Administração' : s.me?.roles.includes('TECHNICIAN') ? 'Técnico de segurança' : s.me?.roles.includes('FIREFIGHTER') ? 'Bombeiro' : 'Engenheiro / SESMT';
  const activeArea = new URLSearchParams(location.search).get('area');
  const visibleDockItems = dockItems.filter(item => item.to === '/app/painel-documental' ? s.can('dashboard.read') : canReadOperationsDashboard(s.can));

  return <div className={`${styles.shell} min-h-dvh bg-[#eff2f8] text-slate-800`}>
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <div className={styles.dockArea}>
      <div className={`${styles.dock} border border-white/90 bg-white/80 shadow-[0_12px_40px_-15px_rgba(69,87,160,.3)] backdrop-blur-xl`}>
        <Link className={styles.dockBrand} to="/app" aria-label="Ampara SESMT · Início"><BrandLogo /></Link>
        <nav aria-label="Acesso rápido" className="flex min-w-0 flex-1 items-center justify-center gap-0.5 sm:gap-1">
          {visibleDockItems.map(item => {
            const active = item.to === '/app/painel-documental' ? location.pathname.startsWith(item.to) : location.pathname === '/app/dashboard' && (item.area ? activeArea === item.area : !activeArea);
            return <motion.div key={item.to} whileHover={reduceMotion ? undefined : { y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }} className="relative min-w-0 flex-1 sm:flex-none">
              <BorderGlow {...dockGlow}><Link to={item.to} title={item.label} aria-label={item.label} aria-current={active ? 'page' : undefined} className={`${styles.dockLink} ${active ? 'text-white' : 'text-slate-500 hover:text-indigo-600'}`}>
                {active && <motion.span layoutId="workspace-dock-active" className="absolute inset-0 rounded-[18px] bg-[#183b68] shadow-[0_6px_18px_-7px_rgba(24,59,104,.6)]" transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30 }} />}
                <item.icon size={19} strokeWidth={1.8} className="relative z-[1] shrink-0" aria-hidden="true" />
                <span className="relative z-[1] hidden whitespace-nowrap text-[11px] font-medium md:inline">{item.label}</span>
              </Link></BorderGlow>
            </motion.div>;
          })}
          {visibleDockItems.length > 0 && <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-slate-200/80 sm:mx-2" />}
          <motion.div className={styles.dockMenuGlow} whileHover={reduceMotion ? undefined : { y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}><BorderGlow {...dockGlow}><button type="button" aria-label="Abrir navegação" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)} className={`${styles.dockLink} text-slate-500 hover:bg-indigo-50 hover:text-indigo-600`} title="Todos os módulos"><Menu size={20} strokeWidth={1.8} aria-hidden="true" /><span className="hidden whitespace-nowrap text-[11px] font-medium md:inline">Módulos</span></button></BorderGlow></motion.div>
        </nav>
      </div>
    </div>

    <header className={`${styles.header} mx-auto flex w-full max-w-[1536px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-5 sm:px-7 lg:px-12`}>
      <div className="min-w-0 flex-1">
        <Link to="/app" aria-label="Ampara SESMT · Início" className="block w-[108px] lg:hidden"><BrandLogo /></Link>
        <div className="hidden lg:block"><p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">{organization}</p><p className="mb-0 text-[13px] font-medium text-slate-600">{name}</p></div>
      </div>
      <div className={styles.headerActions}>
        <label className={styles.unit}>
          <Building2 size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
          <select aria-label="Unidade de trabalho" value={s.unitId || ''} onChange={e => {
            if (e.target.value === s.unitId) return;
            if (!window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))) return;
            s.setUnitId(e.target.value);
          }}>{s.me?.scope.unitIds.map(id => <option key={id} value={id}>{org.data?.units.find(u => u.id === id)?.name || 'Unidade autorizada'}</option>)}</select>
        </label>
        <button type="button" onClick={() => setOpen(true)} className={styles.searchButton} aria-label="Buscar módulos" aria-keyshortcuts="Control+k Meta+k"><Search size={17} aria-hidden="true" /><span>Buscar</span><kbd><Command size={11} aria-hidden="true" /> K</kbd></button>
        <HeaderNotifications className={styles.iconButton} />
        <div role="group" aria-label={`Perfil: ${s.me?.user.displayName} · ${role}`} className="flex min-w-0 items-center gap-2.5 border-l border-slate-200/80 pl-2 sm:pl-4" title={`${s.me?.user.displayName} · ${role}`}>
          <div aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-2xl border border-white bg-indigo-100/80 text-xs font-semibold text-indigo-700">{initials}</div>
          <div className="hidden lg:block"><strong className="block max-w-36 truncate text-xs font-semibold text-slate-700">{s.me?.user.displayName}</strong><span className="mt-0.5 block text-[10px] text-slate-400">{role}</span></div>
        </div>
        <button type="button" className={styles.iconButton} aria-label="Sair da plataforma" title="Sair da plataforma" onClick={() => requestLogout(() => { void s.logout(); })}><LogOut size={17} aria-hidden="true" /></button>
      </div>
    </header>

    <div className={`${styles.content} mx-auto flex min-h-[calc(100dvh-174px)] w-full max-w-[1536px] flex-col px-4 sm:px-7 lg:px-12`}>
      {API_MODE === 'demo' && <div className={`${styles.demoBand} mb-6 flex items-start gap-2.5 rounded-2xl border border-indigo-100/70 bg-white/45 px-4 py-2.5`}><span className="mt-0.5 shrink-0 rounded-md bg-indigo-100/70 px-1.5 py-0.5 text-[8px] font-semibold tracking-[.08em] text-indigo-600">DEMONSTRAÇÃO</span><p className="mb-0 line-clamp-2 text-[10px] leading-5 text-slate-500 sm:line-clamp-none" title="Dados fictícios em memória. Integração com a API ainda pendente; recarregar restaura a demonstração.">Dados fictícios em memória. Integração com a API ainda pendente; recarregar restaura a demonstração.</p></div>}
      <main id="conteudo" className={`${styles.main} min-w-0 flex-1 pb-10 focus:not-focus-visible:outline-none`} tabIndex={-1}><Outlet key={`${s.sessionKey}:${s.unitId}`} /></main>
      <footer className={`${styles.footer} flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 py-5 text-[10px] text-slate-400`}><span>Ampara SESMT <span className="mx-1.5">/</span> Segurança que acompanha você.</span><div className="flex items-center gap-4"><span>{API_MODE === 'demo' ? 'Ambiente de demonstração' : 'API externa'}</span><button type="button" onClick={() => setHelp(true)} className="inline-flex min-h-8 items-center gap-1.5 text-slate-500 hover:text-indigo-600"><CircleHelp size={14} aria-hidden="true" />Sobre esta versão</button></div></footer>
    </div>

    <Modal open={open} title="Navegação" onClose={closeMenu}>
      <div className="mb-5 flex items-center justify-between gap-5"><Link to="/app" aria-label="Ampara SESMT · Início" onClick={closeMenu} className="block w-32 shrink-0"><BrandLogo /></Link><p className="mb-0 text-right text-xs leading-5 text-slate-400">Seu espaço de trabalho,<br />ao alcance de um atalho.</p></div>
      <label className="mb-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4"><Search size={18} className="shrink-0 text-slate-400" aria-hidden="true" /><input className="!border-0 !bg-transparent !px-0 !py-3.5 !shadow-none" aria-label="Buscar módulos de navegação" placeholder="Buscar módulo ou configuração…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <WorkspaceNavigation canNavigate={canNavigate} canConfigure={canConfigure} onNavigate={closeMenu} search={search} overviewPath={dashboardPath(s.can)} />
    </Modal>
    <Modal open={help} title="Sobre esta versão" onClose={() => setHelp(false)}><div className="stack"><BrandLogo /><p>Ampara SESMT: agenda, conferência documental, atendimento em campo, autorizações, revalidações e encerramento, além da preparação de rascunhos da PET, gestão documental e cadastros.</p><p className="muted">O ambiente de demonstração usa dados sintéticos e simula respostas no navegador. Não há servidor de negócio, banco de dados, emissão real de JWT, antivírus ou envio de mensagens neste repositório. A verificação de arquivos e os registros de auditoria exibidos são simulados.</p><p className="muted">O checklist e a matriz da demonstração são ilustrativos. Os modelos reais, requisitos e contratos de integração devem ser alinhados com os responsáveis e a equipe da API.</p><Button onClick={() => setHelp(false)}>Entendi</Button></div></Modal>
  </div>;
}
