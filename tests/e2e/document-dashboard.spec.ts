import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

for (const width of [320, 1440]) {
  test(`painel documental preserva período, atalhos e pendências a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await loginDemo(page, 'Engenheiro');
    const requests: URL[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/dashboard') requests.push(url);
    });
    await navigateWithinApp(page, '/app/painel-documental?from=2020-01-01&to=2035-12-31');
    const table = page.getByRole('table', { name: 'Pendências documentais do painel', exact: true });
    await expect(table).toBeVisible();
    await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeEnabled();
    await page.getByLabel('Período inicial', { exact: true }).fill('2021-01-01');
    await expect(page.getByText('Há alterações no período ainda não aplicadas ao painel.', { exact: true })).toBeVisible();
    const before = requests.length;
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(before);
    expect(requests.at(-1)?.searchParams.get('from')).toBe('2020-01-01');
    await expect(page.getByLabel('Período inicial', { exact: true })).toHaveValue('2021-01-01');
    await page.getByRole('button', { name: 'Aplicar período', exact: true }).click();
    await expect(page).toHaveURL(/from=2021-01-01&to=2035-12-31$/);
    await expect(table).toBeVisible();
    await expect(page.getByText('Há alterações no período ainda não aplicadas ao painel.', { exact: true })).toHaveCount(0);
    const link = page.getByRole('link', { name: 'Consultar documentos →', exact: true }).first();
    const target = new URL((await link.getAttribute('href'))!, page.url());
    expect(target.pathname).toBe('/app/documentos');
    expect(target.searchParams.get('issueDateFrom')).toBe('2021-01-01');
    expect(target.searchParams.get('issueDateTo')).toBe('2035-12-31');
    expect(target.searchParams.get('status')).toBe('ACTIVE');
    await table.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pendencias-painel-${width}.png`), animations: 'disabled' });
    await link.click();
    await expect(page).toHaveURL(/\/app\/documentos\?/);
    await expect(page.getByRole('combobox', { name: 'Situação', exact: true })).toHaveValue('ACTIVE');

    const beforeInvalid = requests.length;
    await navigateWithinApp(page, '/app/painel-documental?from=2020-01-01&from=2021-01-01');
    await expect(page.getByRole('alert')).toContainText('Os filtros na URL são inválidos.');
    await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeDisabled();
    await expect(table).toHaveCount(0);
    expect(requests).toHaveLength(beforeInvalid);
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(table).toBeVisible();
    expect(errors).toEqual([]);
  });
}
