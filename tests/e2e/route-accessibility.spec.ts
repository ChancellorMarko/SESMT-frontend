import { expect, test, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

async function expectPageTitle(page: Page, title: string) {
  await expect(page).toHaveTitle(`${title} — Ampara SESMT`);
}

function observePage(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return () => expect(errors).toEqual([]);
}

for (const width of [320, 1440]) {
  test(`menu por teclado anuncia a página e cancelar a saída mantém o rascunho em ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const verify = observePage(page);
    await loginDemo(page, 'RH');
    const openNavigation = page.getByRole('button', { name: 'Abrir navegação', exact: true });
    await openNavigation.focus();
    await page.keyboard.press('Enter');
    const navigation = page.getByRole('dialog', { name: 'Navegação', exact: true });
    await expect(navigation).toBeVisible();
    const workers = navigation.getByRole('link', { name: 'Trabalhadores', exact: true });
    await workers.focus();
    await page.keyboard.press('Enter');
    await expect(navigation).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Trabalhadores', exact: true })).toBeFocused();
    await expectPageTitle(page, 'Trabalhadores');

    const newWorker = page.getByRole('link', { name: 'Novo trabalhador', exact: true });
    await newWorker.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Novo trabalhador', exact: true })).toBeFocused();
    await expectPageTitle(page, 'Novo trabalhador');
    await page.screenshot({ path: testInfo.outputPath(`titulo-pagina-${width}.png`) });
    const formUrl = page.url();
    const name = page.getByLabel('Nome completo *', { exact: true });
    await name.fill('Rascunho que deve conservar o foco');
    await name.focus();
    await page.goBack();
    const confirmation = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
    await expect(confirmation).toBeVisible();
    await expect(page).toHaveURL(formUrl);
    await expectPageTitle(page, 'Novo trabalhador');
    await confirmation.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(name).toHaveValue('Rascunho que deve conservar o foco');
    await expect(name).toBeFocused();
    await expectPageTitle(page, 'Novo trabalhador');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`navegacao-foco-${width}.png`) });
    verify();
  });
}

test('alterar filtro na mesma página conserva o foco local e o título', async ({ page }) => {
  const verify = observePage(page);
  await loginDemo(page, 'RH');
  await openModule(page, 'Trabalhadores');
  await expect(page.getByRole('heading', { level: 1, name: 'Trabalhadores', exact: true })).toBeFocused();
  const status = page.getByLabel('Situação cadastral', { exact: true });
  await expect(status).toBeEnabled();
  await status.focus();
  await status.selectOption('ACTIVE');
  await expect(page).toHaveURL(/status=ACTIVE/);
  await expect(page.getByRole('region', { name: 'Resultados de trabalhadores', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(status).toBeFocused();
  await expectPageTitle(page, 'Trabalhadores');
  const search = page.getByLabel('Buscar nome ou matrícula', { exact: true });
  await search.fill('Camila');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=Camila/);
  await expect(page.getByRole('link', { name: 'Camila Demo', exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  await expectPageTitle(page, 'Trabalhadores');
  verify();
});

test('o retorno de um documento respeita o foco da seção da ficha', async ({ page }) => {
  const verify = observePage(page);
  await loginDemo(page, 'Engenheiro');
  await openModule(page, 'Trabalhadores');
  await page.getByRole('link', { name: 'Camila Demo', exact: true }).click();
  const heading = page.getByRole('heading', { level: 1, name: 'Camila Demo', exact: true });
  await expect(heading).toBeFocused();
  await expectPageTitle(page, 'Ficha do trabalhador');
  const sections = page.getByRole('navigation', { name: 'Seções da ficha do trabalhador', exact: true });
  await sections.getByRole('link', { name: 'Documentos', exact: true }).click();
  const documents = page.getByRole('region', { name: 'Documentos vinculados', exact: true });
  await expect(documents).toBeFocused();
  await expectPageTitle(page, 'Ficha do trabalhador');
  const documentTitle = 'Comprovante de orientação individual (demo)';
  await documents.getByRole('link', { name: documentTitle, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: documentTitle, exact: true })).toBeFocused();
  await expectPageTitle(page, 'Documento');
  await page.getByRole('link', { name: 'Voltar ao trabalhador', exact: true }).click();
  await expect(page).toHaveURL(/\/trabalhadores\/[^/?]+#documentos$/);
  await expect(documents).toBeFocused();
  await expectPageTitle(page, 'Ficha do trabalhador');
  await expect(heading).not.toBeFocused();
  verify();
});

test('a impressão mantém o título da PT e a saída restaura o título do atendimento', async ({ page }) => {
  const verify = observePage(page);
  await loginDemo(page, 'Engenheiro');
  await openModule(page, 'Permissões de trabalho');
  await page.getByRole('link', { name: 'PT-DEMO-230', exact: true }).click();
  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading).toBeFocused();
  await expectPageTitle(page, 'Permissão de trabalho');
  await page.getByRole('link', { name: 'Visualizar / imprimir PT', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Registro imprimível da PT', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('PT-DEMO-230 — versão 1 — Ampara SESMT');
  await page.getByRole('link', { name: 'Voltar à PT', exact: true }).click();
  await expect(heading).toBeFocused();
  await expectPageTitle(page, 'Permissão de trabalho');
  verify();
});
