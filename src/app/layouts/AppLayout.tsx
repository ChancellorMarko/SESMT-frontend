import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion, useAnimationControls } from 'framer-motion';
import { LayoutDashboard, FolderOpen, Users, Building2, Bell, History, SlidersHorizontal, LogOut, Menu, ArrowUpRight, BookOpen, CircleHelp, CalendarDays, CalendarClock, ClipboardCheck, UsersRound, UserCheck, FileSearch, Search, Command, ShieldCheck, HeartPulse, HardHat, ChartNoAxesCombined, Sparkles, GraduationCap, X, type LucideIcon } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { Button, Modal, Spinner } from '../../shared/ui';
import { MotionPreferencesContent, useAppReducedMotion } from '../../shared/motion/MotionPreferences';
import type { OrganizationDto } from '../../shared/contracts';
import { HeaderNotifications } from './HeaderNotifications';
import { WorkspaceGuide } from './WorkspaceGuide';
import { TerminologyGuide } from '../../shared/ui/TerminologyGuide';
import { useContentMotion } from './useContentMotion';
import { canReadOperationsDashboard, dashboardPath } from '../navigation';
import styles from './AppLayout.module.css';
import navigationStyles from './WorkspaceNavigation.module.css';
import { useProtectedLogout } from '../navigation/NavigationProtection';

