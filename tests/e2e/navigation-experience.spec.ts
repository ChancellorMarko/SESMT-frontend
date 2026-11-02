import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

test('busca por teclado encontra siglas, limpa o termo e abre o resultado único com Enter', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  const trigger = page.getByRole('button', { name: 'Buscar módulos', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  const search = menu.getByRole('textbox', { name: 'Buscar módulos de navegação', exact: true });
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  for (const [term, name, path] of [
    ['PT', 'Permissões de trabalho', '/app/pts'],
    ['AT', 'Autorizações de trabalho', '/app/ats'],
    ['PET', 'Permissões de entrada e trabalho (PET)', '/app/pets'],
  ]) {
    // Type through the keyboard after the shortcut or clear action. A direct
    // locator.fill would hide regressions in the field's initial focus.
    await page.keyboard.type(term);
    await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
    await menu.getByRole('button', { name: 'Limpar busca', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
  }

  await page.keyboard.type('modulo inexistente');
  await expect(menu.getByText('Nenhum módulo encontrado. Tente outro termo.', { exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await expect(search).toBeFocused();
  await page.keyboard.type('auditoria');
  await expect(menu.getByRole('navigation', { name: 'Menu principal', exact: true }).getByRole('link')).toHaveCount(1);
  await expect(menu.getByRole('link', { name: 'Auditoria', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/auditoria$/);
  await expect(page.getByRole('heading', { name: 'Auditoria', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('atalho respeita outros diálogos e o menu identifica a área atual', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  const guideTrigger = page.getByRole('button', { name: 'Abrir Guia Ampara', exact: true });
  await guideTrigger.click();
  const guide = page.getByRole('dialog', { name: 'Guia Ampara', exact: true });
  await expect(guide).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(guide).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Navegação', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(guideTrigger).toBeFocused();

  await page.getByRole('navigation', { name: 'Acesso rápido', exact: true }).getByRole('link', { name: 'Equipamentos de proteção individual (EPI)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipamentos de proteção', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await expect(menu.getByRole('link', { name: 'Visão geral', exact: true })).not.toHaveAttribute('aria-current');
  await expect(menu.getByRole('link', { name: 'Proteção individual', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('busca continua acessível a 320px depois de rolar os módulos', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  const search = menu.getByRole('textbox', { name: 'Buscar módulos de navegação', exact: true });
  const results = menu.locator('[data-navigation-results]');
  await expect(search).toBeFocused();
  await results.hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const lastModule = menu.getByRole('link', { name: 'Parâmetros', exact: true });
  await lastModule.focus();
  await expect(lastModule).toBeFocused();
  await expect(search).toBeInViewport();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();
  await page.keyboard.type('capacitacoes');
  await expect(menu.getByRole('link', { name: 'Capacitações', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('navigation-mobile-320.png') });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
