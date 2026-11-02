import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test.use({ timezoneId: 'Asia/Tokyo' });

async function openRequestedCalendar(page: Page) {
  await loginDemo(page);
  await navigateWithinApp(page, '/app/agenda?view=calendar&status=REQUESTED&q=AG-DEMO-222&location=%C3%81rea');
  await expect(page.getByRole('grid', { name: /^Calendário de/ })).toBeVisible();
  await expect(page.getByRole('grid').getByRole('link', { name: /^AG-DEMO-222:/ })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('calendário mensal e semanal preserva filtros, período e dia ao consultar e voltar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openRequestedCalendar(page);
  const grid = page.getByRole('grid');
  const selectedName = await grid.getByRole('button', { pressed: true }).getAttribute('aria-label');
  const originalMonth = await grid.getAttribute('aria-label');
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  await expect(grid).not.toHaveAttribute('aria-label', originalMonth!);
  await page.getByRole('button', { name: 'Mês anterior', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-label', originalMonth!);
  await grid.getByRole('button', { name: selectedName!, exact: true }).click();
  await page.getByRole('button', { name: 'Semanal', exact: true }).click();
  await expect(grid.getByRole('gridcell')).toHaveCount(7);
  const originalWeek = await grid.getAttribute('aria-label');
  await page.getByRole('button', { name: 'Próxima semana', exact: true }).click();
  await expect(grid).not.toHaveAttribute('aria-label', originalWeek!);
  await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-label', originalWeek!);
  const beforeDetail = page.url();
  await grid.getByRole('link', { name: /^AG-DEMO-222:/ }).click();
  await expect(page.getByRole('heading', { name: 'Dados do atendimento' })).toBeVisible();
  await expect(page.getByText('Horário solicitado pela equipe')).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à agenda' }).click();
  await expect(page).toHaveURL(beforeDetail);
  await expect(grid).toHaveAttribute('aria-label', originalWeek!);
  await expect(grid.getByRole('button', { name: selectedName!, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Buscar atendimento')).toHaveValue('AG-DEMO-222');
  await expect(page.getByLabel('Local do serviço')).toHaveValue('Área');
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(grid).toHaveAttribute('aria-label', originalWeek!);
  expect(new URL(page.url()).searchParams.get('calendarMode')).toBe('week');
  expect(new URL(page.url()).searchParams.has('status')).toBe(false);
  expect(errors).toEqual([]);
});

test('confirma o horário editado preservando a solicitação original e o histórico', async ({ page }) => {
  await openRequestedCalendar(page);
  await page.getByRole('grid').getByRole('link', { name: /^AG-DEMO-222:/ }).click();
  const requested = page.getByText('Horário solicitado pela equipe').locator('..');
  const originalPeriod = await requested.locator('strong').innerText();
  await page.getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const originalStart = await dialog.getByLabel('Início confirmado *', { exact: true }).inputValue();
  const civilDay = originalStart.slice(0, 10);
  await dialog.getByLabel('Início confirmado *', { exact: true }).fill(`${civilDay}T10:15`);
  await dialog.getByLabel('Término confirmado *', { exact: true }).fill(`${civilDay}T11:15`);
  await dialog.getByLabel('Observação da confirmação (opcional)').fill('Janela operacional ajustada no teste de agenda.');
  await dialog.getByRole('button', { name: 'Confirmar agendamento', exact: true }).click();
  await expect(page.getByText('Agendamento confirmado.', { exact: true })).toBeVisible();
  await expect(requested.locator('strong')).toHaveText(originalPeriod);
  const operational = page.getByText('Horário operacional confirmado').locator('..');
  await expect(operational).toContainText('10:15');
  await expect(operational).toContainText('11:15');
  await expect(operational).toContainText('Ajustado na confirmação');
  await expect(page.getByText(/Janela operacional ajustada no teste de agenda\./)).toBeVisible();
});

for (const width of [320, 390]) {
  test(`calendário funciona com teclado e sem overflow em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openRequestedCalendar(page);
    await expectNoHorizontalOverflow(page);
    const grid = page.getByRole('grid');
    const selected = grid.getByRole('button', { pressed: true });
    const originalName = await selected.getAttribute('aria-label');
    await selected.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(grid.getByRole('button', { pressed: true })).not.toHaveAttribute('aria-label', originalName!);
    await expect(grid.getByRole('button', { pressed: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(grid.getByRole('button', { name: originalName!, exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Semanal', exact: true }).click();
    await expect(grid.getByRole('gridcell')).toHaveCount(7);
    await expectNoHorizontalOverflow(page);
    await grid.getByRole('link', { name: /^AG-DEMO-222:/ }).click();
    await expect(page.getByRole('heading', { name: 'Dados do atendimento' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('link', { name: 'Voltar à agenda' }).click();
    await expect(grid.getByRole('gridcell')).toHaveCount(7);
    await page.getByRole('button', { name: 'Hoje', exact: true }).click();
    const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
    expect(new URL(page.url()).searchParams.get('day')).toBe(today);
    await expectNoHorizontalOverflow(page);
  });
}
