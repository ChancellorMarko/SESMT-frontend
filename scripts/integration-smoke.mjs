import assert from 'node:assert/strict';
import { integrationEnv } from './integration-config.mjs';

// Runs against the actual Vite proxy and API. No MSW or replacement repositories.
const base = 'http://127.0.0.1:5175/api/v1';
const cookies = new Map();
let csrf = '';
let accessToken = '';
let requests = 0;
async function request(method, path, body, withCsrf = true) {
  const headers = { Accept: 'application/json' };
  const cookieHeader = [...cookies].filter(([, cookie]) => (`/api/v1${path}`).startsWith(cookie.path)).map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (withCsrf && csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  requests++;
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attributes] = raw.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1);
    const path = attributes.find(attribute => /^\s*path=/i.test(attribute))?.split('=')[1]?.trim() || '/';
    if (!value) cookies.delete(name); else cookies.set(name, { value, path });
  }
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}
async function main() {
  const env = integrationEnv();
  const token = await request('GET', '/auth/csrf');
  assert.equal(token.response.status, 200, 'A API deve emitir CSRF pelo proxy Vite.');
  assert.equal(typeof token.data.csrfToken, 'string'); csrf = token.data.csrfToken;
  const denied = await request('POST', '/auth/login', { email: env.Seed__AdminEmail, password: env.Seed__AdminPassword }, false);
  assert.equal(denied.response.status, 403, 'Login sem CSRF deve ser recusado.');
  assert.equal(denied.data.code, 'CSRF_INVALID');
  const login = await request('POST', '/auth/login', { email: env.Seed__AdminEmail, password: env.Seed__AdminPassword });
  assert.equal(login.response.status, 200, 'Login local deve funcionar com as credenciais de .env.integration.local.');
  assert.equal(login.data.tokenType, 'Bearer');
  assert.ok(login.data.accessToken, 'Access token ausente.');
  assert.ok(!('refreshToken' in login.data), 'Refresh token não pode ser exposto no JSON.');
  const refreshCookie = login.response.headers.getSetCookie().find(cookie => cookie.startsWith('ampara.refresh='));
  assert.ok(refreshCookie && /httponly/i.test(refreshCookie) && /samesite=strict/i.test(refreshCookie) && /path=\/api\/v1\/auth/i.test(refreshCookie), 'Cookie de refresh inválido.');
  accessToken = login.data.accessToken;
  const me = await request('GET', '/me');
  assert.equal(me.response.status, 200, 'Identidade deve ser obtida usando JWT real.');
  assert.equal(me.data.user.email, env.Seed__AdminEmail.trim().toLowerCase());
  assert.ok(me.data.roles.includes('ADMIN'), 'O administrador inicial deve ter o perfil real ADMIN.');
  assert.ok(Array.isArray(me.data.permissions) && Array.isArray(me.data.scope.unitIds), 'Contrato MeDto inválido.');
  const renewed = await request('POST', '/auth/refresh');
  assert.equal(renewed.response.status, 200, 'Refresh deve usar cookie e CSRF, sem body.');
  accessToken = renewed.data.accessToken;
  const logout = await request('POST', '/auth/logout');
  assert.equal(logout.response.status, 204, 'Logout deve confirmar revogação.');
  accessToken = '';
  const expired = await request('POST', '/auth/refresh');
  assert.equal(expired.response.status, 401, 'Sessão encerrada não deve ser renovada.');
  console.log(`Smoke da API real aprovado: ${requests} requisições pelo proxy, CSRF, JWT, refresh e logout. PostgreSQL usado pela API; nenhum mock neste script.`);
}
main().catch(error => { console.error(`Smoke não concluído: ${error.message}. Inicie npm run dev:integrated e confira INTEGRACAO.md.`); process.exitCode = 1; }).finally(async () => {
  if (cookies.has('ampara.refresh')) {
    try { await request('POST', '/auth/logout'); } catch { /* Não esconder a falha original. */ }
  }
});
