// Explicit user-administration grants keep the setup page stable; module grants remain independent.
import { expect, test, type Page } from '@playwright/test';
import { openingAppointmentFixture, openingBrowserWorker, openingNativeWorker, openedPermitFixture, openingReceiptFixture } from './fixtures/native-opening';
import { templateFixture, laterTemplateFixture, checklistIds as ids } from './fixtures/native-checklists';
import { nativeOrganizationFixture, nativeResponsibleFixture, nativeServicesFixture } from './fixtures/native-operations';
import { declarationFixture, historyFixture } from './fixtures/native-permits';

// Controlled contract responses, not live .NET/PostgreSQL homologation.
async function setup(page: Page, options: { unlinked?: boolean; deniedWorker?: boolean; existing?: boolean; badReceipt?: boolean } = {}) {
  let signedIn = false;
  const state = { appointment: openingAppointmentFixture(), created: false, existing: options.existing ?? false, unlinked: options.unlinked ?? false,
    requests: [] as string[], commands: [] as { path: string; body: Record<string, unknown> }[], errors: [] as string[], unexpected: [] as string[] };
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z')); await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method(); state.requests.push(`${method} ${path}${url.search}`);
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const session = { accessToken: 'opening-fixture-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'opening-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', message: 'Entre novamente', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Pessoa da operação', email: 'operacao@example.invalid' }, roles: ['PERFIL_OPERACIONAL'], permissions: ['usuario:ler', 'usuario:editar', 'empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler', 'agenda:ler', 'pt:criar', 'trabalhador:ler'], scope: { companyIds: [ids.company], unitIds: [ids.unit], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/browser/organization') return json({ ...nativeOrganizationFixture, establishments: [], sectors: [], jobs: [], jobFunctions: [], workCenters: [] });
    if (path === '/api/v1/users') return json([nativeResponsibleFixture]);
    if (path === `/api/v1/browser/workers/${ids.worker}`) return options.deniedWorker ? json({ code: 'FORBIDDEN', message: 'Privado', requestId: 'test' }, 403) : json(openingBrowserWorker);
    if (path === `/api/v1/workers/${ids.worker}`) return json({ ...openingNativeWorker, userId: state.unlinked ? null : ids.user });
    if (path === '/api/v1/appointments') return json({ items: [state.appointment], total: 1, page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) });
    if (path === `/api/v1/appointments/${ids.appointment}`) return json(state.appointment);
    if (path === '/api/v1/work-permits/pt-templates') return json([templateFixture(), laterTemplateFixture()]);
    if (path === '/api/v1/work-permits/services') return json(nativeServicesFixture);
    if (path === '/api/v1/work-permits' && method === 'GET') return json(state.created || state.existing ? [openedPermitFixture()] : []);
    if (path === `/api/v1/work-permits/appointments/${ids.appointment}/pt` && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>; state.commands.push({ path, body });
      if (state.existing || state.created) return json({ code: 'DOMAIN_VIOLATION', message: 'Já existe', requestId: 'test' }, 409);
      state.created = true; return json({ ...openingReceiptFixture(), ...(options.badReceipt ? { participanteIds: [ids.worker] } : {}) }, 201);
    }
    if (path === `/api/v1/work-permits/${ids.permit}`) return json(openedPermitFixture());
    if (path === `/api/v1/work-permits/${ids.permit}/history`) return json(historyFixture());
    if (path === `/api/v1/work-permits/${ids.permit}/eligibility`) return json({ ready: false, issues: [{ code: 'CHECKLIST_PENDENTE', participantUserId: null, documentTypeId: null, serviceCode: null }] });
    if (path === `/api/v1/work-permits/${ids.permit}/declarations`) return json(declarationFixture(openedPermitFixture()));
    state.unexpected.push(`${method} ${path}`); return json({ code: 'NOT_FOUND', requestId: 'test' }, 404);
  });
  await page.goto('/login'); await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready'); await page.getByLabel('E-mail', { exact: true }).fill('operacao@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia'); await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/); await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click(); await page.getByRole('dialog', { name: 'Navegação', exact: true }).getByRole('link', { name: 'Agenda', exact: true }).click();
  // On phones the agenda filters are folded behind "Filtros".
  const folded = page.locator('summary', { hasText: 'Filtros' }), search = page.getByLabel('Buscar por título', { exact: true });
  await expect(search.or(folded).first()).toBeVisible(); if (await folded.isVisible()) await folded.click();
  await page.getByLabel('Buscar por título', { exact: true }).fill('Inspeção'); await page.getByLabel('Situação', { exact: true }).selectOption('CONFIRMED'); await page.getByRole('button', { name: 'Buscar', exact: true }).click(); await page.getByRole('link', { name: state.appointment.title, exact: true }).click(); await page.getByRole('button', { name: 'Abrir PT', exact: true }).click();
  return state;
}
async function fill(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Abrir permissão de trabalho', exact: true });
  await expect(dialog.getByRole('cell', { name: /Alice Trabalhadora.*MAT-01/ })).toBeVisible(); await expect(dialog.getByLabel('Modelo: Manutenção em altura')).toHaveValue('');
  await dialog.getByLabel('Modelo: Manutenção em altura').selectOption(ids.templateVersion); await dialog.getByRole('checkbox', { name: /Confirmo os modelos/ }).check(); return dialog;
}
test('abre PT com usuários vinculados e versões explícitas, retornando à agenda com filtros', async ({ page }) => {
  const state = await setup(page), dialog = await fill(page); await dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/pts/${ids.permit}$`)); await expect(page.getByRole('heading', { name: state.appointment.title, exact: true })).toBeVisible();
  expect(state.commands).toEqual([{ path: `/api/v1/work-permits/appointments/${ids.appointment}/pt`, body: { templateVersoes: [{ templateId: ids.template, versao: 2 }], participanteIds: [ids.user], expectedAppointmentVersion: state.appointment.version } }]);
  expect(state.requests.indexOf(`GET /api/v1/browser/workers/${ids.worker}`)).toBeLessThan(state.requests.indexOf(`GET /api/v1/workers/${ids.worker}`));
  await page.getByRole('link', { name: 'Voltar ao agendamento', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/app/agenda/${ids.appointment}$`)); await page.getByRole('link', { name: 'Voltar à agenda', exact: true }).click();
  await expect(page.getByLabel('Buscar por título')).toHaveValue('Inspeção'); await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('CONFIRMED'); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
