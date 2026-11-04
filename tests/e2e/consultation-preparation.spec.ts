import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const appointmentId = '00000000-0000-4000-8000-000000000221';
const unitId = '00000000-0000-4000-8000-000000000002';
const atSearchLabel = 'Buscar AT por código/atendimento/equipe/local';
const petSearchLabel = 'Buscar PET por código/espaço/tarefa';

async function expectConsultation(page: Page, kind: 'ats' | 'pets', criteria: Record<string, string> = {}) {
  await expect(page).toHaveURL(url => url.pathname === '/app/consulta'
    && url.searchParams.get('tab') === kind && url.searchParams.get('unitId') === unitId
    && Object.entries(criteria).every(([name, value]) => url.searchParams.get(name) === value));
}

async function expectMobileLayout(page: Page) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
}

test('central permite percorrer as quatro abas por teclado sem transbordamento no celular', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  await navigateWithinApp(page, '/app/consulta', `/app/consulta?tab=documents&unitId=${unitId}`);
  const tabs = page.getByRole('tablist', { name: 'Abas de consulta', exact: true });
  const documents = tabs.getByRole('tab', { name: 'Documentos controlados', exact: true });
  const permits = tabs.getByRole('tab', { name: 'Permissões de trabalho (PT)', exact: true });
  const authorizations = tabs.getByRole('tab', { name: 'Autorizações de trabalho (AT)', exact: true });
  const pets = tabs.getByRole('tab', { name: 'Permissões de entrada e trabalho (PET)', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeEnabled();
  await documents.focus();
  for (const tab of [permits, authorizations, pets, documents]) {
    await page.keyboard.press('ArrowRight');
    await expect(tab).toBeFocused(); await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await page.keyboard.press('End'); await expect(pets).toBeFocused(); await expect(pets).toHaveAttribute('aria-selected', 'true'); await expectConsultation(page, 'pets');
  await page.keyboard.press('Home'); await expect(documents).toBeFocused(); await expect(documents).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft'); await expect(pets).toBeFocused(); await expect(pets).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Consulta de PETs', exact: true })).toContainText('A entrada não está autorizada.');
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeEnabled();
  await expectMobileLayout(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('central-quatro-abas-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('central conserva filtros da AT entre detalhe, impressão, edição e cancelamento demonstrativo', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const created = await page.evaluate(async input => {
    const clientPath = '/src/shared/api/client.ts', modelPath = '/src/features/authorizations/model.ts';
    const { api } = await import(clientPath); const { createAuthorizationPreparation } = await import(modelPath);
    const appointment = await api.get(`/appointments/${input.appointmentId}`);
    const preparation = createAuthorizationPreparation(appointment);
    preparation.identification.activityDescription = 'Preparação sintética para a consulta central de AT.';
    const result = await api.post('/work-authorizations', { appointmentId: appointment.id, permitId: null, ...preparation }, { query: { unitId: input.unitId } });
    return { id: result.id, code: result.code };
  }, { appointmentId, unitId });

  await navigateWithinApp(page, `/app/consulta?tab=ats&unitId=${unitId}`);
  const consultation = page.getByRole('region', { name: 'Consulta de ATs', exact: true });
  const search = consultation.getByLabel(atSearchLabel, { exact: true });
  await expect(search).toBeEnabled(); await search.fill(created.code);
  await consultation.getByLabel('Estado da AT', { exact: true }).selectOption('DRAFT');
  await consultation.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expectConsultation(page, 'ats', { q: created.code, status: 'DRAFT' });
  const table = page.getByRole('region', { name: 'Tabela de ATs', exact: true });
  await expect(table.getByRole('link', { name: created.code, exact: true })).toBeVisible();
  await expectMobileLayout(page);
  await table.getByRole('link', { name: created.code, exact: true }).click();
  await expect(page.getByRole('link', { name: 'Voltar à consulta', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Imprimir AT', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Registro imprimível da AT', exact: true })).toContainText('SEM VALIDADE OPERACIONAL');
  await expectMobileLayout(page);
  await page.getByRole('link', { name: 'Voltar à AT', exact: true }).click();
  await page.getByRole('link', { name: 'Editar rascunho', exact: true }).click();
  const description = 'Preparação atualizada mantendo os filtros da central de consulta.';
  await page.getByLabel('Descrição da atividade', { exact: true }).fill(description);
  await expect(page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preparação registrada da AT', exact: true })).toContainText(description);
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expectConsultation(page, 'ats', { q: created.code, status: 'DRAFT' });
  await expect(search).toHaveValue(created.code); await expect(consultation.getByLabel('Estado da AT', { exact: true })).toHaveValue('DRAFT');
  const row = table.getByRole('row').filter({ has: page.getByRole('link', { name: created.code, exact: true }) });
  await expect(row.getByRole('cell').last()).toHaveText('2');

  await table.getByRole('link', { name: created.code, exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar AT', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar AT', exact: true });
  await dialog.getByLabel('Motivo *', { exact: true }).fill('Cancelamento demonstrativo para atualizar a consulta da mesma unidade.');
  await dialog.getByRole('checkbox', { name: /Conferi os dados e confirmo esta ação/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar cancelar at', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expectConsultation(page, 'ats', { q: created.code, status: 'DRAFT' });
  await expect(consultation.getByText('Nenhuma AT encontrada', { exact: true })).toBeVisible();
  await expect(consultation.getByLabel('Estado da AT', { exact: true })).toBeEnabled();
  await consultation.getByLabel('Estado da AT', { exact: true }).selectOption('CANCELED');
  await consultation.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expectConsultation(page, 'ats', { q: created.code, status: 'CANCELED' });
  await expect(table.getByRole('row').filter({ has: page.getByRole('link', { name: created.code, exact: true }) })).toContainText('Cancelada');
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeEnabled();
  await expectMobileLayout(page); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('central-at-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('central conserva busca e página da PET após editar, imprimir e consultar revisão histórica', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const searchTerm = 'Consulta central PET E2E';
  const created = await page.evaluate(async input => {
    const clientPath = '/src/shared/api/client.ts', modelPath = '/src/features/confined-space/model.ts';
    const { api } = await import(clientPath); const { createPetPreparation } = await import(modelPath);
    const appointment = await api.get(`/appointments/${input.appointmentId}`);
    const records = [];
    for (let index = 0; index < 11; index++) {
      const preparation = createPetPreparation(appointment);
      preparation.identification.spaceCode = `EC-CENTRAL-${index + 1}`;
      preparation.identification.task = `${input.searchTerm} · tarefa ${index + 1}`;
      const result = await api.post('/confined-space-permits', { appointmentId: appointment.id, ...preparation }, { query: { unitId: input.unitId } });
      records.push({ id: result.id, code: result.code, task: preparation.identification.task });
    }
    return records;
  }, { appointmentId, unitId, searchTerm });

  await navigateWithinApp(page, `/app/consulta?tab=pets&unitId=${unitId}`);
  const consultation = page.getByRole('region', { name: 'Consulta de PETs', exact: true });
  const search = consultation.getByLabel(petSearchLabel, { exact: true });
  await expect(search).toBeEnabled(); await search.fill(searchTerm);
  await consultation.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expectConsultation(page, 'pets', { q: searchTerm });
  await consultation.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expectConsultation(page, 'pets', { q: searchTerm, page: '2' });
  const table = page.getByRole('region', { name: 'Tabela de PETs', exact: true });
  const recordLink = table.getByRole('link', { name: /^PET-DEMO-/ });
  await expect(recordLink).toHaveCount(1);
  const code = await recordLink.innerText(); const original = created.find(record => record.code === code)!;
  expect(original).toBeDefined();
  await expect(consultation).toContainText('A entrada não está autorizada.');
  await expectMobileLayout(page);
  await recordLink.click();
  await page.getByRole('link', { name: 'Visualizar / imprimir rascunho', exact: true }).click();
  const print = page.getByRole('article', { name: 'Rascunho imprimível da PET', exact: true });
  await expect(print).toContainText('ENTRADA NÃO AUTORIZADA'); await expect(print).toContainText(original.task);
  await expectMobileLayout(page);
  await page.getByRole('link', { name: 'Voltar à PET', exact: true }).click();
  await page.getByRole('link', { name: 'Editar preparação', exact: true }).click();
  const task = `${searchTerm} · tarefa atualizada após consulta`;
  await page.getByLabel('Objetivo da entrada / tarefa prevista', { exact: true }).fill(task);
  await page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true }).click();
  const preparation = page.getByRole('article', { name: 'Preparação da PET', exact: true });
  await expect(preparation).toContainText(task);
  await page.getByLabel('Revisão da preparação', { exact: true }).selectOption('1');
  await expect(preparation).toContainText(original.task); await expect(preparation).not.toContainText(task);
  await expect(page.getByRole('link', { name: 'Editar preparação', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Visualizar / imprimir rascunho', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `/app/pets/${original.id}/imprimir` && url.searchParams.get('revision') === '1');
  await expect(print).toContainText(original.task); await expect(print).not.toContainText(task);
  await page.getByRole('link', { name: 'Voltar à PET', exact: true }).click();
  await expect(page.getByLabel('Revisão da preparação', { exact: true })).toHaveValue('1');
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expectConsultation(page, 'pets', { q: searchTerm, page: '2' });
  await expect(search).toHaveValue(searchTerm);
  await expect(consultation.getByRole('navigation', { name: 'Paginação da consulta de PETs', exact: true })).toContainText('11 registro(s) · página 2 de 2');
  await expect(consultation.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await expect(table.getByRole('link', { name: /^PET-DEMO-/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeEnabled();
  await expectMobileLayout(page); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('central-pet-pagina-2-mobile.png'), fullPage: true, animations: 'disabled' });
  // Updating a draft changes its ordering; the preserved second page must still show a fresh server page.
  await consultation.getByRole('button', { name: 'Anterior', exact: true }).click();
  await expectConsultation(page, 'pets', { q: searchTerm });
  const updatedRow = table.getByRole('row').filter({ has: page.getByRole('link', { name: code, exact: true }) });
  await expect(updatedRow).toContainText(task); await expect(updatedRow.getByRole('cell').last()).toHaveText('2');
  expect(errors).toEqual([]);
});
