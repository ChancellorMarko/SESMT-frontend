import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

for (const width of [320, 390, 1440]) {
  test(`pendências em ${width}px preservam a consulta ao abrir a conferência e remover critérios`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, '/app/pendencias?q=Bruno');
    const search = page.getByRole('searchbox', { name: 'Buscar pessoa ou atendimento', exact: true });
    const filters = page.getByRole('region', { name: 'Filtros de pendências', exact: true });
    const result = page.getByRole('region', { name: 'Pendências de AG-DEMO-220', exact: true });
    await expect(result.getByRole('heading', { name: 'Bruno Demo', exact: true })).toBeVisible();
    const team = filters.getByRole('combobox', { name: 'Equipe', exact: true });
    const service = filters.getByRole('combobox', { name: 'Serviço', exact: true });
    await team.selectOption({ label: await result.locator('dd').nth(0).innerText() });
    const serviceId = await service.locator('option').nth(1).getAttribute('value');
    await service.selectOption(serviceId!);
    await expect(result).toBeVisible();
    const original = new URL(page.url());
    await result.getByRole('link', { name: 'Abrir conferência de AG-DEMO-220', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Conferência dos participantes', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar às pendências', exact: true }).click();
    await expect(page).toHaveURL(original.href);
    await expect(search).toHaveValue('Bruno');
    await expect(team).toHaveValue(original.searchParams.get('teamId')!);
    await expect(service).toHaveValue(serviceId!);
    await filters.getByRole('button', { name: 'Remover filtro: Serviço', exact: true }).click();
    original.searchParams.delete('serviceTypeId');
    await expect(page).toHaveURL(original.href);
    await expect(search).toBeFocused();
    await filters.getByRole('button', { name: 'Remover filtro: Situação documental', exact: true }).click();
    await expect(filters.getByRole('combobox', { name: 'Situação documental', exact: true })).toHaveValue('all');
    expect(new URL(page.url()).searchParams.get('status')).toBe('all');
    await expect(result.getByRole('heading', { name: 'Bruno Demo', exact: true })).toBeVisible();
    await filters.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(team).toHaveValue('');
    await expect(service).toHaveValue('');
    await expect(filters.getByRole('combobox', { name: 'Situação documental', exact: true })).toHaveValue('pending');
    expect([...new URL(page.url()).searchParams.keys()]).toEqual(['unitId']);
    await expect(result).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar consulta CSV', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('pendencias-documentais-DEMONSTRACAO.csv');
    expect(errors).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`pendencias-${width}.png`), fullPage: true });
  });
}

test('pendências preservam a origem também após consultar a integração pelo atendimento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/pendencias?q=Julia&status=pending');
  const result = page.getByRole('region', { name: 'Pendências de AG-DEMO-222', exact: true });
  await expect(result.getByRole('heading', { name: 'Julia Demo', exact: true })).toBeVisible();
  const origin = page.url();
  await result.getByRole('link', { name: 'Abrir conferência de AG-DEMO-222', exact: true }).click();
  const appointment = '/app/agenda/00000000-0000-4000-8000-000000000222';
  await expect(page).toHaveURL(appointment);
  // The old readiness screen has a link with the same label until the route commits.
  await expect(page.getByRole('heading', { name: 'Conferência dos participantes', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Consultar integração de Julia Demo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Integração administrativa do trabalhador', exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'Voltar ao atendimento', exact: true }).click();
  await expect(page).toHaveURL(appointment);
  await page.getByRole('link', { name: 'Voltar às pendências', exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByRole('searchbox', { name: 'Buscar pessoa ou atendimento', exact: true })).toHaveValue('Julia');
  await expect(result.getByRole('heading', { name: 'Julia Demo', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
