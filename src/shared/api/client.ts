import type { ErrorDto, SessionDto } from '../contracts';
import { decodeSessionResponse } from '../auth/session-response';
import { resolveApiPath } from './browser-path';
import { AUTH_CONTRACT } from './auth-contract';

export const API_MODE = import.meta.env.VITE_API_MODE === 'api' ? 'api' : 'demo';
const BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
let token: string | null = null;
let csrf: string | null = null;
let refreshPromise: Promise<SessionDto> | null = null;
let onExpired: () => void = () => {};
let epoch = 0;
const controllers = new Set<AbortController>();

export class ApiError extends Error {
  status: number; code: string; fieldErrors: ErrorDto['fieldErrors']; requestId: string;
  constructor(status: number, dto: ErrorDto) {
    super(dto.message); this.name = 'ApiError'; this.status = status; this.code = dto.code;
    this.fieldErrors = dto.fieldErrors; this.requestId = dto.requestId;
  }
}
export interface RequestOptions { query?: Record<string, string | number | boolean | undefined | null>; signal?: AbortSignal; etag?: string; idempotencyKey?: string }
export function revisionEtag(revision: number | null | undefined): string {
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) throw new Error('Este registro não possui uma revisão válida para edição.');
  return `"${revision}"`;
}
export function setAccessToken(value: string | null) { token = value; }
export function setExpiredHandler(handler: () => void) { onExpired = handler; }
export function cancelAllRequests() { epoch++; refreshPromise = null; controllers.forEach(c => c.abort()); controllers.clear(); }
export function clearCredentials() { token = null; csrf = null; cancelAllRequests(); }

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function errorDto(value: unknown): ErrorDto {
  const fallback = { code: 'INVALID_RESPONSE', message: 'O serviço retornou uma resposta inválida.', requestId: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const dto = value as Record<string, unknown>;
  const fieldErrors = Array.isArray(dto.fieldErrors) ? dto.fieldErrors.filter((field): field is NonNullable<ErrorDto['fieldErrors']>[number] =>
    !!field && typeof field === 'object' && typeof field.field === 'string' && typeof field.code === 'string' && typeof field.message === 'string') : undefined;
  return {
    code: typeof dto.code === 'string' && dto.code.trim() ? dto.code : fallback.code,
    message: typeof dto.message === 'string' && dto.message.trim() ? dto.message : fallback.message,
    requestId: typeof dto.requestId === 'string' ? dto.requestId : '',
    fieldErrors,
  };
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}, retried = false, nativeWorker = false, binaryLimit?: number): Promise<T> {
  const publicInvite = /^\/team-invites\/public\/[^/]+(?:\/appointments)?$/.test(path);
  const requestEpoch = epoch;
  const url = new URL(`${BASE}${nativeWorker ? path : resolveApiPath(path, API_MODE, import.meta.env.VITE_API_BROWSER_PREFIX, AUTH_CONTRACT.kind)}`, window.location.origin);
  Object.entries(options.query || {}).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
  const controller = new AbortController(); controllers.add(controller);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException('A requisição excedeu o tempo de espera.', 'TimeoutError')), 30000);
  const headers = new Headers({ Accept: binaryLimit ? 'application/pdf,image/png,image/jpeg' : 'application/json' });
  if (token && !publicInvite) headers.set('Authorization', `Bearer ${token}`);
  if (csrf && method !== 'GET' && !publicInvite) headers.set('X-CSRF-Token', csrf);
  if (options.etag) headers.set('If-Match', options.etag);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers.set('Content-Type', 'application/json');
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    let response: Response;
    try {
      response = await waitFor(fetch(url, { method, headers, credentials: publicInvite ? 'omit' : 'include', signal: controller.signal, ...(nativeWorker ? { cache: 'no-store' as const } : {}), ...(binaryLimit ? { redirect: 'error' as const } : {}), body: body === undefined ? undefined : form ? body : JSON.stringify(body) }), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || error;
      throw new Error('Não foi possível conectar à API. Verifique a conexão e tente novamente.');
    }
    if (requestEpoch !== epoch || options.signal?.aborted) throw new DOMException('Contexto de acesso alterado.', 'AbortError');
    if (!response.ok) {
      let data: ErrorDto;
      try { data = errorDto(await waitFor(response.json(), controller.signal)); } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason || error;
        data = errorDto(undefined);
      }
      if (requestEpoch !== epoch || options.signal?.aborted) throw new DOMException('Contexto de acesso alterado.', 'AbortError');
      const eligible = method === 'GET' || !!options.idempotencyKey;
      if (response.status === 401 && data.code === 'TOKEN_EXPIRED' && !path.startsWith('/auth/') && !publicInvite && !retried && eligible) {
        try {
          await waitFor(renewSession(), controller.signal);
          if (requestEpoch !== epoch || options.signal?.aborted) throw new DOMException('Requisição cancelada.', 'AbortError');
          return request<T>(method, path, body, options, true, nativeWorker, binaryLimit);
        } catch (error) {
          if (requestEpoch === epoch && error instanceof ApiError && error.status === 401) { clearCredentials(); onExpired(); }
          throw error;
        }
      }
      if (response.status === 401 && !path.startsWith('/auth/') && !publicInvite) { clearCredentials(); onExpired(); }
      throw new ApiError(response.status, data);
    }
    if (response.status === 204) {
      if (binaryLimit) throw new Error('O serviço não retornou o arquivo solicitado.');
      return undefined as T;
    }
    if (binaryLimit) {
      const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const encoding = response.headers.get('content-encoding');
      const length = encoding && encoding.toLowerCase() !== 'identity' ? null : response.headers.get('content-length');
      if (!mimeType || !['application/pdf', 'image/png', 'image/jpeg'].includes(mimeType) || !response.body
        || length !== null && (!/^\d+$/.test(length) || Number(length) > binaryLimit || Number(length) < 1))
      { try { await response.body?.cancel(); } catch { /* No body is exposed to the caller. */ } throw new Error('O serviço não retornou um arquivo válido dentro do limite permitido.'); }
      const reader = response.body.getReader(), chunks: ArrayBuffer[] = []; let size = 0;
      try {
        for (;;) {
          const chunk = await waitFor(reader.read(), controller.signal);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > binaryLimit) throw new Error('O arquivo excedeu o limite permitido.');
          const copy = new Uint8Array(chunk.value.byteLength); copy.set(chunk.value); chunks.push(copy.buffer);
        }
      } finally { try { await reader.cancel(); } catch { /* Preserve the original read error. */ } reader.releaseLock(); }
      if (!size || length !== null && size !== Number(length)) throw new Error('O download não confirmou o tamanho do arquivo.');
      if (requestEpoch !== epoch || options.signal?.aborted) throw new DOMException('Contexto de acesso alterado.', 'AbortError');
      return { blob: new Blob(chunks, { type: mimeType }), mimeType } as T;
    }
    const ct = response.headers.get('content-type');
    if (!ct?.includes('application/json')) throw new Error('A API não retornou JSON. Confira a URL e o contrato de integração.');
    let result: T;
    try { result = await waitFor(response.json(), controller.signal) as T; } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || error;
      throw new ApiError(response.status, errorDto(undefined));
    }
    if (requestEpoch !== epoch || options.signal?.aborted) throw new DOMException('Contexto de acesso alterado.', 'AbortError');
    if (method === 'POST' && ['/auth/login', '/auth/refresh', '/auth/mfa/verify'].includes(path)) {
      const challenge = result as Record<string, unknown> | null;
      if (path === '/auth/login' && challenge?.status === 'MFA_REQUIRED'
        && typeof challenge.challengeId === 'string' && challenge.challengeId.trim()
        && typeof challenge.expiresAt === 'string' && Number.isFinite(Date.parse(challenge.expiresAt))
        && Array.isArray(challenge.methods) && challenge.methods.length > 0
        && challenge.methods.every(value => typeof value === 'string' && value.trim())) return result;
      const session = decodeSessionResponse(result);
      if (!session) throw new ApiError(response.status, errorDto(undefined));
      return session as T;
    }
    return result;
  } finally {
    clearTimeout(timeout); controllers.delete(controller); options.signal?.removeEventListener('abort', abort);
  }
}
export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, { idempotencyKey: crypto.randomUUID(), ...options }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, { idempotencyKey: crypto.randomUUID(), ...options }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, { idempotencyKey: crypto.randomUUID(), ...options }),
};
/** Read the existing native worker DTO; callers must first verify its browser-scoped ID. */
export function readNativeWorker<T>(id: string, options?: RequestOptions): Promise<T> {
  if (API_MODE !== 'api' || AUTH_CONTRACT.kind !== 'native' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || id === '00000000-0000-0000-0000-000000000000') throw new Error('Consulta nativa de trabalhador indisponível neste contexto.');
  return request<T>('GET', `/workers/${id.toLowerCase()}`, undefined, options, false, true);
}
/** Create a worker with the native DTO, without replaying an ambiguous POST. */
export function createNativeWorker<T>(body: unknown, options?: Pick<RequestOptions, 'signal'>): Promise<T> {
  if (API_MODE !== 'api' || AUTH_CONTRACT.kind !== 'native') throw new Error('Cadastro nativo de trabalhador indisponível neste contexto.');
  return request<T>('POST', '/workers', body, options, false, true);
}

