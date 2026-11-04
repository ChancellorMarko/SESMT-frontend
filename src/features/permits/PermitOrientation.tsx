import { useEffect, useId, useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowUpRight, Compass } from 'lucide-react';
import type { PermitSectionId, PermitGuidance } from './permit-guidance';
import styles from './PermitOrientation.module.css';

export interface PermitSection { id: PermitSectionId; label: string }

function focusSection(id: PermitSectionId) {
  const section = document.getElementById(id);
  if (!section) return false;
  const heading = section.matches('h2') ? section : section.querySelector('h2') || section;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  heading.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  return true;
}

export function PermitOrientation({ guidance, sections, initialHash = '' }: {
  guidance: PermitGuidance; sections: PermitSection[]; initialHash?: string;
}) {
  const titleId = useId();
  const [active, setActive] = useState<PermitSectionId>();
  useEffect(() => {
    const section = sections.find(item => `#${item.id}` === initialHash);
    if (section && focusSection(section.id)) setActive(section.id);
  }, [initialHash]);
  function jump(event: MouseEvent<HTMLAnchorElement>, id: PermitSectionId) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // Keep the router's return state and history entry intact while moving inside this PT.
    if (focusSection(id)) { event.preventDefault(); setActive(id); }
  }
  const target = sections.find(section => section.id === guidance.target);
  return <section className={`panel ${styles.orientation}`} aria-label="Orientação da PT">
    <div className={styles.intro}>
      <span className={styles.icon}><Compass size={20} aria-hidden="true" /></span>
      <div><h2 id={titleId}>O que fazer agora</h2><p>Orientação para esta versão da PT e seu perfil de acesso.</p></div>
    </div>
    <div className={styles.guidance} aria-labelledby={titleId}>
      <div><h3>{guidance.title}</h3><p>{guidance.description}</p></div>
      {target && <a className={`button button--secondary ${styles.primaryLink}`} href={`#${target.id}`} onClick={event => jump(event, target.id)}>{guidance.linkLabel}<ArrowDown size={15} aria-hidden="true" /></a>}
    </div>
    <details className={styles.index}>
      <summary>Ir para uma seção da PT</summary>
      <nav aria-label="Seções da PT" className={styles.sections}>
        {sections.map(section => <a key={section.id} href={`#${section.id}`} onClick={event => jump(event, section.id)} aria-current={active === section.id ? 'location' : undefined}>{section.label}<ArrowUpRight size={14} aria-hidden="true" /></a>)}
      </nav>
    </details>
  </section>;
}
