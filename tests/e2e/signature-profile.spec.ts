import { expect, test, type Page } from '@playwright/test';
import { loginDemo, logout, navigateWithinApp } from './helpers';

const profilePath = '/app/minha-representacao';
const permitPath = '/app/pts/00000000-0000-4000-8000-000000000230';

async function makePersonalImage(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 90;
    const context = canvas.getContext('2d')!; context.strokeStyle = '#003378'; context.lineWidth = 4;
    context.beginPath(); context.moveTo(20, 70); context.lineTo(110, 20); context.lineTo(270, 60); context.stroke();
    return canvas.toDataURL('image/png');
  });
}

for (const width of [320, 390]) {
  test(`perfil pessoal em ${width}px exige confirmação e preserva a cópia aprovada após atualização`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await loginDemo(page, 'Engenheiro'); await navigateWithinApp(page, profilePath);
    await expect(page.getByRole('heading', { name: 'Minha representação', exact: true })).toBeVisible();
    await expect(page.getByText('Você ainda não possui uma representação pessoal salva.', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Upload de imagem', exact: true }).check();
    const image = await makePersonalImage(page);
    await page.getByLabel('Imagem da representação pessoal', { exact: true }).setInputFiles({ name: 'rubrica-pessoal-demo.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
    await expect(page.getByAltText('Prévia da representação pessoal', { exact: true })).toHaveAttribute('src', image);
    await page.getByRole('button', { name: 'Salvar representação pessoal', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Confirme o salvamento da sua representação pessoal.');
    await expect(page.getByText('Você ainda não possui uma representação pessoal salva.', { exact: true })).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Salvar representação pessoal', exact: true }).click();
    await expect(page.getByText('Representação pessoal salva na versão 1. Nenhuma PT foi aprovada por esta ação.', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('perfil-salvo.png'), fullPage: true });

    // A saved profile alone does not decide any PT. Selection and a fresh confirmation are required.
    await navigateWithinApp(page, permitPath);
    await expect(page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true })).toBeVisible();
    await expect(page.getByText('Encerramento validado', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Revisar encerramento', exact: true });
    await expect(dialog.getByRole('button', { name: 'Usar representação pessoal salva', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Usar representação pessoal salva', exact: true }).click();
    await expect(dialog.getByAltText('Representação pessoal selecionada', { exact: true })).toHaveAttribute('src', image);
    await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Confirme sua decisão sobre esta versão.');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Encerramento validado', { exact: true }).first()).toBeVisible();
    await page.getByText('Versão 1 · versão atual', { exact: true }).click();
    await expect(page.locator('details[open]').getByAltText('Assinatura do responsável', { exact: true })).toHaveAttribute('src', image);

    // Replace the profile with a typed v2; the earlier review remains an image of v1.
    await navigateWithinApp(page, profilePath);
    await expect(page.getByAltText('Prévia da representação pessoal', { exact: true })).toHaveAttribute('src', image);
    await page.getByRole('radio', { name: 'Nome digitado', exact: true }).check();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Salvar representação pessoal', exact: true }).click();
    await expect(page.getByText('Representação pessoal salva na versão 2. Nenhuma PT foi aprovada por esta ação.', { exact: true })).toBeVisible();
    await expect(page.getByAltText('Prévia da representação pessoal', { exact: true })).toHaveCount(0);
    await navigateWithinApp(page, permitPath);
    await page.getByText('Versão 1 · versão atual', { exact: true }).click();
    await expect(page.locator('details[open]').getByAltText('Assinatura do responsável', { exact: true })).toHaveAttribute('src', image);
    await expect(page.locator('details[open]').getByText('Imagem anexada · Marina Demo', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Visualizar / imprimir PT', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Registro imprimível da PT' }).getByAltText('Representação visual de Marina Demo', { exact: true })).toHaveAttribute('src', image);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('perfil pessoal é restrito ao responsável pela revisão e não aparece para o técnico', async ({ page }) => {
  await loginDemo(page, 'Engenheiro'); await navigateWithinApp(page, profilePath);
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Salvar representação pessoal', exact: true }).click();
  await expect(page.getByText('Representação pessoal salva na versão 1. Nenhuma PT foi aprovada por esta ação.', { exact: true })).toBeVisible();
  await logout(page); await page.getByRole('button', { name: 'Técnico de segurança', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/); await navigateWithinApp(page, profilePath);
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar representação pessoal', exact: true })).toHaveCount(0);
  await expect(page.getByAltText('Prévia da representação pessoal', { exact: true })).toHaveCount(0);
  await navigateWithinApp(page, permitPath);
  await expect(page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true })).toHaveCount(0);
  await logout(page); await page.getByRole('button', { name: 'Engenheiro', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/); await navigateWithinApp(page, profilePath);
  await expect(page.getByText(/Perfil salvo · versão 1/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Nome digitado', exact: true })).toBeChecked();
});
