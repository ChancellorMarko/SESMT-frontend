import { expect, test, type Page, type Locator } from '@playwright/test';
import { openModule, loginDemo, logout, navigateWithinApp } from './helpers';

const appointmentId = '00000000-0000-4000-8000-000000000221';
const unitId = '00000000-0000-4000-8000-000000000002';
async function answerChecks(scope: Locator) {
  const groups = scope.locator('fieldset:has(input[type="radio"])');
  for (const group of await groups.all()) await group.getByRole('radio', { name: 'Sim', exact: true }).check();
}
async function chooseRoleWithoutReload(page: Page, role: string) {
  await logout(page); await page.getByRole('button', { name: role, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/(dashboard|documentos)/);
}
async function fillPreparation(page: Page) {
  const form = page.getByRole('form', { name: 'Preparação da AT' });
  for (const label of ['Gerência do serviço', 'Fornecedor do serviço', 'Frente de trabalho', 'Gerência da área', 'Referência da análise de risco']) await form.getByLabel(label, { exact: true }).fill(`Referência sintética de ${label}`);
  await form.getByLabel('Descrição da atividade', { exact: true }).fill('Inspeção demonstrativa das condições e controles do serviço.');
  await form.getByRole('checkbox', { name: 'ART para a atividade está disponível', exact: true }).check();
  await answerChecks(form);
  await form.getByLabel('Meios de comunicação de emergência disponíveis *', { exact: true }).fill('Rádio da equipe e contato de emergência testados nesta demonstração.');
  const interference = form.locator('fieldset').filter({ hasText: 'Existem outras atividades sendo realizadas no mesmo local' });
  await interference.getByRole('radio', { name: 'Não', exact: true }).check();
  await interference.getByLabel('Justificativa da questão 6 *', { exact: true }).fill('Nenhuma atividade simultânea observada neste cenário sintético.');
  await page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AT-DEMO-001', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AT-DEMO-001', exact: true })).toBeInViewport();
}

