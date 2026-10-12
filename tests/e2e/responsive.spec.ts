import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('painel desktop e agenda móvel mantêm navegação e conteúdo dentro da tela', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  await expect(page.getByRole('link').filter({ hasText: 'Serviços na agenda' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.FRONTEND_CAPTURE_QA) await page.screenshot({ path: 'docs/frontend/qa/painel-desktop.png', fullPage: true });
  await page.locator('a[href="/app/pendencias?status=pending"]').click();
  await expect(page.getByLabel('Situação documental')).toHaveValue('pending');
  await expect(page.getByText('AG-DEMO-220', { exact: true })).toBeVisible();
  await expect(page.getByText('AG-DEMO-221', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Permissões de trabalho', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Permissões de trabalho', exact: true })).toBeVisible();
  await navigateWithinApp(page, '/app/agenda?q=AG-DEMO-220');
  await expect(page.getByText('AG-DEMO-220', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.FRONTEND_CAPTURE_QA) await page.screenshot({ path: 'docs/frontend/qa/agenda-mobile.png', fullPage: true });
  expect(consoleErrors).toEqual([]);
});
