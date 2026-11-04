import { expect, test } from '@playwright/test';
import type { AppointmentDto } from '../../src/shared/contracts/work-permits';
import { loginDemo, logout, navigateWithinApp } from './helpers';

const unitA = '00000000-0000-4000-8000-000000000002';
const unitB = '00000000-0000-4000-8000-000000000003';

test('PT consulta 25 atendimentos por páginas, preserva os filtros no retorno e isola outra unidade', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page);
  const appointments = await page.evaluate(async unitId => {
    const modulePath = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(modulePath);
    const results: { id: string; revision: number }[] = [];
    for (let batch = 0; batch < 5; batch++) {
      const items = await Promise.all(Array.from({ length: 5 }, async (_, item) => {
        const sequence = batch * 5 + item + 1;
        const input = {
          unitId, teamId: '00000000-0000-4000-8000-000000000200', serviceTypeId: '00000000-0000-4000-8000-000000000210', serviceTypeIds: ['00000000-0000-4000-8000-000000000210'],
          location: `Lote paginação PT ${String(sequence).padStart(2, '0')}`, responsibleId: '00000000-0000-4000-8000-000000000025',
          startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(),
          participants: [{ workerId: '00000000-0000-4000-8000-000000000040', name: 'Camila Demo', serviceFunction: 'Executante' }],
        };
        const created = await api.post('/appointments', input) as AppointmentDto;
        const confirmed = await api.post(`/appointments/${created.id}/confirm`, {}, { etag: revisionEtag(created.revision) }) as AppointmentDto;
        return { id: confirmed.id, revision: confirmed.revision };
      }));
      results.push(...items);
    }
    return results;
  }, unitA);
  await logout(page);
  await page.getByRole('button', { name: 'Técnico de segurança', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await page.evaluate(async records => {
    const modulePath = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(modulePath);
    for (const appointment of records) await api.post(`/appointments/${appointment.id}/open-permit`, {}, { etag: revisionEtag(appointment.revision) });
  }, appointments);
  const requests: URL[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && url.pathname === '/api/v1/work-permits') requests.push(url); });
  const q = 'Lote paginacao PT';
  await navigateWithinApp(page, `/app/pts?unitId=${unitA}&q=${encodeURIComponent(q)}&operationStatus=VERIFICATION&page=3`);
  const results = page.getByRole('region', { name: 'Permissões de trabalho encontradas', exact: true });
  await expect(results.getByRole('link', { name: 'Consultar PT', exact: true })).toHaveCount(5);
  await expect(page.getByRole('navigation', { name: 'Paginação de PTs', exact: true })).toContainText('Página 3 de 3');
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  const sourceUrl = page.url();
  await results.getByRole('link', { name: 'Consultar PT', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Conferência do atendimento', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar às PTs', exact: true }).click();
  await expect(page).toHaveURL(sourceUrl);
  await expect(results.getByRole('link', { name: 'Consultar PT', exact: true })).toHaveCount(5);
  await page.getByRole('searchbox', { name: 'Buscar PT', exact: true }).fill('Rascunho não aplicado');
  await page.getByRole('combobox', { name: 'Revisão do encerramento', exact: true }).selectOption('NOT_SUBMITTED');
  await expect(page.getByRole('navigation', { name: 'Paginação de PTs', exact: true })).toContainText('Página 1 de 3');
  await expect(page.getByRole('searchbox', { name: 'Buscar PT', exact: true })).toHaveValue('Rascunho não aplicado');
  expect(new URL(page.url()).searchParams.get('q')).toBe(q); expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await results.getByRole('table', { name: 'Permissões de trabalho' }).getByRole('row').nth(1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`lista-pt-${width}.png`), animations: 'disabled' });
  }
  const before = requests.length;
  await navigateWithinApp(page, `/app/pts?unitId=${unitA}&q=${encodeURIComponent(q)}&operationStatus=UNKNOWN`);
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeDisabled();
  await expect(results).toHaveCount(0); expect(requests).toHaveLength(before);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(results).toBeVisible();
  await page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true }).selectOption(unitB);
  await expect(page.getByRole('heading', { name: 'Nenhuma PT encontrada', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('unitId')).toBe(unitB); expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  expect(requests.every(url => url.searchParams.get('pageSize') === '10')).toBe(true);
  expect(errors).toEqual([]);
});

