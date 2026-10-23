import { expect, test, type Page } from '@playwright/test';

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

async function expectNoOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
  expect(size.document).toBeLessThanOrEqual(size.viewport + 1);
}

async function waitForLogin(page: Page) {
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Entrar na sua conta', exact: true })).toBeVisible();
  await expect(page.locator('[data-auth-scene]')).not.toHaveAttribute('inert');
  await expect(page.locator('[data-auth-scene]')).not.toHaveAttribute('aria-hidden', 'true');
}

test('a abertura libera o mesmo formulário para preenchimento e navegação por teclado', async ({ page }, testInfo) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/login');

  const preloader = page.getByTestId('login-preloader');
  const scene = page.locator('[data-auth-scene]');
  await expect(preloader).toBeVisible();
  await expect(preloader).toHaveAttribute('role', 'status');
  await expect(scene).toHaveAttribute('inert');
  await expect(scene).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => preloader.locator('img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('login-preloader.png'), animations: 'disabled' });

  // The input exists during the presentation. Its identity must survive the
  // transition so browser autofill is not discarded by a second form mount.
  const email = page.locator('input[autocomplete="username"]');
  await expect(email).toHaveCount(1);
  await email.evaluate(element => {
    (window as unknown as { __loginEmail: Element }).__loginEmail = element;
  });
  await waitForLogin(page);
  expect(await email.evaluate(element => element === (window as unknown as { __loginEmail: Element }).__loginEmail)).toBe(true);

  const password = page.getByLabel('Senha', { exact: true });
  await expect(email).toHaveAttribute('type', 'email');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await email.focus();
  await page.keyboard.type('gestor@demo.sesmt.local');
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await page.keyboard.type('Demo123!');
  await page.keyboard.press('Tab');
  const reveal = page.getByRole('button', { name: 'Mostrar senha', exact: true });
  await expect(reveal).toBeFocused();
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('Demo123!');
  await expect(email).toHaveValue('gestor@demo.sesmt.local');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Esqueci minha senha', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Entrar na plataforma', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expectNoOverflow(page);
  verify();
});

test('o volume da marca e o botão apresentam movimento real no modo completo', async ({ page }, testInfo) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/login');
  await waitForLogin(page);
  const artwork = page.locator('[data-auth-artwork]');
  const rest = await artwork.evaluate(element => getComputedStyle(element).transform);
  await expect.poll(() => artwork.evaluate(element => getComputedStyle(element).transform)).not.toBe(rest);
  const action = page.getByRole('button', { name: 'Entrar na plataforma', exact: true });
  const restingButton = await action.evaluate(element => getComputedStyle(element).transform);
  await action.hover();
  await expect.poll(() => action.evaluate(element => getComputedStyle(element).transform)).not.toBe(restingButton);
  await page.mouse.move(0, 0);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('login-desktop.png'), fullPage: true, animations: 'disabled' });
  verify();
});

test('uma tentativa inválida preserva os campos sem repetir a apresentação', async ({ page }) => {
  const verify = observeErrors(page);
  await page.goto('/login');
  await waitForLogin(page);
  await page.evaluate(() => {
    const state = { repeated: false };
    (window as unknown as { __loginIntro: typeof state }).__loginIntro = state;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="login-preloader"]')) state.repeated = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const email = page.getByLabel('E-mail', { exact: true });
  const password = page.getByLabel('Senha', { exact: true });
  await email.fill('gestor@demo.sesmt.local');
  await password.fill('senha-incorreta');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Credenciais inválidas');
  await expect(page).toHaveURL(/\/login$/);
  await expect(email).toHaveValue('gestor@demo.sesmt.local');
  await expect(password).toHaveValue('senha-incorreta');
  await expect(page.getByRole('button', { name: 'Entrar na plataforma', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __loginIntro: { repeated: boolean } }).__loginIntro.repeated)).toBe(false);
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  verify();
});

test('movimento reduzido libera o login sem espera e preserva o preenchimento em 320px', async ({ page }) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await waitForLogin(page);
  const scene = page.locator('[data-auth-scene]');
  expect(await scene.evaluate(element => element.getAnimations({ subtree: true }).filter(animation =>
    animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity,
  ).length)).toBe(0);
  const email = page.getByLabel('E-mail', { exact: true });
  await email.fill('rascunho@empresa.com');
  await email.focus();
  await email.evaluate(element => {
    (window as unknown as { __reducedLoginEmail: Element }).__reducedLoginEmail = element;
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(email).toHaveValue('rascunho@empresa.com');
  await expect(email).toBeFocused();
  expect(await email.evaluate(element => element === (window as unknown as { __reducedLoginEmail: Element }).__reducedLoginEmail)).toBe(true);
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  for (const role of ['Técnico de segurança', 'Bombeiro', 'Engenheiro', 'Gestor SESMT', 'RH', 'Auditor', 'Administrador', 'Trabalhador']) {
    const control = page.getByRole('button', { name: role, exact: true });
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(43.9);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
  }
  await expectNoOverflow(page);
  verify();
});

test('recuperação e redefinição continuam operáveis sem a introdução do login', async ({ page }) => {
  const verify = observeErrors(page);
  await page.goto('/recuperar-acesso');
  await expect(page.getByRole('heading', { name: 'Recuperar acesso', exact: true })).toBeVisible();
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  const email = page.getByLabel('E-mail', { exact: true });
  await expect(email).toHaveAttribute('autocomplete', 'email');
  await email.fill('gestor@demo.sesmt.local');
  await page.getByRole('button', { name: 'Solicitar recuperação', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Se houver uma conta');
  await page.getByRole('link', { name: 'Experimentar redefinição', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Definir nova senha', exact: true })).toBeVisible();
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  await page.getByLabel('Nova senha', { exact: true }).fill('NovaSenha123!');
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill('NovaSenha123!');
  await page.getByRole('button', { name: 'Redefinir senha', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Senha redefinida');
  await page.getByRole('link', { name: 'Voltar ao login', exact: true }).click();
  await waitForLogin(page);
  await expect(page.getByRole('button', { name: 'Engenheiro', exact: true })).toBeEnabled();
  verify();
});
