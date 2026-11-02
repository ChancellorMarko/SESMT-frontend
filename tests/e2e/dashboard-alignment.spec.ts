import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

for (const width of [1440, 1024, 390, 320]) {
  test(`filas do painel mantêm alinhamento e leitura em ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    const appointments = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Próximos serviços', exact: true }) }).last();
    const reviews = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Revisão e correções', exact: true }) }).last();
    await expect(appointments).toBeVisible();
    await expect(reviews).toBeVisible();
    const a = (await appointments.boundingBox())!, b = (await reviews.boundingBox())!;
    if (width > 900) {
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(Math.abs(a.width - b.width)).toBeLessThan(2);
      expect(Math.abs(a.height - b.height)).toBeLessThan(2);
      expect(b.x - a.x - a.width).toBeCloseTo(12, 0);
      const footer = (await reviews.getByRole('link', { name: 'Consultar painel documental' }).boundingBox())!;
      expect(Math.abs(b.y + b.height - footer.y - footer.height)).toBeLessThan(3);
    } else {
      expect(Math.abs(a.x - b.x)).toBeLessThan(2);
      expect(Math.abs(a.width - b.width)).toBeLessThan(2);
      expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      expect(b.height).toBeLessThan(a.height);
    }
    expect(await reviews.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius))).toBeLessThanOrEqual(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await appointments.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`dashboard-alinhado-${width}.png`), animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}
