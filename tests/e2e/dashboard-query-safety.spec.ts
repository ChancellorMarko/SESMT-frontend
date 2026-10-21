import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

for (const width of [390, 1440]) {
  test(`painel bloqueia período invertido e recupera filtros a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await loginDemo(page, 'Engenheiro');
    const requests: URL[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/permit-dashboard') requests.push(url);
    });
    await expect(page.getByRole('link', { name: /Serviços na agenda/ })).toBeVisible();
    await page.getByLabel('Período de início', { exact: true }).fill('2026-10-31');
    await expect.poll(() => requests.at(-1)?.searchParams.get('from')).toBe('2026-10-31');
    await page.getByLabel('Período até', { exact: true }).fill('2026-10-01');
    await expect(page.getByText('A data final deve ser igual ou posterior à inicial.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Atualizar painel', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: /Serviços na agenda/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Consultar agenda', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Período de início', { exact: true })).toHaveValue('2026-10-31');
    await page.getByRole('region', { name: 'Filtros contextuais do painel', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`painel-periodo-${width}.png`), animations: 'disabled' });

    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(page.getByRole('link', { name: /Serviços na agenda/ })).toBeVisible();
    const refresh = page.getByRole('button', { name: 'Atualizar painel', exact: true });
    await expect(refresh).toBeEnabled();
    await page.getByLabel('Pesquisar na plataforma', { exact: true }).fill('Busca ainda não enviada');
    const beforeRefresh = requests.length;
    await refresh.click();
    await expect.poll(() => requests.length).toBeGreaterThan(beforeRefresh);
    await expect(refresh).toBeEnabled();
    await expect(page.getByLabel('Pesquisar na plataforma', { exact: true })).toHaveValue('Busca ainda não enviada');
    expect(requests.every(url => !url.searchParams.get('from') || !url.searchParams.get('to') || url.searchParams.get('from')! <= url.searchParams.get('to')!)).toBe(true);
    expect(errors).toEqual([]);
  });
}
