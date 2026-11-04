/** Links temporários recebidos da API só podem usar origens explicitamente autorizadas. */
export function isDownloadUrlAllowed(value: string, origin = window.location.origin): boolean {
  try {
    const url = new URL(value, origin);
    if (url.username || url.password) return false;
    if (url.origin === origin && ['http:', 'https:', 'blob:'].includes(url.protocol)) return true;
    if (url.protocol !== 'https:') return false;
    const apiOrigin = new URL(import.meta.env.VITE_API_BASE_URL || '/api/v1', origin).origin;
    const additional = String(import.meta.env.VITE_DOWNLOAD_ALLOWED_ORIGINS || '').split(',').flatMap(item => {
      try { const candidate = new URL(item.trim()); return candidate.protocol === 'https:' && !candidate.username && !candidate.password ? [candidate.origin] : []; }
      catch { return []; }
    });
    return url.origin === apiOrigin || additional.includes(url.origin);
  } catch { return false; }
}

export function triggerDownload(url: string, fileName?: string): void {
  if (!isDownloadUrlAllowed(url)) {
    throw new Error('Origem de download não permitida.');
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  if (fileName) anchor.download = fileName;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

