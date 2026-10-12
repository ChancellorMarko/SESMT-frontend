import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Modal } from '../../shared/ui';

/** Protects ordinary in-app links and full page exits without a data-router dependency. */
export function UnsavedChanges({ dirty, busy, protectContext = false }: { dirty: boolean; busy: boolean; protectContext?: boolean }) {
  const navigate = useNavigate();
  const [destination, setDestination] = useState<string>();
  useEffect(() => {
    if (!dirty && !busy) return;
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    function contextChange(event: Event) {
      if (!protectContext || event.defaultPrevented) return;
      if (busy || !window.confirm('Há alterações não salvas. Descartar o preenchimento e trocar de unidade?')) event.preventDefault();
    }
    function click(event: MouseEvent) {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href, location.href);
      if (target.origin !== location.origin || (target.pathname === location.pathname && target.search === location.search)) return;
      event.preventDefault(); event.stopPropagation();
      if (!busy) setDestination(`${target.pathname}${target.search}${target.hash}`);
    }
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('sesmt:before-context-change', contextChange);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('sesmt:before-context-change', contextChange); document.removeEventListener('click', click, true); };
  }, [dirty, busy, protectContext]);
  return <Modal open={Boolean(destination)} title="Alterações não salvas" onClose={() => setDestination(undefined)}><div className="stack"><p>Você alterou este formulário. Deseja sair e descartar as alterações?</p><div className="actions"><Button variant="secondary" onClick={() => setDestination(undefined)}>Continuar preenchendo</Button><Button variant="danger" onClick={() => { if (destination) navigate(destination); setDestination(undefined); }}>Descartar e sair</Button></div></div></Modal>;
}