test('trabalhador sem usuário vinculado não gera permissão com ID de trabalhador', async ({ page }) => {
  const state = await setup(page, { unlinked: true }), dialog = page.getByRole('dialog', { name: 'Abrir permissão de trabalho', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('não possui usuário vinculado'); await expect(dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true })).toBeDisabled(); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('leitura browser negada impede consulta nativa e criação', async ({ page }) => {
  const state = await setup(page, { deniedWorker: true }); await expect(page.getByRole('dialog', { name: 'Abrir permissão de trabalho', exact: true }).getByRole('alert')).toContainText('Não foi possível acessar');
  expect(state.requests.some(request => request === `GET /api/v1/workers/${ids.worker}`)).toBe(false); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('alteração do agendamento preserva a escolha e impede POST com contexto antigo', async ({ page }) => {
  const state = await setup(page), dialog = await fill(page); state.appointment.version = 3; await dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('agendamento foi alterado'); await expect(dialog.getByLabel('Modelo: Manutenção em altura')).toHaveValue(ids.templateVersion); await expect(dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true })).toBeDisabled(); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('PT existente é reutilizada sem POST nem leituras desnecessárias', async ({ page }) => {
  const state = await setup(page, { existing: true }), dialog = page.getByRole('dialog', { name: 'Abrir permissão de trabalho', exact: true });
  await dialog.getByRole('button', { name: 'Abrir PT existente', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/app/pts/${ids.permit}$`));
  expect(state.commands).toEqual([]); expect(state.requests.some(request => request.includes('/workers/') || request.includes('/pt-templates'))).toBe(false); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('recibo incompatível bloqueia repetição após um resultado potencialmente persistido', async ({ page }) => {
  const state = await setup(page, { badReceipt: true }), dialog = await fill(page); await dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('A resposta não confirmou'); await expect(dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true })).toBeDisabled(); expect(state.created).toBe(true); expect(state.commands).toHaveLength(1); expect(state.errors).toEqual([]);
});
test('abertura cabe em 320px e não exibe dados adicionais do DTO nativo', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page), dialog = await fill(page);
  await expect(dialog.getByRole('button', { name: 'Mais informações: Conta vinculada: Alice Trabalhadora', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog).not.toContainText('1990-01-01'); await expect(dialog).not.toContainText('***.***.***-00'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('abertura-pt-mobile.png'), fullPage: true }); await dialog.getByRole('button', { name: 'Abrir PT em verificação', exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/app/pts/${ids.permit}$`)); expect(state.commands).toHaveLength(1); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
