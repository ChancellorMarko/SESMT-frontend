import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { loginDemo, logout, navigateWithinApp, simplePdf } from './helpers';

const workerId = '00000000-0000-4000-8000-000000000040';
const workerRoute = `/app/trabalhadores/${workerId}`;
const workerEndpoint = `/workers/${workerId}`;
const unitId = '00000000-0000-4000-8000-000000000002';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
async function openRegistration(page: Page, date: string) {
  const panel = page.getByRole('region', { name: 'Integração administrativa', exact: true });
  const register = panel.getByRole('button', { name: 'Registrar nova integração', exact: true });
  await expect(register).toBeEnabled(); await register.click();
  await panel.getByLabel('Data de realização *', { exact: true }).fill(date);
  return panel;
}
async function integrationRecord(page: Page) {
  return page.evaluate(async endpoint => {
    const clientUrl = '/src/shared/api/client.ts';
    const { api } = await import(clientUrl);
    return api.get(endpoint);
  }, workerEndpoint);
}
async function eligibleForAppointment(page: Page) {
  return page.evaluate(async () => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    return (await api.get('/appointments/00000000-0000-4000-8000-000000000221/eligibility')).eligible;
  });
}

for (const width of [320, 390]) {
  test(`RH vincula prova e engenheiro confere antes do registro integrado a ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await loginDemo(page, 'RH');
    await navigateWithinApp(page, workerRoute);
    await expect(page.getByRole('heading', { name: 'Camila Demo', exact: true })).toBeVisible();
    expect(await eligibleForAppointment(page)).toBe(true);
    const baselinePermits = await page.evaluate(async unit => {
      const clientUrl = '/src/shared/api/client.ts';
      const { api } = await import(clientUrl);
      return (await api.get('/work-permits', { query: { unitId: unit } })).length;
    }, unitId);
    const dates = await page.evaluate(() => {
      const civil = (offset: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
      return { today: civil(0), validity: civil(30) };
    });
    const panel = await openRegistration(page, dates.today);
    await panel.getByLabel('Origem do comprovante', { exact: true }).selectOption('UPLOAD');
    const file = { ...simplePdf(`Prova de integracao sintetica ${width}`), name: `integracao-e2e-${width}.pdf` };
    await panel.getByLabel('Arquivo do comprovante *', { exact: true }).setInputFiles(file);
    await expect(panel.getByText(`Selecionado: ${file.name}`, { exact: true })).toBeVisible();
    await panel.getByLabel('Validade da integração', { exact: true }).fill(dates.validity);
    const pendingNote = `Registro pendente de teste ${width}`;
    await panel.getByLabel('Observações operacionais', { exact: true }).fill(pendingNote);
    await noOverflow(page);
    await panel.getByRole('button', { name: 'Salvar integração', exact: true }).click();
    await expect(panel.getByText(/Integração administrativa registrada\. A execução continua/)).toBeVisible();
    await expect(panel.getByRole('button', { name: `Conferir comprovante ${file.name}`, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: `Rejeitar comprovante ${file.name}`, exact: true })).toHaveCount(0);
    const pending = await integrationRecord(page);
    expect(await eligibleForAppointment(page)).toBe(false);
    expect(pending.integrationStatus).toBe('PENDING'); expect(pending.integrationEvidence.status).toBe('PENDING');
    expect(pending.integrationHistory.some((entry: { status: string; notes?: string }) => entry.status === 'PENDING' && entry.notes === pendingNote)).toBe(true);
    // RH can submit proof but cannot forge a review even with the visible evidence revision.
    const reviewDenied = await page.evaluate(async value => {
      const clientUrl = '/src/shared/api/client.ts';
      const { api } = await import(clientUrl);
      try { await api.post(`/workers/${value.workerId}/integration/evidences/${value.evidenceId}/review`, { decision: 'APPROVE', comment: 'Tentativa indevida do perfil RH.', confirmed: true }, { etag: `"${value.revision}"` }); return 200; }
      catch (error) { return (error as { status: number }).status; }
    }, { workerId, evidenceId: pending.integrationEvidence.id, revision: pending.integrationEvidence.revision });
    expect(reviewDenied).toBe(403);
    await expect(panel.getByRole('button', { name: `Consultar arquivo ${file.name}`, exact: true })).toBeEnabled({ timeout: 15_000 });
    const downloaded = page.waitForEvent('download');
    await panel.getByRole('button', { name: `Consultar arquivo ${file.name}`, exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(file.name);
    const downloadedPath = await download.path(); expect(downloadedPath).not.toBeNull();
    expect(await readFile(downloadedPath!)).toEqual(file.buffer);
    await noOverflow(page);

    // Login through the existing SPA so the in-memory evidence survives the role change.
    await logout(page);
    await page.getByRole('button', { name: 'Engenheiro', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await navigateWithinApp(page, workerRoute);
    await expect(panel.getByRole('button', { name: `Conferir comprovante ${file.name}`, exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: `Conferir comprovante ${file.name}`, exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Conferir comprovante de integração', exact: true });
    await review.getByLabel('Justificativa da conferência *', { exact: true }).fill('Prova e vínculo administrativo conferidos neste teste.');
    await review.getByRole('checkbox', { name: 'Confirmo explicitamente a decisão para este comprovante.', exact: true }).check();
    await noOverflow(page);
    await review.getByRole('button', { name: 'Registrar conferência', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(panel.getByText(/Conferência registrada\. A aprovação do comprovante não muda/)).toBeVisible();
    const afterReview = await integrationRecord(page);
    expect(await eligibleForAppointment(page)).toBe(false);
    expect(afterReview.integrationStatus).toBe('PENDING');
    const approvedEvidence = await page.evaluate(async endpoint => {
      const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
      return api.get(`${endpoint}/integration/evidences`);
    }, workerEndpoint);
    expect(approvedEvidence).toHaveLength(1); expect(approvedEvidence[0].status).toBe('APPROVED');
    expect(afterReview.integrationHistory.length).toBe(pending.integrationHistory.length);

    await openRegistration(page, dates.today);
    await panel.getByLabel('Validade da integração', { exact: true }).fill(dates.validity);
    await panel.getByLabel('Origem do comprovante', { exact: true }).selectOption('EXISTING');
    await panel.getByLabel('Comprovante já vinculado *', { exact: true }).selectOption({ label: `${file.name} · Comprovante conferido` });
    await panel.getByLabel('Situação da integração *', { exact: true }).selectOption('INTEGRATED');
    const completedNote = `Registro integrado explícito de teste ${width}`;
    await panel.getByLabel('Observações operacionais', { exact: true }).fill(completedNote);
    await panel.getByRole('button', { name: 'Salvar integração', exact: true }).click();
    await expect(panel.getByText(/Integração administrativa registrada\. A execução continua/)).toBeVisible();
    const integrated = await integrationRecord(page);
    expect(await eligibleForAppointment(page)).toBe(true);
    expect(integrated.integrationStatus).toBe('INTEGRATED'); expect(integrated.integrationEvidence.id).toBe(pending.integrationEvidence.id);
    expect(integrated.integrationHistory.length).toBe(pending.integrationHistory.length + 1);
    expect(integrated.integrationHistory.some((entry: { status: string; notes?: string }) => entry.status === 'PENDING' && entry.notes === pendingNote)).toBe(true);
    expect(integrated.integrationHistory.some((entry: { status: string; notes?: string }) => entry.status === 'INTEGRATED' && entry.notes === completedNote)).toBe(true);
    const history = panel.getByRole('heading', { name: 'Histórico de integrações', exact: true }).locator('..');
    await expect(history).toContainText(pendingNote); await expect(history).toContainText(completedNote);
    const finalPermits = await page.evaluate(async unit => {
      const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
      return (await api.get('/work-permits', { query: { unitId: unit } })).length;
    }, unitId);
    expect(finalPermits).toBe(baselinePermits);
    await expect(panel).toContainText('Nenhuma delas libera automaticamente o trabalhador ou cria uma PT.');
    await noOverflow(page); expect(errors).toEqual([]);
  });
}

test('comprovante rejeitado permanece no histórico e não pode concluir integração', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  await navigateWithinApp(page, workerRoute);
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const panel = await openRegistration(page, today);
  await panel.getByLabel('Origem do comprovante', { exact: true }).selectOption('UPLOAD');
  const file = { ...simplePdf('Prova sintética para devolução'), name: 'prova-rejeitada.pdf' };
  await panel.getByLabel('Arquivo do comprovante *', { exact: true }).setInputFiles(file);
  await expect(panel.getByText(`Selecionado: ${file.name}`, { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Salvar integração', exact: true }).click();
  await expect(panel.getByText(/Integração administrativa registrada/)).toBeVisible();
  await expect(panel.getByRole('button', { name: `Conferir comprovante ${file.name}`, exact: true })).toBeEnabled({ timeout: 15_000 });
  await panel.getByRole('button', { name: `Rejeitar comprovante ${file.name}`, exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Rejeitar comprovante de integração', exact: true });
  await review.getByLabel('Justificativa da conferência *', { exact: true }).fill('Arquivo não corresponde ao registro administrativo apresentado.');
  await review.getByRole('checkbox', { name: 'Confirmo explicitamente a decisão para este comprovante.', exact: true }).check();
  await review.getByRole('button', { name: 'Registrar conferência', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(panel.getByText('Comprovante rejeitado', { exact: true })).toBeVisible();
  await openRegistration(page, today);
  await panel.getByLabel('Origem do comprovante', { exact: true }).selectOption('EXISTING');
  await panel.getByLabel('Comprovante já vinculado *', { exact: true }).selectOption({ label: `${file.name} · Comprovante rejeitado` });
  await panel.getByLabel('Situação da integração *', { exact: true }).selectOption('INTEGRATED');
  await panel.getByRole('button', { name: 'Salvar integração', exact: true }).click();
  await expect(panel.getByText(/Para registrar Integrado, selecione um comprovante conferido/)).toBeVisible();
  expect((await integrationRecord(page)).integrationStatus).toBe('PENDING');
});
