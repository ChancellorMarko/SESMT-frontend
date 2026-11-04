import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { loginDemo, navigateWithinApp } from './helpers';

const permitPath = '/app/pts/00000000-0000-4000-8000-000000000230';
async function representation(page: Page, updated = false) {
  return page.evaluate(async update => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 90;
    const context = canvas.getContext('2d')!; context.strokeStyle = update ? '#dc2626' : '#003378'; context.lineWidth = 4;
    context.beginPath(); context.moveTo(20, update ? 20 : 70); context.lineTo(110, update ? 70 : 20); context.lineTo(270, update ? 30 : 60); context.stroke();
    const png = canvas.toDataURL('image/png');
    const image = new Image(); await new Promise<void>(resolve => { image.onload = () => resolve(); image.src = png; });
    const jpegCanvas = document.createElement('canvas'); jpegCanvas.width = image.naturalWidth; jpegCanvas.height = image.naturalHeight;
    const jpegContext = jpegCanvas.getContext('2d')!; jpegContext.fillStyle = '#ffffff'; jpegContext.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height); jpegContext.drawImage(image, 0, 0, jpegCanvas.width, jpegCanvas.height);
    const base64 = jpegCanvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    const jpegHex = Array.from(atob(base64), byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return { png, jpegHex };
  }, updated);
}
async function saveProfileImage(page: Page, png: string, version: number) {
  await navigateWithinApp(page, '/app/minha-representacao');
  await page.getByRole('radio', { name: 'Upload de imagem', exact: true }).check();
  await page.getByLabel('Imagem da representação pessoal', { exact: true }).setInputFiles({ name: `rubrica-v${version}.png`, mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await expect(page.getByAltText('Prévia da representação pessoal', { exact: true })).toHaveAttribute('src', png);
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Salvar representação pessoal', exact: true }).click();
  await expect(page.getByText(`Representação pessoal salva na versão ${version}. Nenhuma PT foi aprovada por esta ação.`, { exact: true })).toBeVisible();
}

test('PDF exportado incorpora a imagem preservada da versão aprovada e não a representação atual do perfil', async ({ page }, testInfo) => {
  await loginDemo(page, 'Engenheiro');
  const oldImage = await representation(page), currentImage = await representation(page, true);
  await saveProfileImage(page, oldImage.png, 1);
  await navigateWithinApp(page, permitPath);
  await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Revisar encerramento', exact: true });
  await dialog.getByRole('button', { name: 'Usar representação pessoal salva', exact: true }).click();
  await expect(dialog.getByAltText('Representação pessoal selecionada', { exact: true })).toHaveAttribute('src', oldImage.png);
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByText('Encerramento validado', { exact: true }).first()).toBeVisible();
  await saveProfileImage(page, currentImage.png, 2);
  await navigateWithinApp(page, `${permitPath}/imprimir?version=1`);
  await expect(page.getByRole('article', { name: 'Registro imprimível da PT' }).getByAltText('Representação visual de Marina Demo', { exact: true })).toHaveAttribute('src', oldImage.png);
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Baixar PDF final', exact: true }).click();
  const download = await downloadEvent; expect(download.suggestedFilename()).toMatch(/-final-v1\.pdf$/);
  const localPdf = testInfo.outputPath('pt-historica-v1-com-representacao.pdf'); await download.saveAs(localPdf);
  await testInfo.attach('PDF histórico com representação preservada', { path: localPdf, contentType: 'application/pdf' });
  const bytes = await readFile(localPdf); const source = bytes.toString('ascii');
  expect(source.startsWith('%PDF-1.4')).toBe(true);
  const images = [...source.matchAll(/\/Subtype \/Image[\s\S]*?stream\n([a-f0-9]+)>\nendstream/g)].map(match => match[1]);
  expect(images.length).toBeGreaterThan(0); expect(source).toContain('/Filter [/ASCIIHexDecode /DCTDecode]');
  expect(images.some(hex => hex === oldImage.jpegHex)).toBe(true); expect(images.some(hex => hex === currentImage.jpegHex)).toBe(false);
  for (const hex of images) { const jpeg = Buffer.from(hex, 'hex'); expect(jpeg.subarray(0, 3).toString('hex')).toBe('ffd8ff'); expect(jpeg.subarray(-2).toString('hex')).toBe('ffd9'); }
  const text = [...source.matchAll(/<([0-9a-f]+)> Tj/g)].map(match => Buffer.from(match[1], 'hex').toString('latin1')).join('\n');
  for (const expected of ['SEM VALIDADE OPERACIONAL', 'LIBERAÇÃO OPERACIONAL PRESERVADA', 'Início registrado:', 'Conclusão registrada:', 'ELEGIBILIDADE REGISTRADA NA VERSÃO', 'CIÊNCIAS REGISTRADAS', 'Revisor: Marina Demo', 'versão 1']) expect(text).toContain(expected);
  const xref = Number(source.match(/startxref\n(\d+)/)![1]); expect(source.slice(xref, xref + 4)).toBe('xref');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
