import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const unitA = '00000000-0000-4000-8000-000000000002';
const unitB = '00000000-0000-4000-8000-000000000003';

test('vencimentos exigem filtros válidos e preservam a busca não aplicada ao mudar o período', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page);
  const requests: URL[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/documents' && url.searchParams.get('pageSize') === '10') requests.push(url);
  });
  for (const criteria of ['view=invalid', 'days=365', 'page=Infinity', 'q=um&q=dois', 'unknown=value']) {
    const before = requests.length;
    await navigateWithinApp(page, `/app/vencimentos?unitId=${unitA}&${criteria}`);
    await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Abrir no repositório/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Resultado da consulta', exact: true })).toHaveCount(0);
    expect(requests).toHaveLength(before);
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Inventário de riscos · Matriz (demo)', exact: true })).toBeVisible();
  }
  const input = page.getByLabel('Buscar por título ou código', { exact: true });
  await input.fill('PROC-2026-002');
  await page.getByLabel('Antecedência', { exact: true }).selectOption('90');
  await expect(page.getByRole('link', { name: 'Orientação de segurança · Produção (demo)', exact: true })).toBeVisible();
  await expect(input).toHaveValue('PROC-2026-002'); expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeEnabled();
  await expect(input).toHaveValue('PROC-2026-002');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Inventário de riscos · Matriz (demo)', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Orientação de segurança · Produção (demo)', exact: true })).toBeVisible();
  const repository = new URL((await page.getByRole('link', { name: /Abrir no repositório/ }).getAttribute('href'))!, page.url());
  expect(repository.searchParams.get('q')).toBe('PROC-2026-002'); expect(repository.searchParams.get('status')).toBe('ACTIVE'); expect(repository.searchParams.get('unitId')).toBe(unitA);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`vencimentos-criterios-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true }).selectOption(unitB);
  await expect(page.getByRole('region', { name: 'Resultado da consulta', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inventário de riscos · Matriz (demo)', exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('unitId')).toBe(unitB);
  expect(requests.at(-1)?.searchParams.get('unitId')).toBe(unitB);
  expect(errors).toEqual([]);
});
