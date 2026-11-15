// Explicit user-administration grants keep the setup page stable; module grants remain independent.
import { expect, test, type Page } from '@playwright/test';
import { workerDirectory, workerDraft, workerIds as ids, workerProfile, workerReceipt, workerScope } from './fixtures/native-workers';

// Controlled native HTTP contracts. PostgreSQL/authorization have a separate API suite.
async function setup(page: Page, writable = true) {
  let signedIn = false;
  const state = { created: false, ambiguous: false, posts: [] as { path: string; body: unknown }[], unexpected: [] as string[], errors: [] as string[] };
  await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const session = { accessToken: 'worker-create-fixture', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'workers-fixture-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Pessoa Fictícia', email: 'workers@example.invalid' }, roles: ['ADMIN'],
      permissions: ['usuario:ler', 'usuario:editar', 'trabalhador:ler', 'empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler', ...(writable ? ['trabalhador:criar'] : [])], scope: workerScope, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/users') return json([]);
    if (path === '/api/v1/browser/organization') return json(workerDirectory);
    if (path === '/api/v1/browser/workers' && method === 'GET') return json({ items: state.created ? [workerProfile()] : [], page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 10), total: state.created ? 1 : 0 });
    if (path === `/api/v1/browser/workers/${ids.worker}` && method === 'GET') return json(workerProfile());
    if (path === `/api/v1/browser/workers/${ids.worker}/movements`) return json({ items: [], page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 5), total: 0 });
    if (path === '/api/v1/workers' && method === 'POST') {
      expect(request.headers()['idempotency-key']).toBeUndefined(); expect(request.headers().authorization).toBe('Bearer worker-create-fixture');
      state.posts.push({ path, body: request.postDataJSON() }); state.created = true;
      return state.ambiguous ? route.abort('failed') : json(workerReceipt(), 201);
    }
    state.unexpected.push(`${method} ${path}`); return json({ code: 'NOT_FOUND', requestId: 'test' }, 404);
  });
  await page.goto('/login'); await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('workers@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia do cadastro');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click(); await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);
  await page.goto(`/app/trabalhadores?unitId=${ids.unit}`); await expect(page.getByRole('heading', { name: 'Trabalhadores', exact: true })).toBeVisible(); return state;
}
async function form(page: Page) {
  await page.getByRole('link', { name: 'Novo trabalhador', exact: true }).click(); const dialog = page.getByRole('form', { name: 'Cadastrar trabalhador', exact: true });
  for (const [name, value] of Object.entries({ 'Nome completo': workerDraft.name, Matrícula: workerDraft.enrollment, CPF: workerDraft.cpf, Nascimento: workerDraft.dateOfBirth, Admissão: workerDraft.admissionDate })) await dialog.getByLabel(name, { exact: true }).fill(value);
  await dialog.getByLabel('Setor', { exact: true }).selectOption(ids.sector); await dialog.getByLabel('Cargo', { exact: true }).selectOption(ids.position); return dialog;
}

test('cadastra trabalhador com os campos nativos e retorna ao perfil em 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page); const dialog = await form(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cadastro-trabalhador-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cadastrar', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/app/trabalhadores/${ids.worker}$`)); await expect(page.getByRole('heading', { name: workerDraft.name, exact: true })).toBeVisible();
  expect(state.posts).toEqual([{ path: '/api/v1/workers', body: { ...workerDraft, companyId: ids.company, unitId: ids.unit, dismissalDate: null, userId: null } }]);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('falha de rede após possível persistência conserva os dados e bloqueia repetição', async ({ page }) => {
  const state = await setup(page); const dialog = await form(page); state.ambiguous = true;
  await dialog.getByRole('button', { name: 'Cadastrar', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Não foi possível confirmar');
  await expect(dialog.getByLabel('Matrícula', { exact: true })).toHaveValue(workerDraft.enrollment); await expect(dialog.getByRole('button', { name: 'Cadastrar', exact: true })).toBeDisabled();
  expect(state.posts).toHaveLength(1); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('ADMIN com leitura não recebe acesso ao cadastro sem a permissão de criar', async ({ page }) => {
  const state = await setup(page, false); await expect(page.getByRole('link', { name: 'Novo trabalhador', exact: true })).toHaveCount(0);
  await page.goto('/app/trabalhadores/novo'); await expect(page.getByRole('form', { name: 'Cadastrar trabalhador', exact: true })).toHaveCount(0);
  expect(state.posts).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
