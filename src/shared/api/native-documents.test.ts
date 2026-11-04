import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const id = '71000000-0000-4000-8000-000000000005', version = '71000000-0000-4000-8000-000000000006';
let client: typeof import('./client');
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_API_MODE', 'api'); vi.stubEnv('VITE_AUTH_API_CONTRACT', 'native'); vi.stubEnv('VITE_API_BROWSER_PREFIX', '/browser');
  vi.stubEnv('VITE_API_BASE_URL', '/api/v1'); vi.stubGlobal('fetch', vi.fn()); client = await import('./client'); client.setAccessToken('test-token');
});
afterEach(() => { client.clearCredentials(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('usa a mesma API, token e cancelamento sem encaminhar documentos para a projeção', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  await client.nativeDocumentsApi.get(`/documents/${id}`);
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toContain(`/api/v1/documents/${id}`); expect(String(url)).not.toContain('/browser/');
  expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-token'); expect(options?.credentials).toBe('include'); expect(options?.cache).toBe('no-store');
});
it('envia multipart sem Content-Type manual, ETag fictício ou deduplicação presumida', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const body = new FormData(); body.set('expectedVersion', '2');
  await client.nativeDocumentsApi.post(`/documents/${id}/versions`, body);
  const options = vi.mocked(fetch).mock.calls[0][1], headers = new Headers(options?.headers);
  expect(options?.body).toBe(body); expect(headers.has('Content-Type')).toBe(false); expect(headers.has('If-Match')).toBe(false); expect(headers.has('Idempotency-Key')).toBe(false);
});
it.each(['https://example.invalid', '/documents/../users', `/documents/${id}?x=1`, '/users', '/documents/%2e%2e'])('recusa rota fora do contrato: %s', path => {
  expect(() => client.nativeDocumentsApi.get(path)).toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('não reenvia uma criação documental após expiração de sessão', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: 'TOKEN_EXPIRED', message: 'Expirou', requestId: 'test' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  await expect(client.nativeDocumentsApi.post('/documents', {})).rejects.toMatchObject({ status: 401 }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('baixa arquivo protegido com limite e sem aceitar redirecionamentos', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(new TextEncoder().encode('%PDF-'), { headers: { 'content-type': 'application/pdf', 'content-length': '5' } }));
  const file = await client.downloadNativeDocument(id, version, 100);
  expect(file.blob.size).toBe(5); expect(file.mimeType).toBe('application/pdf'); expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe('error');
});
it.each([{ type: 'text/html', length: '5', body: '12345', limit: 100 }, { type: 'application/pdf', length: '9999', body: '12345', limit: 100 },
  { type: 'application/pdf', length: null, body: '12345', limit: 3 }, { type: 'application/pdf', length: '6', body: '12345', limit: 100 }])('recusa download inválido ou truncado: %j', async config => {
  vi.mocked(fetch).mockResolvedValue(new Response(new TextEncoder().encode(config.body), { headers: { 'content-type': config.type, ...(config.length ? { 'content-length': config.length } : {}) } }));
  await expect(client.downloadNativeDocument(id, version, config.limit)).rejects.toThrow();
});
it('cancela a conclusão de arquivo recebido após trocar o contexto de acesso', async () => {
  let deliver!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  const result = client.downloadNativeDocument(id, version, 100); client.cancelAllRequests();
  deliver(new Response(new TextEncoder().encode('%PDF-'), { headers: { 'content-type': 'application/pdf' } }));
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});
it('204 não representa um download concluído', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
  await expect(client.downloadNativeDocument(id, version, 100)).rejects.toThrow();
});
it('valida o limite dos bytes decodificados sem comparar com o tamanho comprimido do transporte', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(new TextEncoder().encode('%PDF-'), { headers: { 'content-type': 'application/pdf', 'content-length': '3', 'content-encoding': 'gzip' } }));
  expect((await client.downloadNativeDocument(id, version, 100)).blob.size).toBe(5);
});
it('PATCH usa o recurso nativo, sem cabeçalhos de versão ou idempotência inventados', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  await client.nativeDocumentsApi.patch(`/documents/${id}`, { expectedVersion: 7, title: 'Corrigido' });
  const [url, request] = vi.mocked(fetch).mock.calls[0]; expect(String(url)).toContain(`/api/v1/documents/${id}`); expect(String(url)).not.toContain('/browser/');
  expect(request?.method).toBe('PATCH'); expect(new Headers(request?.headers).has('Idempotency-Key')).toBe(false); expect(new Headers(request?.headers).has('If-Match')).toBe(false);
});
it('PATCH recusado por expiração de token não é repetido automaticamente', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{"code":"TOKEN_EXPIRED","requestId":"test"}', { status: 401, headers: { 'content-type': 'application/json' } }));
  await expect(client.nativeDocumentsApi.patch(`/documents/${id}`, { expectedVersion: 7 })).rejects.toMatchObject({ status: 401 }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('cadastro de trabalhador usa somente o POST nativo e não acrescenta idempotência fictícia', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  await client.createNativeWorker({ name: 'Pessoa de teste', cpf: '00000000191' }); const [url, request] = vi.mocked(fetch).mock.calls[0];
  expect(String(url)).toContain('/api/v1/workers'); expect(String(url)).not.toContain('/browser/'); expect(request?.method).toBe('POST'); expect(new Headers(request?.headers).has('Idempotency-Key')).toBe(false);
});
