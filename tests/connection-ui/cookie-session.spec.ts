import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  // The welcome scene is inert until its entrance finishes, just as for a user.
  await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('cookie@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia do cookie');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/conexao$/);
  await expect(page.getByRole('heading', { name: 'Sua conta está conectada.' })).toBeVisible();
}

test('ressincroniza CSRF rotacionado no login antes de encerrar a sessão sem recarregar', async ({ page, context }) => {
  await signIn(page);
  const logout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some(cookie => cookie.name === 'sesmt_refresh')).toBe(false);
  await page.reload();
  await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await expect(page.getByRole('button', { name: 'Entrar na plataforma', exact: true })).toBeVisible();
});

// Exercises browser cookie storage and the Vite proxy against a controlled HTTP fixture.
// It does not authenticate against .NET, PostgreSQL or a production service.
test('cookies HttpOnly, CSRF e corpo vazio acompanham login, restauração e logout pelo proxy', async ({ page, context }) => {
  const requests: { path: string; body: string | null; csrf: boolean; refreshCookie: boolean }[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', async request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'POST' || !path.startsWith('/api/v1/auth/')) return;
    const headers = await request.allHeaders();
    requests.push({ path, body: request.postData(), csrf: !!headers['x-csrf-token'], refreshCookie: /sesmt_refresh=/.test(headers.cookie || '') });
  });
  await signIn(page);

  const loginCookies = await context.cookies();
  const refresh = loginCookies.find(cookie => cookie.name === 'sesmt_refresh');
  expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });
  expect(loginCookies.find(cookie => cookie.name === 'sesmt_csrf')).toMatchObject({ httpOnly: false, sameSite: 'Strict', path: '/api/v1/auth' });
  const probe = await context.newPage();
  await probe.goto('/api/v1/auth/browser-probe');
  const visibleCookies = await probe.evaluate(() => document.cookie);
  expect(visibleCookies).toContain('sesmt_csrf='); expect(visibleCookies).not.toContain('sesmt_refresh=');
  await probe.close();

  // A cookie alone must not authorize a state-changing session request.
  expect(await page.evaluate(async () => (await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })).status)).toBe(403);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sua conta está conectada.' })).toBeVisible();
  expect((await context.cookies()).find(cookie => cookie.name === 'sesmt_refresh')?.value).not.toBe(refresh?.value);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('fixture-access-'); expect(storage).not.toContain('sesmt_refresh');
  const logout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some(cookie => cookie.name === 'sesmt_refresh')).toBe(false);
  await expect.poll(() => requests.some(request => request.path.endsWith('/logout'))).toBe(true);
  const restored = requests.find(request => request.path.endsWith('/refresh') && request.csrf && request.refreshCookie);
  expect(restored).toMatchObject({ body: null, csrf: true, refreshCookie: true });
  expect(requests.find(request => request.path.endsWith('/logout'))).toMatchObject({ body: null, csrf: true, refreshCookie: true });
  expect(errors).toEqual([]);
});