const nav = [
  { to: 'dashboard', label: 'Visão geral', icon: LayoutDashboard, permission: 'dashboard.read' },
  { to: 'consulta', label: 'Consulta central', icon: FileSearch, permission: 'documents.read', alternativePermissions: ['permits.read', 'at.read', 'pet.read'] },
  { to: 'agenda', label: 'Agenda', icon: CalendarDays, permission: 'appointments.read' },
  { to: 'pendencias', label: 'Pendências documentais', icon: ClipboardCheck, permission: 'eligibility.read' },
  { to: 'ats', label: 'Autorizações de trabalho', icon: ClipboardCheck, permission: 'at.read' },
  { to: 'pts', label: 'Permissões de trabalho', icon: ClipboardCheck, permission: 'permits.read' },
  { to: 'designacoes', label: 'Designações', icon: UserCheck, permission: 'appointments.read' },
  { to: 'pets', label: 'Permissões de entrada e trabalho (PET)', icon: ClipboardCheck, permission: 'pet.read' },
  { to: 'modelos-pt', label: 'Modelo de permissão de trabalho', icon: ClipboardCheck, permission: 'permits.read' },
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
const dockItems: { to: string; label: string; compactLabel?: string; icon: LucideIcon; area?: string }[] = [
  { to: '/app/dashboard', label: 'Dashboard', compactLabel: 'Início', icon: LayoutDashboard },
  { to: '/app/dashboard?area=inspecoes', label: 'Inspeções', icon: ShieldCheck, area: 'inspecoes' },
  { to: '/app/dashboard?area=saude', label: 'Saúde e capacitações', compactLabel: 'Saúde', icon: HeartPulse, area: 'saude' },
  { to: '/app/dashboard?area=epis', label: 'Equipamentos de proteção individual (EPI)', compactLabel: 'Proteção', icon: HardHat, area: 'epis' },
  { to: '/app/painel-documental', label: 'Relatórios', icon: ChartNoAxesCombined },
];
const areaSearchItems = [
  { id: 'inspecoes', label: 'Inspeções de segurança', description: 'Vistorias e achados', to: '/app/dashboard?area=inspecoes', icon: ShieldCheck, terms: 'inspeção inspeções vistoria vistorias achados plano de ação riscos' },
  { id: 'asos', label: 'Saúde ocupacional', description: 'Atestado de Saúde Ocupacional (ASO)', to: '/app/dashboard?area=saude&healthView=asos', icon: HeartPulse, terms: 'ASO ASOs atestado atestados saúde ocupacional documentos exames renovar renovações' },
  { id: 'nrs', label: 'Capacitações', description: 'Treinamentos e Normas Regulamentadoras (NR)', to: '/app/dashboard?area=saude&healthView=nrs', icon: GraduationCap, terms: 'NR NRs normas regulamentadoras treinamentos capacitação certificados turmas' },
  { id: 'epis', label: 'Proteção individual', description: 'Equipamento de Proteção Individual (EPI)', to: '/app/dashboard?area=epis', icon: HardHat, terms: 'EPI EPIs equipamentos proteção individual capacetes luvas óculos entregas comprovantes' },
];
const moduleDetails: Record<string, { description: string; terms: string }> = {
  dashboard: { description: 'Acompanhe a operação da unidade', terms: 'painel início indicadores' },
  consulta: { description: 'Encontre registros em um só lugar', terms: 'busca pesquisa central' },
  agenda: { description: 'Serviços, horários e responsáveis', terms: 'agendamentos calendário planejamento' },
  pendencias: { description: 'Requisitos por participante', terms: 'elegibilidade prontidão bloqueios' },
  ats: { description: 'Autorização de Trabalho (AT)', terms: 'AT ATs autorização autorizações' },
  pts: { description: 'Permissão de Trabalho (PT)', terms: 'PT PTs permissão permissões' },
  designacoes: { description: 'Responsáveis pela operação', terms: 'designação responsáveis' },
  pets: { description: 'Preparação para espaços confinados', terms: 'PET PETs entrada espaço confinado' },
  'modelos-pt': { description: 'Consulte o modelo de referência', terms: 'PT modelo checklist' },
  equipes: { description: 'Pessoas e composição das equipes', terms: 'equipe times membros' },
  documentos: { description: 'Arquivos, versões e vigências', terms: 'documento arquivos versões evidências' },
  vencimentos: { description: 'Prazos e próximas renovações', terms: 'vencimento validade expiração renovar' },
  trabalhadores: { description: 'Cadastros e vínculos profissionais', terms: 'trabalhador colaboradores funcionários pessoas' },
  organizacao: { description: 'Empresas, unidades e setores', terms: 'empresa unidade setor funções cargos' },
  notificacoes: { description: 'Avisos e atualizações da unidade', terms: 'notificação alertas avisos' },
  auditoria: { description: 'Histórico de ações registradas', terms: 'auditoria histórico rastreabilidade' },
  'minha-representacao': { description: 'Sua identificação para revisão', terms: 'assinatura representação identificação' },
  'configuracoes/servicos': { description: 'Configuração dos serviços', terms: 'serviço serviços templates modelos' },
  'configuracoes/requisitos': { description: 'Exigências de cada atividade', terms: 'matriz requisito requisitos exigências' },
  'configuracoes/usuarios': { description: 'Perfis e permissões de acesso', terms: 'usuário usuários acesso perfis permissões' },
  'configuracoes/tipos-documentais': { description: 'Tipos e classificação dos documentos', terms: 'tipo documental classificação' },
  'configuracoes/parametros': { description: 'Preferências e parâmetros do sistema', terms: 'parâmetro configuração configurações preferências' },
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

function WorkspaceNavigation({ canNavigate, canConfigure, canReadAreas, onNavigate, search, overviewPath }: {
  canNavigate: (item: typeof nav[number]) => boolean;
  canConfigure: (item: typeof config[number]) => boolean;
  canReadAreas: boolean;
  onNavigate: () => void;
  search: string;
  overviewPath: string;
}) {
  const location = useLocation();
  const query = normalize(search);
  const matches = (label: string, terms: string) => {
    const words = normalize(`${label} ${terms}`).split(/[^a-z0-9]+/);
    return !query || query.split(/\s+/).every(term => words.some(word => ['pt', 'at', 'nr'].includes(term) ? word === term : word.startsWith(term)));
  };
  const matchesModule = (item: { to: string; label: string }, group: string) => matches(item.label, `${group} ${moduleDetails[item.to]?.terms || ''} ${moduleDetails[item.to]?.description || ''}`);
  const visibleAreas = canReadAreas ? areaSearchItems.filter(item => matches(item.label, `${item.terms} ${item.description}`)) : [];
  const currentParams = new URLSearchParams(location.search);
  const areaSelected = (id: string) => location.pathname === '/app/dashboard' && (id === 'asos' || id === 'nrs'
    ? currentParams.get('area') === 'saude' && (currentParams.get('healthView') === 'nrs' ? id === 'nrs' : id === 'asos')
    : currentParams.get('area') === id);
  const visibleConfig = config.filter(canConfigure).filter(item => matchesModule(item, 'Administração'));
  const groups = navigationGroups.map(group => ({ ...group, items: group.routes.map(route => nav.find(item => item.to === route)!).filter(canNavigate).filter(item => matchesModule(item, group.label)) })).filter(group => group.items.length > 0);
  const count = groups.reduce((total, group) => total + group.items.length, 0) + visibleConfig.length + visibleAreas.length;
  const isCurrent = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);
  const linkClasses = navigationStyles.moduleLink;
  function moduleLink(item: { to: string; label: string }, Icon: LucideIcon) {
    const to = item.to === 'dashboard' ? overviewPath : `/app/${item.to}`;
    const active = isCurrent(to) && (item.to !== 'dashboard' || !['inspecoes', 'saude', 'epis'].includes(currentParams.get('area') || ''));
    const descriptionId = `navigation-${item.to.replaceAll('/', '-')}-description`;
    return <Link key={item.to} className={linkClasses} to={to} onClick={onNavigate} aria-label={item.label} aria-describedby={descriptionId} aria-current={active ? 'page' : undefined}>
      <span className={navigationStyles.moduleIcon}><Icon size={17} aria-hidden="true" /></span>
      <span className={navigationStyles.moduleText}><strong>{item.label}</strong><small id={descriptionId}>{moduleDetails[item.to]?.description}</small></span>
      <ArrowUpRight size={14} className={navigationStyles.linkArrow} aria-hidden="true" />
    </Link>;
  }
  return <>
    <p className={navigationStyles.resultCount} role="status" aria-atomic="true">{count === 0 ? 'Nenhum resultado' : `${count} ${count === 1 ? 'destino disponível' : 'destinos disponíveis'}`}{query ? ' para sua busca' : ' para o seu perfil'}</p>
    {visibleAreas.length > 0 && <nav aria-label="Áreas de prevenção" className={navigationStyles.areas}>
      <p className={navigationStyles.sectionTitle}>Prevenção no dia a dia</p>
      <div className={navigationStyles.areaGrid}>{visibleAreas.map(item => <Link key={item.id} to={item.to} state={location.pathname === '/app/dashboard' && currentParams.get('area') === 'saude' && (item.id === 'asos' || item.id === 'nrs') ? { dashboardTabFocus: item.id } : undefined} className={`${linkClasses} ${navigationStyles.areaLink}`} onClick={onNavigate} aria-label={item.label} aria-describedby={`navigation-area-${item.id}`} aria-current={areaSelected(item.id) ? 'page' : undefined}>
        <span className={navigationStyles.moduleIcon}><item.icon size={18} aria-hidden="true" /></span><span className={navigationStyles.moduleText}><strong>{item.label}</strong><small id={`navigation-area-${item.id}`}>{item.description}</small></span><ArrowUpRight size={14} className={navigationStyles.linkArrow} aria-hidden="true" />
      </Link>)}
      </div>
    </nav>}
    <nav aria-label="Menu principal" className={navigationStyles.groups}>
      {groups.map(group => <div key={group.label}>
        <p className={navigationStyles.sectionTitle}>{group.label}</p>
        {group.items.map(item => moduleLink(item, item.icon))}
      </div>)}
    </nav>
    {visibleConfig.length > 0 && <nav aria-label="Configurações" className={navigationStyles.configuration}>
      <p className={navigationStyles.sectionTitle}>Administração</p>
      <div className={navigationStyles.configurationGrid}>{visibleConfig.map(item => moduleLink(item, SlidersHorizontal))}</div>
    </nav>}
    {count === 0 && <div className={navigationStyles.empty}><span><Search size={23} aria-hidden="true" /></span><p>Nenhum módulo encontrado. Tente outro termo.</p><small>Busque pelo nome ou por uma sigla, como PT, ASO ou EPI.</small></div>}
  </>;
}

export function AppLayout() {
  const s = useSession();
  const requestLogout = useProtectedLogout();
  const location = useLocation();
  const dashboardArea = location.pathname === '/app/dashboard' ? new URLSearchParams(location.search).get('area') : null;
  const areaName = dashboardArea === 'inspecoes' ? 'Inspeções' : dashboardArea === 'saude' ? 'Saúde e capacitações' : dashboardArea === 'epis' ? 'Proteção individual' : '';
  // Area shortcuts are separate screens; health tabs and ordinary query filters stay within their screen.
  const pageContext = `${location.pathname}:${areaName}`;
  const reduceMotion = useAppReducedMotion();
  const pageMotion = useAnimationControls();
  const contentRef = useRef<HTMLElement>(null);
  const [motionSettings, setMotionSettings] = useState(false);
  const [motionReplay, setMotionReplay] = useState(0);
  const closeMotionSettings = () => { setMotionSettings(false); setMotionReplay(value => value + 1); };
  useContentMotion(contentRef, `${pageContext}:${s.sessionKey}:${s.unitId}:${motionReplay}`, reduceMotion, Boolean(location.hash));
  const canNavigate = (item: { permission: string; alternativePermissions?: string[] }) => s.can(item.permission) || Boolean(item.alternativePermissions?.some(permission => s.can(permission)));
  const canConfigure = (item: { permission: string; alternativePermission?: string }) => s.can(item.permission) || Boolean(item.alternativePermission && s.can(item.alternativePermission));
  const navigationContext = `${pageContext}:${s.sessionKey}:${s.unitId}`;
  const [guideContext, setGuideContext] = useState<string | null>(null);
  const [terminologyContext, setTerminologyContext] = useState<string | null>(null);
  const terminologyOpen = terminologyContext === navigationContext;
  const guideOpen = guideContext === navigationContext;
  const openGuide = () => { setNavigation(null); setTerminologyContext(null); setGuideContext(navigationContext); };
  const openTerminology = () => { setNavigation(null); setGuideContext(null); setTerminologyContext(navigationContext); };
  const [navigation, setNavigation] = useState<{ context: string; search: string } | null>(null);
  const currentMenu = navigation?.context === navigationContext ? navigation : null;
  const open = Boolean(currentMenu);
  const search = currentMenu?.search || '';
  const navigationInput = useRef<HTMLInputElement>(null);
  const navigationResults = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);
  const openMenu = useCallback(() => setNavigation(current => current?.context === navigationContext ? current : { context: navigationContext, search: '' }), [navigationContext]);
  const closeMenu = () => setNavigation(null);
  const setSearch = (value: string) => setNavigation(current => current?.context === navigationContext ? { ...current, search: value } : current);
  useEffect(() => { if (open) navigationInput.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { if (navigationResults.current) navigationResults.current.scrollTop = 0; }, [search]);

  useEffect(() => {
    // Late effects from arrival must not close a menu already opened on this route.
    setNavigation(current => current?.context === navigationContext ? current : null);
    setGuideContext(current => current === navigationContext ? current : null);
    setTerminologyContext(current => current === navigationContext ? current : null);
    if (!location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [navigationContext]);
  useLayoutEffect(() => {
    const content = contentRef.current;
    pageMotion.set({ opacity: 1, y: 0 });
    if (!content || reduceMotion || location.hash) return;
    let started = false;
    function visible(element: Element) {
      if (element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
      for (let node: Element | null = element; node && node !== content; node = node.parentElement) if (getComputedStyle(node).display === 'none') return false;
      return true;
    }
    const observer = new MutationObserver(enter);
    function enter() {
      if (started || !content) return;
      const heading = Array.from(content.querySelectorAll('h1')).some(visible);
      const loading = Array.from(content.querySelectorAll('.loading,[aria-busy="true"]')).some(visible);
      if (!heading && (loading || !content.textContent?.trim())) return;
      started = true;
      observer.disconnect();
      pageMotion.set({ opacity: .15, y: 24 });
      void pageMotion.start({ opacity: 1, y: 0, transition: { duration: .58, ease: [.16, 1, .3, 1] } });
    }
    function settle(event: Event) {
      if (event.type === 'focusin' && event.target instanceof Element && event.target.matches('[data-page-focus]')) return;
      pageMotion.stop(); pageMotion.set({ opacity: 1, y: 0 });
    }
    // Prepare before paint, and wait for lazy routes instead of spending the entrance on their spinner.
    observer.observe(content, { childList: true, subtree: true });
    enter();
    content.addEventListener('pointerdown', settle, true);
    content.addEventListener('focusin', settle);
    return () => { observer.disconnect(); pageMotion.stop(); content.removeEventListener('pointerdown', settle, true); content.removeEventListener('focusin', settle); };
  }, [pageContext, location.hash, s.unitId, pageMotion, reduceMotion, motionReplay]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role="textbox"]'))) return;
      event.preventDefault();
      // A shortcut must not cover an active confirmation, guide or editing dialog.
      if (Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(dialog => !dialog.contains(navigationInput.current))) return;
      if (open) navigationInput.current?.focus();
      else openMenu();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openMenu, open]);

  const org = useQuery({ queryKey: ['shell-organization', s.sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }), enabled: s.can('organization.read') });
  const name = areaName || nav.find(n => location.pathname.startsWith(`/app/${n.to}`))?.label || config.find(n => location.pathname.startsWith(`/app/${n.to}`))?.label || (location.pathname.includes('painel-documental') ? 'Painel documental' : 'Início');
  const organization = org.data?.companies.find(company => company.id === org.data?.units.find(unit => unit.id === s.unitId)?.companyId)?.name || 'Espaço de trabalho';
  const initials = s.me?.user.displayName.split(' ').slice(0, 2).map(v => v[0]).join('');
  const role = s.me?.roles.includes('AUDITOR') ? 'Auditoria' : s.me?.roles.includes('HR') ? 'Recursos Humanos' : s.me?.roles.includes('WORKER') ? 'Meu acesso' : s.me?.roles.includes('ADMIN') ? 'Administração' : s.me?.roles.includes('TECHNICIAN') ? 'Técnico de segurança' : s.me?.roles.includes('FIREFIGHTER') ? 'Bombeiro' : 'Engenheiro / SESMT';
  const activeArea = areaName ? dashboardArea : null;
  const visibleDockItems = dockItems.filter(item => item.to === '/app/painel-documental' ? s.can('dashboard.read') : canReadOperationsDashboard(s.can));
  const shortcuts = nav.filter(item => ['agenda', 'documentos', 'equipes'].includes(item.to) && canNavigate(item));

  // Resolve the home redirect before exposing controls tied to a temporary /app location.
  if (location.pathname.replace(/\/+$/, '') === '/app') return <Outlet />;

  return <div className={styles.shell}>
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <motion.aside className={styles.rail} aria-label="Navegação do espaço de trabalho" initial={reduceMotion ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .4 }}>
      <div className={styles.railMark} aria-hidden="true"><img src="/brand/ampara/icon.png" alt="" width="36" height="36" /></div>
      <div className={styles.railSurface}>
        <nav aria-label="Acesso rápido" className={styles.railItems}>
          {visibleDockItems.map(item => {
            const active = item.to === '/app/painel-documental' ? location.pathname.startsWith(item.to) : location.pathname === '/app/dashboard' && (item.area ? activeArea === item.area : !activeArea);
            return <Link key={item.to} to={item.to} title={item.label} aria-label={item.label} aria-current={active ? 'page' : undefined} className={`${styles.railItem} ${active ? styles.railItemActive : ''}`}>
              {active && <motion.span layoutId="workspace-rail-active" className={styles.railActive} transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }} />}
              <item.icon size={19} strokeWidth={1.7} aria-hidden="true" />
              <span className={styles.railLabel} aria-hidden="true">{item.compactLabel || item.label}</span>
              <span className={styles.railCompactLabel} aria-hidden="true">{item.compactLabel || item.label}</span>
            </Link>;
          })}
          <button type="button" aria-label="Abrir navegação" aria-expanded={open} aria-haspopup="dialog" onClick={openMenu} className={styles.railItem} title="Todos os módulos"><Menu size={20} strokeWidth={1.7} aria-hidden="true" /><span className={styles.railLabel} aria-hidden="true">Todos os módulos</span><span className={styles.railCompactLabel} aria-hidden="true">Menu</span></button>
        </nav>
        {shortcuts.length > 0 && <nav className={styles.railShortcuts} aria-label="Atalhos da unidade">{shortcuts.map(item => <NavLink key={item.to} to={`/app/${item.to}`} className={styles.railItem} aria-label={`Ir para ${item.label}`} title={item.label}><item.icon size={18} strokeWidth={1.7} aria-hidden="true" /><span className={styles.railLabel} aria-hidden="true">{item.label}</span></NavLink>)}</nav>}
        <div className={styles.railBottom}><button type="button" className={styles.railItem} onClick={() => setHelp(true)} aria-label="Ajuda sobre o sistema" title="Sobre esta versão"><CircleHelp size={19} aria-hidden="true" /><span className={styles.railLabel} aria-hidden="true">Sobre esta versão</span></button><span className={styles.railAvatar} aria-hidden="true">{initials}</span></div>
      </div>
    </motion.aside>

    <motion.header className={styles.header} initial={reduceMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
      <div className={styles.headerIdentity}>
        <Link to="/app" aria-label="Ampara SESMT · Início" className={styles.headerBrand}><BrandLogo /></Link>
        <div className={styles.workspaceIdentity}><p>{organization}</p><motion.strong key={name} initial={reduceMotion ? false : { opacity: .4, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>{name}</motion.strong></div>
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
        <button type="button" onClick={openMenu} className={styles.searchButton} aria-label="Buscar módulos" aria-keyshortcuts="Control+k Meta+k"><span>O que você procura?</span><kbd><Command size={11} aria-hidden="true" /> K</kbd><i aria-hidden="true"><Search size={16} /></i></button>
        <button type="button" className={`${styles.iconButton} ${styles.motionButton}`} data-motion-mode={reduceMotion ? 'reduced' : 'full'} aria-label="Configurar animações" aria-haspopup="dialog" title="Configurar animações" onClick={() => setMotionSettings(true)}><Sparkles size={18} aria-hidden="true" /></button>
        <HeaderNotifications className={styles.iconButton} />
        <div role="group" aria-label={`Perfil: ${s.me?.user.displayName} · ${role}`} className={styles.profile} title={`${s.me?.user.displayName} · ${role}`}>
          <div aria-hidden="true" className={styles.avatar}>{initials}</div>
          <div className={styles.profileText}><strong>{s.me?.user.displayName}</strong><span>{role}</span></div>
        </div>
        <button type="button" className={styles.iconButton} aria-label="Sair da plataforma" title="Sair da plataforma" onClick={() => requestLogout(() => { void s.logout(); })}><LogOut size={17} aria-hidden="true" /></button>
      </div>
    </motion.header>

    <div className={styles.content}>
      {API_MODE === 'demo' && <div className={styles.demoBand}><span>DEMONSTRAÇÃO</span><p title="Dados fictícios em memória. Integração com a API ainda pendente; recarregar restaura a demonstração.">Dados fictícios em memória. Integração com a API ainda pendente; recarregar restaura a demonstração.</p></div>}
      <motion.main ref={contentRef} id="conteudo" data-motion-page className={styles.main} initial={false} animate={pageMotion} tabIndex={-1}><Suspense fallback={<Spinner />}><Outlet key={`${s.sessionKey}:${s.unitId}`} /></Suspense></motion.main>
      <WorkspaceGuide can={s.can} displayName={s.me?.user.displayName || 'Seu acesso'} role={role} onSearch={openMenu} onTerminology={openTerminology} open={guideOpen} onOpen={openGuide} onClose={() => setGuideContext(null)} />
      <footer className={styles.footer}><span>Ampara SESMT <span>/</span> Segurança que acompanha você.</span><div><span>{API_MODE === 'demo' ? 'Ambiente de demonstração' : 'API externa'}</span><button type="button" aria-haspopup="dialog" onClick={openTerminology}><BookOpen size={14} aria-hidden="true" />Guia de siglas</button><button type="button" onClick={() => setHelp(true)}><CircleHelp size={14} aria-hidden="true" />Sobre esta versão</button></div></footer>
    </div>
    <Modal open={motionSettings} title="Animações da interface" onClose={closeMotionSettings}>
      <MotionPreferencesContent />
      <div className="actions mt-6"><Button onClick={closeMotionSettings}>Aplicar e visualizar</Button></div>
    </Modal>

    <Modal open={open} title="Navegação" onClose={closeMenu} className={navigationStyles.dialog}>
      <div className={navigationStyles.intro}><Link to="/app" aria-label="Ampara SESMT · Início" onClick={closeMenu}><BrandLogo /></Link><p>Encontre seu próximo passo.<br /><span>Os módulos disponíveis para você.</span></p></div>
      <div className={navigationStyles.search}>
        <Search size={18} aria-hidden="true" />
        <input ref={navigationInput} className={navigationStyles.searchInput} aria-label="Buscar módulos de navegação" aria-describedby="navigation-search-hint" placeholder="Buscar módulo ou sigla…" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
          if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
          const links = navigationResults.current?.querySelectorAll<HTMLAnchorElement>('a[href]');
          if (event.key === 'ArrowDown' && links?.length) { event.preventDefault(); links[0].focus(); }
          if (event.key === 'Enter' && search.trim() && links?.length === 1) { event.preventDefault(); links[0].click(); }
        }} />
        {search && <button type="button" aria-label="Limpar busca" onClick={() => { setSearch(''); navigationInput.current?.focus({ preventScroll: true }); }}><X size={16} aria-hidden="true" /></button>}
      </div>
      <div ref={navigationResults} className={navigationStyles.results} data-navigation-results>
        <WorkspaceNavigation canNavigate={canNavigate} canConfigure={canConfigure} canReadAreas={canReadOperationsDashboard(s.can)} onNavigate={closeMenu} search={search} overviewPath={dashboardPath(s.can)} />
      </div>
      <div className={navigationStyles.footer}><p id="navigation-search-hint"><kbd>Tab</kbd> navegar <span>·</span> <kbd>Esc</kbd> fechar<span className="sr-only">. Enter abre quando há um único resultado. Seta para baixo foca o primeiro destino.</span></p><div className={navigationStyles.helpActions}><button type="button" onClick={openTerminology}><BookOpen size={15} aria-hidden="true" />Guia de siglas</button><button type="button" onClick={openGuide}><Sparkles size={15} aria-hidden="true" />Guia Ampara<ArrowUpRight size={13} aria-hidden="true" /></button></div></div>
    </Modal>
    <TerminologyGuide open={terminologyOpen} onClose={() => setTerminologyContext(null)} />
    <Modal open={help} title="Sobre esta versão" onClose={() => setHelp(false)}><div className="stack"><BrandLogo /><p>Ampara SESMT: agenda, conferência documental, atendimento em campo, autorizações, revalidações e encerramento, além da preparação de rascunhos da PET, gestão documental e cadastros.</p><p className="muted">O ambiente de demonstração usa dados sintéticos e simula respostas no navegador. Não há servidor de negócio, banco de dados, emissão real de JWT, antivírus ou envio de mensagens neste repositório. A verificação de arquivos e os registros de auditoria exibidos são simulados.</p><p className="muted">O checklist e a matriz da demonstração são ilustrativos. Os modelos reais, requisitos e contratos de integração devem ser alinhados com os responsáveis e a equipe da API.</p><Button onClick={() => setHelp(false)}>Entendi</Button></div></Modal>
  </div>;
}
