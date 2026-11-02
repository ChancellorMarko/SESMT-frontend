import { expect, test, type Download, type Page } from '@playwright/test';
import type { DocumentaryReadinessDto } from '../../src/shared/contracts/requirements';
import { loginDemo, navigateWithinApp } from './helpers';

const unitA = '00000000-0000-4000-8000-000000000002';
const unitB = '00000000-0000-4000-8000-000000000003';

async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('O CSV exportado não pôde ser lido.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function mobileEvidence(page: Page, outputPath: (name: string) => string, name: string) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: outputPath(`${name}-${width}.png`), fullPage: true, animations: 'disabled' });
  }
}

test('pendências recusam filtros inválidos antes de consultar ou exportar e recuperam a situação padrão', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await loginDemo(page);
  const requests: URL[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/documentary-readiness') requests.push(url);
  });
  for (const criteria of ['status=desconhecida', 'status=all&status=pending', 'filtro=nao-suportado']) {
    const before = requests.length;
    await navigateWithinApp(page, `/app/pendencias?unitId=${unitA}&${criteria}`);
    await expect(page.getByRole('button', { name: 'Atualizar pendências', exact: true })).toBeDisabled();
    await expect(page.getByRole('region', { name: /^Pendências de / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exportar consulta CSV', exact: true })).toHaveCount(0);
    expect(requests).toHaveLength(before);
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Situação documental', exact: true })).toHaveValue('pending');
    await expect(page.getByRole('region', { name: 'Pendências de AG-DEMO-220', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exportar consulta CSV', exact: true })).toBeEnabled();
    expect(new URL(page.url()).searchParams.get('unitId')).toBe(unitA);
    expect(new URL(page.url()).searchParams.has('status')).toBe(false);
  }
  // Request the forged unit through the router and wait for its authorized replacement.
  await navigateWithinApp(page,
    `/app/pendencias?unitId=${unitB}&teamId=00000000-0000-4000-8000-000000000201&serviceTypeId=00000000-0000-4000-8000-000000000210&status=all`,
    `/app/pendencias?unitId=${unitA}&status=all`);
  await expect.poll(() => new URL(page.url()).searchParams.get('unitId')).toBe(unitA);
  expect(new URL(page.url()).searchParams.has('teamId')).toBe(false);
  expect(new URL(page.url()).searchParams.has('serviceTypeId')).toBe(false);
  await expect(page.getByRole('region', { name: 'Pendências de AG-DEMO-220', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Luiza Demo', exact: true })).toHaveCount(0);
  expect(requests.every(url => url.searchParams.get('unitId') === unitA)).toBe(true);
  await mobileEvidence(page, name => testInfo.outputPath(name), 'pendencias-filtros-recuperados');
  expect(errors).toEqual([]);
});

test('CSV de pendências contém somente a pessoa e atendimento filtrados com informação restrita mínima', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await loginDemo(page);
  const example = await page.evaluate(async unitId => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    const data = await api.get('/documentary-readiness', { query: { unitId } }) as DocumentaryReadinessDto;
    const row = data.rows.find(item => item.eligibility.participants.some(person => !person.eligible && person.items.some(requirement => requirement.restricted)));
    const person = row?.eligibility.participants.find(item => !item.eligible && item.items.some(requirement => requirement.restricted));
    if (!row || !person) throw new Error('A demonstração precisa de uma pessoa pendente com conferência restrita.');
    return { row, person, otherNames: [...new Set(data.rows.flatMap(item => item.eligibility.participants.map(participant => participant.name)))].filter(name => name !== person.name) };
  }, unitA);
  const criteria = new URLSearchParams({ unitId: unitA, q: `${example.row.appointmentCode} ${example.person.name}`, status: 'pending' });
  await navigateWithinApp(page, `/app/pendencias?${criteria}`);
  const region = page.getByRole('region', { name: `Pendências de ${example.row.appointmentCode}`, exact: true });
  await expect(region.getByRole('heading', { name: example.person.name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Pendências de / })).toHaveCount(1);
  for (const name of example.otherNames) await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exportar consulta CSV', exact: true })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar consulta CSV', exact: true }).click();
  const download = await downloadPromise, csv = await downloadText(download);
  expect(download.suggestedFilename()).toBe('pendencias-documentais-DEMONSTRACAO.csv');
  const records = csv.trim().split(/\r?\n/).slice(1);
  expect(records).toHaveLength(example.person.items.length);
  expect(records.every(line => line.includes(`"${example.row.appointmentCode}"`) && line.includes(`"${example.person.name}"`))).toBe(true);
  for (const name of example.otherNames) expect(csv).not.toContain(`;"${name}";`);
  for (const item of example.person.items.filter(requirement => requirement.restricted)) {
    const line = records.find(record => record.includes(`"${item.label.replaceAll('"', '""')}"`));
    expect(line).toContain('"Conferência restrita por profissional autorizado."');
    if (item.reason) expect(line).not.toContain(item.reason);
    if (item.fileName) expect(csv).not.toContain(item.fileName);
    if (item.validUntil) expect(line).not.toContain(item.validUntil);
  }
  expect(csv).not.toContain('PROFISSIONAL_COMPETENTE_DEMO'); expect(csv).not.toContain('Informação restrita');
  await mobileEvidence(page, name => testInfo.outputPath(name), 'pendencias-selecao-exportada');
  expect(errors).toEqual([]);
});

test('consulta de trabalhadores recusa critérios inválidos, pagina o filtro aplicado e isola a troca de unidade', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await loginDemo(page);
  await page.evaluate(async unitId => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    await Promise.all(Array.from({ length: 15 }, async (_, index) => {
      const sequence = String(index + 1).padStart(3, '0');
      await api.post('/workers', { companyId: '00000000-0000-4000-8000-000000000001', unitId, sectorId: '00000000-0000-4000-8000-000000000005', fullName: `ZZ Consulta Escala ${sequence}`, registration: `E2E-CONSULTA-${sequence}`, employmentType: 'CLT', admissionDate: '2025-03-10' });
    }));
  }, unitA);
  const requests: URL[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && url.pathname === '/api/v1/workers') requests.push(url); });
  const searchTerm = 'ZZ Consulta Escala';
  await navigateWithinApp(page, `/app/trabalhadores?unitId=${unitA}&q=${encodeURIComponent(searchTerm)}&page=Infinity`);
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeDisabled();
  await expect(page.getByRole('table', { name: 'Trabalhadores encontrados', exact: true })).toHaveCount(0); expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Voltar à primeira página', exact: true }).click();
  const table = page.getByRole('table', { name: 'Trabalhadores encontrados', exact: true });
  await expect(table.getByRole('row')).toHaveCount(11); await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue(searchTerm);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Paginação de trabalhadores', exact: true })).toContainText('Página 2 de 2');
  await expect(table.getByRole('row')).toHaveCount(6);
  expect(requests.at(-1)?.searchParams.get('q')).toBe(searchTerm); expect(requests.at(-1)?.searchParams.get('page')).toBe('2'); expect(requests.at(-1)?.searchParams.get('pageSize')).toBe('10');
  await page.getByLabel('Situação cadastral', { exact: true }).selectOption('ACTIVE');
  await expect(page.getByRole('navigation', { name: 'Paginação de trabalhadores', exact: true })).toContainText('Página 1 de 2');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false); expect(new URL(page.url()).searchParams.get('q')).toBe(searchTerm);
  const beforeInvalid = requests.length;
  await navigateWithinApp(page, `/app/trabalhadores?unitId=${unitA}&status=desconhecida`);
  await expect(page.getByRole('button', { name: 'Pesquisar', exact: true })).toBeDisabled(); await expect(table).toHaveCount(0); expect(requests).toHaveLength(beforeInvalid);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click(); await expect(table).toBeVisible();
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(unitB);
  await expect(page.getByRole('link', { name: 'Luiza Demo', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Camila Demo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^ZZ Consulta Escala/ })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('unitId')).toBe(unitB); expect(requests.at(-1)?.searchParams.get('unitId')).toBe(unitB); expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
  await mobileEvidence(page, name => testInfo.outputPath(name), 'trabalhadores-consulta-unidade');
  expect(errors).toEqual([]);
});
