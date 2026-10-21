import { expect, test, type Page } from '@playwright/test';
import { loginDemo, openModule } from './helpers';

function observeNavigation(page: Page) {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
        /^\/api\/v1\/(workers|appointments|documents)(\/|$)/.test(new URL(request.url()).pathname)) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return () => { expect(errors).toEqual([]); expect(writes).toEqual([]); };
}

function discardDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Alterações não salvas', exact: true });
}

for (const width of [320, 1440]) {
  test(`voltar e avançar protegem o cadastro e preservam os filtros em ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginDemo(page, 'RH');
    const verify = observeNavigation(page);
    await openModule(page, 'Trabalhadores');
    await page.getByLabel('Buscar nome ou matrícula', { exact: true }).fill('Camila');
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Camila Demo', exact: true })).toBeVisible();
    await page.getByLabel('Situação cadastral', { exact: true }).selectOption('ACTIVE');
    await expect(page).toHaveURL(/status=ACTIVE/);
    const listUrl = page.url();
    await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
    const formUrl = page.url();
    const name = page.getByLabel('Nome completo *', { exact: true });
    await name.fill('Rascunho protegido pelo histórico');

    // Real Link navigation supplies the BrowserRouter history index. A synthetic
    // pushState would not exercise the browser's Back/Forward protection.
    await page.goBack();
    await expect(discardDialog(page)).toBeVisible();
    await expect(page).toHaveURL(formUrl);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 320) await page.screenshot({ path: testInfo.outputPath('protecao-voltar-320.png') });
    await discardDialog(page).getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
    await expect(discardDialog(page)).toHaveCount(0);
    await expect(name).toHaveValue('Rascunho protegido pelo histórico');
    await expect(page).toHaveURL(formUrl);

    await page.goBack();
    await expect(discardDialog(page)).toBeVisible();
    await discardDialog(page).getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await expect(page).toHaveURL(listUrl);
    await expect(page.getByLabel('Buscar nome ou matrícula', { exact: true })).toHaveValue('Camila');
    await expect(page.getByLabel('Situação cadastral', { exact: true })).toHaveValue('ACTIVE');
    await page.goForward();
    await expect(page).toHaveURL(formUrl);
    await expect(name).toHaveValue('');
    await expect(discardDialog(page)).toHaveCount(0);
    verify();
  });
}

test('cancelar a saída mantém sessão e rascunho; confirmar encerra a sessão uma vez', async ({ page }) => {
  await loginDemo(page, 'RH');
  const verify = observeNavigation(page);
  await openModule(page, 'Trabalhadores');
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click();
  const formUrl = page.url();
  const name = page.getByLabel('Nome completo *', { exact: true });
  await name.fill('Rascunho antes de encerrar a sessão');
  const logouts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/auth/logout') logouts.push(request.url());
  });
  await page.getByRole('button', { name: 'Sair da plataforma', exact: true }).click();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await expect(page).toHaveURL(formUrl);
  await expect(name).toHaveValue('Rascunho antes de encerrar a sessão');
  await expect(page.getByLabel('Unidade de trabalho', { exact: true })).toBeEnabled();
  expect(logouts).toEqual([]);
  await page.getByRole('button', { name: 'Sair da plataforma', exact: true }).click();
  await discardDialog(page).getByRole('button', { name: 'Descartar e sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'RH', exact: true })).toBeVisible();
  expect(logouts).toHaveLength(1);
  verify();
});

test('histórico do navegador preserva o motivo de um reagendamento ainda não enviado', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  const verify = observeNavigation(page);
  await openModule(page, 'Agenda');
  await page.getByLabel('Buscar atendimento', { exact: true }).fill('AG-DEMO-220');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  const row = page.getByRole('table', { name: 'Atendimentos da agenda', exact: true }).getByRole('row').filter({ hasText: 'AG-DEMO-220' });
  await expect(row).toBeVisible();
  const listUrl = page.url();
  await row.getByRole('link', { name: 'Consultar atendimento', exact: true }).click();
  await page.getByRole('button', { name: 'Reagendar', exact: true }).click();
  const reschedule = page.getByRole('dialog', { name: 'Reagendar serviço', exact: true });
  await reschedule.getByLabel('Motivo *', { exact: true }).fill('Período em conferência, ainda não enviado');
  const formUrl = page.url();
  await page.goBack();
  await expect(discardDialog(page)).toBeVisible();
  await expect(page).toHaveURL(formUrl);
  await discardDialog(page).getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await expect(reschedule).toBeVisible();
  await expect(reschedule.getByLabel('Motivo *', { exact: true })).toHaveValue('Período em conferência, ainda não enviado');
  await page.goBack();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole('button', { name: 'Descartar e sair', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  await expect(reschedule).toHaveCount(0);
  await expect(row).toBeVisible();
  verify();
});

test('voltar protege os metadados de um novo documento sem criar um registro', async ({ page }) => {
  await loginDemo(page, 'Engenheiro');
  const verify = observeNavigation(page);
  await openModule(page, 'Documentos');
  await expect(page).toHaveURL(/\/app\/documentos\?.*unitId=/);
  await expect(page.getByRole('region', { name: 'Resultados de documentos', exact: true })).toHaveAttribute('aria-busy', 'false');
  const listUrl = page.url();
  await page.getByRole('link', { name: 'Novo documento', exact: true }).click();
  const formUrl = page.url();
  const title = page.getByLabel('Título *', { exact: true });
  await title.fill('Documento ainda não cadastrado');
  await page.goBack();
  await expect(discardDialog(page)).toBeVisible();
  await expect(page).toHaveURL(formUrl);
  await discardDialog(page).getByRole('button', { name: 'Continuar preenchendo', exact: true }).click();
  await expect(title).toHaveValue('Documento ainda não cadastrado');
  await page.goBack();
  await expect(discardDialog(page)).toBeVisible();
  await discardDialog(page).getByRole('button', { name: 'Descartar e sair', exact: true }).click();
  await expect(page).toHaveURL(listUrl);
  verify();
});
