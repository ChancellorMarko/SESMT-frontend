import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const worker = '64000000-0000-4000-8000-000000000001';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { vi.resetModules(); vi.stubEnv('VITE_API_MODE', 'api'); vi.stubEnv('VITE_AUTH_API_CONTRACT', 'native'); vi.stubEnv('VITE_API_BROWSER_PREFIX', '/browser'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('separa a leitura nativa de UserId da projeção browser sem alterar as outras consultas', async () => {
  const fetchMock = vi.fn(async () => json({ id: worker })); vi.stubGlobal('fetch', fetchMock);
  const { api, readNativeWorker, setAccessToken } = await import('./client'); setAccessToken('native-worker-token');
  await api.get(`/workers/${worker}`); await readNativeWorker(worker);
  const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][];
  expect(String(calls[0][0])).toContain(`/api/v1/browser/workers/${worker}`); expect(String(calls[1][0])).toContain(`/api/v1/workers/${worker}`);
  expect(calls[1][1].method).toBe('GET'); expect(calls[1][1].body).toBeUndefined(); expect(calls[1][1].credentials).toBe('include');
  expect(calls[1][1].cache).toBe('no-store'); expect(calls[0][1].cache).toBeUndefined();
  expect(new Headers(calls[1][1].headers).get('Authorization')).toBe('Bearer native-worker-token');
});
it.each(['../../users', '00000000-0000-0000-0000-000000000000', `${worker}?companyId=outra`])('não permite usar a leitura especializada para outro recurso: %s', async id => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const { readNativeWorker } = await import('./client');
  expect(() => readNativeWorker(id)).toThrow(); expect(fetchMock).not.toHaveBeenCalled();
});
it.each([['demo', 'native'], ['api', 'adapter']])('não mistura contratos em %s/%s', async (mode, auth) => {
  vi.stubEnv('VITE_API_MODE', mode); vi.stubEnv('VITE_AUTH_API_CONTRACT', auth); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const { readNativeWorker } = await import('./client'); expect(() => readNativeWorker(worker)).toThrow(); expect(fetchMock).not.toHaveBeenCalled();
});
it('mantém a rota nativa após renovar o token expirado, sem trocar pela projeção browser', async () => {
  let reads = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'native-worker-csrf' });
    if (path.endsWith('/auth/refresh')) return json({ accessToken: 'renewed-worker-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' });
    if (path === `/api/v1/workers/${worker}`) return ++reads === 1 ? json({ code: 'TOKEN_EXPIRED', message: 'Entre novamente', requestId: 'test' }, 401) : json({ id: worker });
    throw new Error('Rota inesperada: ' + path);
  }); vi.stubGlobal('fetch', fetchMock);
  const { readNativeWorker } = await import('./client'); await expect(readNativeWorker(worker)).resolves.toEqual({ id: worker });
  expect(reads).toBe(2); expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/browser/workers'))).toBe(false);
});
it('cancela a consulta nativa ao trocar o contexto de sessão', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const { readNativeWorker, cancelAllRequests } = await import('./client'); const pending = readNativeWorker(worker); cancelAllRequests(); resolve(json({ id: worker }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
