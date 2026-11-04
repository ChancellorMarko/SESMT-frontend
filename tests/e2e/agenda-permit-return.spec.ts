import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test.use({ timezoneId: 'Asia/Tokyo' });

// Existing read-only demo fixture: a completed PT awaiting review, linked to
// AG-DEMO-224. These journeys never open, release, edit or review a permit.
const appointmentCode = 'AG-DEMO-224';
const appointmentPath = '/app/agenda/00000000-0000-4000-8000-000000000224';
const permitPath = '/app/pts/00000000-0000-4000-8000-000000000230';
const agendaQuery = '?q=AG-DEMO-224&status=ATTENDANCE_OPENED&order=START_DESC';

function observeReadOnlyJourney(page: Page) {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
        /^\/api\/v1\/(appointments|work-permits|pts)(\/|$)/.test(new URL(request.url()).pathname)) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  return () => { expect(errors).toEqual([]); expect(writes).toEqual([]); };
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function openLinkedAppointmentList(page: Page) {
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, `/app/agenda${agendaQuery}`);
  const row = page.getByRole('table', { name: 'Atendimentos da agenda', exact: true })
    .getByRole('row').filter({ hasText: appointmentCode });
  await expect(row.getByRole('link', { name: 'Ver PT →', exact: true })).toBeVisible();
  return row;
}

async function expectRestoredAgenda(page: Page, original: string) {
  await expect(page).toHaveURL(original);
  await expect(page.getByLabel('Buscar atendimento', { exact: true })).toHaveValue(appointmentCode);
  await expect(page.getByLabel('Situação do agendamento', { exact: true })).toHaveValue('ATTENDANCE_OPENED');
  await expect(page.getByLabel('Ordenar atendimentos', { exact: true })).toHaveValue('START_DESC');
  await expectNoHorizontalOverflow(page);
}

for (const width of [320, 1440]) {
  test(`PT aberta pela lista retorna à agenda e ao atendimento em ${width}px`, async ({ page }, testInfo) => {
    const verifyReadOnlyJourney = observeReadOnlyJourney(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const row = await openLinkedAppointmentList(page);
    const original = page.url();
    await row.getByRole('link', { name: 'Ver PT →', exact: true }).click();
    await expect(page).toHaveURL(permitPath);
    const path = page.getByRole('navigation', { name: 'Caminho da PT', exact: true });
    await expect(path.getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('href', new URL(original).pathname + new URL(original).search);
    await expect(path.getByRole('link', { name: `Atendimento ${appointmentCode}`, exact: true })).toHaveAttribute('href', appointmentPath);
    await expect(path.getByText('PT-DEMO-230', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Voltar à agenda', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByText('Carregando informações…', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`pt-contexto-topo-${width}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`pt-contexto-agenda-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
    await expectRestoredAgenda(page, original);

    // The breadcrumb's intermediate destination must preserve the same list
    // query, even when the user originally entered the PT directly from it.
    await row.getByRole('link', { name: 'Ver PT →', exact: true }).click();
    await path.getByRole('link', { name: `Atendimento ${appointmentCode}`, exact: true }).click();
    await expect(page).toHaveURL(appointmentPath);
    await expect(page.getByRole('heading', { name: 'Dados do atendimento', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
    await expectRestoredAgenda(page, original);
    verifyReadOnlyJourney();
  });
}

test('PT aberta no dia selecionado preserva semana, período e filtros do calendário', async ({ page }) => {
  const verifyReadOnlyJourney = observeReadOnlyJourney(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  const row = await openLinkedAppointmentList(page);
  const startsAt = await row.locator('time').first().getAttribute('datetime');
  expect(startsAt).toBeTruthy();
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(startsAt!));
  await navigateWithinApp(page, `/app/agenda${agendaQuery}&view=calendar&calendarMode=week&calendarDate=${day}&day=${day}&from=${day}&to=${day}`);
  const grid = page.getByRole('grid', { name: /^Calendário semanal de / });
  await expect(grid.getByRole('gridcell')).toHaveCount(7);
  const selectedName = await grid.getByRole('button', { pressed: true }).getAttribute('aria-label');
  const periodName = await grid.getAttribute('aria-label');
  const selectedDay = page.getByRole('region', { name: /^Atendimentos em / });
  await expect(selectedDay.getByText(appointmentCode, { exact: true })).toBeVisible();
  const original = page.url();
  await selectedDay.getByRole('link', { name: 'Ver PT →', exact: true }).click();
  await expect(page).toHaveURL(permitPath);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
  await expectRestoredAgenda(page, original);
  await expect(grid).toHaveAttribute('aria-label', periodName!);
  await expect(grid.getByRole('gridcell')).toHaveCount(7);
  await expect(grid.getByRole('button', { name: selectedName!, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedDay.getByText(appointmentCode, { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('from')).toBe(day);
  expect(new URL(page.url()).searchParams.get('to')).toBe(day);
  verifyReadOnlyJourney();
});

test('atendimento, PT e impressão mantêm o caminho de volta após selecionar a versão do registro', async ({ page }) => {
  const verifyReadOnlyJourney = observeReadOnlyJourney(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  const row = await openLinkedAppointmentList(page);
  const original = page.url();
  await row.getByRole('link', { name: 'Consultar atendimento', exact: true }).click();
  await expect(page).toHaveURL(appointmentPath);
  await page.getByRole('link', { name: 'Acompanhar PT →', exact: true }).click();
  await expect(page).toHaveURL(permitPath);
  await expect(page.getByRole('link', { name: 'Voltar ao atendimento', exact: true })).toHaveAttribute('href', appointmentPath);
  await page.getByRole('link', { name: 'Visualizar / imprimir PT', exact: true }).click();
  await expect(page).toHaveURL(`${permitPath}/imprimir`);
  const document = page.getByRole('article', { name: 'Registro imprimível da PT', exact: true });
  await expect(document.getByText('PENDENTE DE REVISÃO', { exact: true }).first()).toBeVisible();
  await expect(document.getByText('DEMONSTRAÇÃO · DADOS FICTÍCIOS · SEM VALIDADE OPERACIONAL', { exact: true })).toBeVisible();
  // The seed contains only version 1. Selecting it explicitly exercises the
  // search-param update without manufacturing a historical business record.
  await page.getByLabel('Versão do registro', { exact: true }).selectOption('1');
  await expect.poll(() => new URL(page.url()).searchParams.get('version')).toBe('1');
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: 'Voltar à PT', exact: true }).click();
  await expect(page).toHaveURL(permitPath);
  const path = page.getByRole('navigation', { name: 'Caminho da PT', exact: true });
  await expect(path.getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('href', new URL(original).pathname + new URL(original).search);
  await page.getByRole('link', { name: 'Voltar ao atendimento', exact: true }).click();
  await expect(page).toHaveURL(appointmentPath);
  await expect(page.getByRole('heading', { name: 'Dados do atendimento', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
  await expectRestoredAgenda(page, original);
  verifyReadOnlyJourney();
});
