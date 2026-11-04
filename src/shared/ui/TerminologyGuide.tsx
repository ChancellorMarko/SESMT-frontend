import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { searchSafetyTerms, type SafetyAcronym } from '../content/safety-terms';
import { Modal } from '.';
import styles from './TerminologyGuide.module.css';

export function TerminologyGuide({ open, onClose, related = [] }: { open: boolean; onClose: () => void; related?: readonly SafetyAcronym[] }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    setQuery('');
    input.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => { if (resultsRef.current) resultsRef.current.scrollTop = 0; }, [query]);
  const results = searchSafetyTerms(query, related);
  return <Modal open={open} title="Guia de siglas" onClose={onClose} className={styles.dialog}>
    <div className={styles.intro}><span className={styles.icon}><BookOpen size={21} aria-hidden="true" /></span><div><h3>O que cada sigla significa?</h3><p id={`${id}-hint`}>Busque pela sigla ou pelo nome completo. {related.length > 0 ? 'As siglas desta área aparecem primeiro.' : 'Uma referência rápida para navegar pelo Ampara.'}</p></div></div>
    <div className={styles.search}><Search size={18} aria-hidden="true" /><input ref={input} type="search" aria-label="Buscar sigla ou significado" aria-describedby={`${id}-hint`} placeholder="Ex.: ASO, permissão, proteção…" value={query} maxLength={150} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Limpar busca de siglas" onClick={() => { setQuery(''); input.current?.focus(); }}><X size={17} aria-hidden="true" /></button>}</div>
    <p className={styles.count} role="status" aria-atomic="true">{results.length === 0 ? 'Nenhuma sigla encontrada' : `${results.length} ${results.length === 1 ? 'sigla encontrada' : 'siglas encontradas'}`}</p>
    <div ref={resultsRef} className={styles.results} role="region" aria-label="Significados das siglas" tabIndex={0}>
      {results.length > 0 ? <ul className={styles.list}>{results.map(term => <li key={term.acronym}><article aria-labelledby={`${id}-${term.acronym}`}><header><span className={styles.acronym}>{term.acronym}</span><div><h4 id={`${id}-${term.acronym}`}>{term.name}</h4><span className={styles.context}>{term.context}</span></div></header><p>{term.description}</p>{'detail' in term && <p className={styles.detail}>{term.detail}</p>}</article></li>)}</ul> : <div className={styles.empty}><BookOpen size={25} aria-hidden="true" /><h4>Vamos tentar outro termo?</h4><p>Use uma sigla, como PT, ou parte do nome, como “atestado”.</p></div>}
    </div>
    <p className={styles.footnote}>Os significados seguem o contexto do Ampara. Os requisitos de cada atividade são definidos nos seus próprios fluxos.</p>
  </Modal>;
}

export function TerminologyHelp({ children = 'Guia de siglas', related, className }: { children?: React.ReactNode; related?: readonly SafetyAcronym[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={`${styles.help} ${className || ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><BookOpen size={16} aria-hidden="true" />{children}</button><TerminologyGuide open={open} onClose={() => setOpen(false)} related={related} /></>;
}
