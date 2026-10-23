import { expect, test } from '@playwright/test';
import { loginDemo, logout, navigateWithinApp } from './helpers';

const appointmentId = '00000000-0000-4000-8000-000000000221';
const unitId = '00000000-0000-4000-8000-000000000002';

test('técnico prepara PET, conserva revisões e imprime rascunho sem alterar atendimento', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  await navigateWithinApp(page, `/app/agenda/${appointmentId}`);
  const original = await page.evaluate(async id => {
    const module = '/src/shared/api/client.ts'; const { api } = await import(module);
    return api.get(`/appointments/${id}`);
  }, appointmentId);
  await page.getByRole('link', { name: 'Preparar PET', exact: true }).click();
  await expect(page.getByLabel('Atendimento da PET *', { exact: true })).toHaveValue(appointmentId);
  const form = page.getByRole('form', { name: 'Preparação da PET' });
  await form.getByLabel('Identificação do espaço confinado', { exact: true }).fill('EC-DEMO-01');
  await form.getByLabel('Descrição do espaço e dos acessos', { exact: true }).fill('Espaço fictício para avaliação do formulário.');
  await form.getByLabel('Objetivo da entrada / tarefa prevista', { exact: true }).fill('Inspeção sintética da revisão inicial');
  await form.getByLabel('Participante do atendimento', { exact: true }).selectOption({ label: 'Camila Demo · Executante' });
  await form.getByLabel('Papel previsto para o participante', { exact: true }).selectOption('ENTRANT');
  await form.getByRole('button', { name: 'Adicionar participante cadastrado', exact: true }).click();
  for (const [index, role] of ['WATCHER', 'ENTRY_SUPERVISOR', 'RESCUE'].entries()) {
    await form.getByRole('button', { name: 'Adicionar pessoa prevista', exact: true }).click();
    const number = index + 2;
    await form.getByLabel(`Nome da pessoa ${number}`, { exact: true }).fill(`Pessoa fictícia ${number}`);
    await form.getByLabel(`Função no serviço da pessoa ${number}`, { exact: true }).fill('Função sintética');
    await form.getByLabel(`Papel previsto da pessoa ${number}`, { exact: true }).selectOption(role);
  }
  await form.getByRole('group', { name: /Equipamentos previstos/ }).getByRole('checkbox').first().check();
  await form.getByRole('group', { name: /Controles previstos/ }).getByRole('checkbox').first().check();
  await form.getByLabel('Controles adicionais', { exact: true }).fill('Controle fictício registrado para conferir impressão e revisão.');
  const checks = form.getByRole('combobox', { name: /^Resposta da verificação/ });
  expect(await checks.count()).toBe(23);
  for (const check of await checks.all()) await check.selectOption('YES');
  await form.getByRole('button', { name: 'Adicionar leitura atmosférica', exact: true }).click();
  await form.getByLabel('Data e hora da leitura 1', { exact: true }).fill('2026-10-11T08:00');
  await form.getByLabel('Instrumento da leitura 1', { exact: true }).fill('Instrumento fictício');
  await form.getByLabel('Responsável pela leitura 1', { exact: true }).fill('Pessoa fictícia');
  await form.getByLabel('Oxigênio (%) da leitura 1', { exact: true }).fill('20,9');
  await form.getByLabel('Monóxido de carbono (ppm) da leitura 1', { exact: true }).fill('0');
  await form.getByLabel('Inflamabilidade (% LIE) da leitura 1', { exact: true }).fill('0');
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PET-DEMO-001', exact: true })).toBeVisible();
  const path = new URL(page.url()).pathname; const id = path.split('/').at(-1)!;
  const record = await page.evaluate(async ids => {
    const module = '/src/shared/api/client.ts'; const { api } = await import(module);
    return { pet: await api.get(`/confined-space-permits/${ids.id}`, { query: { unitId: ids.unitId } }), appointment: await api.get(`/appointments/${ids.appointmentId}`) };
  }, { id, unitId, appointmentId });
  expect(record.appointment).toEqual(original);
  expect(record.pet.status).toBe('DRAFT'); expect(record.pet.preparation.people).toHaveLength(4);
  expect(record.pet.preparation.people[0].registration).toBe('DEMO-001');
  expect(record.pet.preparation.atmosphere[0].measuredAt).toBe('2026-10-11T11:00:00.000Z');
  await page.screenshot({ path: 'docs/frontend/qa/pet-rascunho-desktop.png' });
  await page.getByRole('link', { name: 'Editar preparação', exact: true }).click();
  await page.getByLabel('Objetivo da entrada / tarefa prevista', { exact: true }).fill('Tarefa da segunda revisão');
  await page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PET-DEMO-001', exact: true })).toBeVisible();
  await page.getByLabel('Revisão da preparação', { exact: true }).selectOption('1');
  const preparation = page.getByRole('article', { name: 'Preparação da PET' });
  await expect(preparation).toContainText('Inspeção sintética da revisão inicial');
  await expect(preparation).not.toContainText('Tarefa da segunda revisão');
  await expect(page.getByRole('link', { name: 'Editar preparação', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Visualizar / imprimir rascunho', exact: true }).click();
  const paper = page.getByRole('article', { name: 'Rascunho imprimível da PET' });
  await expect(paper).toContainText('Inspeção sintética da revisão inicial');
  await expect(paper).not.toContainText('Tarefa da segunda revisão');
  await expect(paper).toContainText('NÃO EMITIDO'); await expect(paper).toContainText('ENTRADA NÃO AUTORIZADA');
  await expect(paper).toContainText('DADOS FICTÍCIOS'); await expect(paper).toContainText('20,9');
  await page.pdf({ path: 'docs/frontend/qa/pet-rascunho-revisao-1.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'docs/frontend/qa/pet-rascunho-mobile.png' });
  await navigateWithinApp(page, `${path}/imprimir?revision=999`);
  await expect(page.getByRole('heading', { name: 'Revisão não encontrada', exact: true })).toBeVisible();
  await expect(paper).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PET preserva preenchimento em conflito e aplica permissões e unidade', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  const created = await page.evaluate(async input => {
    const module = '/src/shared/api/client.ts'; const { api } = await import(module);
    const model = '/src/features/confined-space/model.ts'; const { createPetPreparation } = await import(model);
    const appointment = await api.get(`/appointments/${input.appointmentId}`);
    return api.post('/confined-space-permits', { appointmentId: appointment.id, ...createPetPreparation(appointment) }, { query: { unitId: input.unitId } });
  }, { appointmentId, unitId });
  const path = `/app/pets/${created.id}`;
  await navigateWithinApp(page, `${path}/editar`);
  await page.getByLabel('Objetivo da entrada / tarefa prevista', { exact: true }).fill('Preenchimento local preservado');
  await page.evaluate(async input => {
    const module = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(module);
    const current = await api.get(`/confined-space-permits/${input.id}`, { query: { unitId: input.unitId } });
    current.preparation.identification.task = 'Alteração de outra sessão simulada';
    await api.patch(`/confined-space-permits/${input.id}`, current.preparation, { query: { unitId: input.unitId }, etag: revisionEtag(current.revision) });
  }, { id: created.id, unitId });
  await page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Conferir PET atual', exact: true })).toBeVisible();
  await expect(page.getByLabel('Objetivo da entrada / tarefa prevista', { exact: true })).toHaveValue('Preenchimento local preservado');
  await expect(page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Conferir PET atual', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conferência da PET atual' })).toContainText('Alteração de outra sessão simulada');
  await page.getByRole('button', { name: 'Usar revisão atual e manter preenchimento', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar rascunho da PET', exact: true }).click();
  await expect(page.getByRole('heading', { name: created.code, exact: true })).toBeVisible();
  await page.getByLabel('Unidade de trabalho').selectOption('00000000-0000-4000-8000-000000000003');
  await expect(page.getByText('Preparação de PET não encontrada ou fora da unidade selecionada.', { exact: true })).toBeVisible();
  await page.getByLabel('Unidade de trabalho').selectOption(unitId);
  await expect(page.getByRole('heading', { name: created.code, exact: true })).toBeVisible();
  await logout(page); await page.getByRole('button', { name: 'Auditor', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/); await navigateWithinApp(page, path);
  await expect(page.getByRole('heading', { name: created.code, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Editar preparação', exact: true })).toHaveCount(0);
  await navigateWithinApp(page, `${path}/editar`);
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
  await logout(page); await page.getByRole('button', { name: 'Trabalhador', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/documentos/); await navigateWithinApp(page, path);
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Permissões de entrada e trabalho (PET)', exact: true })).toHaveCount(0);
});
