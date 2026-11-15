import { useEffect, type RefObject } from 'react';

/** Copies each column header into its cells (data-label) for tables marked .card-table, so the phone card layout can
 * show "Header: value". Runs on every DOM change inside the content area; only touches cells whose label differs. */
export function useCardTableLabels(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const content = root.current;
    if (!content || typeof MutationObserver === 'undefined') return;
    const label = () => content.querySelectorAll<HTMLTableElement>('table.card-table').forEach(table => {
      const headers = [...table.querySelectorAll('thead th')].map(cell => cell.querySelector('.sr-only') ? '' : (cell.textContent ?? '').trim());
      table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell, index) => {
        const text = headers[index] ?? '';
        if (cell.getAttribute('data-label') !== text) cell.setAttribute('data-label', text);
      }));
    });
    label();
    const observer = new MutationObserver(label);
    observer.observe(content, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
}
