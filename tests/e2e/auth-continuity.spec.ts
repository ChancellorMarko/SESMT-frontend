import { expect, test, type Page } from '@playwright/test';

function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
}

test('MFA em 320px mantém a etapa, o foco e um novo desafio limpo após código inválido', async ({ page }, testInfo) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Entrar na sua conta', exact: true })).toBeVisible();
  await expectNoOverflow(page);

  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifique seu acesso', exact: true })).toBeVisible();
  const code = page.getByLabel('Código de verificação', { exact: true });
  await expect(code).toBeFocused();
  const steps = page.getByRole('list', { name: 'Etapas do acesso', exact: true });
  await expect(steps.getByRole('listitem').filter({ hasText: 'Verificação' })).toHaveAttribute('aria-current', 'step');
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('mfa-mobile.png'), fullPage: true, animations: 'disabled' });

  await code.fill('000000');
  await page.getByRole('button', { name: 'Verificar e entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Código inválido');
  await expect(page).toHaveURL(/\/login$/);
  await expectNoOverflow(page);
  await page.getByRole('button', { name: 'Voltar ao login', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar na sua conta', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();
  await expectNoOverflow(page);

  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await expect(code).toBeVisible();
  await expect(code).toHaveValue('');
  await expect(code).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectNoOverflow(page);
  await code.fill('123456');
  await page.getByRole('button', { name: 'Verificar e entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
  verify();
});

test('redefinição associa a divergência ao campo, preserva a senha ao revelar e direciona o retorno após sucesso', async ({ page }, testInfo) => {
  const verify = observeErrors(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/redefinir-senha');
  await expect(page.getByRole('heading', { name: 'Definir nova senha', exact: true })).toBeVisible();
  const password = page.getByLabel('Nova senha', { exact: true });
  const confirm = page.getByLabel('Confirmar nova senha', { exact: true });
  await password.fill('NovaSenha123!');
  await confirm.fill('OutraSenha123!');
  await page.getByRole('button', { name: 'Redefinir senha', exact: true }).click();
  const mismatch = page.getByRole('alert').filter({ hasText: 'As senhas devem ser iguais.' });
  await expect(mismatch).toBeVisible();
  await expect(confirm).toHaveAttribute('aria-invalid', 'true');
  const errorId = await mismatch.getAttribute('id');
  expect(errorId).toBeTruthy();
  expect((await confirm.getAttribute('aria-describedby') || '').split(/\s+/)).toContain(errorId);
  await expectNoOverflow(page);

  await page.getByRole('button', { name: 'Mostrar nova senha', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('NovaSenha123!');
  await page.getByRole('button', { name: 'Ocultar nova senha', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('NovaSenha123!');
  await confirm.fill('NovaSenha123!');
  await page.getByRole('button', { name: 'Redefinir senha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tudo pronto.', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Senha redefinida.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const back = page.getByRole('link', { name: 'Voltar ao login', exact: true });
  await expect(back).toBeFocused();
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('reset-success-mobile.png'), fullPage: true, animations: 'disabled' });
  await back.click();
  await expect(page.getByRole('heading', { name: 'Entrar na sua conta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar na plataforma', exact: true })).toBeEnabled();
  verify();
});
