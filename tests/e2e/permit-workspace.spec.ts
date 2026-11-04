import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('remover um critério de PT preserva a unidade e os demais filtros', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/pts?q=PT&operationStatus=VERIFICATION');
  const group = page.getByRole('group', { name: 'Filtros aplicados', exact: true });
  await expect(group).toBeVisible();
  const unit = new URL(page.url()).searchParams.get('unitId');
  expect(unit).toBeTruthy();
  await group.getByRole('button', { name: 'Remover filtro: Busca', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar PT', exact: true })).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
  expect(new URL(page.url()).searchParams.get('unitId')).toBe(unit);
  expect(new URL(page.url()).searchParams.get('operationStatus')).toBe('VERIFICATION');
  await group.getByRole('button', { name: 'Remover filtro: Situação operacional', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Consultar PT', exact: true }).first()).toBeVisible();
});

for (const width of [320, 390, 768]) {
  test(`lista de PTs a ${width}px mantém status, ciências e consulta acessíveis`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, '/app/pts');
    const results = page.getByRole('region', { name: 'Permissões de trabalho encontradas', exact: true });
    await expect(results.getByText('Operação', { exact: true }).first()).toBeVisible();
    await expect(results.getByText('Revisão', { exact: true }).first()).toBeVisible();
    await expect(results.getByText(/Versão \d+ da PT/).first()).toBeVisible();
    const table = results.getByRole('table');
    const bounds = await table.evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const beforeDetail = page.url();
    await results.getByRole('link', { name: 'Consultar PT', exact: true }).first().click();
    await page.getByRole('link', { name: 'Voltar às PTs', exact: true }).click();
    await expect(page).toHaveURL(beforeDetail);
    expect(errors).toEqual([]);
  });
}
