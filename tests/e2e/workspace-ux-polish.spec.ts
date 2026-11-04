import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('navegação por toque tem nomes visíveis e capacitações cabem em 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  const shortcuts = page.getByRole('navigation', { name: 'Acesso rápido' });
  const captions: { x: number; width: number }[] = [];
  for (const [name, caption] of [['Dashboard', 'Início'], ['Inspeções', 'Inspeções'], ['Saúde e capacitações', 'Saúde'], ['Equipamentos de proteção individual (EPI)', 'Proteção'], ['Relatórios', 'Relatórios']]) {
    const link = shortcuts.getByRole('link', { name, exact: true });
    const text = link.getByText(caption, { exact: true }).filter({ visible: true });
    await expect(text).toBeVisible();
    captions.push((await text.boundingBox())!);
    const bounds = await link.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  for (let index = 1; index < captions.length; index++) expect(captions[index].x - captions[index - 1].x - captions[index - 1].width).toBeGreaterThanOrEqual(2);
  await shortcuts.getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
  await page.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)', exact: true }).click();
  const teams = page.getByRole('list', { name: 'Capacitações por equipe', exact: true });
  await expect(teams).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(teams.getByRole('article')).toHaveCount(3);
  await expect(teams).toContainText('Trabalho em altura');
  await expect(teams).toContainText('Espaço confinado');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await teams.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('capacitacoes-mobile-320.png') });
  const detail = page.getByRole('button', { name: 'Ver detalhe: Planejar orientação da manutenção', exact: true });
  await expect(detail.getByText('Ver detalhe', { exact: true })).toBeVisible();
  await detail.click();
  const dialog = page.getByRole('dialog', { name: 'Planejar orientação da manutenção', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeFocused();
});

test('guia fica fora do conteúdo e pode ser aberto pelo menu sem sobrepor modais', async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  await page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'Saúde e capacitações', exact: true }).click();
  await page.getByRole('tab', { name: 'Capacitações e normas regulamentadoras (NR)', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  const main = await page.locator('main#conteudo').boundingBox();
  const launcher = await page.getByRole('button', { name: 'Abrir Guia Ampara', exact: true }).boundingBox();
  expect(launcher!.y).toBeGreaterThanOrEqual(main!.y + main!.height - 1);
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  await trigger.click();
  await page.getByRole('dialog', { name: 'Navegação', exact: true }).getByRole('button', { name: 'Guia Ampara', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Guia Ampara', exact: true });
  await expect(guide).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await navigateWithinApp(page, '/app/dashboard?area=desconhecida');
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('EPIs mantém indicadores compactos e permite desfazer o acompanhamento sem conferir o lote', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 950, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginDemo(page, 'Engenheiro');
  await page.getByRole('navigation', { name: 'Acesso rápido' }).getByRole('link', { name: 'Equipamentos de proteção individual (EPI)', exact: true }).click();
  const tops: number[] = [];
  for (const title of ['Entregas previstas', 'Comprovantes conferidos', 'Registros a conferir', 'Categorias do ciclo']) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const bounds = await card.boundingBox();
    tops.push(bounds!.y);
    expect(bounds!.height).toBeLessThan(180);
  }
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
  const row = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Conferir comprovantes de entrega', exact: true }) });
  const detail = row.getByRole('button', { name: 'Ver conferência: Capacetes', exact: true });
  await detail.click();
  const dialog = page.getByRole('dialog', { name: 'Conferência de capacetes', exact: true });
  await dialog.getByRole('button', { name: 'Acompanhar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(row.getByText('3 a conferir', { exact: true })).toBeVisible();
  await expect(row.getByText('Em acompanhamento', { exact: true })).toBeVisible();
  await detail.click();
  await dialog.getByRole('button', { name: 'Retirar acompanhamento', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(detail).toBeFocused();
  await expect(row.getByText('3 a conferir', { exact: true })).toBeVisible();
  await expect(row.getByText('Em acompanhamento', { exact: true })).toHaveCount(0);
  await page.getByRole('heading', { name: 'Equipamentos de proteção', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('epis-tablet-950.png') });
});
