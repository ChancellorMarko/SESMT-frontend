import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp, simplePdf } from './helpers';

const workerId = '00000000-0000-4000-8000-000000000042';
const appointmentId = '00000000-0000-4000-8000-000000000222';
const readinessPath = '/app/pendencias?q=Julia&status=pending';
const appointmentPath = `/app/agenda/${appointmentId}?origin=pendencias`;
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

for (const width of [320, 390]) {
  test(`regularização da integração volta à consulta atualizada a ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await loginDemo(page, 'Engenheiro');
    const fromReadiness = width === 320;
    const origin = fromReadiness ? readinessPath : appointmentPath;
    await navigateWithinApp(page, origin);
    if (!fromReadiness) {
      const row = page.getByRole('heading', { name: 'Comprovação da integração administrativa', exact: true }).locator('../..');
      await expect(row).toContainText('Comprovante de integração não vinculado.');
      await expect(row.getByRole('button', { name: /Enviar evidência|Conferir evidência/ })).toHaveCount(0);
    }
    const integrationLink = page.getByRole('link', { name: 'Consultar integração de Julia Demo', exact: true });
    await expect(integrationLink).toBeVisible();
    // Readiness normalizes the query with the active unit before opening the record.
    const normalizedOrigin = page.url();
    await integrationLink.click();
    await expect(page).toHaveURL(`/app/trabalhadores/${workerId}#integracao`);
    await expect(page.getByRole('region', { name: 'Integração administrativa do trabalhador', exact: true })).toBeFocused();
    const panel = page.getByRole('region', { name: 'Integração administrativa', exact: true });
    const dates = await page.evaluate(() => {
      const civil = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      return { today: civil(0), until: civil(30) };
    });
    await panel.getByRole('button', { name: 'Registrar nova integração', exact: true }).click();
    await panel.getByLabel('Data de realização *', { exact: true }).fill(dates.today);
    await panel.getByLabel('Validade da integração', { exact: true }).fill(dates.until);
    await panel.getByLabel('Origem do comprovante', { exact: true }).selectOption('UPLOAD');
    const file = { ...simplePdf('Regularizacao administrativa sintetica'), name: 'comprovante-integracao.pdf' };
    await panel.getByLabel('Arquivo do comprovante *', { exact: true }).setInputFiles(file);
    await expect(panel.getByText(`Selecionado: ${file.name}`, { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Salvar integração', exact: true }).click();
    await expect(panel.getByText(/Integração administrativa registrada\./)).toBeVisible();
    await expect(panel.getByRole('button', { name: `Conferir comprovante ${file.name}`, exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: `Conferir comprovante ${file.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Conferir comprovante de integração', exact: true });
    await dialog.getByLabel('Justificativa da conferência *', { exact: true }).fill('Comprovante e vínculo conferidos explicitamente neste teste.');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Registrar conferência', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await panel.getByRole('button', { name: 'Registrar nova integração', exact: true }).click();
    await panel.getByLabel('Data de realização *', { exact: true }).fill(dates.today);
    await panel.getByLabel('Validade da integração', { exact: true }).fill(dates.until);
    await panel.getByLabel('Origem do comprovante', { exact: true }).selectOption('EXISTING');
    await panel.getByLabel('Comprovante já vinculado *', { exact: true }).selectOption({ label: `${file.name} · Comprovante conferido` });
    await panel.getByLabel('Situação da integração *', { exact: true }).selectOption('INTEGRATED');
    await panel.getByRole('button', { name: 'Salvar integração', exact: true }).click();
    await expect(panel.getByText(/Integração administrativa registrada\./)).toBeVisible();
    await noOverflow(page);
    await page.getByRole('link', { name: fromReadiness ? 'Voltar às pendências' : 'Voltar ao atendimento', exact: true }).click();
    await expect(page).toHaveURL(normalizedOrigin);
    if (fromReadiness) {
      await expect(page.getByRole('heading', { name: 'Nenhum atendimento nesta consulta', exact: true })).toBeVisible();
      await expect(page.getByRole('searchbox')).toHaveValue('Julia');
      await page.getByRole('combobox', { name: 'Situação documental', exact: true }).selectOption('all');
      await expect(page.getByRole('heading', { name: 'Julia Demo', exact: true })).toBeVisible();
      await expect(page.getByText('Documentação conferida', { exact: true })).toBeVisible();
    } else {
      const eligibility = page.getByRole('region', { name: 'Elegibilidade documental dos participantes', exact: true });
      await expect(eligibility.getByText('Todos os requisitos aplicáveis estão conferidos neste momento.', { exact: true })).toBeVisible();
      const integration = eligibility.getByRole('heading', { name: 'Comprovação da integração administrativa', exact: true }).locator('../..');
      await expect(integration.getByRole('button')).toHaveCount(0);
      await expect(integration.getByRole('link', { name: 'Consultar integração de Julia Demo', exact: true })).toBeVisible();
    }
    const appointment = await page.evaluate(async id => { const moduleUrl = '/src/shared/api/client.ts'; const { api } = await import(moduleUrl); return api.get(`/appointments/${id}`); }, appointmentId);
    expect(appointment.status).toBe('REQUESTED'); expect(appointment.permitId).toBeUndefined();
    await noOverflow(page); expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`regularizacao-${width}.png`), fullPage: true });
  });
}
