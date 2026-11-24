import { useEffect, useRef, useState } from 'react';
import styles from './documents.module.css';

/** Pages drawn in the dialog; longer files are read through "Abrir / baixar arquivo". */
export const PREVIEW_PAGE_LIMIT = 15;

type State = { status: 'loading' } | { status: 'ready'; pages: number; shown: number } | { status: 'failed' };

/**
 * Draws the PDF pages onto canvases with pdf.js instead of handing the file to the browser's own viewer.
 * A sandboxed iframe blocks that viewer (blank page in Chrome and Firefox), and mobile browsers do not embed PDFs at
 * all. Canvas rendering keeps the file's scripts, links and forms inert and works the same on every device.
 */
export function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const canvases: HTMLCanvasElement[] = [];
    let destroy = () => {};
    setState({ status: 'loading' });
    (async () => {
      const pdfjs = await import('./pdf-runtime').then(module => module.loadPdfjs());
      if (cancelled) return;
      const task = pdfjs.getDocument({ url, enableXfa: false, stopAtErrors: false });
      destroy = () => { void task.destroy(); };
      const pdf = await task.promise;
      const shown = Math.min(pdf.numPages, PREVIEW_PAGE_LIMIT);
      const width = Math.max(240, (host.current?.clientWidth ?? 640) - 2);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let number = 1; number <= shown && !cancelled; number++) {
        const page = await pdf.getPage(number);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        canvas.className = styles.pdfPage;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages}`);
        canvases.push(canvas); host.current?.append(canvas);
        await page.render({ canvas, viewport }).promise;
        page.cleanup();
        if (number === 1 && !cancelled) setState({ status: 'ready', pages: pdf.numPages, shown });
      }
    })().catch(() => { if (!cancelled) setState({ status: 'failed' }); });
    return () => { cancelled = true; destroy(); canvases.forEach(canvas => { canvas.width = 0; canvas.remove(); }); };
  }, [url]);

  return <div className={styles.pdfPreview} aria-busy={state.status === 'loading'}>
    <div ref={host} className={styles.pdfPages} role="region" aria-label={`Prévia de ${fileName}`} tabIndex={0}/>
    {state.status === 'loading' && <p className="muted" role="status">Carregando a prévia…</p>}
    {state.status === 'failed' && <p role="status">Não foi possível montar a prévia deste PDF. Use “Abrir / baixar arquivo”.</p>}
    {state.status === 'ready' && <p className="muted" role="status">{state.pages === 1 ? '1 página.' : state.shown < state.pages ? `Mostrando as ${state.shown} primeiras de ${state.pages} páginas. Abra o arquivo para ver todas.` : `${state.pages} páginas.`}</p>}
  </div>;
}
