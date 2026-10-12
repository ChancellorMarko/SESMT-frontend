import { expect, test } from '@playwright/test';
import { createDocument, loginDemo, logout, navigateWithinApp, publish, reviewAndApprove, uploadVersion } from './helpers';

test('gestor acessa painel e combina busca com filtros documentais', async ({ page }) => {
  await loginDemo(page);
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(page.getByText('Dados fictícios em memória.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Documentos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documentos', exact: true })).toBeVisible();
  await page.getByLabel('Buscar por título ou código', { exact: true }).fill('PROC-2026-001');
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('IN_REVIEW');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Procedimento de trabalho seguro (demo)', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inventário de riscos · Matriz (demo)', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum documento encontrado' })).toBeVisible();
  await page.getByLabel('Vencimento a partir de', { exact: true }).fill('2030-12-31');
  await page.getByLabel('Vencimento até', { exact: true }).fill('2030-01-01');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText('O fim do intervalo de validade deve ser igual ou posterior ao início.')).toBeVisible();
});

test('procedimento percorre revisão, aprovação e duas publicações sem perder histórico', async ({ page }) => {
  await loginDemo(page);
  await createDocument(page);
  await uploadVersion(page, 'Primeiro envio controlado.');
  await reviewAndApprove(page);
  await expect(page.getByRole('region', { name: 'Versão selecionada' }).getByText('Aprovado', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Metadados do documento' }).getByText('Vigente', { exact: true })).toHaveCount(0);
  await publish(page);
  await uploadVersion(page, 'Atualização de procedimento com preservação da anterior.');
  await expect(page.getByText('A versão em trabalho ainda não substituiu a versão vigente.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'v1 · vigente' })).toBeVisible();
  await reviewAndApprove(page);
  await publish(page);
  await expect(page.getByRole('row').filter({ hasText: 'v1' }).getByText('Substituído', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'v2 · vigente' })).toBeVisible();
  const history = page.getByRole('region', { name: 'Histórico do documento' });
  await expect(history.getByRole('listitem')).not.toHaveCount(0);
  await expect(page.getByText('Atualização de procedimento com preservação da anterior.', { exact: true }).first()).toBeVisible();
});

test('PGR não permite autoaprovação quando a política exige separação de responsabilidades', async ({ page }) => {
  await loginDemo(page);
  await createDocument(page, { type: 'Programa de Gerenciamento de Riscos', title: 'PGR de teste com separação de funções', code: 'E2E-PGR-01' });
  await uploadVersion(page, 'Documento para testar separação de responsáveis.');
  await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('button', { name: 'Registrar revisão', exact: true }).click();
  await page.getByLabel('Justificativa *', { exact: true }).fill('Revisão de conteúdo concluída.');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Revisão: aceita.', { exact: false })).toBeVisible();
  const approve = page.getByRole('button', { name: 'Aprovar versão', exact: true });
  if (await approve.isVisible()) {
    await approve.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/própri|autor|autoaprovação|outra pessoa/i);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  } else {
    await expect(approve).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Publicar versão', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Versão selecionada' }).getByText('Em revisão', { exact: true })).toBeVisible();
});

test('RH consulta sem aprovação, administrador confirma MFA e auditor não abre formulário de escrita', async ({ page }) => {
  await loginDemo(page, 'RH');
  await page.getByRole('link', { name: 'Documentos', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Novo documento', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Procedimento de trabalho seguro (demo)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Versão 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar versão', exact: true })).toHaveCount(0);
  await logout(page);
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verifique seu acesso' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Código de verificação', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Verificar e entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Código de verificação', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verificar e entrar', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Usuários e acessos', exact: true })).toBeVisible();
  await logout(page);
  await page.getByRole('button', { name: 'Auditor', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await navigateWithinApp(page, '/app/documentos/novo');
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar documento', exact: true })).toHaveCount(0);
  await logout(page);
  await expect(page.getByRole('heading', { name: 'Sua rotina, organizada.' })).toBeVisible();
});

test('mobile mantém conteúdo sem overflow e navegação/modal restauram foco pelo teclado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginDemo(page);
  const toggle = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('dialog', { name: 'Navegação', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Navegação', exact: true })).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole('dialog', { name: 'Navegação', exact: true }).getByRole('link', { name: 'Documentos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documentos', exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await page.getByRole('link', { name: 'Procedimento de trabalho seguro (demo)', exact: true }).click();
  const review = page.getByRole('button', { name: 'Aprovar versão', exact: true });
  await expect(review).toBeVisible();
  await review.click();
  await expect(page.getByRole('dialog', { name: 'Aprovar versão', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Aprovar versão', exact: true })).toHaveCount(0);
  await expect(review).toBeFocused();
});
