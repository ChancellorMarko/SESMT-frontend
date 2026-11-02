import { expect, test } from '@playwright/test';
import { openModule, loginDemo, navigateWithinApp } from './helpers';

test('painel documental recupera data inválida e mantém filtros ao abrir documentos', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page);
  await navigateWithinApp(page, '/app/painel-documental?from=2026-02-30');
  await expect(page.getByText('O intervalo na URL é inválido. Corrija as datas para consultar o painel.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atualizar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pendências documentais' })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.FRONTEND_CAPTURE_QA && width !== 320) await page.screenshot({ path: `docs/frontend/qa/revisao-geral-2026-10-12-${width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: true });
  }
  await page.getByLabel('Período inicial', { exact: true }).fill('2024-02-29');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await page.getByRole('link', { name: 'Consultar documentos →' }).first().click();
  await expect(page).toHaveURL(/issueDateFrom=2024-02-29/);
  expect(errors).toEqual([]);
});

test('novo documento pede um único descarte na troca de unidade e conserva dados ao cancelar', async ({ page }) => {
  await loginDemo(page);
  await openModule(page, 'Documentos');
  await page.getByRole('link', { name: 'Novo documento', exact: true }).click();
  await expect(page.getByLabel('Título *', { exact: true })).toBeVisible();
  const unit = page.getByRole('combobox', { name: 'Unidade de trabalho' });
  const original = await unit.inputValue();
  let accept = false;
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await unit.selectOption({ index: 1 });
  await expect(unit).not.toHaveValue(original);
  expect(confirmations).toBe(0);
  const title = page.getByLabel('Título *', { exact: true });
  await title.fill('Rascunho protegido no teste');
  await unit.selectOption(original);
  await expect(unit).not.toHaveValue(original);
  await expect(title).toHaveValue('Rascunho protegido no teste');
  expect(confirmations).toBe(1);
  accept = true;
  await unit.selectOption(original);
  await expect(unit).toHaveValue(original);
  await expect(title).toHaveValue('');
  expect(confirmations).toBe(2);
});

test('admin pesquisa usuários por nome e a lista respeita a unidade selecionada', async ({ page }) => {
  await loginDemo(page, 'Administrador');
  await openModule(page, 'Usuários e acessos');
  await page.getByLabel('Pesquisar nome ou e-mail').fill('CAMILA');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('cell').filter({ hasText: 'Camila Demo' })).toBeVisible();
  await expect(page.getByRole('cell').filter({ hasText: 'Lucas Demo' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Unidade de trabalho' }).selectOption({ index: 1 });
  // The layout remounts the page for a different unit; apply the same search again.
  await page.getByLabel('Pesquisar nome ou e-mail').fill('CAMILA');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum usuário encontrado' })).toBeVisible();
});
