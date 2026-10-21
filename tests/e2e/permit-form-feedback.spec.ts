import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const appointmentId = '00000000-0000-4000-8000-000000000221';

async function openDraft(page: Page) {
  const fixture = await page.evaluate(async id => {
    const clientUrl = '/src/shared/api/client.ts';
    const sourceUrl = '/src/features/permits/templates/ri-s-36001.ts';
    const { api, revisionEtag } = await import(clientUrl);
    const { PT_ACTIVITIES } = await import(sourceUrl);
    const appointment = await api.get(`/appointments/${id}`);
    const permit = await api.post(`/appointments/${id}/open-permit`, {}, { etag: revisionEtag(appointment.revision) });
    const firstHeightCheck = permit.preparation.checks.find((item: { section: string }) => item.section === 'height');
    return {
      path: `/app/pts/${permit.id}`,
      heightLabel: PT_ACTIVITIES.find((item: { id: string }) => item.id === 'height').label,
      firstHeightCheck,
    };
  }, appointmentId);
  await navigateWithinApp(page, fixture.path);
  await expect(page.getByRole('region', { name: 'Preparação do modelo PT', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return fixture;
}

async function expectDescribedError(control: Locator, page: Page) {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const description = await control.getAttribute('aria-describedby');
  expect(description).toBeTruthy();
  const texts = await page.evaluate(ids => ids!.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || ''), description);
  expect(texts.some(text => text.length > 0)).toBe(true);
}

for (const width of [320, 1440]) {
  test(`pendências da PT levam ao campo e preservam o rascunho a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const writes: { method: string; path: string }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && /\/work-permits\/[^/]+\/(preparation|checklist|release|start|sciences)$/.test(path)) {
        writes.push({ method: request.method(), path });
      }
    });
    await loginDemo(page, 'Técnico de segurança');
    const fixture = await openDraft(page);
    const preparation = page.getByRole('region', { name: 'Preparação do modelo PT', exact: true });
    const supplier = preparation.getByLabel('Fornecedor de serviço', { exact: true });
    const activity = preparation.getByLabel('Atividade a ser realizada', { exact: true });
    const supplierDraft = 'Fornecedor fictício preservado durante a conferência';
    await supplier.fill(supplierDraft);
    await preparation.getByRole('button', { name: 'Conferir preenchimento', exact: true }).click();
    const summary = preparation.getByRole('region', { name: 'Pendências da preparação', exact: true });
    await expect(summary).toBeVisible();
    await expect(activity).toBeFocused();
    await expectDescribedError(activity, page);
    await expect(supplier).toHaveValue(supplierDraft);
    expect(writes).toEqual([]);
    await supplier.focus();
    await summary.getByRole('button').first().click();
    await expect(activity).toBeFocused();
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`pt-preparacao-pendencias-${width}.png`) });
    await activity.fill('Descrição fictícia da manutenção planejada para conferência.');

    // A conferência de completude orienta o preenchimento. Salvar continua
    // permitindo rascunhos, mas respostas Não/NA exigem justificativa.
    await preparation.getByRole('checkbox', { name: fixture.heightLabel, exact: true }).check();
    const firstQuestion = preparation.getByRole('group', { name: `1. ${fixture.firstHeightCheck.label}`, exact: true });
    await firstQuestion.getByRole('radio', { name: 'Não aplicável', exact: true }).check();
    const note = firstQuestion.getByLabel(`Justificativa: ${fixture.firstHeightCheck.label}`, { exact: true });
    const details = preparation.locator('details').filter({ has: page.getByRole('group', { name: `1. ${fixture.firstHeightCheck.label}`, exact: true, includeHidden: true }) });
    await details.locator('summary').click();
    await expect(details).not.toHaveAttribute('open', '');
    await preparation.getByRole('button', { name: 'Salvar preparação da PT', exact: true }).click();
    await expect(note).toBeFocused();
    await expect(details).toHaveAttribute('open', '');
    await expectDescribedError(note, page);
    await expect(summary).toBeVisible();
    expect(writes).toEqual([]);
    await expect(supplier).toHaveValue(supplierDraft);
    const justification = 'Não se aplica ao escopo fictício; registrar a análise da equipe.';
    await note.fill(justification);
    const preparationSaved = page.waitForResponse(response => response.url().endsWith('/preparation') && response.request().method() === 'PATCH' && response.ok());
    await preparation.getByRole('button', { name: 'Salvar preparação da PT', exact: true }).click();
    await preparationSaved;
    await expect(preparation.getByRole('button', { name: 'Salvar preparação da PT', exact: true })).toBeDisabled();
    await expect(supplier).toHaveValue(supplierDraft);
    await expect(note).toHaveValue(justification);
    expect(writes.filter(write => write.path.endsWith('/preparation'))).toHaveLength(1);
    expect(writes.some(write => /\/(release|start|sciences)$/.test(write.path))).toBe(false);

    const checklist = page.getByRole('region', { name: 'Conferência do atendimento', exact: true });
    const items = checklist.getByRole('group');
    await expect(items).toHaveCount(3);
    await items.nth(1).getByRole('radio', { name: 'Sim', exact: true }).check();
    await checklist.getByRole('button', { name: 'Salvar checklist', exact: true }).click();
    const checklistSummary = checklist.getByRole('region', { name: 'Pendências do checklist', exact: true });
    await expect(checklistSummary).toBeVisible();
    const firstAnswer = items.first().getByRole('radio', { name: 'Sim', exact: true });
    await expect(firstAnswer).toBeFocused();
    await expectDescribedError(firstAnswer, page);
    expect(writes.filter(write => write.path.endsWith('/checklist'))).toEqual([]);
    await expect(items.nth(1).getByRole('radio', { name: 'Sim', exact: true })).toBeChecked();
    await firstAnswer.check();
    await items.first().getByRole('radio', { name: 'Não', exact: true }).check();
    await checklist.getByRole('button', { name: 'Salvar checklist', exact: true }).click();
    const observation = items.first().getByLabel('Observação do item 1', { exact: true });
    await expect(observation).toBeFocused();
    await expectDescribedError(observation, page);
    await expect(checklistSummary).toBeVisible();
    expect(writes.filter(write => write.path.endsWith('/checklist'))).toEqual([]);
    await expect(supplier).toHaveValue(supplierDraft);
    await expect(note).toHaveValue(justification);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pt-checklist-pendencias-viewport-${width}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`pt-pendencias-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
