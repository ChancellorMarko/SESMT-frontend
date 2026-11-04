import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
for (const width of [320, 390]) {
  test(`classificação explícita de empresas e filtros preservam os vínculos a ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 }); await loginDemo(page);
    await navigateWithinApp(page, '/app/organizacao');
    await page.getByRole('button', { name: /^Empresas \(/ }).click();
    const registers = page.getByRole('region', { name: 'Cadastros organizacionais', exact: true });
    const companyRow = registers.getByRole('row').filter({ hasText: 'Organização Exemplo' });
    await expect(companyRow).toContainText('Interna');
    await page.getByRole('button', { name: 'Cadastrar empresa', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Cadastrar empresa', exact: true });
    await form.getByLabel('Nome *', { exact: true }).fill(`Prestadora de teste ${width}px`);
    await form.getByLabel('CNPJ *', { exact: true }).fill('00.000.000/0000-00');
    await expect(form.getByLabel('Classificação da empresa *', { exact: true })).toHaveValue('');
    const attempts: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/companies') attempts.push(request.postDataJSON());
    });
    await form.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
    await expect(form.getByText('Selecione se a empresa é interna ou prestadora de serviços.', { exact: true })).toBeVisible();
    expect(attempts).toEqual([]);
    await form.getByLabel('Classificação da empresa *', { exact: true }).selectOption('SERVICE_PROVIDER');
    await expectNoOverflow(page);
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/companies');
    await form.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.ok()).toBe(true);
    expect(await createdResponse.json()).toMatchObject({ name: `Prestadora de teste ${width}px`, classification: 'SERVICE_PROVIDER' });
    await expect(form).toHaveCount(0);
    await expect(page.getByText('Cadastro organizacional salvo.', { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(1); expect(attempts[0]).toMatchObject({ classification: 'SERVICE_PROVIDER' });

    // The granted company is edited; creating another company does not enlarge access.
    await companyRow.getByRole('button', { name: 'Editar Organização Exemplo', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Editar empresa', exact: true });
    await expect(edit.getByLabel('Classificação da empresa *', { exact: true })).toHaveValue('INTERNAL');
    await edit.getByLabel('Classificação da empresa *', { exact: true }).selectOption('SERVICE_PROVIDER');
    await edit.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
    await expect(edit).toHaveCount(0); await expect(companyRow).toContainText('Prestadora de serviços');
    const filter = page.getByLabel('Filtrar empresas por classificação', { exact: true });
    await filter.selectOption('INTERNAL'); await expect(companyRow).toHaveCount(0);
    await filter.selectOption('SERVICE_PROVIDER'); await expect(companyRow).toBeVisible();
    await filter.selectOption('UNSPECIFIED'); await expect(companyRow).toHaveCount(0);
    await filter.selectOption('ALL'); await expect(companyRow).toBeVisible();
    await expectNoOverflow(page);
    await page.getByRole('button', { name: /^Unidades \(/ }).click();
    await expect(registers.getByRole('row').filter({ hasText: 'Unidade Matriz' })).toBeVisible();
    await expect(registers.getByRole('row').filter({ hasText: 'Unidade Operacional' })).toBeVisible();
    await expectNoOverflow(page); expect(errors).toEqual([]);
  });
}
