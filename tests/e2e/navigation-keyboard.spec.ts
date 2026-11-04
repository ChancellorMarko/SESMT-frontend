import { expect, test, type Page } from '@playwright/test';
import { loginDemo } from './helpers';

// Browser UX over synthetic MSW data. This does not validate backend authorization.
function observeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

async function noOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ body: document.body.scrollWidth, document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
}

test('setas, Home e End percorrem destinos sem capturar Tab e Enter abre somente o destino escolhido', async ({ page }, testInfo) => {
  const verifyErrors = observeErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  await page.getByRole('button', { name: 'Buscar módulos', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  const search = menu.getByRole('textbox', { name: 'Buscar módulos de navegação', exact: true });
  const destinations = menu.locator('[data-navigation-results]').getByRole('link');
  expect(await destinations.count()).toBeGreaterThan(3);
  const first = destinations.first(), last = destinations.last();
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(last).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(destinations.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(destinations.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('navigation-keyboard-desktop.png'), fullPage: true, animations: 'disabled' });

  await search.focus();
  await search.fill('PT');
  expect(await destinations.count()).toBeGreaterThan(1);
  const previousUrl = page.url();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  expect(page.url()).toBe(previousUrl);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('link', { name: 'Permissões de trabalho', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/pts$/);
  verifyErrors();
});

test('busca sem resultados oferece somente sugestões autorizadas e devolve o foco ao campo', async ({ page }) => {
  const verifyErrors = observeErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Trabalhador');
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  const search = menu.getByRole('textbox', { name: 'Buscar módulos de navegação', exact: true });
  await search.fill('módulo inexistente');
  await expect(menu.getByText('Nenhum módulo encontrado. Tente outro termo.', { exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Documentos', exact: true })).toBeVisible();
  for (const name of ['Agenda', 'PT', 'Equipes']) await expect(menu.getByRole('button', { name, exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Documentos', exact: true }).click();
  await expect(search).toHaveValue('Documentos');
  await expect(search).toBeFocused();
  await expect(menu.getByRole('link', { name: 'Documentos', exact: true })).toBeVisible();
  await expect(menu.getByText('Nenhum módulo encontrado. Tente outro termo.', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Abrir navegação', exact: true })).toBeFocused();
  verifyErrors();
});

test('teclado mantém o destino visível em 320px e reconhece a busca NR-35 sem perder a pesquisa', async ({ page }, testInfo) => {
  const verifyErrors = observeErrors(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  const search = menu.getByRole('textbox', { name: 'Buscar módulos de navegação', exact: true });
  const results = menu.locator('[data-navigation-results]');
  const destinations = results.getByRole('link');
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(destinations.last()).toBeFocused();
  await expect(destinations.last()).toBeInViewport();
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const previousScroll = await results.evaluate(element => element.scrollTop);
  await expect(search).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(destinations.first()).toBeFocused();
  await expect(destinations.first()).toBeInViewport();
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeLessThan(previousScroll);
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await search.fill('NR-35');
  const training = menu.getByRole('link', { name: 'Capacitações', exact: true });
  await expect(training).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(training).toBeFocused();
  await expect(training).toBeInViewport();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('navigation-keyboard-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/dashboard\?area=saude&healthView=nrs$/);
  verifyErrors();
});
