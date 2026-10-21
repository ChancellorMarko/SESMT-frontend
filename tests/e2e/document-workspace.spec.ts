import { expect, test } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

test('consulta compacta remove um filtro e Voltar restaura os critérios anteriores', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await openModule(page, 'Documentos');
  const more = page.getByRole('button', { name: 'Mais filtros', exact: true });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Vencimento a partir de', { exact: true })).toBeHidden();
  await page.getByLabel('Situação', { exact: true }).selectOption('IN_REVIEW');
  await expect(page.getByText('Alterações ainda não aplicadas à lista.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const active = page.getByRole('group', { name: 'Filtros aplicados', exact: true });
  await expect(active).toContainText('Em revisão');
  await expect(page.getByRole('link', { name: 'Procedimento de trabalho seguro (demo)', exact: true })).toBeVisible();
  await active.getByRole('button', { name: 'Remover filtro: Situação', exact: true }).click();
  await expect(page.getByLabel('Buscar por título ou código', { exact: true })).toBeFocused();
  await expect(page).not.toHaveURL(/status=/);
  await page.goBack();
  await expect(page).toHaveURL(/status=IN_REVIEW/);
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('IN_REVIEW');
  await more.click();
  await expect(page.getByLabel('Vencimento a partir de', { exact: true })).toBeVisible();
  await more.click();
  await expect(more).toBeFocused();
  await expect(page.getByLabel('Vencimento a partir de', { exact: true })).toBeHidden();
});

for (const width of [320, 390]) {
  test(`documentos ficam legíveis sem rolagem horizontal a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await loginDemo(page, 'Engenheiro');
    await openModule(page, 'Documentos');
    const table = page.getByRole('table', { name: 'Lista de documentos', exact: true });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Documento', exact: true })).toHaveCount(1);
    const first = table.getByRole('link').first();
    await first.scrollIntoViewIfNeeded();
    await expect(first).toBeVisible();
    const dimensions = await table.evaluate(element => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth, viewport: innerWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await first.click();
    await expect(page.getByRole('region', { name: 'Metadados do documento', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
