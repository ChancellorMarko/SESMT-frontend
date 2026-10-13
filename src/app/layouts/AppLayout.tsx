import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, LayoutDashboard, FolderOpen, Users, Building2, Bell, History, SlidersHorizontal, LogOut, Menu, ChevronRight, CircleHelp, CalendarDays, CalendarClock, ClipboardCheck, UsersRound, UserCheck, FileSearch } from 'lucide-react';
import { api, API_MODE } from '../../shared/api/client';
import { useSession } from '../../shared/auth/SessionProvider';
import { BrandLogo } from '../../shared/brand/BrandLogo';
import { Button, Modal } from '../../shared/ui';
import type { OrganizationDto } from '../../shared/contracts';
import styles from './AppLayout.module.css';

const nav = [
  { to: 'dashboard', label: 'Visão geral', icon: LayoutDashboard, permission: 'dashboard.read' },
  { to: 'consulta', label: 'Consulta central', icon: FileSearch, permission: 'documents.read' },
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
  { to: 'configuracoes/servicos', label: 'Serviços e templates', permission: 'requirements.read' },
  { to: 'configuracoes/requisitos', label: 'Matriz de requisitos', permission: 'requirements.read' },
  { to: 'configuracoes/usuarios', label: 'Usuários e acessos', permission: 'users.manage' },
  { to: 'configuracoes/tipos-documentais', label: 'Tipos documentais', permission: 'documentTypes.write' },
  { to: 'configuracoes/parametros', label: 'Parâmetros', permission: 'documentTypes.write' },
];

