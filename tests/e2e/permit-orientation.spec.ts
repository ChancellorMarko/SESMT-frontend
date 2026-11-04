import { expect, test, type Page } from '@playwright/test';
import { loginDemo, logout, openModule } from './helpers';

const appointmentId = '00000000-0000-4000-8000-000000000221';
const sections = [
  ['Preparação', 'preparacao'],
  ['Checklist', 'conferencia'],
  ['Requisitos', 'requisitos'],
  ['Ciências', 'ciencias'],
  ['Designação', 'designacao'],
  ['Liberação e execução', 'operacao'],
  ['Interrupção e retomada', 'interrupcao'],
  ['Anexos', 'anexos'],
  ['Encerramento', 'encerramento'],
  ['Revisão final', 'revisao'],
  ['Histórico', 'historico'],
] as const;

async function createDraft(page: Page) {
  return page.evaluate(async id => {
    const clientUrl = '/src/shared/api/client.ts';
    const { api, revisionEtag } = await import(clientUrl);
    const appointment = await api.get(`/appointments/${id}`);
    const permit = await api.post(`/appointments/${id}/open-permit`, {}, { etag: revisionEtag(appointment.revision) });
    return { code: permit.code, path: `/app/pts/${permit.id}` };
  }, appointmentId);
}

async function openPermit(page: Page, code: string) {
  // Use the same links as the user so browser history retains React Router's state.
  await openModule(page, 'Permissões de trabalho');
  await page.getByRole('link', { name: code, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Orientação da PT', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

function observeNavigation(page: Page) {
  const writes: string[] = [];
  const dialogs: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && new URL(request.url()).pathname.includes('/work-permits/')) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  page.on('pageerror', error => errors.push(error.message));
  return { writes, dialogs, errors };
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [320, 1440]) {
  test(`orientação e seções da PT preservam o rascunho e o foco a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const observed = observeNavigation(page);
    await loginDemo(page, 'Técnico de segurança');
    const permit = await createDraft(page);
    await openPermit(page, permit.code);
    const orientation = page.getByRole('region', { name: 'Orientação da PT', exact: true });
    await expect(orientation.getByRole('heading', { name: 'O que fazer agora', exact: true })).toBeVisible();
    await expect(orientation.getByRole('link')).toHaveCount(1);
    await expect(orientation.getByRole('link')).toHaveAttribute('href', '#preparacao');
    await expect(page.getByRole('navigation', { name: 'Etapas da PT', exact: true })).toHaveCount(0);
    await page.getByText('Ir para uma seção da PT', { exact: true }).click();
    const navigation = page.getByRole('navigation', { name: 'Seções da PT', exact: true });
    await expect(navigation.getByRole('link')).toHaveCount(sections.length);
    expect((await navigation.getByRole('link').allTextContents()).map(text => text.trim())).toEqual(sections.map(([label]) => label));

    const supplier = page.getByRole('region', { name: 'Preparação do modelo PT', exact: true }).getByLabel('Fornecedor de serviço', { exact: true });
    const draft = `Fornecedor fictício preservado ao navegar em ${width}px`;
    await supplier.fill(draft);
    await orientation.getByRole('link').first().click();
    await expect(page.locator('#preparacao').getByRole('heading', { level: 2 }).first()).toBeFocused();
    await expect(supplier).toHaveValue(draft);

    for (const [index, [label, anchor]] of sections.entries()) {
      const link = navigation.getByRole('link', { name: label, exact: true });
      await expect(link).toHaveAttribute('href', `#${anchor}`);
      await expect(page.locator(`[id="${anchor}"]`)).toHaveCount(1);
      // Alternate pointer and keyboard activation while the preparation is dirty.
      if (index % 2) { await link.focus(); await page.keyboard.press('Enter'); }
      else await link.click();
      const heading = page.locator(`#${anchor}`).getByRole('heading', { level: 2 }).first();
      await expect(heading).toBeFocused();
      await expect(heading).not.toHaveText(/^\d+\./);
      await expect(supplier).toHaveValue(draft);
      expect(new URL(page.url()).pathname).toBe(permit.path);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expectNoOverflow(page);
    }
    await orientation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`pt-orientacao-${width}.png`) });
    await navigation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`pt-secoes-${width}.png`) });
    expect(observed.writes).toEqual([]);
    expect(observed.dialogs).toEqual([]);
    expect(observed.errors).toEqual([]);
  });
}

test('engenheiro consulta a preparação sem receber ação de liberação', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const observed = observeNavigation(page);
  await loginDemo(page, 'Técnico de segurança');
  const permit = await createDraft(page);
  await logout(page);
  await page.getByRole('button', { name: 'Engenheiro', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await openPermit(page, permit.code);
  const orientation = page.getByRole('region', { name: 'Orientação da PT', exact: true });
  await expect(orientation).toContainText(/consulte|consulta|consultar/i);
  await expect(orientation.getByRole('link')).toHaveCount(1);
  const primary = orientation.getByRole('link');
  await expect(primary).toHaveAttribute('href', '#preparacao');
  await primary.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#preparacao').getByRole('heading', { level: 2 }).first()).toBeFocused();
  await expect(page.getByLabel('Fornecedor de serviço', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Liberar execução', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrar início da execução', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Salvar (preparação da PT|checklist)$/ })).toHaveCount(0);
  await page.getByText('Ir para uma seção da PT', { exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Seções da PT', exact: true });
  await expect(navigation.getByRole('link', { name: 'Interrupção e retomada', exact: true })).toHaveCount(0);
  await expect(page.locator('#interrupcao')).toHaveCount(0);
  await expectNoOverflow(page);
  await orientation.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pt-orientacao-consulta-320.png') });
  expect(observed.writes).toEqual([]);
  expect(observed.dialogs).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('engenheiro recebe orientação para revisar a versão concluída sem executá-la', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const observed = observeNavigation(page);
  await loginDemo(page, 'Engenheiro');
  await openPermit(page, 'PT-DEMO-230');
  const orientation = page.getByRole('region', { name: 'Orientação da PT', exact: true });
  await expect(orientation).toContainText(/revisão|revisar/i);
  await expect(orientation.getByRole('link')).toHaveCount(1);
  const primary = orientation.getByRole('link');
  await expect(primary).toHaveAttribute('href', '#revisao');
  await orientation.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pt-orientacao-revisao-1440.png') });
  await primary.focus(); await page.keyboard.press('Enter');
  const review = page.locator('#revisao');
  await expect(review.getByRole('heading', { level: 2 }).first()).toBeFocused();
  await expect(review.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Liberar execução', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrar início da execução', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectNoOverflow(page);
  expect(observed.writes).toEqual([]);
  expect(observed.dialogs).toEqual([]);
  expect(observed.errors).toEqual([]);
});
