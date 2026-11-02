import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test.use({ timezoneId: 'Asia/Tokyo' });

async function operationalToday(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
}

for (const width of [320, 390, 1440]) {
  test(`períodos rápidos e ordenação preservam a consulta a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [], writes: string[] = [], reads: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/appointments' && request.method() === 'GET') reads.push(request.url());
      if (request.method() === 'POST' && /\/api\/v1\/(appointments|work-permits)/.test(path)) writes.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, '/app/agenda?q=AG-DEMO&status=CONFIRMED');
    const table = page.getByRole('table', { name: 'Atendimentos da agenda', exact: true });
    await expect(table).toBeVisible();
    const requests = reads.length;
    await page.getByLabel('Ordenar atendimentos', { exact: true }).selectOption('START_DESC');
    await expect(page.getByLabel('Ordenar atendimentos', { exact: true })).toHaveValue('START_DESC');
    expect(reads).toHaveLength(requests);
    const dates = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => row.querySelector('time')?.getAttribute('datetime') || ''));
    expect(dates.length).toBeGreaterThan(1);
    expect(dates.map(Date.parse)).toEqual(dates.map(Date.parse).sort((a, b) => b - a));
    await page.getByRole('button', { name: 'Filtrar agenda para hoje', exact: true }).click();
    const today = await operationalToday(page);
    await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe(today);
    expect(new URL(page.url()).searchParams.get('to')).toBe(today);
    await page.getByRole('button', { name: 'Filtrar agenda para os próximos 7 dias, incluindo hoje', exact: true }).click();
    const last = new Date(`${today}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 6);
    await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe(last.toISOString().slice(0, 10));
    await expect(table).toBeVisible();
    const quick = page.getByRole('group', { name: 'Períodos rápidos da agenda', exact: true });
    await expect(quick.getByRole('button', { name: /próximos 7 dias/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Filtros avançados/ })).toHaveAttribute('aria-expanded', 'false');
    await page.getByLabel('Ordenar atendimentos', { exact: true }).selectOption('TEAM');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`agenda-planejamento-${width}.png`), fullPage: true });
    const original = page.url();
    await table.getByRole('link', { name: 'Consultar atendimento', exact: true }).first().click();
    await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
    await expect(page).toHaveURL(original);
    await expect(page.getByLabel('Ordenar atendimentos', { exact: true })).toHaveValue('TEAM');
    await expect(page.getByLabel('Situação do agendamento', { exact: true })).toHaveValue('CONFIRMED');
    await page.getByRole('button', { name: 'Consultar agenda sem limite de período', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has('from')).toBe(false);
    expect(new URL(page.url()).searchParams.has('to')).toBe(false);
    expect(new URL(page.url()).searchParams.get('status')).toBe('CONFIRMED');
    expect(new URL(page.url()).searchParams.get('order')).toBe('TEAM');
    expect(errors).toEqual([]); expect(writes).toEqual([]);
  });
}

test('atalho de hoje alinha o calendário semanal ao fuso operacional e conserva filtros', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, '/app/agenda?view=calendar&calendarMode=week&calendarDate=2026-01-01&day=2026-01-02&status=REQUESTED&q=AG-DEMO');
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Filtrar agenda para hoje', exact: true }).click();
  const today = await operationalToday(page);
  await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe(today);
  expect(new URL(page.url()).searchParams.get('calendarDate')).toBe(today);
  expect(new URL(page.url()).searchParams.get('calendarMode')).toBe('week');
  expect(new URL(page.url()).searchParams.get('status')).toBe('REQUESTED');
  await expect(page.getByRole('grid').getByRole('gridcell')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ordenação incompatível exige correção antes da consulta', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  const reads: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/appointments') reads.push(request.url()); });
  await navigateWithinApp(page, '/app/agenda?q=AG-DEMO&order=TEAM&order=START_DESC');
  await expect(page.getByRole('heading', { name: 'Corrija os filtros da agenda', exact: true })).toBeVisible();
  expect(reads).toEqual([]);
  await page.getByLabel('Ordenar atendimentos', { exact: true }).selectOption('TEAM');
  await expect(page.getByRole('table', { name: 'Atendimentos da agenda', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll('order')).toEqual(['TEAM']);
  expect(new URL(page.url()).searchParams.get('q')).toBe('AG-DEMO');
});
