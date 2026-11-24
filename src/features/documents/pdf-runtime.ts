// Loaded on demand so pdf.js (and its worker) only downloads when someone opens a PDF preview.
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export function loadPdfjs() {
  if (pdfjs.GlobalWorkerOptions.workerSrc !== workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
}
