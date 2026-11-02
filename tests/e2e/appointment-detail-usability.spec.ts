import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

for (const width of [320, 390, 1440]) {
  test(`fechar a ação preserva o preenchimento e o retorno à agenda em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/reschedule')) writes.push(request.url()); });
    await loginDemo(page, 'Engenheiro');
    await navigateWithinApp(page, '/app/agenda?q=AG-DEMO-220');
    const beforeDetail = page.url();
    await page.getByRole('row').filter({ hasText: 'AG-DEMO-220' }).getByRole('link', { name: 'Consultar atendimento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dados do atendimento', exact: true })).toBeVisible();
    const action = page.getByRole('button', { name: 'Reagendar', exact: true });
    await action.click();
    const dialog = page.getByRole('dialog', { name: 'Reagendar serviço', exact: true });
    await dialog.getByLabel('Motivo *', { exact: true }).fill('Ajuste ainda não enviado pela equipe');
    page.once('dialog', native => native.dismiss());
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Motivo *', { exact: true })).toHaveValue('Ajuste ainda não enviado pela equipe');
    page.once('dialog', native => native.accept());
    await dialog.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(action).toBeFocused();
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
    await expect(page).toHaveURL(beforeDetail);
    expect(errors).toEqual([]);
  });
}
