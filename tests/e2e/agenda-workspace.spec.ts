import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('o último filtro removido da agenda permanece removido', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/agenda?status=REQUESTED');
  const status = page.getByLabel('Situação do agendamento', { exact: true });
  await expect(status).toHaveValue('REQUESTED');
  await page.getByRole('button', { name: 'Remover filtro: Situação', exact: true }).click();
  await expect(status).toHaveValue('');
  await expect(page).not.toHaveURL(/status=/);
  await expect(page.getByText('AG-DEMO-220', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Buscar atendimento', { exact: true })).toBeFocused();
  await status.selectOption('REQUESTED');
  await expect(page.getByRole('button', { name: 'Remover filtro: Situação', exact: true })).toBeVisible();
  await status.selectOption('');
  await expect(page.getByText('AG-DEMO-220', { exact: true })).toBeVisible();
  await expect(status).toHaveValue('');
});

test('a agenda explica um período inválido sem consultar atendimentos', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/appointments') requests.push(request.url()); });
  await navigateWithinApp(page, '/app/agenda?from=2026-12-31&to=2026-01-01');
  await expect(page.getByRole('heading', { name: 'Corrija os filtros da agenda', exact: true })).toBeVisible();
  await expect(page.getByLabel('Data final do filtro', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Atendimentos da agenda', exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
});

test('o status de atendimento cabe na coluna sem invadir ações no tablet', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/agenda?q=AG-DEMO-224');
  const row = page.getByRole('row').filter({ hasText: 'AG-DEMO-224' });
  const status = row.getByText('Atendimento aberto', { exact: true });
  const cell = row.getByRole('cell').filter({ hasText: 'Atendimento aberto' });
  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(status).toBeVisible();
    const badgeBounds = await status.boundingBox(), cellBounds = await cell.boundingBox();
    const actionBounds = await row.getByRole('link', { name: 'Consultar atendimento', exact: true }).boundingBox();
    expect(badgeBounds!.x + badgeBounds!.width).toBeLessThanOrEqual(cellBounds!.x + cellBounds!.width);
    expect(badgeBounds!.x + badgeBounds!.width).toBeLessThanOrEqual(actionBounds!.x);
  }
});

for (const width of [320, 390]) {
  test(`agenda em ${width}px preserva horários, consulta e retorno à pesquisa`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, '/app/agenda?q=AG-DEMO-220');
    const table = page.getByRole('table', { name: 'Atendimentos da agenda', exact: true });
    await expect(table).toBeVisible();
    const row = table.getByRole('row').filter({ hasText: 'AG-DEMO-220' });
    await expect(row.getByText('Horário de solicitação', { exact: true })).toBeVisible();
    const dimensions = await table.evaluate(element => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const beforeDetail = page.url();
    await row.getByRole('link', { name: 'Consultar atendimento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dados do atendimento', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
    await expect(page).toHaveURL(beforeDetail);
    await expect(page.getByLabel('Buscar atendimento', { exact: true })).toHaveValue('AG-DEMO-220');
    expect(errors).toEqual([]);
  });
}