/** Document-type commands use the native DTO, never the browser read projection. */
export const nativeDocumentTypesApi = {
  create: <T>(body:unknown,signal?:AbortSignal)=>{requireNativeDocumentTypes();return request<T>('POST','/document-types',body,{signal},false,true);},
  rename: <T>(id:string,version:string,body:unknown,signal?:AbortSignal)=>{
    requireNativeDocumentTypes();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!/^[a-f0-9]{64}$/.test(version))throw new Error('Versão ou identificação de tipo documental inválida.');
    return request<T>('PATCH',`/document-types/${id}`,body,{signal,etag:`"${version}"`},false,true);
  },
};
function requireNativeDocumentTypes(){if(API_MODE!=='api'||AUTH_CONTRACT.kind!=='native')throw new Error('Configuração nativa de tipos indisponível neste modo.');}

function workerAccountPath(id: string) {
  if (API_MODE !== 'api' || AUTH_CONTRACT.kind !== 'native' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || id === '00000000-0000-0000-0000-000000000000') throw new Error('Vínculo de conta indisponível neste contexto.');
  return `/workers/${id.toLowerCase()}/account-binding`;
}
/** Minimal identity-binding DTOs: never route these through the browser worker projection. */
export const nativeWorkerAccountApi = {
  context: <T>(id: string, signal?: AbortSignal) => request<T>('GET', workerAccountPath(id), undefined, { signal }, false, true),
  search: <T>(id: string, q: string, page: number, signal?: AbortSignal) => request<T>('GET', `${workerAccountPath(id)}/candidates`, undefined, { query: { q, page }, signal }, false, true),
  candidate: <T>(id: string, userId: string, signal?: AbortSignal) => {
    workerAccountPath(userId);
    return request<T>('GET', `${workerAccountPath(id)}/candidates/${userId.toLowerCase()}`, undefined, { signal }, false, true);
  },
  link: <T>(id: string, body: unknown, signal?: AbortSignal) => request<T>('PUT', workerAccountPath(id), body, { signal }, false, true),
};

