import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const appointmentId = '00000000-0000-4000-8000-000000000221';
const unitId = '00000000-0000-4000-8000-000000000002';

async function expectList(page: Page, list: 'ats' | 'pets', criteria: Record<string, string>) {
  await expect(page).toHaveURL(url => url.pathname === `/app/${list}`
    && url.searchParams.get('unitId') === unitId
    && Object.entries(criteria).every(([key, value]) => url.searchParams.get(key) === value));
}

async function expectMobileLayout(page: Page) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
}

test('AT conserva pesquisa e estado entre consulta, impressão, edição e novo rascunho', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const created = await page.evaluate(async input => {
    const clientPath = '/src/shared/api/client.ts';
    const modelPath = '/src/features/authorizations/model.ts';
    const { api } = await import(clientPath);
    const { createAuthorizationPreparation } = await import(modelPath);
    const appointment = await api.get(`/appointments/${input.appointmentId}`);
    const preparation = createAuthorizationPreparation(appointment);
    preparation.identification.activityDescription = 'Preparação sintética para conferir o retorno aos filtros da AT.';
    return api.post('/work-authorizations', { appointmentId: appointment.id, permitId: null, ...preparation }, { query: { unitId: input.unitId } });
  }, { appointmentId, unitId });

  await navigateWithinApp(page, '/app/ats');
  await page.getByLabel('Pesquisar AT', { exact: true }).fill(created.code);
  await page.getByLabel('Estado da AT', { exact: true }).selectOption('DRAFT');
  await expectList(page, 'ats', { q: created.code, status: 'DRAFT' });
  await expectMobileLayout(page);
  const consult = page.getByRole('link', { name: `Consultar ${created.code}`, exact: true });
  await consult.click();
  await expect(page.getByRole('heading', { name: created.code, exact: true })).toBeVisible();
  await page.goBack();
  await expectList(page, 'ats', { q: created.code, status: 'DRAFT' });
  await expect(page.getByLabel('Pesquisar AT', { exact: true })).toHaveValue(created.code);
  await expect(page.getByLabel('Estado da AT', { exact: true })).toHaveValue('DRAFT');
  await consult.click();
  await page.getByRole('link', { name: 'Imprimir AT', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Registro imprimível da AT', exact: true })).toContainText('SEM VALIDADE OPERACIONAL');
  await expectMobileLayout(page);
  await page.getByRole('link', { name: 'Voltar à AT', exact: true }).click();
  await page.getByRole('link', { name: 'Editar rascunho', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Preparação da AT', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Cancelar preenchimento', exact: true }).click();
  await expect(page.getByRole('heading', { name: created.code, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Editar rascunho', exact: true }).click();
  const description = 'Descrição atualizada para conferir que o salvamento conserva a origem da consulta.';
  await page.getByLabel('Descrição da atividade', { exact: true }).fill(description);
  await expectMobileLayout(page);
  await page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preparação registrada da AT', exact: true })).toContainText(description);
  await page.getByRole('link', { name: 'Voltar às ATs', exact: true }).click();
  await expectList(page, 'ats', { q: created.code, status: 'DRAFT' });
  await expect(consult).toBeVisible();
  await page.getByRole('link', { name: 'Criar AT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Criar Autorização de Trabalho', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar', exact: true }).click();
  await expectList(page, 'ats', { q: created.code, status: 'DRAFT' });
  expect(errors).toEqual([]);
});

test('PET conserva a busca e a segunda página após imprimir, salvar e cancelar preenchimento', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const search = 'Retorno de preparação E2E';
  await page.evaluate(async input => {
    const clientPath = '/src/shared/api/client.ts';
    const modelPath = '/src/features/confined-space/model.ts';
    const { api } = await import(clientPath);
    const { createPetPreparation } = await import(modelPath);
    const appointment = await api.get(`/appointments/${input.appointmentId}`);
    for (let index = 0; index < 11; index++) {
      const preparation = createPetPreparation(appointment);
      preparation.identification.spaceCode = `EC-RETORNO-${index + 1}`;
      preparation.identification.task = `${input.search} · espaço ${index + 1}`;
      await api.post('/confined-space-permits', { appointmentId: appointment.id, ...preparation }, { query: { unitId: input.unitId } });
    }
  }, { appointmentId, unitId, search });

  await navigateWithinApp(page, '/app/pets');
  await page.getByLabel('Buscar PET por código, espaço ou tarefa', { exact: true }).fill(search);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expectList(page, 'pets', { q: search });
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expectList(page, 'pets', { q: search, page: '2' });
  const records = page.getByRole('region', { name: 'Preparações de PET', exact: true });
  const recordLink = records.getByRole('link', { name: /^PET-DEMO-/ }).first();
  await expect(records.getByRole('link', { name: /^PET-DEMO-/ })).toHaveCount(1);
  const code = await recordLink.innerText();
  await expectMobileLayout(page);
  await recordLink.click();
  await expect(page.getByRole('heading', { name: code, exact: true })).toBeVisible();
  await page.goBack();
  await expectList(page, 'pets', { q: search, page: '2' });
  await expect(page.getByLabel('Buscar PET por código, espaço ou tarefa', { exact: true })).toHaveValue(search);
  await recordLink.click();
  await page.getByRole('link', { name: 'Visualizar / imprimir rascunho', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Rascunho imprimível da PET', exact: true })).toContainText('ENTRADA NÃO AUTORIZADA');
  await expectMobileLayout(page);
  await page.getByRole('link', { name: 'Voltar à PET', exact: true }).click();
  await page.getByRole('link', { name: 'Editar preparação', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Preparação da PET', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Cancelar preenchimento', exact: true }).click();
  await expect(page.getByRole('heading', { name: code, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Editar preparação', exact: true }).click();
  const task = `${search} · preparação atualizada nesta demonstração`;
  await page.getByLabel('Objetivo da entrada / tarefa prevista', { exact: true }).fill(task);
  await expectMobileLayout(page);
  await page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Preparação da PET', exact: true })).toContainText(task);
  await page.getByRole('link', { name: 'Voltar às PETs', exact: true }).click();
  await expectList(page, 'pets', { q: search, page: '2' });
  await expect(records).toContainText('página 2');
  await expect(page.getByRole('button', { name: 'Anterior', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('pet-lista-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Nova PET', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preparar PET', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar', exact: true }).click();
  await expectList(page, 'pets', { q: search, page: '2' });
  expect(errors).toEqual([]);
});
