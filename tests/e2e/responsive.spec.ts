import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('painel desktop e agenda móvel mantêm navegação e conteúdo dentro da tela', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  await expect(page.getByRole('link').filter({ hasText: 'Serviços na agenda' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Acesso rápido' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.FRONTEND_CAPTURE_QA) await page.screenshot({ path: 'docs/frontend/qa/painel-desktop.png', fullPage: true });
  // Intermediate widths must leave room for the full brand, scope picker and logout.
  for (const width of [521, 600, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const header = page.getByRole('banner');
    const logo = await header.getByRole('img', { name: 'Ampara SESMT', exact: true }).boundingBox();
    const unit = await page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true }).boundingBox();
    expect(logo).not.toBeNull(); expect(unit).not.toBeNull();
    expect(logo!.x + logo!.width <= unit!.x || unit!.x + unit!.width <= logo!.x || logo!.y + logo!.height <= unit!.y || unit!.y + unit!.height <= logo!.y).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Sair da plataforma', exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Conferir requisitos por participante', exact: true }).click();
  await expect(page.getByLabel('Situação documental', { exact: true })).toHaveValue('pending');
  await expect(page.getByText('AG-DEMO-220', { exact: true })).toBeVisible();
  await expect(page.getByText('AG-DEMO-221', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Permissões de trabalho', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Permissões de trabalho (PT)', exact: true })).toBeVisible();
  await navigateWithinApp(page, '/app/agenda?q=AG-DEMO-220');
  await expect(page.getByText('AG-DEMO-220', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.FRONTEND_CAPTURE_QA) await page.screenshot({ path: 'docs/frontend/qa/agenda-mobile.png', fullPage: true });
  expect(consoleErrors).toEqual([]);
});
