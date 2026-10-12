import { expect, test, type Page } from '@playwright/test';
import { loginDemo, logout, navigateWithinApp, simplePdf } from './helpers';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function prepareFixture(page: Page, appointmentId: string, execute = true) {
  return page.evaluate(async ({ appointmentId, execute }) => {
    const moduleUrl = '/src/shared/api/client.ts';
    const sourceUrl = '/src/features/permits/templates/ri-s-36001.ts';
    const { api, revisionEtag } = await import(moduleUrl);
    const { PT_EQUIPMENT, PT_CONTROLS } = await import(sourceUrl);
    const appointment = await api.get(`/appointments/${appointmentId}`);
    let permit = await api.post(`/appointments/${appointmentId}/open-permit`, {}, { etag: revisionEtag(appointment.revision) });
    if (execute) {
      const preparation = permit.preparation;
      preparation.identification.serviceProvider = 'Fornecedor sintético E2E';
      preparation.identification.workFront = 'Frente de apoio fictícia';
      preparation.identification.activityDescription = 'Registro didático dos controles na frente de apoio.';
      preparation.identification.riskAnalysisReference = 'AR-DEMO-E2E';
      preparation.activities = ['overlapping'];
      preparation.equipment = [PT_EQUIPMENT[0].id];
      preparation.controls = [PT_CONTROLS[0].id];
      preparation.checks = preparation.checks.map((item: { section: string; answer: string | null }) => item.section === 'overlapping' ? { ...item, answer: 'YES' } : item);
      permit = await api.patch(`/work-permits/${permit.id}/preparation`, preparation, { etag: revisionEtag(permit.revision) });
      permit = await api.patch(`/work-permits/${permit.id}/checklist`, { items: permit.checklist.map((item: object) => ({ ...item, answer: 'YES' })) }, { etag: revisionEtag(permit.revision) });
      permit = await api.post(`/work-permits/${permit.id}/sciences`, { workerId: permit.appointment.participants[0].workerId, declarantName: 'Camila Demo', representation: 'Camila Demo', method: 'TYPED', confirmed: true }, { etag: revisionEtag(permit.revision) });
      permit = await api.post(`/work-permits/${permit.id}/release`, { confirmed: true }, { etag: revisionEtag(permit.revision) });
      permit = await api.post(`/work-permits/${permit.id}/start`, { confirmed: true }, { etag: revisionEtag(permit.revision) });
    }
    return `/app/pts/${permit.id}`;
  }, { appointmentId, execute });
}

test('anexo, interrupção, retomada e encerramento preservam a versão no celular e no PDF', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const path = await prepareFixture(page, id(221));
  await navigateWithinApp(page, path);
  const attachment = page.getByRole('region', { name: 'Anexos de acompanhamento da PT' });
  await attachment.getByLabel('Arquivo de acompanhamento *', { exact: true }).setInputFiles(simplePdf('Acompanhamento ficticio da atividade'));
  await attachment.getByLabel('Descrição do anexo *', { exact: true }).fill('Registro fictício da frente de apoio no cenário de desenvolvimento.');
  await attachment.getByRole('button', { name: 'Registrar anexo', exact: true }).click();
  await expect(attachment.getByText('documento-teste.pdf', { exact: true })).toBeVisible();
  await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0);
  const draft = 'Resumo preservado durante uma interrupção fictícia da atividade.';
  await page.getByLabel('Resumo do atendimento', { exact: true }).fill(draft);
  await page.getByRole('button', { name: 'Suspender operação', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo da suspensão *', { exact: true }).fill('Interrupção fictícia para nova conferência das condições.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar: suspender operação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Operação suspensa', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Concluir atividade e enviar para revisão', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retomar operação', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Conferência para retomada *', { exact: true }).fill('Equipe e controles do cenário fictício conferidos novamente.');
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check();
  await dialog.getByRole('button', { name: 'Confirmar: retomar operação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Resumo do atendimento', { exact: true })).toHaveValue(draft);
  const closing = page.getByLabel('Checklist de encerramento do modelo', { exact: true });
  for (const radio of await closing.getByRole('radio', { name: 'Sim', exact: true }).all()) await radio.check();
  await page.getByRole('button', { name: 'Concluir atividade e enviar para revisão', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar ação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Aguardando revisão', { exact: true }).first()).toBeVisible();
  await logout(page);
  await page.getByRole('button', { name: 'Engenheiro', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await navigateWithinApp(page, `${path}/imprimir`);
  const document = page.getByRole('article', { name: 'Registro imprimível da PT' });
  await expect(document).toContainText('Fornecedor sintético E2E');
  await expect(document).toContainText('documento-teste.pdf');
  await expect(document).toContainText(draft);
  await expect(document).toContainText('PENDENTE DE REVISÃO');
  await expect(document.getByText('Sim', { exact: true })).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'Imprimir / salvar PDF' })).toBeEnabled();
  await page.screenshot({ path: 'docs/frontend/qa/pt-modelo-preenchido-desktop.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: 'docs/frontend/qa/pt-modelo-preenchido.pdf', format: 'A4', printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } });
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/frontend/qa/pt-modelo-preenchido-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('cancelamento conserva a PT e seu agendamento de origem para consulta', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  const path = await prepareFixture(page, id(220), false);
  await navigateWithinApp(page, path);
  await page.getByRole('button', { name: 'Cancelar PT', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo do cancelamento *', { exact: true }).fill('Atividade fictícia cancelada antes da liberação.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar: cancelar pt', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Cancelada', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retomar operação', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Visualizar / imprimir PT', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Registro imprimível da PT' })).toContainText('PERMISSÃO CANCELADA');
  const origin = await page.evaluate(async appointmentId => {
    const moduleUrl = '/src/shared/api/client.ts';
    const { api } = await import(moduleUrl);
    const appointment = await api.get(`/appointments/${appointmentId}`);
    return { status: appointment.status, permitId: appointment.permitId };
  }, id(220));
  expect(origin.status).toBe('ATTENDANCE_OPENED');
  expect(path).toBe(`/app/pts/${origin.permitId}`);
});
