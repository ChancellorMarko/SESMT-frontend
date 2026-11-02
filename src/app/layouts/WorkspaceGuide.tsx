import { Link } from 'react-router';
import { ArrowUpRight, BookOpen, CalendarDays, ClipboardCheck, FolderOpen, Search, Sparkles, UsersRound } from 'lucide-react';
import { Button, Modal } from '../../shared/ui';
import styles from './WorkspaceGuide.module.css';

const shortcuts = [
  { to: '/app/agenda', label: 'Organizar os próximos serviços', description: 'Agenda e responsáveis', icon: CalendarDays, permission: 'appointments.read' },
  { to: '/app/pendencias', label: 'Conferir pendências', description: 'Requisitos por participante', icon: ClipboardCheck, permission: 'eligibility.read' },
  { to: '/app/documentos', label: 'Encontrar um documento', description: 'Versões, arquivos e vigências', icon: FolderOpen, permission: 'documents.read' },
  { to: '/app/equipes', label: 'Consultar minhas equipes', description: 'Pessoas e composição', icon: UsersRound, permission: 'teams.read' },
];

export function WorkspaceGuide({ can, displayName, role, onSearch, onTerminology, open, onOpen, onClose }: {
  can: (permission: string) => boolean;
  displayName: string;
  role: string;
  onSearch: () => void;
  onTerminology: () => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const firstName = displayName.split(' ')[0];
  return <>
    <button type="button" className={styles.launcher} aria-label="Abrir Guia Ampara" aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>
      <span className={styles.miniOrb} aria-hidden="true"><span /><span /></span><span>Guia Ampara</span><Sparkles size={13} aria-hidden="true" />
    </button>
    <Modal open={open} title="Guia Ampara" onClose={onClose} className={styles.drawer}>
      <div className={styles.intro}>
        <span className={styles.orb} aria-hidden="true"><span /><span /></span>

        <h3>Por onde vamos, {firstName}?</h3>
        <p>Encontre os próximos passos e os atalhos do seu dia de trabalho.</p>
      </div>
      <nav className={styles.shortcuts} aria-label="Atalhos do Guia Ampara">{shortcuts.filter(item => can(item.permission)).map(item => <Link key={item.to} to={item.to} onClick={onClose} className={styles.shortcut}>
        <span className={styles.shortcutIcon}><item.icon size={17} aria-hidden="true" /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowUpRight size={14} aria-hidden="true" />
      </Link>)}</nav>
      <button type="button" className={`${styles.shortcut} ${styles.terminology}`} onClick={onTerminology}><span className={styles.shortcutIcon}><BookOpen size={17} aria-hidden="true" /></span><span><strong>Entender as siglas</strong><small>ASO, PT, PET e outros termos, por extenso</small></span><ArrowUpRight size={14} aria-hidden="true" /></button>
      <div className={styles.profile}><span aria-hidden="true">{displayName.split(' ').slice(0, 2).map(part => part[0]).join('')}</span><div><strong>{displayName}</strong><small>{role}</small></div><span className={styles.connected}>Seu acesso</span></div>
      <div className={styles.search}><p>Precisando de outro módulo?</p><Button variant="secondary" onClick={() => { onClose(); onSearch(); }}><Search size={16} aria-hidden="true" />Buscar módulos no guia<ArrowUpRight size={14} aria-hidden="true" /></Button></div>
    </Modal>
  </>;
}
