import { NativeFormError } from '../native-operations/NativeCommandDialog';
import type { FilePolicy } from './contracts';

export function readDocumentBlob(blob: Blob, signal: AbortSignal) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException('Leitura cancelada.', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    reader.onload = () => { cleanup(); resolve(reader.result as ArrayBuffer); };
    reader.onerror = () => { cleanup(); reject(new NativeFormError('Não foi possível ler o arquivo selecionado.')); };
    reader.onabort = () => { cleanup(); reject(new DOMException('Leitura cancelada.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    reader.readAsArrayBuffer(blob);
  });
}
export async function documentHash(blob: Blob, signal: AbortSignal) {
  const buffer = await readDocumentBlob(blob, signal);
  if (signal.aborted) throw new DOMException('Leitura cancelada.', 'AbortError');
  if (!crypto.subtle) throw new NativeFormError('Não foi possível verificar o arquivo neste navegador. Acesse pelo endereço local autorizado.');
  const bytes = await crypto.subtle.digest('SHA-256', buffer);
  if (signal.aborted) throw new DOMException('Leitura cancelada.', 'AbortError');
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function checkDocumentFile(file: File | undefined, policy: FilePolicy) {
  if (!file || file.size < 1 || file.size > policy.maxSizeBytes || !policy.allowedMimeTypes.includes(file.type as FilePolicy['allowedMimeTypes'][number])
    || file.name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(file.name)
    || !(file.type === 'application/pdf' && /\.pdf$/i.test(file.name) || file.type === 'image/png' && /\.png$/i.test(file.name) || file.type === 'image/jpeg' && /\.jpe?g$/i.test(file.name)))
    throw new NativeFormError('Selecione um PDF, PNG ou JPEG válido dentro do limite informado.');
  return file;
}
export function fileDownloadName(code: string, version: number, mime: string) {
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : undefined;
  if (!extension) throw new Error('Tipo de arquivo inválido.');
  return `${code.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').slice(0, 160) || 'documento'}-v${version}.${extension}`;
}
