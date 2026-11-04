import { expect, test } from '@playwright/test';

test('login da API oferece link separado para a demonstração sem autenticar perfis fictícios', async ({ page }) => {
  const logins: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/auth/login')) logins.push(request.postData() || '');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login?demonstracao=perfis');
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  const demo = page.getByRole('link', { name: 'Ver demonstrações', exact: true });
  await expect(demo).toBeVisible();
  await expect(demo).toHaveAttribute('href', 'http://127.0.0.1:5173/login?demonstracao=perfis');
  await expect(demo).toHaveAttribute('target', '_blank');
  await expect(demo).toHaveAttribute('rel', /noopener/);
  await expect(page.getByRole('heading', { name: 'Escolha um perfil', exact: true })).toHaveCount(0);
  for (const role of ['Técnico de segurança', 'Bombeiro', 'Engenheiro', 'Gestor SESMT', 'RH', 'Auditor', 'Administrador', 'Trabalhador']) {
    await expect(page.getByRole('button', { name: role, exact: true })).toHaveCount(0);
  }
  await page.getByLabel('E-mail', { exact: true }).fill('conta@empresa.com');
  await page.getByLabel('Senha', { exact: true }).fill('Senha preservada');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('conta@empresa.com');
  await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('Senha preservada');
  expect(logins).toEqual([]); expect(errors).toEqual([]);
});
