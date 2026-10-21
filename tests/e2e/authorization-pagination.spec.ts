import { expect, test } from '@playwright/test';
import { openModule, loginDemo, navigateWithinApp } from './helpers';

test('AT consulta além de 25 registros por páginas e preserva a origem após imprimir', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const unitId = '00000000-0000-4000-8000-000000000002';
  await page.evaluate(async unit => {
    const clientPath = '/src/shared/api/client.ts', modelPath = '/src/features/authorizations/model.ts';
    const { api, revisionEtag } = await import(clientPath); const { createAuthorizationPreparation } = await import(modelPath);
    const appointment = await api.get('/appointments/00000000-0000-4000-8000-000000000221');
    for (let index = 0; index < 26; index++) {
      const created = await api.post('/work-authorizations', { appointmentId: appointment.id, ...createAuthorizationPreparation(appointment) }, { query: { unitId: unit } });
      await api.post(`/work-authorizations/${created.id}/cancel`, { reason: 'Cancelamento sintético para a massa de paginação.', confirmed: true }, { query: { unitId: unit }, etag: revisionEtag(created.revision) });
    }
  }, unitId);
  const requests: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/v1/work-authorizations' && request.method() === 'GET') requests.push(url.search); });
  await navigateWithinApp(page, `/app/ats?unitId=${unitId}&page=3&status=CANCELED`);
  const results = page.getByRole('region', { name: 'Resultados de ATs', exact: true });
  await expect(results.getByRole('link', { name: /^Consultar AT-DEMO-/ })).toHaveCount(6);
  await expect(results).toContainText('26 AT(s) · página 3 de 3');
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Anterior', exact: true })).toBeEnabled();
  const sourceUrl = page.url();
  await results.getByRole('link', { name: /^Consultar AT-DEMO-/ }).first().click();
  await page.getByRole('link', { name: 'Imprimir AT', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Registro imprimível da AT', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à AT', exact: true }).click();
  await page.getByRole('link', { name: 'Voltar às ATs', exact: true }).click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(results.getByRole('link', { name: /^Consultar AT-DEMO-/ })).toHaveCount(6);
  await page.getByLabel('Pesquisar AT', { exact: true }).fill('AT-DEMO-026');
  await expect(results.getByRole('link', { name: 'Consultar AT-DEMO-026', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(requests.every(search => new URLSearchParams(search).get('pageSize') === '10')).toBe(true);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('auditor consulta e pesquisa políticas sem receber ações de edição', async ({ page }) => {
  await loginDemo(page, 'Auditor');
  await openModule(page, 'Parâmetros');
  await expect(page.getByRole('heading', { name: 'Parâmetros documentais', exact: true })).toBeVisible();
  await expect(page.getByRole('article').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Gerenciar políticas/ })).toHaveCount(0);
});
