import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loginDemo, logout, navigateWithinApp } from './helpers';

const permitPath = '/app/pts/00000000-0000-4000-8000-000000000230';

for (const width of [320, 390]) {
  test(`revisão desenhada em ${width}px preserva snapshot e baixa apenas a versão aprovada`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, permitPath);
    await expect(page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Baixar PDF final', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Revisar encerramento', exact: true });
    const drawing = dialog.getByRole('radio', { name: 'Desenho', exact: true });
    await drawing.focus(); await page.keyboard.press('Space'); await expect(drawing).toBeChecked();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
    await expect(dialog.getByText('Desenhe sua assinatura no quadro antes de confirmar a aprovação.', { exact: true })).toBeVisible();

    const surface = dialog.getByLabel('Área para desenhar a manifestação', { exact: true });
    const draw = async () => {
      const bounds = await surface.boundingBox(); expect(bounds).not.toBeNull();
      await page.mouse.move(bounds!.x + bounds!.width * 0.1, bounds!.y + bounds!.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(bounds!.x + bounds!.width * 0.4, bounds!.y + bounds!.height * 0.3, { steps: 8 });
      await page.mouse.move(bounds!.x + bounds!.width * 0.7, bounds!.y + bounds!.height * 0.65, { steps: 8 });
      await page.mouse.up();
      await expect(dialog.getByAltText('Prévia da assinatura desenhada', { exact: true })).toBeVisible();
    };
    await draw();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await dialog.getByRole('radio', { name: 'Nome digitado', exact: true }).check();
    await drawing.check();
    await expect(dialog.getByAltText('Prévia da assinatura desenhada', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Nenhum desenho registrado.', { exact: true })).toBeVisible();
    await draw();
    const representation = await dialog.getByAltText('Prévia da assinatura desenhada', { exact: true }).getAttribute('src');
    expect(representation).toMatch(/^data:image\/png;base64,/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Encerramento validado', { exact: true }).first()).toBeVisible();
    await page.getByText('Versão 1 · versão atual', { exact: true }).click();
    await expect(page.locator('details[open]').getByAltText('Assinatura do responsável', { exact: true })).toHaveAttribute('src', representation!);

    // Changing the authenticated profile must not substitute the recorded reviewer or drawing.
    await logout(page);
    await page.getByRole('button', { name: 'Técnico de segurança', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await navigateWithinApp(page, permitPath);
    await page.getByText('Versão 1 · versão atual', { exact: true }).click();
    await expect(page.locator('details[open]').getByAltText('Assinatura do responsável', { exact: true })).toHaveAttribute('src', representation!);
    await expect(page.locator('details[open]').getByText('Rubrica desenhada · Marina Demo', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Visualizar / imprimir PT', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Registro imprimível da PT' }).getByAltText('Representação visual de Marina Demo', { exact: true })).toHaveAttribute('src', representation!);
    await expect(page.getByText('DEMONSTRAÇÃO · DADOS FICTÍCIOS · SEM VALIDADE OPERACIONAL', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar PDF final', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/-final-v1\.pdf$/);
    const source = await readFile((await download.path())!);
    expect(source.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    const text = source.toString('latin1').replace(/<([0-9a-f]+)>\s*Tj/gi, (_, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
    expect(text).toContain('Marina Demo');
    expect(text).not.toContain('Revisor: Diego Demo');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('imagem enviada é conferida, confirmada e preservada na revisão e impressão', async ({ page }) => {
  await loginDemo(page, 'Engenheiro'); await navigateWithinApp(page, permitPath);
  await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('radio', { name: 'Upload de imagem', exact: true }).check();
  const signature = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 90;
    const drawing = canvas.getContext('2d')!; drawing.strokeStyle = '#003378'; drawing.lineWidth = 4;
    drawing.beginPath(); drawing.moveTo(20, 70); drawing.lineTo(100, 20); drawing.lineTo(250, 65); drawing.stroke();
    return canvas.toDataURL('image/png');
  });
  await dialog.getByLabel('Upload de imagem da rubrica').setInputFiles({ name: 'rubrica-demo.png', mimeType: 'image/png', buffer: Buffer.from(signature.split(',')[1], 'base64') });
  await expect(dialog.getByAltText('Prévia da imagem da assinatura')).toHaveAttribute('src', signature);
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByText('Versão 1 · versão atual', { exact: true }).click();
  await expect(page.locator('details[open]').getByAltText('Assinatura do responsável')).toHaveAttribute('src', signature);
  await page.getByRole('link', { name: 'Visualizar / imprimir PT', exact: true }).click();
  await expect(page.getByAltText('Representação visual de Marina Demo')).toHaveAttribute('src', signature);
  await expect(page.getByText('Marina Demo (Rubrica digitalizada)', { exact: true })).toBeVisible();
});