test('técnico percorre AT vinculada à PT, revalida, encerra e imprime sem alterar a PT', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page, 'Técnico de segurança');
  const pt = await page.evaluate(async id => {
    const url = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(url);
    const appointment = await api.get(`/appointments/${id}`);
    const permit = await api.post(`/appointments/${id}/open-permit`, {}, { etag: revisionEtag(appointment.revision) });
    return { id: permit.id, status: permit.operationStatus, revision: permit.revision };
  }, appointmentId);
  await navigateWithinApp(page, `/app/agenda/${appointmentId}`);
  await page.getByRole('link', { name: 'Preparar AT', exact: true }).click();
  await expect(page.getByLabel('Atendimento da AT *', { exact: true })).toHaveValue(appointmentId);
  await page.getByLabel('PT vinculada (opcional)', { exact: true }).selectOption(pt.id);
  await fillPreparation(page);
  const detailPath = new URL(page.url()).pathname; const atId = detailPath.split('/').at(-1)!;
  await page.screenshot({ path: 'docs/frontend/qa/at-0.5-rascunho-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Registrar ciência na AT', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Registrar ciência na AT', exact: true });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => Boolean(window.document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  const focusable = dialog.locator('button, input, select, textarea, a[href]').filter({ visible: true });
  await focusable.last().focus(); await page.keyboard.press('Tab'); await expect(focusable.first()).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar ciência na AT', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Registrar ciência na AT', exact: true }).click();
  await dialog.getByLabel('Participante que declara *', { exact: true }).selectOption({ label: 'Camila Demo' });
  await dialog.getByRole('checkbox', { name: /O participante confirma/ }).check();
  await dialog.getByRole('button', { name: /Confirmar registrar ciência/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Editar rascunho', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Autorizar AT', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Autorizar AT', exact: true });
  await dialog.getByLabel('Nome do emitente *', { exact: true }).fill('Emitente Demo da Área');
  await dialog.getByRole('checkbox', { name: /Conferi os dados e confirmo esta ação/ }).check();
  await dialog.getByRole('button', { name: /Confirmar autorizar at/i }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('A janela registrada ainda não começou.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Suspender AT', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Suspender AT', exact: true });
  await dialog.getByLabel('Motivo *', { exact: true }).fill('Interrupção demonstrativa para reconferência das condições.');
  await dialog.getByRole('checkbox', { name: /Conferi os dados e confirmo esta ação/ }).check();
  await dialog.getByRole('button', { name: /Confirmar suspender at/i }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Revalidar AT', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Revalidar AT', exact: true });
  await dialog.getByLabel('Motivo da revalidação *', { exact: true }).fill('Condições e equipe reconferidas nesta rodada demonstrativa.');
  await dialog.getByLabel('Nome do emitente *', { exact: true }).fill('Emitente Demo da Área');
  await dialog.getByRole('checkbox', { name: /A equipe e os participantes continuam/ }).check();
  await dialog.getByRole('checkbox', { name: /Conferi as condições do serviço/ }).check();
  await dialog.getByRole('checkbox', { name: /Conferi os dados e confirmo esta ação/ }).check();
  await dialog.getByRole('button', { name: /Confirmar revalidar at/i }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Autorizações e revalidações da AT' })).toContainText('Revalidações registradas: 1');
  await page.getByRole('button', { name: 'Encerrar AT', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Encerrar AT', exact: true });
  await dialog.getByLabel('Resumo da conclusão *', { exact: true }).fill('Serviço demonstrativo concluído, local organizado e controles conferidos.');
  await answerChecks(dialog);
  await dialog.getByLabel('Nome do emitente *', { exact: true }).fill('Emitente Demo da Área');
  await dialog.getByRole('checkbox', { name: /Conferi os dados e confirmo esta ação/ }).check();
  await dialog.getByRole('button', { name: /Confirmar encerrar at/i }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Conclusão preservada da AT' })).toContainText('Serviço demonstrativo concluído');
  const result = await page.evaluate(async ids => {
    const url = '/src/shared/api/client.ts'; const { api } = await import(url);
    return { at: await api.get(`/work-authorizations/${ids.atId}`), pt: await api.get(`/work-permits/${ids.ptId}`) };
  }, { atId, ptId: pt.id });
  expect(result.at.status).toBe('CLOSED'); expect(result.at.closure.checks).toHaveLength(12); expect(result.at.releases).toHaveLength(2);
  expect(result.pt.operationStatus).toBe(pt.status); expect(result.pt.revision).toBe(pt.revision);
  await page.getByRole('link', { name: 'Imprimir AT', exact: true }).click();
  const print = page.getByRole('article', { name: 'Registro imprimível da AT' });
  const navigation = page.getByRole('navigation', { name: 'Acesso rápido', exact: true, includeHidden: true });
  const search = page.getByRole('button', { name: 'Buscar módulos', exact: true, includeHidden: true });
  await expect(print).toContainText('Encerrada'); await expect(print).toContainText('Revalidação 1');
  await expect(print).toContainText('SEM VALIDADE OPERACIONAL');
  await expect(navigation).toBeVisible(); await expect(search).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(navigation).not.toBeVisible(); await expect(search).not.toBeVisible();
  await expect(print).toBeVisible(); await page.emulateMedia({ media: null });
  await expect(navigation).toBeVisible(); await expect(search).toBeVisible();
  await page.screenshot({ path: 'docs/frontend/qa/at-0.5-impressao-desktop.png', fullPage: true });
  await page.pdf({ path: 'docs/frontend/qa/at-0.5-encerrada.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/frontend/qa/at-0.5-impressao-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('conflito de rascunho preserva campos e troca de unidade exige resolver alterações', async ({ page }) => {
  await loginDemo(page);
  await openModule(page, 'Autorizações de trabalho');
  await page.getByRole('link', { name: 'Criar AT', exact: true }).click();
  await page.getByLabel('Atendimento da AT *', { exact: true }).selectOption(appointmentId);
  await page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true }).click();
  await page.getByRole('link', { name: 'Editar rascunho', exact: true }).click();
  const path = new URL(page.url()).pathname; const atId = path.split('/').at(-2)!;
  const description = page.getByLabel('Descrição da atividade', { exact: true });
  await description.fill('Descrição local da atividade que deve ser preservada.');
  await page.evaluate(async ids => {
    const url = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(url);
    const at = await api.get(`/work-authorizations/${ids.atId}`);
    const preparation = structuredClone(at.preparation); preparation.identification.activityDescription = 'Descrição gravada por outra sessão na demonstração.';
    await api.patch(`/work-authorizations/${ids.atId}`, { ...preparation, permitId: null }, { etag: revisionEtag(at.revision), query: { unitId: ids.unitId } });
  }, { atId, unitId });
  await page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true }).click();
  await expect(description).toHaveValue('Descrição local da atividade que deve ser preservada.');
  await page.getByRole('button', { name: 'Conferir AT atual', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conferência da AT atual' })).toContainText('Descrição gravada por outra sessão');
  await page.getByRole('button', { name: 'Usar revisão atual e manter preenchimento', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar rascunho da AT', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Preparação registrada da AT' })).toContainText('Descrição local da atividade que deve ser preservada.');
  await page.getByRole('link', { name: 'Editar rascunho', exact: true }).click();
  await description.fill('Alteração ainda não salva para testar a troca de unidade.');
  const cancel = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await page.getByRole('combobox', { name: 'Unidade de trabalho' }).selectOption('00000000-0000-4000-8000-000000000003'); await cancel;
  await expect(page.getByRole('combobox', { name: 'Unidade de trabalho' })).toHaveValue(unitId);
  await expect(description).toHaveValue('Alteração ainda não salva para testar a troca de unidade.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/frontend/qa/at-0.5-formulario-mobile.png', fullPage: true });
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.accept(); });
  await page.getByRole('combobox', { name: 'Unidade de trabalho' }).selectOption('00000000-0000-4000-8000-000000000003');
  await expect(page.getByRole('combobox', { name: 'Unidade de trabalho' })).toHaveValue('00000000-0000-4000-8000-000000000003');
  await expect(page.getByText('AT não encontrada ou fora do seu alcance.', { exact: true })).toBeVisible();
  await expect(description).toHaveCount(0);
  expect(confirmations).toBe(1);
});

test('gestor prepara e cancela; auditor consulta e trabalhador não acessa a AT', async ({ page }) => {
  await loginDemo(page);
  await navigateWithinApp(page, `/app/ats/nova?appointmentId=${appointmentId}`);
  await fillPreparation(page);
  const detailPath = new URL(page.url()).pathname; const atId = detailPath.split('/').at(-1)!;
  await expect(page.getByRole('button', { name: 'Autorizar AT', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrar ciência na AT', exact: true })).toHaveCount(0);
  const forbidden = await page.evaluate(async id => {
    const url = '/src/shared/api/client.ts'; const { api, revisionEtag } = await import(url);
    const at = await api.get(`/work-authorizations/${id}`);
    try { await api.post(`/work-authorizations/${id}/authorize`, {}, { etag: revisionEtag(at.revision) }); return 200; } catch (error) { return (error as { status: number }).status; }
  }, atId);
  expect(forbidden).toBe(403);
  await page.getByRole('button', { name: 'Cancelar AT', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar AT', exact: true });
  await dialog.getByLabel('Motivo *', { exact: true }).fill('Cancelamento administrativo de registro demonstrativo sem uso.');
  await dialog.getByRole('checkbox', { name: /Conferi os dados e confirmo esta ação/ }).check();
  await dialog.getByRole('button', { name: /Confirmar cancelar at/i }).click();
  await expect(dialog).not.toBeVisible();
  await chooseRoleWithoutReload(page, 'Auditor');
  await navigateWithinApp(page, detailPath);
  await expect(page.getByRole('heading', { name: 'AT-DEMO-001', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Histórico da AT' })).toContainText('AT cancelada administrativamente');
  await expect(page.getByRole('region', { name: 'Ações da AT' }).getByRole('button')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Unidade de trabalho' }).selectOption('00000000-0000-4000-8000-000000000003');
  await expect(page.getByText('AT não encontrada ou fora do seu alcance.', { exact: true })).toBeVisible();
  await loginDemo(page, 'Trabalhador');
  await navigateWithinApp(page, detailPath);
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
});
