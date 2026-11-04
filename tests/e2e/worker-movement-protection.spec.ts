import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const workerPath = `/app/trabalhadores/${id(40)}`;

test('movimentação em 320px remove vínculos opcionais e conserva o vínculo anterior no histórico', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 844 }); await loginDemo(page, 'RH');
  await navigateWithinApp(page, workerPath);
  await expect(page.getByRole('heading', { name: 'Camila Demo', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Vínculo atual', exact: true })).toContainText('Operador / Operação de produção');
  await page.getByRole('link', { name: 'Registrar movimentação', exact: true }).click();
  await expect(page.getByLabel('Cargo', { exact: true })).toHaveValue(id(8));
  await expect(page.getByLabel('Função', { exact: true })).toHaveValue(id(10));
  await expect(page.getByLabel('Gestor', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Gestor', { exact: true })).toHaveValue(id(20));
  await page.getByLabel('Cargo', { exact: true }).selectOption('');
  await expect(page.getByLabel('Função', { exact: true })).toHaveValue('');
  await page.getByLabel('Gestor', { exact: true }).selectOption('');
  await page.getByLabel('Motivo / justificativa *', { exact: true }).fill('Retirada dos vínculos opcionais no teste de movimentação.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/workers/${id(40)}/movements`));
  await page.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  const response = await responsePromise; expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.movement.previousAssignment).toMatchObject({ unitId: id(2), sectorId: id(5), jobId: id(8), jobFunctionId: id(10), managerId: id(20) });
  expect(result.movement.newAssignment).toMatchObject({ jobId: null, jobFunctionId: null, workCenterId: null, managerId: null });
  expect(result.worker.jobId).toBeUndefined(); expect(result.worker.jobFunctionId).toBeUndefined(); expect(result.worker.managerId).toBeUndefined();
  await expect(page.getByRole('heading', { name: 'Camila Demo', exact: true })).toBeVisible();
  const current = page.getByRole('region', { name: 'Vínculo atual', exact: true });
  await expect(current).toContainText('Unidade Matriz / Produção');
  await expect(current).toContainText('Não informado / Não informado');
  const history = page.getByRole('region', { name: 'Histórico de movimentações', exact: true });
  await expect(history).toContainText('Retirada dos vínculos opcionais no teste de movimentação.');
  await expect(history).toContainText('Anterior: Unidade Matriz · Produção · Operação de produção');
  await expect(history).toContainText('Novo vínculo: Unidade Matriz · Produção');
  await expect(history).toContainText('Registro sintético de admissão.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Registrar movimentação', exact: true }).click();
  await expect(page.getByLabel('Cargo', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Função', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Gestor', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Gestor', { exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});

test('edição em 390px mantém os valores digitados após conflito e exige confirmação para recarregar', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let authorization = ''; let csrf = ''; let workerApiUrl = '';
  page.on('request', request => {
    const headers = request.headers();
    if (headers['authorization']) authorization = headers['authorization'];
    if (headers['x-csrf-token']) csrf = headers['x-csrf-token'];
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/workers/${id(40)}`)) workerApiUrl = request.url();
  });
  await page.setViewportSize({ width: 390, height: 844 }); await loginDemo(page, 'RH');
  await navigateWithinApp(page, `${workerPath}/editar`);
  await expect(page.getByRole('heading', { name: 'Editar cadastro', exact: true })).toBeVisible();
  await page.getByLabel('Nome completo *', { exact: true }).fill('Camila revisão preservada E2E');
  await page.getByLabel('Matrícula *', { exact: true }).fill('E2E-CONFLITO-390');
  // Simulates a concurrent writer through the same authorized demo API without
  // refreshing the form's captured revision or resetting the demonstration.
  expect(authorization).not.toBe(''); expect(csrf).not.toBe(''); expect(workerApiUrl).not.toBe('');
  const concurrentStatus = await page.evaluate(async ({ url, authorization, csrf }) => {
    const response = await fetch(url, { method: 'PATCH', credentials: 'include', headers: { Authorization: authorization, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify({ fullName: 'Camila alterada em outra sessão' }) });
    return response.status;
  }, { url: workerApiUrl, authorization, csrf });
  expect(concurrentStatus).toBe(200);
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Este registro foi alterado.');
  await expect(page).toHaveURL(`${workerPath}/editar`);
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('Camila revisão preservada E2E');
  await expect(page.getByLabel('Matrícula *', { exact: true })).toHaveValue('E2E-CONFLITO-390');
  await expect(page.getByRole('button', { name: 'Salvar cadastro', exact: true })).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Recarregar cadastro', exact: true }).click();
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('Camila revisão preservada E2E');
  await expect(page.getByLabel('Matrícula *', { exact: true })).toHaveValue('E2E-CONFLITO-390');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Recarregar cadastro', exact: true }).click();
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('Camila alterada em outra sessão');
  await expect(page.getByLabel('Matrícula *', { exact: true })).toHaveValue('DEMO-001');
  await page.getByLabel('Nome completo *', { exact: true }).fill('Camila cadastro reconciliado E2E');
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camila cadastro reconciliado E2E', exact: true })).toBeVisible();
  await expect(page.getByText('Cadastro atualizado.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
