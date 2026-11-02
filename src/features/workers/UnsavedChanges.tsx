import { useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Button, Modal } from '../../shared/ui';
import { useNavigationGuard } from '../../app/navigation/NavigationProtection';

/** Keeps local link/full-page guards and registers history/logout protection when available. */
export function UnsavedChanges({ dirty, busy, protectContext = false, navigationState }: { dirty: boolean; busy: boolean; protectContext?: boolean; navigationState?: { state: unknown } }) {
  useNavigationGuard({ dirty, busy });
  const navigate = useNavigate();
  const route = useLocation();
  const returnState = navigationState ? navigationState.state : route.state;
  const [destination, setDestination] = useState<{ to: string; state: unknown }>();
  // Remove capture guards in the same commit that unmounts the editor; a newly
  // rendered destination link must not be blocked by the previous busy form.
  useLayoutEffect(() => {
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
      // Preserve the route's return context when the original Link navigation is intercepted.
      // State remains data; only the same-origin URL above determines the destination.
      if (!busy) setDestination({ to: `${target.pathname}${target.search}${target.hash}`, state: returnState });
    }
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('sesmt:before-context-change', contextChange);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('sesmt:before-context-change', contextChange); document.removeEventListener('click', click, true); };
  }, [dirty, busy, protectContext, returnState]);
  return <Modal open={Boolean(destination)} title="Alterações não salvas" onClose={() => setDestination(undefined)}><div className="stack"><p>Você alterou este formulário. Deseja sair e descartar as alterações?</p><div className="actions"><Button variant="secondary" onClick={() => setDestination(undefined)}>Continuar preenchendo</Button><Button variant="danger" onClick={() => { if (destination) navigate(destination.to, { state: destination.state }); setDestination(undefined); }}>Descartar e sair</Button></div></div></Modal>;
}