/** Versioned professional fields only; the browser projection remains read-only. */
export const nativeWorkerProfileApi = {
  context: <T>(id: string, signal?: AbortSignal) => request<T>('GET', workerAccountPath(id).replace('/account-binding', '/professional-profile'), undefined, { signal }, false, true),
  update: <T>(id: string, body: unknown, signal?: AbortSignal) => request<T>('PATCH', workerAccountPath(id).replace('/account-binding', '/professional-profile'), body, { signal }, false, true),
};

type NativeDocumentOptions = Pick<RequestOptions, 'query' | 'signal'>;
export interface NativeDocumentFile { blob: Blob; mimeType: string }
const documentIdPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const nativeDocumentPath = new RegExp(`^/(?:documents(?:/(?:query|file-policy|query-policy|${documentIdPattern}(?:/versions(?:/${documentIdPattern}(?:/(?:review|download))?)?)?))?|document-types(?:/${documentIdPattern})?)$`, 'i');
function requireNativeDocumentPath(path: string) {
  if (API_MODE !== 'api' || AUTH_CONTRACT.kind !== 'native' || !nativeDocumentPath.test(path))
    throw new Error('Operação documental nativa indisponível neste contexto.');
}
/** Native document DTOs and protected files must never pass through browser projections. */
export const nativeDocumentsApi = {
  get: <T>(path: string, options?: NativeDocumentOptions) => { requireNativeDocumentPath(path); return request<T>('GET', path, undefined, options, false, true); },
  post: <T>(path: string, body: unknown, options?: NativeDocumentOptions) => { requireNativeDocumentPath(path); return request<T>('POST', path, body, options, false, true); },
  patch: <T>(path: string, body: unknown, options?: NativeDocumentOptions) => {
    requireNativeDocumentPath(path);
    if (!new RegExp(`^/documents/${documentIdPattern}$`, 'i').test(path)) throw new Error('Edição documental indisponível neste contexto.');
    return request<T>('PATCH', path, body, options, false, true);
  },
};
export function downloadNativeDocument(id: string, versionId: string, maxBytes: number, options?: NativeDocumentOptions) {
  const path = `/documents/${id}/versions/${versionId}/download`; requireNativeDocumentPath(path);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 50 * 1024 * 1024) throw new Error('Limite de download inválido.');
  return request<NativeDocumentFile>('GET', path, undefined, options, false, true, maxBytes);
}
export async function obtainCsrf() {
  const sessionEpoch = epoch;
  const result = await api.get<{ csrfToken: string }>('/auth/csrf');
  if (sessionEpoch !== epoch) throw new DOMException('Sessão alterada.', 'AbortError');
  if (!result || typeof result.csrfToken !== 'string' || !result.csrfToken || /\s|[\u0000-\u001f\u007f]/.test(result.csrfToken))
    throw new ApiError(200, errorDto(undefined));
  csrf = result.csrfToken;
}
export async function renewSession(): Promise<SessionDto> {
  if (!refreshPromise) {
    const sessionEpoch = epoch;
    const pending = (async () => {
      if (!csrf) await obtainCsrf();
      if (sessionEpoch !== epoch) throw new DOMException('Sessão alterada.', 'AbortError');
      const session = await api.post<SessionDto>('/auth/refresh');
      if (sessionEpoch !== epoch) throw new DOMException('Sessão alterada.', 'AbortError');
      setAccessToken(session.accessToken); return session;
    })().finally(() => { if (refreshPromise === pending) refreshPromise = null; });
    refreshPromise = pending;
  }
  return refreshPromise;
}
