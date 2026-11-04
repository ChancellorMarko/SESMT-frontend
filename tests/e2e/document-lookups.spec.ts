import { expect, test } from '@playwright/test';
import type { DocumentDto, DocumentTypeDto, PageDto, WorkerDto } from '../../src/shared/contracts';
import { loginDemo, navigateWithinApp } from './helpers';

test('seletores documentais alcançam mais de 100 registros e preservam vínculos ao editar e consultar', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await loginDemo(page);
  const seeded = await page.evaluate(async () => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    const unitId = '00000000-0000-4000-8000-000000000002';
    const originalTypes = await api.get('/document-types', { query: { page: 1, pageSize: 20 } }) as PageDto<DocumentTypeDto>;
    const source = originalTypes.items.find(type => type.code === 'PROCED');
    if (!source) throw new Error('Política de procedimento ausente.');
    const { id: _id, revision: _revision, ...typeFields } = source;
    const types: DocumentTypeDto[] = []; const workers: WorkerDto[] = [];
    for (let start = 1; start <= 125; start += 15) {
      await Promise.all(Array.from({ length: Math.min(15, 126 - start) }, async (_, index) => {
        const sequence = String(start + index).padStart(3, '0');
        const [type, worker] = await Promise.all([
          api.post('/document-types', { ...typeFields, code: `SCALE-TYPE-${sequence}`, name: `ZZ Escala Tipo ${sequence}` }),
          api.post('/workers', {
            companyId: '00000000-0000-4000-8000-000000000001', unitId,
            sectorId: '00000000-0000-4000-8000-000000000005', jobId: '00000000-0000-4000-8000-000000000008',
            jobFunctionId: '00000000-0000-4000-8000-000000000010', managerId: '00000000-0000-4000-8000-000000000020',
            fullName: `ZZ Escala Pessoa ${sequence}`, registration: `SCALE-WORKER-${sequence}`,
            employmentType: 'CLT', admissionDate: '2025-03-10',
          }),
        ]);
        types.push(type as DocumentTypeDto); workers.push(worker as WorkerDto);
      }));
    }
    const firstTypes = await api.get('/document-types', { query: { page: 1, pageSize: 100 } }) as PageDto<DocumentTypeDto>;
    const firstWorkers = await api.get('/workers', { query: { unitId, page: 1, pageSize: 100 } }) as PageDto<WorkerDto>;
    // Concurrent creation has no guaranteed insertion order. Choose actual records beyond page 1.
    const targetType = types.find(type => !firstTypes.items.some(first => first.id === type.id));
    const targetWorker = workers.find(worker => !firstWorkers.items.some(first => first.id === worker.id));
    if (!targetType || !targetWorker) throw new Error('Os alvos precisam estar além dos primeiros 100 registros.');
    const secondWorker = workers.find(worker => worker.id !== targetWorker.id && firstWorkers.items.some(first => first.id === worker.id));
    if (!secondWorker) throw new Error('A segunda seleção precisa ser uma pessoa diferente, da página já carregada.');
    return { targetType, targetWorker, secondWorker, unitId };
  });

  await navigateWithinApp(page, '/app/documentos/novo');
  await page.getByLabel('Código *', { exact: true }).fill('E2E-LOOKUP-SCALE');
  await page.getByLabel('Título *', { exact: true }).fill('Documento com vínculos fora da primeira página');
  await page.getByRole('searchbox', { name: 'Buscar tipos documentais', exact: true }).fill(seeded.targetType.name);
  await page.getByRole('button', { name: 'Pesquisar tipos documentais', exact: true }).click();
  await page.getByLabel('Tipo documental *', { exact: true }).selectOption(seeded.targetType.id);
  await page.getByLabel('Proprietário *', { exact: true }).selectOption({ label: 'Marina Demo' });
  const workerSelect = page.getByLabel('Trabalhadores vinculados', { exact: true });
  const workerSearch = page.getByRole('searchbox', { name: 'Buscar trabalhadores', exact: true });
  await workerSearch.fill(seeded.targetWorker.fullName);
  await page.getByRole('button', { name: 'Pesquisar trabalhadores', exact: true }).click();
  await workerSelect.selectOption(seeded.targetWorker.id);
  await expect(workerSearch).toBeEnabled();
  await workerSearch.fill(seeded.secondWorker.fullName);
  await page.getByRole('button', { name: 'Pesquisar trabalhadores', exact: true }).click();
  await workerSelect.selectOption([seeded.targetWorker.id, seeded.secondWorker.id]);
  const expectedWorkers = [seeded.targetWorker.id, seeded.secondWorker.id].sort();
  await expect.poll(() => workerSelect.evaluate((select: HTMLSelectElement) => Array.from(select.selectedOptions, option => option.value).sort())).toEqual(expectedWorkers);
  await expect(page.getByRole('button', { name: 'Criar documento', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('seletores-documentais-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Criar documento', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documento com vínculos fora da primeira página', exact: true })).toBeVisible();
  const documentId = new URL(page.url()).pathname.split('/').at(-1)!;

  await page.getByRole('link', { name: 'Editar metadados', exact: true }).click();
  await expect(page.getByLabel('Tipo documental *', { exact: true })).toHaveValue(seeded.targetType.id);
  await expect.poll(() => page.getByLabel('Trabalhadores vinculados', { exact: true }).evaluate((select: HTMLSelectElement) => Array.from(select.selectedOptions, option => option.value).sort())).toEqual(expectedWorkers);
  await page.getByLabel('Título *', { exact: true }).fill('Documento com vínculos preservados após edição');
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Documento com vínculos preservados após edição', exact: true })).toBeVisible();
  const saved = await page.evaluate(async id => { const url = '/src/shared/api/client.ts'; const { api } = await import(url); return api.get(`/documents/${id}`) as Promise<DocumentDto>; }, documentId);
  expect(saved.typeId).toBe(seeded.targetType.id);
  expect(saved.workerIds.slice().sort()).toEqual([seeded.targetWorker.id, seeded.secondWorker.id].sort());

  const listCriteria = new URLSearchParams({ q: saved.code, typeId: seeded.targetType.id, workerId: seeded.targetWorker.id, unitId: seeded.unitId });
  await navigateWithinApp(page, `/app/documentos?${listCriteria}`);
  await expect(page.getByRole('link', { name: saved.title, exact: true })).toBeVisible();
  await expect(page.getByLabel('Tipo documental', { exact: true }).getByRole('option', { name: seeded.targetType.name, exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Trabalhador', { exact: true })).toHaveValue(seeded.targetWorker.id);
  const appliedListUrl = page.url();
  await page.getByRole('searchbox', { name: 'Buscar trabalhadores', exact: true }).fill('ZZ Escala Pessoa');
  await page.getByRole('button', { name: 'Pesquisar trabalhadores', exact: true }).click();
  await page.getByRole('button', { name: 'Próxima: trabalhadores', exact: true }).click();
  await expect(page.getByRole('option', { name: 'ZZ Escala Pessoa 021 · SCALE-WORKER-021', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Trabalhador', { exact: true })).toHaveValue(seeded.targetWorker.id);
  expect(page.url()).toBe(appliedListUrl);
  await expect(page.getByRole('button', { name: 'Anterior: trabalhadores', exact: true })).toBeEnabled();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('filtros-documentais-mobile.png'), fullPage: true, animations: 'disabled' });
  await navigateWithinApp(page, '/app/configuracoes/parametros');
  await page.getByRole('searchbox', { name: 'Buscar política por nome ou código', exact: true }).fill(seeded.targetType.code);
  await page.getByRole('button', { name: 'Buscar políticas', exact: true }).click();
  await expect(page.getByRole('article', { name: `Política de ${seeded.targetType.name}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  const criteria = new URLSearchParams({ tab: 'documents', q: saved.code, typeId: seeded.targetType.id, workerId: seeded.targetWorker.id });
  await navigateWithinApp(page, `/app/consulta?${criteria}`);
  const table = page.getByRole('table', { name: 'Resultados da consulta documental' });
  await expect(table.getByRole('link', { name: saved.title, exact: true })).toBeVisible();
  await expect(page.getByLabel('Tipo documental', { exact: true })).toHaveValue(seeded.targetType.id);
  await expect(page.getByLabel('Trabalhador vinculado', { exact: true })).toHaveValue(seeded.targetWorker.id);
  await expect(page.getByLabel('Tipo documental', { exact: true }).getByRole('option', { name: seeded.targetType.name, exact: true })).toHaveCount(1);
  const resultRequests: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && url.pathname === '/api/v1/documents') resultRequests.push(url.search); });
  const appliedUrl = page.url();
  await page.getByRole('searchbox', { name: 'Buscar trabalhadores', exact: true }).fill('ZZ Escala Pessoa');
  await page.getByRole('button', { name: 'Pesquisar trabalhadores', exact: true }).click();
  await page.getByRole('button', { name: 'Próxima: trabalhadores', exact: true }).click();
  await expect(page.getByRole('option', { name: 'ZZ Escala Pessoa 021 (SCALE-WORKER-021)', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Trabalhador vinculado', { exact: true })).toHaveValue(seeded.targetWorker.id);
  await expect(table.getByRole('link', { name: saved.title, exact: true })).toBeVisible();
  expect(page.url()).toBe(appliedUrl);
  expect(resultRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
