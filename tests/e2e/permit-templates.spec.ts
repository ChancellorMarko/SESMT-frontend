import { expect, test } from '@playwright/test';
import { openModule, loginDemo, navigateWithinApp } from './helpers';

test('catálogo pesquisa perguntas e diferencia PT escolhida, AT, PET e revisão alternativa', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  await openModule(page, 'Modelo de permissão de trabalho');
  await expect(page.getByRole('heading', { name: 'RI-S-36001 · revisão A', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Autorização de Trabalho', exact: true })).toBeVisible();
  const pet = page.getByRole('article', { name: 'PET de espaço confinado', exact: true });
  await expect(pet).toContainText('Preparação PET disponível');
  await expect(pet.getByRole('link', { name: 'Abrir preparações de PET →', exact: true })).toHaveAttribute('href', '/app/pets');
  await expect(page.getByText('O nome do arquivo cita Rev.06 e a planilha mostra revisão 3.', { exact: false })).toBeVisible();
  const search = page.getByLabel('Buscar no catálogo', { exact: true });
  await search.fill('PET!B38');
  await expect(pet).toBeVisible();
  await expect(pet).toContainText('PET!B38');
  await expect(page.getByRole('article', { name: 'Autorização de Trabalho', exact: true })).toHaveCount(0);
  await search.fill('termo que não consta do arquivo 123xyz');
  await expect(page.getByRole('article')).toHaveCount(0);
  await search.fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/frontend/qa/catalogo-modelos-mobile.png', fullPage: true });
  await navigateWithinApp(page, '/app/dashboard');
});
