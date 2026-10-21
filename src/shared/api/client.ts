import type { ErrorDto, SessionDto } from '../contracts';

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
export const revisionEtag = (revision: number) => `"${revision}"`;
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

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}, retried = false): Promise<T> {
  const publicInvite = /^\/team-invites\/public\/[^/]+(?:\/appointments)?$/.test(path);
  const requestEpoch = epoch;
  const url = new URL(`${BASE}${path}`, window.location.origin);
  Object.entries(options.query || {}).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
  const controller = new AbortController(); controllers.add(controller);
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException('A requisição excedeu o tempo de espera.', 'TimeoutError')), 30000);
  const headers = new Headers({ Accept: 'application/json' });
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
      response = await waitFor(fetch(url, { method, headers, credentials: publicInvite ? 'omit' : 'include', signal: controller.signal, body: body === undefined ? undefined : form ? body : JSON.stringify(body) }), controller.signal);
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
          return request<T>(method, path, body, options, true);
        } catch (error) {
          if (requestEpoch === epoch && error instanceof ApiError && error.status === 401) { clearCredentials(); onExpired(); }
          throw error;
        }
      }
      if (response.status === 401 && !path.startsWith('/auth/') && !publicInvite) { clearCredentials(); onExpired(); }
      throw new ApiError(response.status, data);
    }
    if (response.status === 204) return undefined as T;
    const ct = response.headers.get('content-type');
    if (!ct?.includes('application/json')) throw new Error('A API não retornou JSON. Confira a URL e o contrato de integração.');
    let result: T;
    try { result = await waitFor(response.json(), controller.signal) as T; } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason || error;
      throw new ApiError(response.status, errorDto(undefined));
    }
    if (requestEpoch !== epoch || options.signal?.aborted) throw new DOMException('Contexto de acesso alterado.', 'AbortError');
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
export async function obtainCsrf() {
  const sessionEpoch = epoch;
  const result = await api.get<{ csrfToken: string }>('/auth/csrf');
  if (sessionEpoch !== epoch) throw new DOMException('Sessão alterada.', 'AbortError');
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
