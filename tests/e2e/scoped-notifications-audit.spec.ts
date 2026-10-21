import { expect, test, type Page } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

const unitA = '00000000-0000-4000-8000-000000000002';
const unitB = '00000000-0000-4000-8000-000000000003';
async function mobile(page: Page) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
}

test('notificações bloqueiam critérios inválidos e registram leitura somente na unidade atual', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page);
  const queries: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && url.pathname === '/api/v1/notifications' && url.searchParams.get('pageSize') === '20') queries.push(request.url()); });
  await navigateWithinApp(page, `/app/notificacoes?unitId=${unitA}&read=unknown`);
  await expect(page.getByText(/filtro de leitura.*inválido/i).last()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lista de notificações', exact: true })).toHaveCount(0);
  expect(queries).toEqual([]);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  const notices = page.getByRole('region', { name: 'Lista de notificações', exact: true });
  await expect(notices.getByRole('article')).toHaveCount(3);
  await page.getByLabel('Leitura', { exact: true }).selectOption('false');
  const first = notices.getByRole('article').first(); const title = await first.getByRole('heading').innerText();
  await first.getByRole('button', { name: `Marcar como lida: ${title}`, exact: true }).click();
  await expect(page.getByText(/Leitura registrada:/)).toContainText('A pendência do registro continua sendo acompanhada.');
  await expect(notices.getByRole('article')).toHaveCount(2);
  const read = await page.evaluate(async input => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    const result = await api.get('/notifications', { query: { unitId: input.unitA, read: true, page: 1, pageSize: 20 } });
    const notice = result.items.find((item: { title: string }) => item.title === input.title);
    if (!notice) throw new Error('Notificação lida não retornou no contexto esperado.');
    const document = await api.get(`/documents/${notice.resourceId}`);
    return { readAt: notice.readAt, status: document.status, revision: document.revision };
  }, { unitA, title });
  expect(Number.isFinite(Date.parse(read.readAt))).toBe(true); expect(read.status).toBe('ACTIVE'); expect(read.revision).toBe(1);
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(unitB);
  await expect(page).toHaveURL(url => url.searchParams.get('unitId') === unitB && url.searchParams.get('read') === 'false');
  await expect(notices.getByRole('article')).toHaveCount(1);
  await expect(notices).toContainText('Orientação para equipe de logística');
  await expect(page.getByText(/Leitura registrada:/)).toHaveCount(0);
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(unitA);
  await expect(notices.getByRole('article')).toHaveCount(2);
  await expect(notices).not.toContainText(title);
  await mobile(page); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('notificacoes-unidade-mobile.png'), fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('auditoria mantém período e paginação, bloqueia URL ambígua e muda de unidade sem eventos antigos', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await loginDemo(page);
  await page.evaluate(async unitId => {
    const clientUrl = '/src/shared/api/client.ts'; const { api } = await import(clientUrl);
    for (let start = 1; start <= 25; start += 10) await Promise.all(Array.from({ length: Math.min(10, 26 - start) }, (_, index) => api.post('/sectors', { unitId, name: `Setor da auditoria E2E ${start + index}` })));
  }, unitA);
  const queries: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/audit-logs') queries.push(request.url()); });
  await navigateWithinApp(page, `/app/auditoria?unitId=${unitA}&action=CREATE&action=UPDATE`);
  await expect(page.getByRole('alert')).toContainText('repetidos'); expect(queries).toEqual([]);
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Trilha de eventos de auditoria', exact: true })).toBeVisible();
  const filters = page.getByRole('form', { name: 'Filtros da auditoria', exact: true });
  await filters.getByLabel('Ação', { exact: true }).selectOption('ORGANIZATION_CREATED');
  await filters.getByLabel('De', { exact: true }).fill('2024-02-29');
  await filters.getByLabel('Até', { exact: true }).fill('2099-12-31');
  await filters.getByRole('button', { name: 'Filtrar eventos', exact: true }).click();
  const table = page.getByRole('table', { name: 'Trilha de eventos de auditoria', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(page).toHaveURL(url => url.searchParams.get('page') === '2' && url.searchParams.get('from') === '2024-02-29' && url.searchParams.get('action') === 'ORGANIZATION_CREATED');
  await expect(page.getByRole('navigation', { name: 'Paginação da auditoria', exact: true })).toContainText('25 eventos · página 2 de 2');
  await mobile(page); await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('auditoria-pagina-2-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByLabel('Unidade de trabalho', { exact: true }).selectOption(unitB);
  await expect(page).toHaveURL(url => url.searchParams.get('unitId') === unitB && !url.searchParams.has('page'));
  await expect(page.getByRole('heading', { name: 'Nenhum evento encontrado', exact: true })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByLabel('Ação', { exact: true })).toHaveValue('ORGANIZATION_CREATED');
  await navigateWithinApp(page, `/app/auditoria?unitId=${unitB}&action=EVENTO_NOVO`);
  await expect(page.getByRole('heading', { name: 'Nenhum evento encontrado', exact: true })).toBeVisible();
  await expect(page.getByLabel('Ação', { exact: true })).toHaveValue('EVENTO_NOVO');
  expect(errors).toEqual([]);
});
