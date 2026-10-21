import { expect, test } from '@playwright/test';
import { loginDemo, logout, openModule } from './helpers';

test('dock, busca por teclado e acompanhamento ilustrativo mantêm ações e retorno de foco', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  const dock = page.getByRole('navigation', { name: 'Acesso rápido' });
  await expect(page.locator('aside')).toHaveCount(0);
  for (const name of ['Dashboard', 'Inspeções', 'ASOs e NRs', 'EPIs', 'Relatórios']) await expect(dock.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByText('Cenário ilustrativo de SST', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Entregas de EPIs no cenário ilustrativo' })).toHaveAttribute('aria-valuenow', '92');
  await dock.getByRole('link', { name: 'Inspeções', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inspeções de segurança', exact: true })).toBeVisible();
  const action = page.getByRole('button', { name: 'Conferir exemplo prioritário', exact: true });
  await action.click();
  const detail = page.getByRole('dialog', { name: 'Proteção de máquina a conferir', exact: true });
  await expect(detail).toContainText('Nenhum registro real, autorização ou condição de aptidão será alterado.');
  await detail.getByRole('button', { name: 'Acompanhar exemplo', exact: true }).click();
  await expect(detail.getByRole('status')).toContainText('Exemplo marcado para acompanhamento');
  await page.keyboard.press('Escape');
  await expect(action).toBeFocused();
  await dock.getByRole('link', { name: 'EPIs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipamentos de proteção', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver detalhes: Proteção de máquina a conferir' })).toHaveCount(0);
  await dock.getByRole('link', { name: 'Relatórios', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Painel documental', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }).fill('documentos');
  await menu.getByRole('link', { name: 'Documentos', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Documentos', exact: true })).toBeVisible();
  await page.getByLabel('Buscar por título ou código', { exact: true }).focus();
  await page.keyboard.press('Control+k');
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`dock e modais funcionam com movimento reduzido a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    await expect(page.getByRole('banner').getByAltText('Ampara SESMT', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'ASOs e NRs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saúde e capacitação', exact: true })).toBeVisible();
    const info = page.getByRole('button', { name: 'Sobre o indicador: ASOs e treinamentos', exact: true });
    await info.click();
    await expect(page.getByRole('dialog')).toContainText('números sintéticos');
    await page.keyboard.press('Escape');
    await expect(info).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openModule(page, 'Documentos');
    await expect(page.getByRole('heading', { name: 'Documentos', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('menu completo preserva as capacidades de escrita de cada perfil', async ({ page }) => {
  await loginDemo(page, 'Auditor');
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await expect(menu.getByRole('link', { name: 'Documentos', exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Usuários e acessos', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await logout(page);
  await loginDemo(page, 'Administrador');
  await openModule(page, 'Usuários e acessos');
  await expect(page.getByRole('heading', { name: 'Usuários e acesso', exact: true })).toBeVisible();
});
