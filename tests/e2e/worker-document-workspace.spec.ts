import { expect, test } from '@playwright/test';
import { loginDemo, openModule, simplePdf } from './helpers';

test('consulta, edição e primeira versão retornam à página documental e à busca do trabalhador', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await page.evaluate(async () => {
    const modulePath = '/src/shared/api/client.ts';
    const { api } = await import(modulePath);
    for (let index = 1; index <= 6; index++) await api.post('/documents', {
      code: `UX-RETORNO-${index}`, title: `Evidência UX ${index}`, typeId: '00000000-0000-4000-8000-000000000061', companyId: '00000000-0000-4000-8000-000000000001', unitId: '00000000-0000-4000-8000-000000000002', ownerId: '00000000-0000-4000-8000-000000000020', accessClass: 'INTERNAL', issueDate: '2026-10-01', workerIds: ['00000000-0000-4000-8000-000000000040'], responsibleIds: [], keywords: [],
    });
  });
  await openModule(page, 'Trabalhadores');
  await page.getByLabel('Buscar nome ou matrícula', { exact: true }).fill('Camila');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  const listUrl = page.url();
  await page.getByLabel('Buscar nome ou matrícula', { exact: true }).fill('Ainda não pesquisado');
  await page.getByRole('link', { name: 'Camila Demo', exact: true }).click();
  const linked = page.getByRole('region', { name: 'Documentos vinculados', exact: true });
  await linked.getByRole('button', { name: 'Próximos documentos', exact: true }).click();
  await expect(linked).toContainText('Página 2');
  await linked.getByRole('link').first().click();
  const back = page.getByRole('link', { name: 'Voltar ao trabalhador', exact: true });
  await expect(back).toHaveAttribute('href', '/app/trabalhadores/00000000-0000-4000-8000-000000000040#documentos');
  await page.getByRole('link', { name: 'Editar metadados', exact: true }).click();
  await page.getByLabel('Título *', { exact: true }).fill('Evidência UX revisada');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evidência UX revisada', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Anexar primeiro arquivo', exact: true }).click();
  await page.getByLabel('Arquivo da versão *', { exact: true }).setInputFiles(simplePdf());
  await page.getByLabel('Justificativa da versão *', { exact: true }).fill('Primeiro arquivo da evidência de demonstração.');
  await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Versão 1', exact: true })).toBeVisible();
  await back.click();
  await expect(linked).toBeFocused();
  await expect(linked).toContainText('Página 2');
  await expect(linked.getByRole('link', { name: 'Evidência UX revisada', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à lista', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue('Ainda não pesquisado');
});

for (const width of [320, 390, 1440]) {
  test(`versões e retorno à pessoa funcionam a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    await openModule(page, 'Trabalhadores');
    await page.getByRole('link', { name: 'Camila Demo', exact: true }).click();
    const linked = page.getByRole('region', { name: 'Documentos vinculados', exact: true });
    await linked.getByRole('link', { name: 'Comprovante de orientação individual (demo)', exact: true }).click();
    await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
    await page.getByLabel('Arquivo da versão *', { exact: true }).setInputFiles(simplePdf());
    await page.getByLabel('Justificativa da versão *', { exact: true }).fill('Revisão demonstrativa para conferir o histórico.');
    await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Versão 2', exact: true })).toBeVisible();
    const versions = page.getByRole('table', { name: 'Versões disponíveis', exact: true });
    await versions.getByRole('button', { name: 'Consultar v1', exact: true }).click();
    const selected = page.getByRole('region', { name: 'Versão selecionada', exact: true });
    await expect(selected).toBeFocused();
    await expect(selected.getByRole('heading', { name: 'Versão 1', exact: true })).toBeVisible();
    await expect(versions.getByRole('button', { name: 'Consultar v1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(versions.getByRole('button', { name: 'Consultar v2', exact: true })).toHaveAttribute('aria-pressed', 'false');
    if (width < 768) expect(await versions.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`versoes-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Voltar ao trabalhador', exact: true }).click();
    await expect(linked).toBeFocused();
    expect(errors).toEqual([]);
  });
}
