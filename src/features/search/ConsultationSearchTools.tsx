import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../shared/ui';
import styles from './Consultation.module.css';

export function ConsultationSearchHeading({ title, description }: { title: string; description: string }) {
  return <div className={styles.searchHeading}>
    <span className={styles.searchIcon}><Search size={19} aria-hidden="true" /></span>
    <div><h2>{title}</h2><p>{description}</p></div>
  </div>;
}

export function PendingSearchChanges({ onDiscard }: { onDiscard: () => void }) {
  return <div className={styles.draftNotice}>
    <SlidersHorizontal size={16} aria-hidden="true" />
    <div><p role="status">Há alterações nos filtros ainda não aplicadas.</p><small>Os resultados continuam mostrando a última pesquisa. Use Pesquisar para atualizar.</small></div>
    <Button variant="ghost" onClick={onDiscard}>Descartar alterações</Button>
  </div>;
}
