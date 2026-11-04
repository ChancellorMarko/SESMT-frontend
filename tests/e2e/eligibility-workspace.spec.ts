import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp, simplePdf } from './helpers';

for (const width of [320, 390]) {
  test(`conferência em ${width}px filtra pessoas e protege arquivo ainda não enviado`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && /\/evidence(?:\/|$)/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, '/app/agenda/00000000-0000-4000-8000-000000000220');
    const panel = page.getByRole('region', { name: 'Elegibilidade documental dos participantes', exact: true });
    const camila = panel.getByRole('article', { name: 'Camila Demo', exact: true });
    const bruno = panel.getByRole('article', { name: 'Bruno Demo', exact: true });
    await expect(camila).toBeVisible(); await expect(bruno).toBeVisible();
    await panel.getByRole('button', { name: 'Com pendências', exact: true }).click();
    await expect(camila).toHaveCount(0); await expect(bruno).toBeVisible();
    await expect(panel.getByText('Exibindo 1 de 2 participantes', { exact: true })).toBeVisible();
    await expect(panel.getByText(/liberar e iniciar a execução ficam bloqueados/)).toBeVisible();
    const search = panel.getByRole('searchbox', { name: 'Buscar participante', exact: true });
    await search.fill('ninguém neste filtro');
    await expect(panel.getByRole('heading', { name: 'Nenhum participante neste filtro', exact: true })).toBeVisible();
    await expect(panel.getByText(/liberar e iniciar a execução ficam bloqueados/)).toBeVisible();
    await panel.getByRole('button', { name: 'Limpar busca', exact: true }).click();
    await expect(search).toBeFocused();
    await expect(camila).toBeVisible(); await expect(bruno).toBeVisible();
    await search.fill('bruno');
    await expect(bruno).toBeVisible(); await expect(camila).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const upload = bruno.getByRole('button', { name: 'Substituir evidência', exact: true });
    await upload.click();
    const dialog = page.getByRole('dialog', { name: 'Enviar evidência do participante', exact: true });
    const file = simplePdf('Comprovante sintetico ainda nao enviado');
    await dialog.getByLabel('Arquivo da evidência *', { exact: true }).setInputFiles(file);
    page.once('dialog', native => native.dismiss());
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    expect(await dialog.getByLabel('Arquivo da evidência *', { exact: true }).evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(file.name);
    page.once('dialog', native => native.accept());
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(upload).toBeFocused();
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}
