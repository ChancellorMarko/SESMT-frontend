import { expect, test } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

for (const width of [320, 390, 1440]) {
  test(`consulta de trabalhadores organiza filtros e leitura a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'RH');
    await openModule(page, 'Trabalhadores');
    const results = page.getByRole('region', { name: 'Resultados de trabalhadores', exact: true });
    const table = page.getByRole('table', { name: 'Trabalhadores encontrados', exact: true });
    await expect(results.getByRole('link', { name: 'Camila Demo', exact: true })).toBeVisible();
    const disclosure = page.getByRole('button', { name: 'Empresa e equipe', exact: true });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Equipe operacional', { exact: true })).toBeVisible();
    await disclosure.click();
    await page.getByLabel('Buscar nome ou matrícula', { exact: true }).fill('Camila');
    await expect(page.getByText(/Busca digitada ainda não aplicada/)).toBeVisible();
    await expect(results.getByRole('link', { name: 'Julia Demo', exact: true })).toBeVisible();
    await page.getByLabel('Situação cadastral', { exact: true }).selectOption('ACTIVE');
    await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue('Camila');
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remover filtro: Busca', exact: true })).toContainText('Camila');
    await expect(page.getByText(/Busca digitada ainda não aplicada/)).toHaveCount(0);
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remover filtro: Situação cadastral', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remover filtro: Busca', exact: true })).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(2);
    const row = table.getByRole('row').filter({ hasText: 'Camila Demo' });
    await expect(row).toContainText('Integra');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 768) {
      const bounds = await row.boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(width - 32);
      await expect(row.getByRole('link', { name: 'Consultar Camila Demo', exact: true })).toHaveCSS('min-height', '44px');
    }
    await page.screenshot({ path: testInfo.outputPath(`trabalhadores-${width}.png`), fullPage: true });
    await row.getByRole('link', { name: 'Consultar Camila Demo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Camila Demo', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