export function AppLayout() {
  const s = useSession();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [location.pathname, s.unitId]);
  const org = useQuery({ queryKey: ['shell-organization', s.sessionKey], queryFn: ({ signal }) => api.get<OrganizationDto>('/organization', { signal }), enabled: s.can('organization.read') });
  const name = nav.find(n => location.pathname.startsWith(`/app/${n.to}`))?.label || config.find(n => location.pathname.startsWith(`/app/${n.to}`))?.label || (location.pathname.includes('painel-documental') ? 'Painel documental' : 'Início');
  const initials = s.me?.user.displayName.split(' ').slice(0, 2).map(v => v[0]).join('');
  const role = s.me?.roles.includes('AUDITOR') ? 'Auditoria' : s.me?.roles.includes('HR') ? 'Recursos Humanos' : s.me?.roles.includes('WORKER') ? 'Meu acesso' : s.me?.roles.includes('ADMIN') ? 'Administração' : s.me?.roles.includes('TECHNICIAN') ? 'Técnico de segurança' : s.me?.roles.includes('FIREFIGHTER') ? 'Bombeiro' : 'Engenheiro / SESMT';
  const menu = <>
    <p className={styles.navTitle}>ESPAÇO DE TRABALHO</p>
    <nav aria-label="Menu principal" className={styles.nav}>
      {nav.filter(n => s.can(n.permission)).map(n => <NavLink key={n.to} to={`/app/${n.to}`} onClick={() => setOpen(false)}><n.icon size={18} aria-hidden="true" /><span>{n.label}</span><ChevronRight size={13} aria-hidden="true" /></NavLink>)}
    </nav>
    {config.some(n => s.can(n.permission)) && <>
      <p className={styles.navTitle}>CONFIGURAÇÕES</p>
      <nav aria-label="Configurações" className={styles.nav}>
        {config.filter(n => s.can(n.permission)).map(n => <NavLink key={n.to} to={`/app/${n.to}`} onClick={() => setOpen(false)}><SlidersHorizontal size={17} aria-hidden="true" /><span>{n.label}</span></NavLink>)}
      </nav>
    </>}
  </>;
  return <div className={styles.shell}>
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <aside className={styles.sidebar}>
      <NavLink className={styles.brand} to="/app" aria-label="Ampara SESMT · Início"><BrandLogo tone="dark" /></NavLink>
      <div className={styles.workspace}><span className={styles.workspaceIcon}><Building2 size={17} aria-hidden="true" /></span><div><strong>{org.data?.companies.find(company => company.id === org.data?.units.find(unit => unit.id === s.unitId)?.companyId)?.name || 'Sua organização'}</strong><small>Segurança e Saúde no Trabalho</small></div></div>
      {menu}
      <div className={styles.sideBottom}>
        <div className={styles.care}><ShieldCheck size={24} aria-hidden="true" /><p>Tecnologia que<br /><strong>cuida de pessoas.</strong></p></div>
        <Button variant="ghost" onClick={() => setHelp(true)}><CircleHelp size={16} aria-hidden="true" /> Sobre esta versão</Button>
      </div>
    </aside>
    <div className={styles.content}>
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Button variant="ghost" className={styles.mobileToggle} aria-label="Abrir navegação" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={21} aria-hidden="true" /></Button>
          <NavLink className={styles.mobileBrand} to="/app" aria-label="Ampara SESMT · Início"><BrandLogo compact /></NavLink>
          <span>Espaço de trabalho</span><ChevronRight size={13} aria-hidden="true" /><strong>{name}</strong>
        </div>
        <div className={styles.headerRight}>
          <label className={styles.unit}><Building2 size={15} aria-hidden="true" /><select aria-label="Unidade de trabalho" value={s.unitId || ''} onChange={e => {
            if (e.target.value === s.unitId) return;
            if (!window.dispatchEvent(new Event('sesmt:before-context-change', { cancelable: true }))) return;
            s.setUnitId(e.target.value);
          }}>{s.me?.scope.unitIds.map(id => <option key={id} value={id}>{org.data?.units.find(u => u.id === id)?.name || 'Unidade autorizada'}</option>)}</select></label>
          <div className={styles.avatar} aria-hidden="true">{initials}</div>
          <div className={styles.user}><strong>{s.me?.user.displayName}</strong><small>{role}</small></div>
          <Button variant="ghost" aria-label="Sair da plataforma" onClick={() => void s.logout()}><LogOut size={17} aria-hidden="true" /></Button>
        </div>
      </header>
      {API_MODE === 'demo' && <div className={styles.demoBand}><span>DEMONSTRAÇÃO</span><p>Dados fictícios em memória. Integração com a API ainda pendente; recarregar restaura a demonstração.</p></div>}
      <main id="conteudo" className={styles.main} tabIndex={-1}><Outlet key={`${s.sessionKey}:${s.unitId}`} /></main>
      <footer className={styles.footer}><span><strong>ampara</strong> SESMT · Tecnologia que cuida de pessoas.</span><span>Frontend v0.5 · {API_MODE === 'demo' ? 'Demonstração' : 'API externa'}</span></footer>
    </div>
    <Modal open={open} title="Navegação" onClose={() => setOpen(false)}><div className={styles.mobileMenu}><NavLink className={styles.brand} to="/app" aria-label="Ampara SESMT · Início" onClick={() => setOpen(false)}><BrandLogo tone="dark" /></NavLink>{menu}</div></Modal>
    <Modal open={help} title="Sobre esta versão" onClose={() => setHelp(false)}><div className="stack"><BrandLogo /><p>Ampara SESMT: agenda, conferência documental, atendimento em campo, autorizações, revalidações e encerramento, além da preparação de rascunhos da PET, gestão documental e cadastros.</p><p className="muted">O ambiente de demonstração usa dados sintéticos e simula respostas no navegador. Não há servidor de negócio, banco de dados, emissão real de JWT, antivírus ou envio de mensagens neste repositório. A verificação de arquivos e os registros de auditoria exibidos são simulados.</p><p className="muted">O checklist e a matriz da demonstração são ilustrativos. Os modelos reais, requisitos e contratos de integração devem ser alinhados com os responsáveis e a equipe da API.</p><Button onClick={() => setHelp(false)}>Entendi</Button></div></Modal>
  </div>;
}
