import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp, openModule } from './helpers';

test('preserva página, critérios e busca não enviada ao editar, movimentar e cancelar cadastro', async ({ page }) => {
  await loginDemo(page, 'RH');
  await page.evaluate(async () => {
    const modulePath = '/src/shared/api/client.ts';
    const { api } = await import(/* @vite-ignore */ modulePath);
    for (let index = 1; index <= 12; index++) {
      const sequence = String(index).padStart(3, '0');
      await api.post('/workers', { fullName: `UX Consulta ${sequence}`, registration: `UX-RETURN-${sequence}`, companyId: '00000000-0000-4000-8000-000000000001', unitId: '00000000-0000-4000-8000-000000000002', sectorId: '00000000-0000-4000-8000-000000000005', employmentType: 'CLT', admissionDate: '2025-01-01' });
    }
  });
  const search = '?unitId=00000000-0000-4000-8000-000000000002&q=UX+Consulta&status=ACTIVE&integrationStatus=PENDING&page=2';
  await navigateWithinApp(page, `/app/trabalhadores${search}`);
  await expect(page.getByRole('link', { name: 'UX Consulta 011', exact: true })).toBeVisible();
  const draft = 'Texto ainda não pesquisado';
  await page.getByLabel('Buscar nome ou matrícula', { exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Empresa e equipe', exact: true }).click();
  await page.getByRole('link', { name: 'Consultar UX Consulta 011', exact: true }).click();
  const back = page.getByRole('link', { name: 'Voltar à lista', exact: true });
  await expect(back).toHaveAttribute('href', `/app/trabalhadores${search}`);
  await page.getByRole('navigation', { name: 'Seções da ficha do trabalhador' }).getByRole('link', { name: 'Histórico', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Histórico de movimentações', exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'Editar cadastro', exact: true }).click();
  await page.getByLabel('Tipo de vínculo *', { exact: true }).fill('CLT atualizado');
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByText('Cadastro atualizado.', { exact: true })).toBeVisible();
  await expect(back).toHaveAttribute('href', `/app/trabalhadores${search}`);
  await page.getByRole('link', { name: 'Registrar movimentação', exact: true }).click();
  await page.getByLabel('Motivo / justificativa *', { exact: true }).fill('Conferência do retorno à consulta original.');
  await page.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  await expect(page.getByText(/Movimentação registrada\./)).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(`/app/trabalhadores${search}`);
  await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue(draft);
  await expect(page.getByRole('button', { name: 'Empresa e equipe', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Paginação de trabalhadores', exact: true })).toContainText('Página 2 de 2');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  await page.getByRole('link', { name: 'Cancelar', exact: true }).click();
  await expect(page).toHaveURL(`/app/trabalhadores${search}`);
  await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue(draft);
});

for (const width of [320, 390, 1440]) {
  test(`ficha organiza seções e listas relacionadas a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'RH');
    await openModule(page, 'Trabalhadores');
    await page.getByLabel('Buscar nome ou matrícula', { exact: true }).fill('Camila');
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    const listUrl = page.url();
    await page.getByRole('link', { name: 'Camila Demo', exact: true }).click();
    const navigation = page.getByRole('navigation', { name: 'Seções da ficha do trabalhador' });
    for (const [label, region] of [['Vínculo', 'Vínculo atual'], ['Equipes', 'Equipes de trabalho vinculadas'], ['Documentos', 'Documentos vinculados'], ['Histórico', 'Histórico de movimentações']]) {
      await navigation.getByRole('link', { name: label, exact: true }).click();
      await expect(page.getByRole('region', { name: region, exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await navigation.getByRole('link', { name: 'Integração', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Integração administrativa do trabalhador', exact: true })).toBeFocused();
    if (width < 768) {
      const table = page.getByRole('table', { name: 'Equipes vinculadas', exact: true });
      expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`ficha-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Voltar à lista', exact: true }).click();
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue('Camila');
    expect(errors).toEqual([]);
  });
}
