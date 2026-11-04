import { expect, test, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const scenario of [
  {
    tab: 'documents', label: 'Documentos controlados', searchLabel: 'Buscar título ou código',
    table: 'Resultados da consulta documental', term: 'PROC-2026-002', width: 1440, height: 1000,
  },
  {
    tab: 'permits', label: 'Permissões de trabalho (PT)', searchLabel: 'Buscar PT',
    table: 'Resultados da consulta de PTs', term: 'PT-DEMO-230', width: 320, height: 844,
  },
] as const) {
  test(`consulta de ${scenario.tab} distingue rascunho e pesquisa aplicada a ${scenario.width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'Técnico de segurança');
    await openModule(page, 'Consulta central');
    await expect(page.getByRole('heading', { name: 'Central de consulta unificada', exact: true })).toBeVisible();
    const tab = page.getByRole('tab', { name: scenario.label, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('table', { name: scenario.table, exact: true })).toBeVisible();
    const search = page.getByRole('searchbox', { name: scenario.searchLabel, exact: true });
    const initialUrl = page.url();
    const unitId = new URL(initialUrl).searchParams.get('unitId');
    expect(unitId).toBeTruthy();
    await expectNoOverflow(page);

    await search.fill('rascunho da consulta');
    const pending = page.getByRole('status').filter({ hasText: 'Há alterações nos filtros ainda não aplicadas.' });
    await expect(pending).toBeVisible();
    await expect(page).toHaveURL(initialUrl);
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`consultation-${scenario.tab}-draft-${scenario.width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(pending).toHaveCount(0);
    await expect(page).toHaveURL(initialUrl);

    await search.fill(scenario.term);
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    await expect(page).toHaveURL(url => url.searchParams.get('tab') === scenario.tab
      && url.searchParams.get('q') === scenario.term && url.searchParams.get('unitId') === unitId);
    await expect(page.getByRole('table', { name: scenario.table, exact: true }).locator('tbody tr')).toHaveCount(1);
    await expect(pending).toHaveCount(0);
    const appliedUrl = page.url();
    await tab.click();
    await expect(search).toHaveValue(scenario.term);
    await expect(page).toHaveURL(appliedUrl);
    // Home is idempotent on the first tab. On PT it intentionally selects
    // documents, so the PT scenario checks its current tab by click instead.
    if (scenario.tab === 'documents') {
      await tab.focus();
      await page.keyboard.press('Home');
      await expect(tab).toBeFocused();
      await expect(search).toHaveValue(scenario.term);
      await expect(page).toHaveURL(appliedUrl);
    }
    await expectNoOverflow(page);
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page).toHaveURL(url => url.searchParams.get('tab') === scenario.tab
      && url.searchParams.get('unitId') === unitId && !url.searchParams.has('q'));
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`consultation-${scenario.tab}-${scenario.width}.png`), fullPage: true, animations: 'disabled' });

    if (scenario.tab === 'permits') {
      // End must preserve the last tab rather than be mistaken for a request
      // to clear its criteria. Keep a draft to catch an unnecessary remount.
      const last = page.getByRole('tab', { name: 'Permissões de entrada e trabalho (PET)', exact: true });
      await last.click();
      const petSearch = page.getByRole('searchbox', { name: 'Buscar PET por código/espaço/tarefa', exact: true });
      await expect(petSearch).toBeEnabled();
      const petUrl = page.url();
      await petSearch.fill('rascunho da última aba');
      await last.focus();
      await page.keyboard.press('End');
      await expect(last).toBeFocused();
      await expect(petSearch).toHaveValue('rascunho da última aba');
      await expect(page).toHaveURL(petUrl);
      await expectNoOverflow(page);
    }
    expect(errors).toEqual([]);
  });
}
