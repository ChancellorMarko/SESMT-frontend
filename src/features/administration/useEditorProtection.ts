import { useEffect } from 'react';
import { useNavigationGuard } from '../../app/navigation/NavigationProtection';

export type EditorState = { dirty: boolean; busy: boolean };

/** Keeps an open administrative editor intact until a save completes or changes are discarded. */
export function useEditorProtection({ dirty, busy }: EditorState, onClose: () => void) {
  useNavigationGuard({ dirty, busy });
  const allowLeave = () => !busy && (!dirty || window.confirm('Descartar as alterações não salvas deste cadastro?'));
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const contextChange = (event: Event) => { if (!event.defaultPrevented && !allowLeave()) event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!allowLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('sesmt:before-context-change', contextChange);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('sesmt:before-context-change', contextChange);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty, busy]);
  return () => { if (allowLeave()) onClose(); };
}
