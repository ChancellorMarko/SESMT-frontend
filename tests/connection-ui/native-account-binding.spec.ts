import { expect, test, type Page } from '@playwright/test';
import { bindingAccounts, bindingContext, bindingIds as ids, bindingPage } from './fixtures/native-account-binding';
import { workerDirectory, workerProfile, workerScope } from './fixtures/native-workers';

async function setup(page: Page, writable = true, linked = false) {
  let signedIn = false;
  const state = { current: { ...bindingContext(), userId: linked ? ids.account : null as string | null }, conflict: false, lost: false, writes: [] as unknown[], unexpected: [] as string[], errors: [] as string[] };
  await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const session = { accessToken: 'binding-fixture-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'binding-fixture-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Administrador de QA', email: 'binding@example.invalid' }, roles: ['ADMIN'], permissions: ['usuario:ler', 'trabalhador:ler', 'empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler', ...(writable ? ['trabalhador:editar', 'usuario:editar'] : [])], scope: workerScope, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/users') return json([]);
    if (path === '/api/v1/browser/organization') return json(workerDirectory);
    if (path === `/api/v1/browser/workers/${ids.worker}`) return json(workerProfile());
    if (path === `/api/v1/browser/workers/${ids.worker}/movements`) return json({ items: [], page: 1, pageSize: 5, total: 0 });
    const root = `/api/v1/workers/${ids.worker}/account-binding`;
    if (path === root && method === 'GET') return json(state.current);
    if (path === `${root}/candidates`) return json(bindingPage());
    if (path === `${root}/candidates/${ids.account}`) return json(bindingAccounts[0]);
    if (path === root && method === 'PUT') {
      expect(request.headers().authorization).toBe('Bearer binding-fixture-token'); expect(request.headers()['idempotency-key']).toBeUndefined(); const body = request.postDataJSON(); state.writes.push(body);
      if (state.conflict) return json({ code: 'CONFLICT', message: 'Vínculo alterado', requestId: 'test' }, 409);
      state.current = { ...state.current, revision: state.current.revision + 1, userId: body.userId };
      return state.lost ? route.abort('failed') : json(state.current);
    }
    state.unexpected.push(`${method} ${path}`); return json({ code: 'NOT_FOUND', requestId: 'test' }, 404);
  });
  await page.goto('/login'); await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('binding@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia para teste');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click(); await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);
  await page.goto(`/app/trabalhadores/${ids.worker}?unitId=${ids.unit}`); await expect(page.getByRole('heading', { name: 'Pessoa Fictícia', exact: true })).toBeVisible(); return state;
}
async function form(page: Page) {
  await page.getByRole('link', { name: 'Conta de acesso', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Vincular conta de acesso', exact: true });
  await dialog.getByRole('radio', { name: /Pessoa Fictícia.*titular@example.invalid/ }).check(); return dialog;
}

test('vincula conta confirmada em 320px e retorna à ficha sem enviar campos de identidade civil', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page); const dialog = await form(page);
  await expect(dialog.getByRole('button', { name: 'Vincular conta', exact: true })).toBeDisabled(); await dialog.getByRole('checkbox').check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('vinculo-conta-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Vincular conta', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Pessoa Fictícia', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Conta vinculada');
  expect(state.writes).toEqual([{ expectedVersion: 1, userId: ids.account, expectedAccountName: bindingAccounts[0].name, expectedAccountEmail: bindingAccounts[0].email, confirmation: true }]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('409 mantém a conta selecionada e bloqueia o reenvio', async ({ page }, testInfo) => {
  const state = await setup(page); const dialog = await form(page); await dialog.getByRole('checkbox').check(); state.conflict = true;
  await dialog.getByRole('button', { name: 'Vincular conta', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('dados foram mantidos'); await expect(dialog.getByRole('radio', { name: /Pessoa Fictícia/ })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Vincular conta', exact: true })).toBeDisabled(); await page.screenshot({ path: testInfo.outputPath('vinculo-conta-conflito-desktop.png'), fullPage: true });
  expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('resposta perdida após possível gravação não repete o vínculo', async ({ page }) => {
  const state = await setup(page); const dialog = await form(page); await dialog.getByRole('checkbox').check(); state.lost = true;
  await dialog.getByRole('button', { name: 'Vincular conta', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Não foi possível confirmar'); await expect(dialog.getByRole('button', { name: 'Vincular conta', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1); expect(state.current.userId).toBe(ids.account); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('conta já vinculada recebe consulta sem ações de substituição', async ({ page }) => {
  const state = await setup(page, true, true); await page.getByRole('link', { name: 'Conta de acesso', exact: true }).click(); await expect(page.getByText('Este trabalhador já possui uma conta vinculada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('ADMIN sem as permissões de edição não recebe o comando', async ({ page }) => {
  const state = await setup(page, false); await expect(page.getByRole('link', { name: 'Conta de acesso', exact: true })).toHaveCount(0);
  await page.goto(`/app/trabalhadores/${ids.worker}/conta`); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
