import { expect, test, type Page } from '@playwright/test';
import { loginDemo } from './helpers';

async function fillWorker(page: Page, name: string, registration: string) {
  await page.getByLabel('Nome completo *', { exact: true }).fill(name);
  await page.getByLabel('Matrícula *', { exact: true }).fill(registration);
  await page.getByLabel('Tipo de vínculo *', { exact: true }).fill('CLT');
  await page.getByLabel('Data de admissão *', { exact: true }).fill('2025-04-01');
  await page.getByLabel('Empresa *', { exact: true }).selectOption({ label: 'Organização Exemplo' });
  await page.getByLabel('Unidade *', { exact: true }).selectOption({ label: 'Unidade Matriz' });
  await page.getByLabel('Setor *', { exact: true }).selectOption({ label: 'Produção' });
  await page.getByLabel('Cargo', { exact: true }).selectOption({ label: 'Operador' });
  await page.getByLabel('Função', { exact: true }).selectOption({ label: 'Operação de produção' });
  await page.getByLabel('Centro de trabalho', { exact: true }).selectOption({ label: 'Linha de produção A' });
  await expect(page.getByLabel('Gestor', { exact: true })).toBeEnabled();
  await page.getByLabel('Gestor', { exact: true }).selectOption({ label: 'Marina Demo' });
}

test('RH cadastra trabalhador com lotação e recebe duplicidade sem perder o formulário', async ({ page }) => {
  await loginDemo(page, 'RH');
  await page.getByRole('link', { name: 'Trabalhadores', exact: true }).click();
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  await fillWorker(page, 'Pessoa sintética E2E RH', 'E2E-RH-001');
  // CPF não faz parte do contrato mínimo de WorkerDto desta versão.
  await expect(page.getByLabel(/CPF/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pessoa sintética E2E RH', exact: true })).toBeVisible();
  const current = page.getByRole('region', { name: 'Vínculo atual', exact: true });
  await expect(current).toContainText('Unidade Matriz / Produção');
  await expect(current).toContainText('Operador / Operação de produção');
  await expect(current).toContainText('01/04/2025');
  await expect(page.getByRole('region', { name: 'Histórico de movimentações', exact: true })).toContainText('Cadastro inicial.');
  await page.getByRole('link', { name: 'Voltar à lista', exact: true }).click();
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  await fillWorker(page, 'Outra pessoa sintética', 'E2E-RH-001');
  await page.getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  await expect(page.getByLabel('Matrícula *', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Matrícula *', { exact: true })).toHaveValue('E2E-RH-001');
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('Outra pessoa sintética');
  await expect(page.getByText('Matrícula já cadastrada nesta empresa.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/trabalhadores\/novo$/);
});

test('movimentação exige justificativa e preserva vínculo anterior no histórico', async ({ page }) => {
  await loginDemo(page, 'RH');
  await page.getByRole('link', { name: 'Trabalhadores', exact: true }).click();
  await page.getByRole('link', { name: 'Camila Demo', exact: true }).click();
  await page.getByRole('link', { name: 'Registrar movimentação', exact: true }).click();
  await page.getByLabel('Data efetiva *', { exact: true }).fill('2025-04-01');
  await page.getByLabel('Setor *', { exact: true }).selectOption({ label: 'Administrativo' });
  await page.getByLabel('Cargo', { exact: true }).selectOption({ label: 'Analista' });
  await page.getByLabel('Função', { exact: true }).selectOption({ label: 'Assistência administrativa' });
  await page.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  await expect(page.getByLabel('Motivo / justificativa *', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Setor *', { exact: true })).toHaveValue('00000000-0000-4000-8000-000000000006');
  await page.getByLabel('Motivo / justificativa *', { exact: true }).fill('Realocação sintética para validar a preservação do vínculo anterior.');
  await page.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Camila Demo', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Vínculo atual', exact: true })).toContainText('Unidade Matriz / Administrativo');
  const history = page.getByRole('region', { name: 'Histórico de movimentações', exact: true });
  await expect(history).toContainText('Realocação sintética para validar a preservação do vínculo anterior.');
  await expect(history).toContainText('Anterior: Unidade Matriz · Produção · Operação de produção');
  await expect(history).toContainText('Novo vínculo: Unidade Matriz · Administrativo · Assistência administrativa');
  await expect(history).toContainText('Registro sintético de admissão.');
  await expect(page.getByText('Movimentação registrada. 0 pendência(s) criada(s) pelos módulos habilitados.', { exact: true })).toBeVisible();
});

test('troca de unidade protege rascunho, isola lista e organização cadastra, edita e inativa setor', async ({ page }) => {
  await loginDemo(page);
  await page.getByRole('link', { name: 'Trabalhadores', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Camila Demo', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Luiza Demo', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  await page.getByLabel('Nome completo *', { exact: true }).fill('Rascunho que deve ser protegido');
  await page.getByRole('link', { name: 'Documentos', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Alterações não salvas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('Rascunho que deve ser protegido');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('alterações não salvas'); await dialog.dismiss(); });
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption({ label: 'Unidade Operacional' });
  await expect(page.getByLabel('Unidade de trabalho', { exact: true })).toHaveValue('00000000-0000-4000-8000-000000000002');
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('Rascunho que deve ser protegido');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('alterações não salvas'); await dialog.accept(); });
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption({ label: 'Unidade Operacional' });
  await expect(page.getByLabel('Nome completo *', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Unidade *', { exact: true })).toHaveValue('00000000-0000-4000-8000-000000000003');
  await page.getByRole('link', { name: 'Voltar', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Luiza Demo', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Camila Demo', exact: true })).toHaveCount(0);
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption({ label: 'Unidade Matriz' });
  await page.getByRole('link', { name: 'Organização', exact: true }).click();
  await page.getByRole('button', { name: /^Setores/ }).click();
  await page.getByRole('button', { name: 'Cadastrar setor', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cadastrar setor', exact: true }).getByLabel('Nome *', { exact: true }).fill('Setor sintético E2E');
  await page.getByRole('dialog', { name: 'Cadastrar setor', exact: true }).getByLabel('Código', { exact: true }).fill('E2E-SETOR');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Setor sintético E2E' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Editar Setor sintético E2E', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Nome *', { exact: true }).fill('Setor sintético revisado E2E');
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar cadastro', exact: true }).click();
  const updated = page.getByRole('row').filter({ hasText: 'Setor sintético revisado E2E' });
  await expect(updated).toBeVisible();
  await updated.getByRole('button', { name: 'Inativar Setor sintético revisado E2E', exact: true }).click();
  await page.getByRole('dialog', { name: 'Inativar cadastro', exact: true }).getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Inativar cadastro', exact: true })).toHaveCount(0);
  await page.getByLabel('Mostrar inativos', { exact: true }).check();
  await expect(page.getByRole('row').filter({ hasText: 'Setor sintético revisado E2E' })).toContainText('Inativo');
});
