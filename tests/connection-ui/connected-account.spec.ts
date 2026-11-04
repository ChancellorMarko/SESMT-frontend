import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Browser contract/visual QA only: these HTTP responses are test doubles.
// Real PostgreSQL validation is scripts/integration-smoke.mjs.
test('modo API entra na conta conectada, restaura sessão e encerra sem abrir módulos pendentes', async ({ page }) => {
  let signedIn = false;
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const session = { accessToken: 'browser-test-access', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'browser-test-csrf' });
    if (request.method() !== 'GET' && request.headers()['x-csrf-token'] !== 'browser-test-csrf') return json({ code: 'CSRF_INVALID', message: 'CSRF ausente.', requestId: 'test' }, 403);
    if (path === '/api/v1/auth/login') {
      const body = request.postDataJSON();
      expect(body.email).toBe('admin@example.invalid'); expect(body.password).toBe('Senha de teste 2026');
      signedIn = true; return json(session);
    }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', message: 'Entre novamente.', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/logout') { signedIn = false; return route.fulfill({ status: 204 }); }
    if (path === '/api/v1/me' && signedIn) {
      expect(request.headers().authorization).toBe('Bearer browser-test-access');
      return json({ user: { id: 'account-1', displayName: 'Administrador local', email: 'admin@example.invalid' }, roles: ['ADMIN'], permissions: [], scope: { companyIds: [], unitIds: [], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    }
    unexpected.push(path);
    return json({ code: 'INTEGRATION_PENDING', message: 'Em integração.', requestId: 'test' }, 501);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administrador', exact: true })).toHaveCount(0);
  await page.getByLabel('E-mail', { exact: true }).fill('admin@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('Senha de teste 2026');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/conexao$/);
  await expect(page.getByRole('heading', { name: 'Sua conta está conectada.' })).toBeVisible();
  await expect(page).toHaveTitle('Conta conectada — Ampara SESMT');
  await expect(page.getByText('Módulos não liberados', { exact: true })).toBeVisible();
  await mkdir('docs/frontend/qa', { recursive: true });
  await page.screenshot({ path: 'docs/frontend/qa/integration-connected-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sua conta está conectada.' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/frontend/qa/integration-connected-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(signedIn).toBe(false);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});
