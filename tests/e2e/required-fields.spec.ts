import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, loginDemo, navigateWithinApp, openModule } from './helpers';

async function expectRequired(control: Locator) {
  await expect(control).toHaveAttribute('aria-required', 'true');
  // A obrigatoriedade é comunicada ao leitor de tela. A validação local
  // continua mostrando os erros do produto, sem bloquear o submit nativo.
  await expect(control).not.toHaveAttribute('required');
}

async function expectOptional(control: Locator) {
  await expect(control).not.toHaveAttribute('aria-required', 'true');
  await expect(control).not.toHaveAttribute('required');
}

async function expectAssociatedError(control: Locator, page: Page, message: string) {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const ids = await control.getAttribute('aria-describedby');
  expect(ids).toBeTruthy();
  const descriptions = await page.evaluate(value => value!.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()), ids);
  expect(descriptions).toContain(message);
}

for (const width of [320, 1440]) {
  test(`cadastro informa campos obrigatórios e preserva a validação local a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/workers')) writes.push(request.url());
    });
    await loginDemo(page, 'RH');
    await openModule(page, 'Trabalhadores');
    await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Nome completo *', exact: true });
    const registration = page.getByRole('textbox', { name: 'Matrícula *', exact: true });
    for (const label of ['Nome completo *', 'Matrícula *', 'Tipo de vínculo *', 'Data de admissão *', 'Empresa *', 'Unidade *', 'Setor *']) {
      await expectRequired(page.getByLabel(label, { exact: true }));
    }
    await expectOptional(page.getByRole('combobox', { name: 'Cargo', exact: true }));
    await expectOptional(page.getByRole('combobox', { name: 'Função', exact: true }));
    await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
    await expectAssociatedError(name, page, 'Informe o nome completo.');
    await expectAssociatedError(registration, page, 'Informe a matrícula.');
    await expectAssociatedError(page.getByRole('combobox', { name: 'Setor *', exact: true }), page, 'Selecione o setor.');
    expect(writes).toEqual([]);
    expect(await name.evaluate(input => (input as HTMLInputElement).validity.valueMissing)).toBe(false);

    await registration.fill(`E2E-OBRIGATORIO-${width}`);
    await name.fill('Pessoa sintética com nome corrigido');
    await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(registration).not.toHaveAttribute('aria-invalid', 'true');
    await expect(registration).toHaveValue(`E2E-OBRIGATORIO-${width}`);
    await expectAssociatedError(page.getByLabel('Tipo de vínculo *', { exact: true }), page, 'Informe o tipo de vínculo.');
    expect(writes).toEqual([]);
    await name.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`cadastro-campos-obrigatorios-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

test('arquivo obrigatório e justificativa mantêm descrições e erros associados na nova versão', async ({ page }, testInfo) => {
  await loginDemo(page);
  await createDocument(page, { title: 'Documento sintético de semântica obrigatória', code: 'E2E-OBRIGATORIO-DOC' });
  await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
  const file = page.getByLabel('Arquivo da versão *', { exact: true });
  const reason = page.getByRole('textbox', { name: 'Justificativa da versão *', exact: true });
  await expect(file).toHaveAccessibleDescription(/Campo obrigatório\./);
  await expect(file).not.toHaveAttribute('aria-required', 'true');
  await expect(file).not.toHaveAttribute('required');
  await expectRequired(reason);
  await expectRequired(page.getByRole('combobox', { name: 'Tipo documental *', exact: true }));
  await expectOptional(page.getByRole('combobox', { name: 'Setor', exact: true }));
  await expectOptional(page.getByLabel('Palavras-chave (separadas por vírgula)', { exact: true }));
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/documents\/[^/]+\/versions$/.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
  await expectAssociatedError(file, page, 'Selecione um arquivo.');
  await expect(file).toHaveAccessibleDescription(/Campo obrigatório\./);
  await expectAssociatedError(reason, page, 'Informe a justificativa desta versão.');
  expect(writes).toEqual([]);
  await file.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('nova-versao-arquivo-obrigatorio.png') });
});

test('a preparação parcial da PT continua salvável sem obrigatoriedade de liberação no rascunho', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await loginDemo(page, 'Técnico de segurança');
  const permitPath = await page.evaluate(async () => {
    const source = '/src/shared/api/client.ts';
    const { api, revisionEtag } = await import(source);
    const appointmentId = '00000000-0000-4000-8000-000000000221';
    const appointment = await api.get(`/appointments/${appointmentId}`);
    const permit = await api.post(`/appointments/${appointmentId}/open-permit`, {}, { etag: revisionEtag(appointment.revision) });
    return `/app/pts/${permit.id}`;
  });
  await navigateWithinApp(page, permitPath);
  const preparation = page.getByRole('region', { name: 'Preparação do modelo PT', exact: true });
  const supplier = preparation.getByLabel('Fornecedor de serviço', { exact: true });
  const activity = preparation.getByLabel('Atividade a ser realizada', { exact: true });
  await expectOptional(supplier);
  await expectOptional(activity);
  await supplier.fill('Fornecedor fictício no rascunho parcial');
  const operationalWrites: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/work-permits\/[^/]+\/(release|start|sciences)$/.test(new URL(request.url()).pathname)) operationalWrites.push(request.url());
  });
  const saved = page.waitForResponse(response => response.url().endsWith('/preparation') && response.request().method() === 'PATCH' && response.ok());
  await preparation.getByRole('button', { name: 'Salvar preparação da PT', exact: true }).click();
  await saved;
  await expect(preparation.getByRole('button', { name: 'Salvar preparação da PT', exact: true })).toBeDisabled();
  await expect(supplier).toHaveValue('Fornecedor fictício no rascunho parcial');
  await expect(activity).toHaveValue('');
  await expect(activity).not.toHaveAttribute('aria-invalid', 'true');
  expect(operationalWrites).toEqual([]);
});
