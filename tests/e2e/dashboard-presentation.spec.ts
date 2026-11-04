import { expect, test } from '@playwright/test';
import { loginDemo } from './helpers';

test('busca do menu encontra áreas por assunto e abre a aba correta por teclado', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  await page.keyboard.press('Control+k');
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }).fill('certificados NR');
  const training = menu.getByRole('link', { name: 'Capacitações', exact: true });
  await training.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/area=saude&healthView=nrs/);
  await expect(page.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Saúde ocupacional e capacitações', exact: true })).toBeFocused();
  await page.getByRole('heading', { name: 'Planejamento de capacitações', exact: true }).scrollIntoViewIfNeeded();
  await page.keyboard.press('Control+k');
  await menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }).fill('ASO');
  await menu.getByRole('link', { name: 'Saúde ocupacional', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Saúde ocupacional · atestados de saúde ocupacional (ASO)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Control+k');
  await menu.getByRole('textbox', { name: 'Buscar módulos de navegação' }).fill('capacetes');
  await menu.getByRole('link', { name: 'Proteção individual', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipamentos de proteção', exact: true })).toBeFocused();
});

test('fila de EPIs filtra acompanhamento, recupera estado vazio e mantém foco ao retirar um lote', async ({ page }) => {
  const writes: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/v1/')) writes.push(request.url());
  });
  await page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'Equipamentos de proteção individual (EPI)', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Conferências de EPIs', exact: true });
  const filters = queue.getByRole('group', { name: 'Filtrar lotes de EPIs', exact: true });
  const following = filters.getByRole('button', { name: 'Em acompanhamento', exact: true });
  await following.click();
  await expect(queue.getByRole('heading', { name: 'Nenhum lote em acompanhamento', exact: true })).toBeVisible();
  await queue.getByRole('button', { name: 'Ver todos os lotes', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'Todos os lotes', exact: true })).toBeFocused();
  const detail = queue.getByRole('button', { name: 'Ver conferência: Capacetes', exact: true });
  await detail.click();
  const dialog = page.getByRole('dialog', { name: 'Conferência de capacetes', exact: true });
  await dialog.getByRole('button', { name: 'Acompanhar', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(detail).toBeFocused();
  await following.click();
  await expect(queue.getByRole('button', { name: /^Ver conferência:/ })).toHaveCount(1);
  await expect(queue.getByText('3 a conferir', { exact: true })).toBeVisible();
  await detail.click();
  await dialog.getByRole('button', { name: 'Retirar acompanhamento', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(following).toBeFocused();
  await expect(queue.getByRole('heading', { name: 'Nenhum lote em acompanhamento', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Comprovantes conferidos: Capacetes', exact: true })).toHaveAttribute('aria-valuetext', '40 de 43 registros');
  expect(writes).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`aberturas das áreas preservam identidade, conteúdo e ações em ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Engenheiro');
    const shortcuts = page.getByRole('navigation', { name: 'Acesso rápido' });
    for (const area of [
      { link: 'Dashboard', title: 'Visão geral', action: 'Agendar serviço' },
      { link: 'Inspeções', title: 'Inspeções de segurança', action: 'Consultar agenda de inspeções' },
      { link: 'Saúde e capacitações', title: 'Saúde ocupacional e capacitações', action: 'Consultar vencimentos' },
      { link: 'Equipamentos de proteção individual (EPI)', title: 'Equipamentos de proteção', action: 'Consultar documentos de EPIs' },
    ]) {
      await shortcuts.getByRole('link', { name: area.link, exact: true }).click();
      await expect(page.getByRole('heading', { name: area.title, level: 1, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const action = page.getByRole('link', { name: area.action, exact: true });
      await expect(action).toBeVisible();
      const bounds = await action.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await expect(page.getByRole('link', { name: 'Ampara SESMT · Página inicial', exact: true }).getByAltText('Ampara SESMT', { exact: true })).toHaveAttribute('src', '/brand/ampara/icon.png');
    await page.screenshot({ path: testInfo.outputPath(`design-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
