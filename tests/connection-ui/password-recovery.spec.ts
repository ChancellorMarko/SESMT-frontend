import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// API-mode browser QA with controlled HTTP responses; no MSW or PostgreSQL claim.
async function recoveryApi(page: Page) {
  const state = {
    failCsrf: false,
    csrf: '',
    csrfCount: 0,
    events: [] as string[],
    forgot: [] as { email: string }[],
    reset: [] as { token: string; newPassword: string }[],
    unexpected: [] as string[],
  };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    state.events.push(`${request.method()} ${path}`);
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/csrf') {
      state.csrfCount++;
      if (state.failCsrf) return json({ code: 'CSRF_UNAVAILABLE', message: 'Não foi possível preparar a proteção de acesso. Tente novamente.', requestId: 'recovery-ui' }, 503);
      state.csrf = `recovery-csrf-${state.csrfCount}`;
      return json({ csrfToken: state.csrf });
    }
    if (path === '/auth/refresh') return json({ code: 'SESSION_EXPIRED', message: 'Entre novamente.', requestId: 'recovery-ui' }, 401);
    if (request.method() === 'POST' && request.headers()['x-csrf-token'] !== state.csrf) {
      return json({ code: 'CSRF_INVALID', message: 'Proteção de acesso inválida.', requestId: 'recovery-ui' }, 403);
    }
    if (path === '/auth/password/forgot') {
      state.forgot.push(request.postDataJSON());
      return json({ message: 'Se houver uma conta associada a este e-mail, você receberá as instruções de recuperação.' }, 202);
    }
    if (path === '/auth/password/reset') {
      state.reset.push(request.postDataJSON());
      return route.fulfill({ status: 204 });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return json({ code: 'INTEGRATION_PENDING', message: 'Recurso em integração.', requestId: 'recovery-ui' }, 501);
  });
  return state;
}

function errorsOn(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('recuperação em 320px aguarda CSRF, preserva a tentativa após falha e confirma sem revelar a existência da conta', async ({ page }) => {
  const verifyErrors = errorsOn(page);
  const api = await recoveryApi(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/recuperar-acesso');
  const email = page.getByLabel('E-mail', { exact: true });
  const submit = page.getByRole('button', { name: 'Solicitar recuperação', exact: true });
  await expect(submit).toBeEnabled();
  await email.fill('pessoa@example.invalid');
  api.failCsrf = true;
  const failedAt = api.events.length;
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível preparar');
  expect(api.events.slice(failedAt)).toEqual(['GET /auth/csrf']);
  expect(api.forgot).toEqual([]);
  await expect(email).toHaveValue('pessoa@example.invalid');
  await expect(submit).toBeEnabled();

  api.failCsrf = false;
  const retriedAt = api.events.length;
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail', exact: true })).toBeVisible();
  expect(api.events.slice(retriedAt)).toEqual(['GET /auth/csrf', 'POST /auth/password/forgot']);
  expect(api.forgot).toEqual([{ email: 'pessoa@example.invalid' }]);
  await expect(page.getByRole('status')).toContainText('Se houver uma conta');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await noOverflow(page);
  await mkdir('docs/frontend/qa', { recursive: true });
  await page.screenshot({ path: 'docs/frontend/qa/password-recovery-mobile.png', fullPage: true, animations: 'disabled' });

  await page.getByRole('button', { name: 'Usar outro e-mail', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar acesso', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(email).toBeFocused();
  await noOverflow(page);
  expect(api.unexpected).toEqual([]);
  verifyErrors();
});

test('link de redefinição preenche código protegido, permite trocar e não envia senha quando a preparação CSRF falha', async ({ page }) => {
  const verifyErrors = errorsOn(page);
  const api = await recoveryApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const linkToken = 'recovery-link-token-1234567890';
  const manualToken = 'recovery-manual-token-1234567890';
  await page.goto(`/redefinir-senha#token=${linkToken}`);
  const code = page.getByLabel('Código de recuperação', { exact: true });
  const password = page.getByLabel('Nova senha', { exact: true });
  const confirm = page.getByLabel('Confirmar nova senha', { exact: true });
  const submit = page.getByRole('button', { name: 'Redefinir senha', exact: true });
  await expect(submit).toBeEnabled();
  await expect(code).toHaveValue(linkToken);
  await expect(code).toHaveAttribute('type', 'password');
  await password.fill('Senha de recuperação 2026');
  await confirm.fill('Senha de recuperação 2026');
  await page.getByRole('button', { name: 'Usar outro código', exact: true }).click();
  await expect(code).toHaveValue('');
  await expect(code).toBeFocused();
  await expect(password).toHaveValue('');
  await expect(confirm).toHaveValue('');
  await code.fill(manualToken);
  await password.fill('Senha de recuperação 2026');
  await confirm.fill('Senha de recuperação 2026');
  api.failCsrf = true;
  const failedAt = api.events.length;
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível preparar');
  expect(api.events.slice(failedAt)).toEqual(['GET /auth/csrf']);
  expect(api.reset).toEqual([]);
  await expect(password).toHaveValue('Senha de recuperação 2026');
  await expect(confirm).toHaveValue('Senha de recuperação 2026');
  await noOverflow(page);
  await mkdir('docs/frontend/qa', { recursive: true });
  await page.screenshot({ path: 'docs/frontend/qa/reset-password-desktop.png', fullPage: true, animations: 'disabled' });

  api.failCsrf = false;
  const retriedAt = api.events.length;
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Tudo pronto.', exact: true })).toBeVisible();
  expect(api.events.slice(retriedAt)).toEqual(['GET /auth/csrf', 'POST /auth/password/reset']);
  expect(api.reset).toEqual([{ token: manualToken, newPassword: 'Senha de recuperação 2026' }]);
  await expect(page.getByRole('link', { name: 'Voltar ao login', exact: true })).toBeFocused();
  await noOverflow(page);
  expect(api.unexpected).toEqual([]);
  verifyErrors();
});

test('link de recuperação ambíguo exige código manual e não escolhe uma das credenciais do fragmento', async ({ page }) => {
  const verifyErrors = errorsOn(page);
  const api = await recoveryApi(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/redefinir-senha#token=first-reset-token-123456&token=second-reset-token-123456');
  await expect(page.getByRole('alert')).toBeVisible();
  const code = page.getByLabel('Código de recuperação', { exact: true });
  await expect(code).toHaveValue('');
  expect(api.reset).toEqual([]);
  await noOverflow(page);
  expect(api.unexpected).toEqual([]);
  verifyErrors();
});
