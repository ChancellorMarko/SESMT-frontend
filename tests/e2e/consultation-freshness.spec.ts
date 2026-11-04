import { expect, test } from '@playwright/test';
import type { DocumentDto, PageDto } from '../../src/shared/contracts';
import { loginDemo, navigateWithinApp } from './helpers';

const teamA = '00000000-0000-4000-8000-000000000200';
const teamB = '00000000-0000-4000-8000-000000000201';

test('consulta filtra a equipe e atualiza a fila preservada depois da revisão do engenheiro', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  const search = new URLSearchParams({ tab: 'permits', q: 'PT-DEMO-230', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', teamId: teamA, unitId: '00000000-0000-4000-8000-000000000002' });
  await navigateWithinApp(page, `/app/consulta?${search}`);
  const table = page.getByRole('table', { name: 'Resultados da consulta de PTs' });
  await expect(table.getByRole('link', { name: 'Abrir PT-DEMO-230', exact: true })).toBeVisible();

  // Team B belongs to another unit and cannot be selected among this unit's options.
  // An incoming link must nevertheless apply that criterion without widening the scope.
  search.set('teamId', teamB);
  await navigateWithinApp(page, `/app/consulta?${search}`);
  await expect(page.getByRole('heading', { name: 'Nenhuma PT encontrada', exact: true })).toBeVisible();
  await expect(table).toHaveCount(0);
  await page.getByLabel('Equipe operacional', { exact: true }).selectOption(teamA);
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expect(table.getByRole('link', { name: 'Abrir PT-DEMO-230', exact: true })).toBeVisible();

  const cachedAt = Date.now();
  await table.getByRole('link', { name: 'Abrir PT-DEMO-230', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar encerramento da versão 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Revisar encerramento', exact: true });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar aprovação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Encerramento validado', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Nenhuma PT encontrada', exact: true })).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Buscar PT', exact: true })).toHaveValue('PT-DEMO-230');
  await expect(page.getByLabel('Situação operacional', { exact: true })).toHaveValue('COMPLETED');
  await expect(page.getByLabel('Revisão do encerramento', { exact: true })).toHaveValue('PENDING_REVIEW');
  await expect(page.getByLabel('Equipe operacional', { exact: true })).toHaveValue(teamA);
  const returned = new URL(page.url()).searchParams;
  expect(returned.get('q')).toBe('PT-DEMO-230');
  expect(returned.get('operationStatus')).toBe('COMPLETED');
  expect(returned.get('reviewStatus')).toBe('PENDING_REVIEW');
  expect(returned.get('teamId')).toBe(teamA);
  // Stay inside the ordinary 30-second freshness window: success must come from invalidation.
  expect(Date.now() - cachedAt).toBeLessThan(30_000);
});

test('consulta documental conserva os critérios ao descartar e salvar metadados e mostra o título atualizado', async ({ page }) => {
  await loginDemo(page);
  const code = 'CONSULTA-FRESHNESS-E2E';
  const originalTitle = 'Documento para conferir retorno da consulta';
  const updatedTitle = 'Documento atualizado com retorno à consulta';
  const documentId = await page.evaluate(async ({ code, title }) => {
    const clientUrl = '/src/shared/api/client.ts';
    const { api } = await import(clientUrl);
    const response = await api.get('/documents', { query: { unitId: '00000000-0000-4000-8000-000000000002', pageSize: 100 } }) as PageDto<DocumentDto>;
    const reference = response.items.find(document => document.typeId === '00000000-0000-4000-8000-000000000061');
    if (!reference) throw new Error('Procedimento de referência ausente na demonstração.');
    const created = await api.post('/documents', {
      code, title, typeId: reference.typeId, companyId: reference.companyId,
      unitId: reference.unitId, sectorId: reference.sectorId, ownerId: reference.ownerId,
      responsibleIds: reference.responsibleIds, workerIds: [], accessClass: 'INTERNAL',
      issueDate: reference.issueDate, keywords: [],
    }) as DocumentDto;
    return created.id;
  }, { code, title: originalTitle });

  const search = new URLSearchParams({ tab: 'documents', q: code, status: 'DRAFT', unitId: '00000000-0000-4000-8000-000000000002' });
  await navigateWithinApp(page, `/app/consulta?${search}`);
  const table = page.getByRole('table', { name: 'Resultados da consulta documental' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await table.getByRole('link', { name: `Abrir ${originalTitle}`, exact: true }).click();
  await page.getByRole('link', { name: 'Editar metadados', exact: true }).click();
  await page.getByLabel('Título *', { exact: true }).fill('Alteração que deve ser descartada');
  await page.getByRole('link', { name: 'Voltar', exact: true }).click();
  const dirtyDialog = page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
  await expect(dirtyDialog).toBeVisible();
  await dirtyDialog.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
  await expect(page.getByRole('heading', { name: originalTitle, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expect(table.getByRole('link', { name: originalTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar título ou código', exact: true })).toHaveValue(code);
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('DRAFT');

  const cachedAt = Date.now();
  await table.getByRole('link', { name: `Abrir ${originalTitle}`, exact: true }).click();
  await page.getByRole('link', { name: 'Editar metadados', exact: true }).click();
  await page.getByLabel('Título *', { exact: true }).fill(updatedTitle);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page).toHaveURL(`/app/documentos/${documentId}`);
  await expect(page.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();

  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table.getByRole('link', { name: updatedTitle, exact: true })).toBeVisible();
  await expect(table.getByRole('link', { name: originalTitle, exact: true })).toHaveCount(0);
  await expect(table).not.toContainText('Alteração que deve ser descartada');
  await expect(page.getByRole('searchbox', { name: 'Buscar título ou código', exact: true })).toHaveValue(code);
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('DRAFT');
  const returned = new URL(page.url()).searchParams;
  expect(returned.get('tab')).toBe('documents');
  expect(returned.get('q')).toBe(code);
  expect(returned.get('status')).toBe('DRAFT');
  expect(Date.now() - cachedAt).toBeLessThan(30_000);
});
