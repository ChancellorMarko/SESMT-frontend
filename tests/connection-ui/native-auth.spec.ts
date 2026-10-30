import { expect, test, type Page } from '@playwright/test';

// Native-contract browser QA: real Vite proxy/cookies with fictitious HTTP services.
// These scenarios do not run the independent .NET API or its database.
function observe(page: Page) {
  const errors: string[] = [];
  const paths: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/')) paths.push(`${request.method()} ${path}`);
  });
  return { errors, paths };
}

async function enterCredentials(page: Page, email = 'cookie@example.invalid') {
  await page.goto('/login');
  await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia do cookie');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
}

test('contrato nativo recupera e redefine a senha em 320px, validando 12 caracteres antes do envio', async ({ page }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/recuperar-acesso');
  const requestRecovery = page.getByRole('button', { name: 'Solicitar recuperação', exact: true });
  await expect(requestRecovery).toBeEnabled();
  await page.getByLabel('E-mail', { exact: true }).fill('pessoa@example.invalid');
  const forgotResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/forgot-password');
  await requestRecovery.click();
  const forgot = await forgotResponse;
  expect(forgot.status()).toBe(202);
  expect(forgot.request().postDataJSON()).toEqual({ email: 'pessoa@example.invalid' });
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Se houver uma conta');

  // Accept the route used by the API's email configuration, without putting the token in a query.
  await page.goto('/reset-password#token=fixture-reset-token');
  await expect(page).toHaveTitle('Definir nova senha — Ampara SESMT');
  const password = page.getByLabel('Nova senha', { exact: true });
  const confirm = page.getByLabel('Confirmar nova senha', { exact: true });
  const resetButton = page.getByRole('button', { name: 'Redefinir senha', exact: true });
  await expect(resetButton).toBeEnabled();
  await expect(password).toHaveAccessibleDescription(/12/);
  await password.fill('Curta123!');
  await confirm.fill('Curta123!');
  await resetButton.click();
  await expect(page.getByRole('alert').filter({ hasText: /12/ })).toBeVisible();
  expect(observed.paths.filter(path => path === 'POST /api/v1/auth/reset-password')).toEqual([]);
  await expect(password).toHaveValue('Curta123!');
  await expect(page.getByLabel('Código de recuperação', { exact: true })).toHaveValue('fixture-reset-token');

  await password.fill('Nova senha nativa 2026');
  await confirm.fill('Nova senha nativa 2026');
  const resetResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/reset-password');
  await resetButton.click();
  const reset = await resetResponse;
  expect(reset.status()).toBe(204);
  expect(reset.request().postDataJSON()).toEqual({ token: 'fixture-reset-token', newPassword: 'Nova senha nativa 2026' });
  await expect(page.getByRole('heading', { name: 'Tudo pronto.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voltar ao login', exact: true })).toBeFocused();
  expect(observed.paths.some(path => path.includes('/auth/password/'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(observed.errors).toEqual([]);
});

test('identidade nativa reduzida mantém as áreas protegidas bloqueadas no login e na restauração', async ({ page }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterCredentials(page);
  const profileWarning = page.getByRole('alert').filter({ hasText: /perfil/ });
  await expect(profileWarning).toContainText(/permissões/);
  await expect(profileWarning).toContainText(/administrador/);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sua conta está conectada.' })).toHaveCount(0);
  expect(observed.paths).toContain('GET /api/v1/auth/me');
  expect(observed.paths).not.toContain('GET /api/v1/me');

  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status').filter({ hasText: /perfil/ })).toContainText(/permissões/);
  await expect(page.getByRole('button', { name: 'Entrar na plataforma', exact: true })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('fixture-access-');
  expect(observed.errors).toEqual([]);
});

test('MFA nativo sem desafio orienta a procurar o administrador e não cria uma etapa fictícia', async ({ page }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterCredentials(page, 'mfa@example.invalid');
  const warning = page.getByRole('alert');
  await expect(warning).toContainText(/verificação/);
  await expect(warning).toContainText(/administrador/);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Código de verificação', { exact: true })).toHaveCount(0);
  expect(observed.paths).not.toContain('POST /api/v1/auth/mfa/verify');
  expect(observed.paths).not.toContain('GET /api/v1/auth/me');
  expect(observed.errors).toEqual([]);
});
