import { expect, test } from '@playwright/test';
import { loginDemo, logout, openModule } from './helpers';

test('dock, busca por teclado e acompanhamento mantêm ações e retorno de foco', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  const dock = page.getByRole('navigation', { name: 'Acesso rápido' });
  const railBounds = await dock.boundingBox();
  expect(railBounds).not.toBeNull();
  expect(railBounds!.height).toBeGreaterThan(railBounds!.width);
  await expect(dock).toBeInViewport();
  for (const name of ['Dashboard', 'Inspeções', 'Saúde e capacitações', 'Equipamentos de proteção individual (EPI)', 'Relatórios']) await expect(dock.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dias sem acidentes', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Entregas de EPIs' })).toHaveAttribute('aria-valuenow', '92');
  await dock.getByRole('link', { name: 'Inspeções', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inspeções de segurança', exact: true })).toBeVisible();
  const action = page.getByRole('button', { name: 'Ver achado: Proteção de transmissão', exact: true });
  await action.click();
  const detail = page.getByRole('dialog', { name: 'Proteção de transmissão', exact: true });
  await expect(detail.getByRole('heading', { name: 'Observação', exact: true })).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Próximo passo', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Acompanhar', exact: true }).click();
  await expect(detail.getByRole('status')).toContainText('Achado em acompanhamento.');
  await page.keyboard.press('Escape');
  await expect(action).toBeFocused();
  await dock.getByRole('link', { name: 'Equipamentos de proteção individual (EPI)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipamentos de proteção', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conferências de EPIs', exact: true })).toBeVisible();
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
    await expect(page.getByRole('link', { name: 'Ampara SESMT · Página inicial', exact: true }).getByAltText('Ampara SESMT', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saúde ocupacional e capacitações', exact: true })).toBeVisible();
    const info = page.getByRole('button', { name: 'Ver detalhe: Conferir identificação do documento', exact: true });
    await info.click();
    const healthDetail = page.getByRole('dialog', { name: 'Conferir identificação do documento', exact: true });
    await expect(healthDetail.getByRole('status')).toHaveText('Acompanhamento pendente.');
    await expect(healthDetail.getByRole('button', { name: 'Acompanhar', exact: true })).toBeEnabled();
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
