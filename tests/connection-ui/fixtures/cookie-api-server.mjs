import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Controlled HTTP fixture: real browser cookies/proxy, fictitious authentication only.
const sessions = new Map();
const cookiePath = '/api/v1/auth';
const userId = '00000000-0000-4000-8000-000000000001';
const expiresAtUtc = '2099-01-01T00:00:00Z';
const server = createServer((request, response) => {
  void serve(request, response).catch(() => {
    if (response.destroyed || response.headersSent) return;
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 'FIXTURE_ERROR', message: 'Falha da API controlada.', requestId: 'cookie-fixture' }));
  });
});
async function serve(request, response) {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const cookies = Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(pair => {
    const index = pair.indexOf('='); return [pair.slice(0, index).trim(), pair.slice(index + 1)];
  }));
  const json = (value, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const error = (code, status) => json({ code, message: 'Resposta controlada de teste.', requestId: 'cookie-fixture' }, status);
  const cookie = (name, value, httpOnly = false, clear = false) =>
    `${name}=${value}; Path=${cookiePath}; SameSite=Strict${httpOnly ? '; HttpOnly' : ''}${clear ? '; Max-Age=0' : ''}`;
  if (path === '/__health') return json({ fixture: true });
  if (path === `${cookiePath}/browser-probe`) {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return response.end('<!doctype html><title>Cookie fixture</title>');
  }
  if (path === `${cookiePath}/csrf` && request.method === 'GET') {
    const csrfToken = randomUUID(); response.setHeader('Set-Cookie', cookie('sesmt_csrf', csrfToken));
    return json({ csrfToken });
  }
  if (request.method !== 'GET') {
    if (!cookies.sesmt_csrf || cookies.sesmt_csrf !== request.headers['x-csrf-token']) return error('CSRF_INVALID', 403);
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) return error('INVALID_BODY', 400);
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (path === `${cookiePath}/forgot-password` || path === `${cookiePath}/reset-password`) {
      let input; try { input = JSON.parse(body); } catch { return error('INVALID_BODY', 400); }
      if (path.endsWith('/forgot-password')) {
        if (typeof input?.email !== 'string' || !input.email.includes('@')) return error('INVALID_BODY', 400);
        return json({ message: 'Se o e-mail estiver cadastrado, você receberá instruções para redefinir a senha.' }, 202);
      }
      if (input?.token !== 'fixture-reset-token' || typeof input.newPassword !== 'string' || input.newPassword.length < 12)
        return error('INVALID_RESET_TOKEN', 400);
      response.writeHead(204); return response.end();
    }
    if (path === `${cookiePath}/login`) {
      let credentials; try { credentials = JSON.parse(body); } catch { return error('INVALID_BODY', 400); }
      if (credentials.email === 'mfa@example.invalid' && credentials.password === 'Senha fictícia do cookie') return error('MFA_REQUIRED', 403);
      if (credentials.email !== 'cookie@example.invalid' || credentials.password !== 'Senha fictícia do cookie') return error('INVALID_CREDENTIALS', 401);
    } else if (body.length) return error('BODY_NOT_ALLOWED', 400);
    if (path === `${cookiePath}/login` || path === `${cookiePath}/refresh`) {
      if (path.endsWith('/refresh') && !sessions.has(cookies.sesmt_refresh)) return error('SESSION_EXPIRED', 401);
      if (cookies.sesmt_refresh) sessions.delete(cookies.sesmt_refresh);
      const refresh = randomUUID(); const accessToken = `fixture-access-${randomUUID()}`;
      sessions.set(refresh, accessToken);
      // Login replaces the pre-login CSRF cookie, as the cookie-auth API does.
      // Its session JSON deliberately does not return the new CSRF value.
      response.setHeader('Set-Cookie', path.endsWith('/login')
        ? [cookie('sesmt_refresh', refresh, true), cookie('sesmt_csrf', randomUUID())]
        : cookie('sesmt_refresh', refresh, true));
      return json({ accessToken, expiresAtUtc, userId, roles: ['ADMIN'], scopes: [] });
    }
    if (path === `${cookiePath}/logout`) {
      if (!sessions.delete(cookies.sesmt_refresh)) return error('SESSION_EXPIRED', 401);
      response.setHeader('Set-Cookie', [cookie('sesmt_refresh', '', true, true), cookie('sesmt_csrf', '', false, true)]);
      response.writeHead(204); return response.end();
    }
  }
  if ((path === '/api/v1/me' || path === `${cookiePath}/me`) && request.method === 'GET') {
    const access = request.headers.authorization?.replace(/^Bearer /, '');
    if (![...sessions.values()].includes(access)) return error('SESSION_EXPIRED', 401);
    if (path === `${cookiePath}/me`) return json({ userId });
    return json({ user: { id: userId, displayName: 'Conta de teste de cookies', email: 'cookie@example.invalid' },
      roles: ['ADMIN'], permissions: [], scope: { companyIds: [], unitIds: [], sectorIds: [], teamIds: [], ownOnly: false }, workerId: null, accessExpiresAt: expiresAtUtc });
  }
  return error('INTEGRATION_PENDING', 501);
}
server.listen(5177, '127.0.0.1');
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
