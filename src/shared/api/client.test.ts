import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function error(code: string, status: number, extra: Record<string, unknown> = {}) { return json({ code, message: 'Erro de teste', requestId: 'request-test', ...extra }, status); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const session = { accessToken: 'renewed-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
const pathOf = (input: RequestInfo | URL) => new URL(String(input), window.location.origin).pathname;

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('cliente HTTP e ciclo da sessão', () => {
  it.each([null, undefined, 0, -1, 1.5, Number.NaN])('recusa revisão indisponível para escrita: %s', async revision => {
    const { revisionEtag } = await import('./client');
    expect(() => revisionEtag(revision)).toThrow('revisão válida');
    expect(revisionEtag(2)).toBe('"2"');
  });
  it.each(['/auth/login', '/auth/refresh', '/auth/mfa/verify'])('normaliza o contrato de cookie em %s sem expor refresh ou usar claims como permissões', async path => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      accessToken: 'cookie-access', expiresAtUtc: '2099-01-01T00:00:00Z',
      userId: 'account', roles: ['ADMIN'], scopes: [{ scopeType: 'GLOBAL', referenceId: null }],
      refreshToken: 'must-not-reach-consumers', refreshTokenExpiresAtUtc: '2099-01-01T00:00:00Z',
    })));
    const { api } = await import('./client');
    await expect(api.post(path)).resolves.toEqual({ accessToken: 'cookie-access', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' });
  });

  it('preserva um desafio MFA válido sem confundi-lo com uma sessão', async () => {
    const challenge = { status: 'MFA_REQUIRED', challengeId: 'challenge', expiresAt: '2099-01-01T00:00:00Z', methods: ['TOTP'] };
    vi.stubGlobal('fetch', vi.fn(async () => json(challenge)));
    const { api } = await import('./client');
    await expect(api.post('/auth/login')).resolves.toEqual(challenge);
  });

  it.each([null, {}, { accessToken: 'bad', expiresAtUtc: 'invalid' }, { status: 'MFA_REQUIRED' }])('recusa sucesso de autenticação fora do contrato: %j', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => json(value)));
    const { api } = await import('./client');
    await expect(api.post('/auth/login')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('renova e encerra por cookies e CSRF sem corpo ou refresh token em JSON', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => pathOf(input).endsWith('/auth/csrf')
      ? json({ csrfToken: 'csrf-cookie-pair' }) : pathOf(input).endsWith('/auth/logout') ? new Response(null, { status: 204 })
        : json({ accessToken: 'cookie-access', expiresAtUtc: '2099-01-01T00:00:00Z' }));
    vi.stubGlobal('fetch', fetchMock);
    const { renewSession, api } = await import('./client');
    await renewSession(); await api.post('/auth/logout');
    for (const [input, options] of fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][]) {
      expect(options.credentials).toBe('include');
      if (!pathOf(input).endsWith('/auth/csrf')) {
        expect(options.body).toBeUndefined();
        expect(new Headers(options.headers).has('Content-Type')).toBe(false);
        expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('csrf-cookie-pair');
      }
    }
  });

  it.each([null, {}, { csrfToken: '' }, { csrfToken: 'with space' }])('não prossegue com um CSRF inválido: %j', async value => {
    const fetchMock = vi.fn(async () => json(value)); vi.stubGlobal('fetch', fetchMock);
    const { renewSession } = await import('./client');
    await expect(renewSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('envia solicitação por convite sem credenciais nem renovação da sessão', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => pathOf(input).includes('/team-invites/public/') ? error('TOKEN_EXPIRED', 401) : json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setAccessToken('private-token'); setExpiredHandler(expired);
    await expect(api.post('/team-invites/public/link/appointments', { location: 'Local' }, { idempotencyKey: 'invite-operation' })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(expired).not.toHaveBeenCalled();
    const request = fetchMock.mock.calls[0][1]!; const headers = new Headers(request.headers);
    expect(request.credentials).toBe('omit'); expect(headers.has('Authorization')).toBe(false); expect(headers.has('X-CSRF-Token')).toBe(false);
    expect(headers.get('Idempotency-Key')).toBe('invite-operation');
    await api.get('/documents'); expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer private-token');
  });
  it('salva perfil via PUT com revisão e identidade da operação', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ revision: 1 })); vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./client');
    await api.put('/me/signature-representation', { method: 'TYPED' }, { etag: '"0"', idempotencyKey: 'profile-operation' });
    const request = fetchMock.mock.calls[0][1]!;
    expect(request.method).toBe('PUT'); expect(new Headers(request.headers).get('If-Match')).toBe('"0"'); expect(new Headers(request.headers).get('Idempotency-Key')).toBe('profile-operation');
  });
  it('nega convite público sem renovar ou encerrar a sessão de quem abriu o link', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => pathOf(input).includes('/team-invites/public/') ? error('TOKEN_EXPIRED', 401) : json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setAccessToken('retained-token'); setExpiredHandler(expired);
    await expect(api.get('/team-invites/public/denied-token')).rejects.toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
    expect(expired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const publicRequest = fetchMock.mock.calls[0] as unknown as [RequestInfo, RequestInit];
    expect(publicRequest[1].credentials).toBe('omit');
    expect(new Headers(publicRequest[1].headers).has('Authorization')).toBe(false);
    await api.get('/documents');
    const authenticated = fetchMock.mock.calls[1] as unknown as [RequestInfo, RequestInit];
    expect(new Headers(authenticated[1].headers).get('Authorization')).toBe('Bearer retained-token');
  });
  it.each([null, [], 'erro', { message: { unexpected: true }, fieldErrors: 'invalid' }])('normaliza erro fora do contrato sem quebrar a recuperação: %j', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => json(value, 500)));
    const { api } = await import('./client');
    await expect(api.get('/documents')).rejects.toMatchObject({ name: 'ApiError', status: 500, code: 'INVALID_RESPONSE', message: 'O serviço retornou uma resposta inválida.', requestId: '' });
  });

  it('encerra a sessão recusada com 401 mesmo quando o corpo JSON é nulo', async () => {
    const fetchMock = vi.fn(async () => json(null, 401)); vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setAccessToken('old-token'); setExpiredHandler(expired);
    await expect(api.get('/documents')).rejects.toMatchObject({ status: 401, code: 'INVALID_RESPONSE' });
    expect(expired).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('filtra erros de campo malformados antes de entregá-los aos formulários', async () => {
    const valid = { field: 'title', code: 'REQUIRED', message: 'Informe o título.' };
    vi.stubGlobal('fetch', vi.fn(async () => error('VALIDATION_FAILED', 422, { fieldErrors: [null, valid, { field: 'name', message: {} }], requestId: 123 })));
    const { api } = await import('./client');
    await expect(api.post('/documents', {})).rejects.toMatchObject({ status: 422, fieldErrors: [valid], requestId: '' });
  });

  it('explica JSON truncado em resposta de sucesso sem expor erro de sintaxe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { headers: { 'Content-Type': 'application/json' } })));
    const { api } = await import('./client');
    await expect(api.get('/documents')).rejects.toMatchObject({ name: 'ApiError', code: 'INVALID_RESPONSE', message: 'O serviço retornou uma resposta inválida.' });
  });

  it('não envia uma consulta cujo sinal já estava cancelado antes da chamada', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./client');
    const controller = new AbortController(); controller.abort();
    await expect(api.get('/documents', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancelar uma consulta que aguarda renovação não encerra a sessão compartilhada', async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (path.endsWith('/auth/refresh')) return refresh.promise;
      if (new Headers(init?.headers).get('Authorization') === 'Bearer old-token') return error('TOKEN_EXPIRED', 401);
      return json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-token');
    const controller = new AbortController();
    const canceled = api.get('/documents', { signal: controller.signal }).catch((value: unknown) => value);
    const retained = api.get('/workers');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/auth/refresh'))).toBe(true));
    controller.abort();
    refresh.resolve(json(session));
    expect(await canceled).toMatchObject({ name: 'AbortError' });
    await expect(retained).resolves.toEqual({ ok: true });
    expect(expired).not.toHaveBeenCalled();
    await api.get('/notifications');
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer renewed-token');
  });

  it('a identidade nova renova sua própria sessão sem aguardar o refresh cancelado anterior', async () => {
    const oldRefresh = deferred<Response>();
    const newRefresh = deferred<Response>();
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (pathOf(input).endsWith('/auth/refresh')) return ++refreshCalls === 1 ? oldRefresh.promise : newRefresh.promise;
      return json({ ok: true });
    }));
    const { api, renewSession, cancelAllRequests, setAccessToken } = await import('./client');
    setAccessToken('old-session');
    const oldResult = renewSession().catch((value: unknown) => value);
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    cancelAllRequests(); setAccessToken('new-session');
    const newResult = renewSession();
    await vi.waitFor(() => expect(refreshCalls).toBe(2));
    oldRefresh.resolve(json(session));
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
    // A conclusão antiga também não deve apagar o refresh em andamento da nova identidade.
    const sameNewResult = renewSession();
    newRefresh.resolve(json({ ...session, accessToken: 'new-renewed-token' }));
    expect((await newResult).accessToken).toBe('new-renewed-token');
    expect((await sameNewResult).accessToken).toBe('new-renewed-token');
    expect(refreshCalls).toBe(2);
    await api.get('/documents');
  });

  it('mantém o limite de tempo enquanto aguarda o corpo JSON após receber os headers', async () => {
    const body = deferred<unknown>();
    const response = json({ ok: true });
    const readBody = vi.spyOn(response, 'json').mockImplementation(() => body.promise);
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const { api } = await import('./client');
    vi.useFakeTimers();
    try {
      const result = api.get('/documents').catch((value: unknown) => value);
      await Promise.resolve(); await Promise.resolve();
      expect(readBody).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30000);
      // Resolver o corpo permite demonstrar que o timeout foi perdido na implementação anterior.
      body.resolve({ ok: true });
      expect(await result).toMatchObject({ name: 'TimeoutError' });
    } finally { vi.useRealTimers(); }
  });

  it('cancela imediatamente a leitura do corpo ao trocar de unidade', async () => {
    const body = deferred<unknown>();
    const response = json({ confidential: 'old-data' });
    const readBody = vi.spyOn(response, 'json').mockImplementation(() => body.promise);
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const { api, cancelAllRequests } = await import('./client');
    const result = api.get('/documents').catch((value: unknown) => value);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
    cancelAllRequests();
    // Uma leitura que ignorar o abort não pode prender o consumidor indefinidamente.
    await expect(result).resolves.toMatchObject({ name: 'AbortError' });
  });

  it('não descarta a sessão por uma falha transitória de conexão durante a renovação', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (path.endsWith('/auth/refresh')) throw new TypeError('Failed to fetch');
      return path.endsWith('/documents') ? error('TOKEN_EXPIRED', 401) : json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-token');
    await expect(api.get('/documents')).rejects.toThrow('Não foi possível conectar à API');
    expect(expired).not.toHaveBeenCalled();
    await api.get('/workers');
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer old-token');
  });

  it('encerra a sessão uma única vez quando a renovação confirma que o acesso foi revogado', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      return error(path.endsWith('/auth/refresh') ? 'SESSION_REVOKED' : 'TOKEN_EXPIRED', 401);
    }));
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-token');
    await expect(api.get('/documents')).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('envia o token por header e nunca grava credenciais no armazenamento persistente', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken } = await import('./client');
    setAccessToken('secret-access-token');
    await api.get('/documents', { query: { page: 1, unitId: 'allowed-unit' } });
    const [url, options] = fetchMock.mock.calls[0];
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer secret-access-token');
    expect(String(url)).not.toContain('secret-access-token');
    expect(options?.credentials).toBe('include');
    expect(storage).not.toHaveBeenCalled();
  });

  it('compartilha uma única renovação entre três consultas e repete cada uma somente uma vez', async () => {
    const refresh = deferred<Response>();
    const calls = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathOf(input);
      calls.set(path, (calls.get(path) ?? 0) + 1);
      if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (path.endsWith('/auth/refresh')) return refresh.promise;
      if (new Headers(init?.headers).get('Authorization') === 'Bearer old-token') return error('TOKEN_EXPIRED', 401);
      return json({ path, ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken } = await import('./client');
    setAccessToken('old-token');
    const results = Promise.all(['/documents', '/workers', '/notifications'].map((path) => api.get<{ ok: boolean }>(path)));
    await vi.waitFor(() => expect(calls.get('/api/v1/auth/refresh')).toBe(1));
    refresh.resolve(json(session));
    expect((await results).every((result) => result.ok)).toBe(true);
    expect(calls.get('/api/v1/auth/csrf')).toBe(1);
    expect(calls.get('/api/v1/auth/refresh')).toBe(1);
    for (const path of ['documents', 'workers', 'notifications']) expect(calls.get(`/api/v1/${path}`)).toBe(2);
    const refreshOptions = fetchMock.mock.calls.find(([input]) => pathOf(input).endsWith('/auth/refresh'))?.[1];
    expect(new Headers(refreshOptions?.headers).get('X-CSRF-Token')).toBe('csrf-test');
  });

  it('encerra o retry depois de uma segunda resposta 401 sem entrar em loop', async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (pathOf(input).endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (pathOf(input).endsWith('/auth/refresh')) { refreshCalls++; return json(session); }
      protectedCalls++; return error('TOKEN_EXPIRED', 401);
    }));
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-token');
    await expect(api.get('/documents')).rejects.toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
    expect(protectedCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('não renova a sessão por 403 e mantém intacto o token para consultas permitidas', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => pathOf(input).endsWith('/forbidden') ? error('FORBIDDEN', 403) : json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('valid-token');
    await expect(api.get('/forbidden')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await api.get('/allowed');
    expect(fetchMock.mock.calls.some(([url]) => pathOf(url).includes('/auth/'))).toBe(false);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer valid-token');
    expect(expired).not.toHaveBeenCalled();
  });

  it('preserva conflito, erros de campo e requestId sem repetir a alteração', async () => {
    const fields = [{ field: 'title', code: 'STALE_VALUE', message: 'O título foi alterado por outra pessoa.' }];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => error('REVISION_CONFLICT', 412, { fieldErrors: fields }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, revisionEtag } = await import('./client');
    await expect(api.patch('/documents/document-1', { title: 'Edição local' }, { etag: revisionEtag(2), idempotencyKey: 'operation-1' })).rejects.toMatchObject({ status: 412, code: 'REVISION_CONFLICT', fieldErrors: fields, requestId: 'request-test' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('If-Match')).toBe('"2"');
  });

  it('repete comando elegível com a mesma chave de idempotência e o mesmo corpo', async () => {
    const commandCalls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (pathOf(input).endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (pathOf(input).endsWith('/auth/refresh')) return json(session);
      commandCalls.push(init ?? {});
      return commandCalls.length === 1 ? error('TOKEN_EXPIRED', 401) : json({ id: 'created-once' }, 201);
    }));
    const { api, setAccessToken } = await import('./client');
    setAccessToken('old-token');
    await expect(api.post('/documents', { title: 'Registro de teste' }, { idempotencyKey: 'same-operation-key' })).resolves.toEqual({ id: 'created-once' });
    expect(commandCalls).toHaveLength(2);
    expect(commandCalls.map((request) => new Headers(request.headers).get('Idempotency-Key'))).toEqual(['same-operation-key', 'same-operation-key']);
    expect(commandCalls[0].body).toBe(commandCalls[1].body);
  });

  it('não renova nem repete escrita explicitamente sem garantia de idempotência', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => error('TOKEN_EXPIRED', 401));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./client');
    await expect(api.post('/documents', { title: 'Teste' }, { idempotencyKey: undefined })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('descarta leitura tardia de contexto anterior sem limpar a sessão nova', async () => {
    const late = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => pathOf(input).endsWith('/old-unit') ? late.promise : json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, cancelAllRequests, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-session');
    const oldResult = api.get('/old-unit').catch((error: unknown) => error);
    cancelAllRequests(); setAccessToken('new-session');
    await api.get('/new-unit');
    late.resolve(json({ confidential: 'old-data' }));
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
    await api.get('/new-unit');
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer new-session');
    expect(expired).not.toHaveBeenCalled();
  });

  it('não deixa um refresh antigo revogar uma nova sessão estabelecida durante a renovação', async () => {
    const refresh = deferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = pathOf(input);
      if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'csrf-test' });
      if (path.endsWith('/auth/refresh')) return refresh.promise;
      return path.endsWith('/old-read') ? error('TOKEN_EXPIRED', 401) : json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, cancelAllRequests, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-session');
    const oldResult = api.get('/old-read').catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/auth/refresh'))).toBe(true));
    cancelAllRequests(); setAccessToken('new-session');
    refresh.resolve(json(session));
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
    await api.get('/new-read');
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer new-session');
    expect(expired).not.toHaveBeenCalled();
  });

  it('descarta JSON de sucesso cuja leitura terminou depois da mudança de contexto', async () => {
    const body = deferred<unknown>();
    const response = json({ confidential: 'old-data' });
    const readBody = vi.spyOn(response, 'json').mockImplementation(() => body.promise);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => pathOf(input).endsWith('/old-body') ? response : json({ ok: true })));
    const { api, setAccessToken, cancelAllRequests } = await import('./client');
    setAccessToken('old-session');
    const oldResult = api.get('/old-body').catch((error: unknown) => error);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
    cancelAllRequests(); setAccessToken('new-session');
    body.resolve({ confidential: 'old-data' });
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
  });

  it('não deixa JSON 401 antigo limpar a nova sessão depois da mudança de identidade', async () => {
    const body = deferred<unknown>();
    const response = error('UNAUTHENTICATED', 401);
    const readBody = vi.spyOn(response, 'json').mockImplementation(() => body.promise);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => pathOf(input).endsWith('/old-command') ? response : json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api, setAccessToken, cancelAllRequests, setExpiredHandler } = await import('./client');
    const expired = vi.fn(); setExpiredHandler(expired); setAccessToken('old-session');
    const oldResult = api.post('/old-command', {}, { idempotencyKey: undefined }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
    cancelAllRequests(); setAccessToken('new-session');
    body.resolve({ code: 'UNAUTHENTICATED', message: 'Sessão anterior', requestId: 'old-request' });
    expect(await oldResult).toMatchObject({ name: 'AbortError' });
    await api.get('/new-session');
    expect(new Headers(fetchMock.mock.calls.at(-1)?.[1]?.headers).get('Authorization')).toBe('Bearer new-session');
    expect(expired).not.toHaveBeenCalled();
  });
});
