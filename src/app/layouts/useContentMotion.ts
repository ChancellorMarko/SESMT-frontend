import { useLayoutEffect, type RefObject } from 'react';

const surfaces = '.page-header, .panel, [data-motion-surface]';
const interactiveControls = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"],[role="slider"],[role="spinbutton"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"]';

/** Animate existing content without remounting routed forms or hiding offscreen content. */
export function useContentMotion(root: RefObject<HTMLElement | null>, context: string, reduced: boolean | null, anchored: boolean) {
  useLayoutEffect(() => {
    const content = root.current;
    if (!content || reduced || anchored || typeof Element.prototype.animate !== 'function') return;

    const seen = new WeakSet<HTMLElement>();
    const running = new Map<HTMLElement, Animation>();
    let frame: number | undefined;
    const pending = new Set<HTMLElement>();
    const waiting = new Set<HTMLElement>();

    function finish(element: HTMLElement) {
      const animation = running.get(element);
      if (animation) { animation.cancel(); running.delete(element); }
    }
    function reveal(element: HTMLElement, order: number) {
      const active = document.activeElement;
      if (!element.isConnected || (active instanceof Element && element.contains(active) && !active.matches('[data-page-focus]')) || window.matchMedia('print').matches) return;
      // A scroll-triggered entrance must not move a control between pointer targeting and click.
      const hasControls = element.matches(interactiveControls) || Boolean(element.querySelector(interactiveControls));
      const keyframes = hasControls ? [{ opacity: .15 }, { opacity: 1 }] : [
        { opacity: .15, translate: '0 28px' },
        { opacity: 1, translate: '0 0' },
      ];
      // The resting style is always visible; cancellation also restores it immediately.
      const animation = element.animate(keyframes, { duration: 620, delay: Math.min(order, 5) * 85, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'backwards' });
      running.set(element, animation);
      animation.onfinish = () => { if (running.get(element) === animation) running.delete(element); };
    }
    function flush() {
      frame = undefined;
      let order = 0;
      for (const element of pending) {
        if (!element.isConnected) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.width && bounds.height && bounds.top < window.innerHeight && bounds.bottom > 0) reveal(element, order++);
        else if (intersection) { waiting.add(element); intersection.observe(element); }
      }
      pending.clear();
    }
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      let order = 0;
      for (const entry of entries) if (entry.isIntersecting) {
        intersection?.unobserve(entry.target);
        waiting.delete(entry.target as HTMLElement);
        reveal(entry.target as HTMLElement, order++);
      }
    }, { threshold: 0, rootMargin: '0px 0px -24px 0px' }) : undefined;

    function discover(element: HTMLElement) {
      const candidates = element.matches(surfaces) ? [element] : Array.from(element.querySelectorAll<HTMLElement>(surfaces));
      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        // Nested panels move with their parent; dashboards keep their own chart/card choreography.
        if (candidate.parentElement?.closest(surfaces) || candidate.closest('[data-motion-managed]')) continue;
        candidate.dataset.motionSurface = '';
        pending.add(candidate);
      }
      if (pending.size && frame === undefined) frame = requestAnimationFrame(flush);
    }
    discover(content);
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.removedNodes) if (node instanceof HTMLElement) {
          for (const element of running.keys()) if (node === element || node.contains(element)) finish(element);
          for (const element of waiting) if (node === element || node.contains(element)) { intersection?.unobserve(element); waiting.delete(element); }
          for (const element of pending) if (node === element || node.contains(element)) pending.delete(element);
        }
        for (const node of record.addedNodes) if (node instanceof HTMLElement) discover(node);
      }
    });
    mutations.observe(content, { childList: true, subtree: true });

    // Keyboard and pointer interaction take priority over a decorative entrance.
    function settle(event: Event) {
      if (!(event.target instanceof Node)) return;
      if (event.type === 'focusin' && event.target instanceof Element && event.target.matches('[data-page-focus]')) return;
      for (const element of pending) if (element.contains(event.target)) { pending.delete(element); intersection?.unobserve(element); }
      for (const element of waiting) if (element.contains(event.target)) { waiting.delete(element); intersection?.unobserve(element); }
      for (const element of running.keys()) if (element.contains(event.target)) finish(element);
    }
    const settleAll = () => { for (const element of running.keys()) finish(element); };
    content.addEventListener('focusin', settle);
    content.addEventListener('pointerdown', settle, true);
    window.addEventListener('beforeprint', settleAll);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      mutations.disconnect();
      intersection?.disconnect();
      pending.clear();
      waiting.clear();
      settleAll();
      content.removeEventListener('focusin', settle);
      content.removeEventListener('pointerdown', settle, true);
      window.removeEventListener('beforeprint', settleAll);
    };
  }, [root, context, reduced, anchored]);
}
