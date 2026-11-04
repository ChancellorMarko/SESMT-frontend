import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

for (const width of [320, 390, 1024, 1440]) {
  test(`layout compacto mantém uma marca para a home e o menu acessível em ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    const logo = page.getByRole('link', { name: 'Ampara SESMT · Página inicial', exact: true });
    await expect(logo).toHaveCount(1);
    await expect(logo).toBeVisible();
    await expect(page.getByRole('img', { name: 'Ampara SESMT', exact: true })).toHaveCount(1);
    await page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'Inspeções', exact: true }).click();
    await logo.click();
    await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
    await trigger.click();
    const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByLabel('Buscar módulos de navegação', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByText(/Dados fictícios em memória|Ambiente de demonstração|Cenário ilustrativo de SST|Números sintéticos para explorar a interface|Segurança que acompanha você\./i)).toHaveCount(0);
    const cards = [];
    for (const title of ['Dias sem acidentes', 'Índice de entrega de EPIs', 'Saúde e capacitações', 'Inspeções de risco pendentes']) {
      const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await expect(card).toBeVisible();
      cards.push((await card.boundingBox())!);
    }
    for (let index = 1; index < cards.length; index++) {
      const previous = cards[index - 1], current = cards[index];
      if (Math.abs(previous.y - current.y) < 2) expect(Math.abs(previous.height - current.height)).toBeLessThan(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`layout-${width}.png`), animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}
