import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
async function fillDesignation(page: Page) {
  await page.getByLabel('Responsável *', { exact: true }).selectOption(id(25));
  await page.getByLabel('Local / alcance', { exact: true }).fill('Galpão da designação E2E');
  await page.getByLabel('Início da vigência *', { exact: true }).fill('2026-10-13');
  await page.getByLabel('Fim da vigência *', { exact: true }).fill('2030-12-31');
  await page.getByRole('checkbox', { name: 'Trabalho a quente', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Espaço confinado', exact: true }).check();
}

test('designação em 320px protege preenchimento ao navegar e descarta ao trocar unidade com confirmação', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 844 });
  await loginDemo(page, 'Engenheiro'); await navigateWithinApp(page, '/app/designacoes/nova');
  await expect(page.getByRole('heading', { name: 'Nova designação', exact: true })).toBeVisible();
  await fillDesignation(page);
  await page.getByRole('link', { name: 'Voltar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await expect(page.getByLabel('Local / alcance', { exact: true })).toHaveValue('Galpão da designação E2E');
  page.once('dialog', alert => alert.dismiss());
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(id(3));
  await expect(page.getByLabel('Unidade de trabalho', { exact: true })).toHaveValue(id(2));
  await expect(page.getByRole('checkbox', { name: 'Espaço confinado', exact: true })).toBeChecked();
  page.once('dialog', alert => alert.accept());
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(id(3));
  await expect(page.getByLabel('Unidade de trabalho', { exact: true })).toHaveValue(id(3));
  await expect(page.getByLabel('Local / alcance', { exact: true })).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Espaço confinado', exact: true })).not.toBeChecked();
  await fillDesignation(page); await page.getByRole('button', { name: 'Criar designação', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/designacoes\/[a-f0-9-]+$/);
  await expect(page.getByText('Designação criada.', { exact: true })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: id(3) })).toBeVisible();
  await expect(page.getByText('Trabalho a quente', { exact: true })).toBeVisible();
  await expect(page.getByText('Espaço confinado', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('revogação em 390px mantém unidade correta e permite cancelar por teclado antes de confirmar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await loginDemo(page, 'Engenheiro');
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(id(3));
  await navigateWithinApp(page, `/app/designacoes/${id(600)}`);
  await expect(page.getByRole('heading', { name: 'Designação de outra unidade', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revogar designação', exact: true })).toHaveCount(0);
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(id(2));
  const revoke = page.getByRole('button', { name: 'Revogar designação', exact: true });
  await revoke.click(); let dialog = page.getByRole('dialog', { name: 'Revogar designação', exact: true });
  await dialog.getByLabel('Motivo da revogação *', { exact: true }).fill('Troca de escala fictícia na equipe.');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(revoke).toBeFocused();
  await revoke.click(); dialog = page.getByRole('dialog', { name: 'Revogar designação', exact: true });
  await expect(dialog.getByLabel('Motivo da revogação *', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Motivo da revogação *', { exact: true }).fill('Revogação fictícia para conferir a escala e a cobertura.');
  await dialog.getByRole('button', { name: 'Confirmar revogação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Revogada', { exact: true })).toBeVisible();
  await expect(page.getByText('Designação revogada', { exact: true })).toBeVisible();
  await expect(revoke).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
