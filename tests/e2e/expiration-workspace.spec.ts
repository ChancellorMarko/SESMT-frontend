import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp, simplePdf } from './helpers';

const unitId = '00000000-0000-4000-8000-000000000002';
const title = 'Orientação de segurança · Produção (demo)';
const origin = `/app/vencimentos?unitId=${unitId}&days=90&q=PROC-2026-002`;

for (const width of [320, 390, 768, 1440]) {
  test(`vencimentos em ${width}px distinguem o rascunho e preservam a consulta no documento`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, origin);
    const documentLink = page.getByRole('link', { name: title, exact: true });
    await expect(documentLink).toBeVisible();
    const table = page.getByRole('table', { name: 'Documentos da consulta de vencimentos', exact: true });
    await expect(table.getByRole('columnheader')).toHaveCount(4);
    const dimensions = await table.evaluate(element => ({ width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    const input = page.getByRole('searchbox', { name: 'Buscar por título ou código', exact: true });
    await input.fill('Texto ainda não enviado');
    await expect(page.getByText(/Busca ainda não aplicada/)).toBeVisible();
    expect(new URL(page.url()).searchParams.get('q')).toBe('PROC-2026-002');
    await page.getByLabel('Consultar', { exact: true }).selectOption('expired');
    await expect(input).toHaveValue('Texto ainda não enviado');
    await expect(page.getByRole('button', { name: 'Remover filtro: Antecedência', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Remover filtro: Consulta', exact: true }).click();
    await expect(page.getByLabel('Antecedência', { exact: true })).toHaveValue('90');
    await expect(input).toHaveValue('Texto ainda não enviado');
    await page.getByRole('button', { name: 'Remover filtro: Antecedência', exact: true }).click();
    await expect(page.getByLabel('Antecedência', { exact: true })).toHaveValue('30');
    await expect(input).toHaveValue('Texto ainda não enviado');
    await expect(input).toBeFocused();
    await page.getByLabel('Antecedência', { exact: true }).selectOption('90');
    await page.getByRole('button', { name: 'Remover filtro: Busca', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    await expect(page.getByText(/Busca ainda não aplicada/)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('unitId')).toBe(unitId);
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
    await input.fill('PROC-2026-002');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(documentLink).toBeVisible();
    const returnTo = page.url();
    await documentLink.click();
    await expect(page.getByRole('region', { name: 'Metadados do documento', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar aos vencimentos', exact: true }).click();
    await expect(page).toHaveURL(returnTo);
    await expect(documentLink).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`vencimentos-${width}.png`), fullPage: true });
  });
}

test('cancelar e salvar nova versão e metadados preserva os vencimentos e atualiza o resultado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, origin);
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
  await expect(page.getByLabel('Título *', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar ao documento', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Voltar aos vencimentos', exact: true })).toHaveAttribute('href', origin);
  // A published version remains immutable; the new draft makes metadata editing available.
  await expect(page.getByRole('link', { name: 'Editar metadados', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
  await page.getByLabel('Arquivo da versão *', { exact: true }).setInputFiles(simplePdf('Nova versao sintetica para conferir a navegacao de vencimentos'));
  await page.getByLabel('Justificativa da versão *', { exact: true }).fill('Atualizar orientação mantendo a versão vigente no histórico.');
  await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voltar aos vencimentos', exact: true })).toHaveAttribute('href', origin);
  await page.getByRole('link', { name: 'Editar metadados', exact: true }).click();
  const updatedTitle = 'Orientação revisada no teste de vencimentos';
  await page.getByLabel('Título *', { exact: true }).fill(updatedTitle);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar aos vencimentos', exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByRole('link', { name: updatedTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Buscar por título ou código', exact: true })).toHaveValue('PROC-2026-002');
});
