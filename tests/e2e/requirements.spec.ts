import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('gestor salva e publica uma matriz, reavalia pendências e preserva a PT concluída', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Matriz de requisitos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Matriz de requisitos documentais' })).toBeVisible();
  await page.getByLabel('Título da regra 1 *', { exact: true }).fill('Critério revisado na demonstração E2E');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A matriz publicada continua em uso nos atendimentos.', { exact: true })).toBeVisible();
  const before = await page.evaluate(async () => {
    const moduleUrl = '/src/shared/api/client.ts'; const { api } = await import(moduleUrl);
    return api.get('/appointments/00000000-0000-4000-8000-000000000221/eligibility');
  });
  expect(before.eligible).toBe(true); expect(before.requirementVersion).toBe('DEMO-MATRIZ-1');
  await page.getByRole('button', { name: 'Publicar rascunho salvo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publicar matriz de requisitos' });
  await dialog.getByLabel('Motivo da publicação *', { exact: true }).fill('Atualização de critério sintético para verificar a nova conferência.');
  await dialog.getByRole('checkbox', { name: /Conferi o rascunho salvo/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar publicação', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Matriz publicada', exact: true })).toContainText('DEMO-MATRIZ-2');
  const after = await page.evaluate(async () => {
    const moduleUrl = '/src/shared/api/client.ts'; const { api } = await import(moduleUrl);
    const eligible = await api.get('/appointments/00000000-0000-4000-8000-000000000221/eligibility');
    const closed = await api.get('/work-permits/00000000-0000-4000-8000-000000000230');
    return { eligible, closed: closed.eligibility, snapshot: closed.snapshots[0].eligibility };
  });
  expect(after.eligible.eligible).toBe(false); expect(after.eligible.requirementVersion).toBe('DEMO-MATRIZ-2');
  expect(after.eligible.participants[0].items[0].status).toBe('MISSING');
  expect(after.closed.requirementVersion).toBe('DEMO-MATRIZ-1'); expect(after.snapshot).toEqual(after.closed);
  await page.getByRole('link', { name: 'Pendências documentais', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar pessoa ou atendimento' }).fill('camila');
  await expect(page.getByRole('heading', { name: 'Camila Demo', exact: true })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Bruno Demo', exact: true })).toHaveCount(0);
  const pending = page.getByRole('region', { name: 'Pendências de AG-DEMO-221', exact: true });
  await expect(pending).toContainText('Critério revisado na demonstração E2E');
  await expect(pending).toContainText('Ausente');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar consulta CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pendencias-documentais-DEMONSTRACAO.csv');
  await pending.getByRole('link', { name: 'Abrir conferência de AG-DEMO-221', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/agenda\/00000000-0000-4000-8000-000000000221$/);
  await expect(page.getByRole('heading', { name: 'Conferência dos participantes', exact: true })).toBeVisible();
});

test('conflito de matriz preserva preenchimento e a troca de unidade exige resolver alterações', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Matriz de requisitos', exact: true }).click();
  const title = page.getByLabel('Título da regra 1 *', { exact: true });
  await title.fill('Minha alteração local preservada');
  await page.evaluate(async () => {
    const moduleUrl = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(moduleUrl);
    const unitId = '00000000-0000-4000-8000-000000000002';
    const matrix = await api.get('/requirement-matrix', { query: { unitId } });
    const rules = structuredClone(matrix.published.rules); rules[0].label = 'Critério alterado por outra sessão';
    await api.patch('/requirement-matrix/draft', { rules }, { etag: revisionEtag(matrix.revision), query: { unitId } });
  });
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar rascunho', exact: true })).toBeDisabled();
  await expect(title).toHaveValue('Minha alteração local preservada');
  await page.getByRole('button', { name: 'Conferir matriz atual', exact: true }).click();
  const current = page.getByRole('region', { name: 'Conferência da matriz atual', exact: true });
  await current.getByText('Comparar composição atual', { exact: true }).click();
  await expect(current).toContainText('Critério alterado por outra sessão');
  await page.getByRole('button', { name: 'Usar revisão atual e manter meu preenchimento', exact: true }).click();
  await expect(title).toHaveValue('Minha alteração local preservada');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. A matriz publicada continua em uso nos atendimentos.', { exact: true })).toBeVisible();
  await title.fill('Texto ainda não salvo na unidade atual');
  const cancelChange = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await page.getByRole('combobox', { name: 'Unidade de trabalho' }).selectOption('00000000-0000-4000-8000-000000000003');
  await cancelChange;
  await expect(title).toHaveValue('Texto ainda não salvo na unidade atual');
  await expect(page.getByRole('combobox', { name: 'Unidade de trabalho' })).toHaveValue('00000000-0000-4000-8000-000000000002');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('técnico consulta a matriz e apenas pendências dos seus atendimentos; trabalhador não acessa', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  await page.getByRole('link', { name: 'Matriz de requisitos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Matriz de requisitos documentais' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar rascunho', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Pendências documentais', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Pendências de AG-DEMO-220', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Situação documental', exact: true }).selectOption('all');
  await expect(page.getByRole('region', { name: 'Pendências de AG-DEMO-221', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pendências de AG-DEMO-222', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Unidade de trabalho' }).selectOption('00000000-0000-4000-8000-000000000003');
  await expect(page.getByRole('heading', { name: 'Nenhum atendimento nesta consulta', exact: true })).toBeVisible();
  await loginDemo(page, 'Trabalhador');
  await navigateWithinApp(page, '/app/pendencias');
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
  await navigateWithinApp(page, '/app/configuracoes/requisitos');
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
});
