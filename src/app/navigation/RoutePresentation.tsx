import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { pageTitle } from './page-title';

function visible(element: HTMLElement) {
  if (element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** Place before the routed content so print pages can apply their specific title afterwards. */
export function RoutePresentation({ contextKey }: { contextKey: string }) {
  const { pathname, hash } = useLocation();
  const currentHash = useRef(hash);
  currentHash.current = hash;
  const previousPath = useRef<string | undefined>(undefined);
  const stopPendingFocus = useRef<(() => void) | undefined>(undefined);

  useEffect(() => { document.title = pageTitle(pathname); }, [pathname, contextKey]);

  useEffect(() => {
    const samePage = previousPath.current === pathname;
    previousPath.current = pathname;
    if (currentHash.current) return;
    // Changing a unit should leave its selector available for further keyboard interaction.
    if (samePage && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) return;
    let done = false;
    let frame: number | undefined;
    let observer: MutationObserver | undefined;
    const scope = () => document.querySelector<HTMLElement>('main#conteudo')
      || document.querySelector<HTMLElement>('main') || document.querySelector<HTMLElement>('.error-page');
    function stop() {
      done = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('keydown', stop, true);
      document.removeEventListener('focusin', preserveLocalFocus, true);
      if (stopPendingFocus.current === stop) stopPendingFocus.current = undefined;
    }
    function preserveLocalFocus(event: FocusEvent) {
      const content = scope();
      if (event.target instanceof HTMLElement && content?.contains(event.target) && event.target !== content) stop();
    }
    function focusContent() {
      frame = undefined;
      if (done) return;
      if (currentHash.current) { stop(); return; }
      if (Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(visible)) return;
      const content = scope();
      if (!content || !visible(content)) return;
      // Form autofocus, section returns and explicit error focus take precedence.
      const active = document.activeElement;
      if (active instanceof HTMLElement && content.contains(active) && active !== content) { stop(); return; }
      const heading = Array.from(content.querySelectorAll<HTMLElement>('h1')).find(visible);
      const waiting = Array.from(content.querySelectorAll<HTMLElement>('.loading,[aria-busy="true"],[role="status"]')).some(element =>
        visible(element) && (element.matches('.loading,[aria-busy="true"]') || /^\s*Carregando\b/i.test(element.textContent || '')));
      const target = heading || (!waiting && content.textContent?.trim() ? content : undefined);
      if (!target) return;
      target.tabIndex = -1;
      target.setAttribute('data-page-focus', '');
      target.focus({ preventScroll: true });
      stop();
    }
    function schedule() {
      if (!done && frame === undefined) frame = window.requestAnimationFrame(focusContent);
    }
    stopPendingFocus.current = stop;
    // Watch only until this navigation is resolved. Refetches and later edits never refocus the page.
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'inert', 'aria-hidden', 'aria-modal'] });
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('keydown', stop, true);
    document.addEventListener('focusin', preserveLocalFocus, true);
    schedule();
    return stop;
  }, [pathname, contextKey]);

  // Hash navigation belongs to the page/skip-link, including when its data is still loading.
  useEffect(() => { if (hash) stopPendingFocus.current?.(); }, [hash]);
  return null;
}
