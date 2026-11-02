import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp, openModule } from './helpers';

for (const width of [320, 1440]) {
  test(`informações sob demanda e filtros seguem o fluxo de leitura em ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    const occurrences = page.getByRole('table', { name: 'Ocorrências e vistorias', exact: true });
    await expect(occurrences).toBeVisible();
    const detail = occurrences.getByRole('button', { name: 'Ver detalhes: Proteção de máquina a conferir' });
    await detail.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Proteção de máquina a conferir', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toBeFocused();
    await expect(page.getByRole('link', { name: /Serviços na agenda/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`painel-compacto-${width}.png`), fullPage: true });

    await navigateWithinApp(page, '/app/painel-documental');
    await expect(page.getByRole('heading', { name: 'Documentos vigentes', exact: true })).toBeVisible();
    const values = await page.locator('article > strong').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
    if (width === 1440) expect(Math.max(...values) - Math.min(...values)).toBeLessThan(2);
    const indicator = page.locator('article').first().getByRole('button');
    await indicator.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Fonte:');
    await page.keyboard.press('Escape');
    await expect(indicator).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`painel-documental-${width}.png`), fullPage: true });

    await openModule(page, 'Documentos');
    const form = page.getByRole('form', { name: 'Filtros de documentos', exact: true });
    await form.getByRole('button', { name: 'Mais filtros', exact: true }).click();
    const lastQuestion = form.getByLabel('Emissão até', { exact: true });
    await lastQuestion.focus();
    // Native date controls may have separate day/month/year and calendar tab stops.
    for (let step = 0; step < 6 && !await form.getByRole('button', { name: 'Buscar', exact: true }).evaluate(node => node === document.activeElement); step++) await page.keyboard.press('Tab');
    await expect(form.getByRole('button', { name: 'Buscar', exact: true })).toBeFocused();
    await lastQuestion.fill('2035-12-31');
    await form.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(page).toHaveURL(/issueDateTo=2035-12-31/);
    const documents = page.getByRole('table', { name: 'Lista de documentos' });
    await expect(documents).toBeVisible();
    if (width === 320) {
      const information = documents.getByRole('button').first();
      await information.click();
      await expect(page.getByRole('dialog')).toContainText('Tipo documental');
      await expect(page.getByRole('dialog')).toContainText('Versões vigentes');
      await page.keyboard.press('Escape');
      await expect(information).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
