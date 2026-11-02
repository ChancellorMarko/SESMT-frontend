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

it('vínculo usa rotas nativas sem browser, CPF, cache ou idempotência presumida', async () => {
  const fetchMock = vi.fn(async () => json({ ok: true })); vi.stubGlobal('fetch', fetchMock); const { nativeWorkerAccountApi, setAccessToken } = await import('./client'); setAccessToken('binding-token');
  const account = '73000000-0000-4000-8000-000000000001';
  await nativeWorkerAccountApi.context(worker); await nativeWorkerAccountApi.search(worker, 'Pessoa', 2); await nativeWorkerAccountApi.candidate(worker, account); await nativeWorkerAccountApi.link(worker, { expectedVersion: 1, userId: account });
  const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][];
  expect(calls.map(([url]) => url.pathname)).toEqual([`/api/v1/workers/${worker}/account-binding`, `/api/v1/workers/${worker}/account-binding/candidates`, `/api/v1/workers/${worker}/account-binding/candidates/${account}`, `/api/v1/workers/${worker}/account-binding`]);
  expect(calls[1][0].searchParams.get('page')).toBe('2'); expect(calls.every(([, init]) => init.cache === 'no-store')).toBe(true);
  expect(calls[3][1].method).toBe('PUT'); expect(new Headers(calls[3][1].headers).get('Idempotency-Key')).toBeNull(); expect(new Headers(calls[3][1].headers).get('Authorization')).toBe('Bearer binding-token');
});
it('não repete PUT de vínculo após 401 ou resultado perdido', async () => {
  const fetchMock = vi.fn(async () => json({ code: 'SESSION_EXPIRED', message: 'Entre novamente', requestId: 'test' }, 401)); vi.stubGlobal('fetch', fetchMock);
  const { nativeWorkerAccountApi } = await import('./client'); await expect(nativeWorkerAccountApi.link(worker, {})).rejects.toMatchObject({ status: 401 }); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('identificadores de vínculo não permitem escapar para outra rota', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const { nativeWorkerAccountApi } = await import('./client');
  expect(() => nativeWorkerAccountApi.context('../../users')).toThrow(); expect(() => nativeWorkerAccountApi.candidate(worker, '../outra')).toThrow(); expect(fetchMock).not.toHaveBeenCalled();
});
