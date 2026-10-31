import { expect, test, type Page } from '@playwright/test';

// Native-contract browser QA: real Vite proxy/cookies with fictitious HTTP services.
// These scenarios do not run the independent .NET API or its database.
function observe(page: Page) {
  const errors: string[] = [];
  const paths: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/v1/')) paths.push(`${request.method()} ${path}`);
  });
  return { errors, paths };
}

async function enterCredentials(page: Page, email = 'cookie@example.invalid') {
  await page.goto('/login');
  await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia do cookie');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
}

test('contrato nativo recupera e redefine a senha em 320px, validando 12 caracteres antes do envio', async ({ page }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/recuperar-acesso');
  const requestRecovery = page.getByRole('button', { name: 'Solicitar recuperação', exact: true });
  await expect(requestRecovery).toBeEnabled();
  await page.getByLabel('E-mail', { exact: true }).fill('pessoa@example.invalid');
  const forgotResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/forgot-password');
  await requestRecovery.click();
  const forgot = await forgotResponse;
  expect(forgot.status()).toBe(202);
  expect(forgot.request().postDataJSON()).toEqual({ email: 'pessoa@example.invalid' });
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Se houver uma conta');

  // Accept the route used by the API's email configuration, without putting the token in a query.
  await page.goto('/reset-password#token=fixture-reset-token');
  await expect(page).toHaveTitle('Definir nova senha — Ampara SESMT');
  const password = page.getByLabel('Nova senha', { exact: true });
  const confirm = page.getByLabel('Confirmar nova senha', { exact: true });
  const resetButton = page.getByRole('button', { name: 'Redefinir senha', exact: true });
  await expect(resetButton).toBeEnabled();
  await expect(password).toHaveAccessibleDescription(/12/);
  await password.fill('Curta123!');
  await confirm.fill('Curta123!');
  await resetButton.click();
  await expect(page.getByRole('alert').filter({ hasText: /12/ })).toBeVisible();
  expect(observed.paths.filter(path => path === 'POST /api/v1/auth/reset-password')).toEqual([]);
  await expect(password).toHaveValue('Curta123!');
  await expect(page.getByLabel('Código de recuperação', { exact: true })).toHaveValue('fixture-reset-token');

  await password.fill('Nova senha nativa 2026');
  await confirm.fill('Nova senha nativa 2026');
  const resetResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/reset-password');
  await resetButton.click();
  const reset = await resetResponse;
  expect(reset.status()).toBe(204);
  expect(reset.request().postDataJSON()).toEqual({ token: 'fixture-reset-token', newPassword: 'Nova senha nativa 2026' });
  await expect(page.getByRole('heading', { name: 'Tudo pronto.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voltar ao login', exact: true })).toBeFocused();
  expect(observed.paths.some(path => path.includes('/auth/password/'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(observed.errors).toEqual([]);
});

test('identidade nativa reduzida mantém as áreas protegidas bloqueadas no login e na restauração', async ({ page }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterCredentials(page);
  const profileWarning = page.getByRole('alert').filter({ hasText: /perfil/ });
  await expect(profileWarning).toContainText(/permissões/);
  await expect(profileWarning).toContainText(/administrador/);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sua conta está conectada.' })).toHaveCount(0);
  expect(observed.paths).toContain('GET /api/v1/auth/me');
  expect(observed.paths).not.toContain('GET /api/v1/me');

  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status').filter({ hasText: /perfil/ })).toContainText(/permissões/);
  await expect(page.getByRole('button', { name: 'Entrar na plataforma', exact: true })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain('fixture-access-');
  expect(observed.errors).toEqual([]);
});

test('MFA nativo sem desafio orienta a procurar o administrador e não cria uma etapa fictícia', async ({ page }) => {
  const observed = observe(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterCredentials(page, 'mfa@example.invalid');
  const warning = page.getByRole('alert');
  await expect(warning).toContainText(/verificação/);
  await expect(warning).toContainText(/administrador/);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Código de verificação', { exact: true })).toHaveCount(0);
  expect(observed.paths).not.toContain('POST /api/v1/auth/mfa/verify');
  expect(observed.paths).not.toContain('GET /api/v1/auth/me');
  expect(observed.errors).toEqual([]);
});

// Native grants + explicit UI DTO fixture. This tests naming and route guards,
// not compatibility of the native DocumentsController response or live authorization.
async function nativeGrants(page: Page, grants: string[], rawDocument = false, scopeUnits?: string[]) {
  const companyId = '10000000-0000-4000-8000-000000000001';
  const unitId = '10000000-0000-4000-8000-000000000002';
  const userId = '10000000-0000-4000-8000-000000000003';
  const document = { id: '10000000-0000-4000-8000-000000000004', companyId, unitId, sectorId: null, code: 'DOC-API-01', title: 'Documento retornado pela API de teste', typeId: '10000000-0000-4000-8000-000000000005', ownerId: userId, accessClass: 'INTERNAL', issueDate: '2026-10-31', status: 'DRAFT', currentVersionId: null, activeVersionId: null, activeVersionIds: [], workerIds: [], responsibleIds: [], keywords: [], availableActions: [], revision: null, sourceReadOnly: true };
  let signedIn = false;
  const state = {
    grants, usersDenied: false, auditDenied: false, noticesDenied: false, markDenied: false, patchConflict: false, unexpected: [] as string[],
    commands: [] as { method: string; path: string; body: unknown }[], queries: [] as string[],
    users: [{ id: userId, name: 'Pessoa do cadastro nativo', email: 'person@example.invalid', roles: ['PERFIL_NOVO'], scopeIds: [companyId], active: true }],
    notices: [{ id: '10000000-0000-4000-8000-000000000006', type: 'PT_AGUARDANDO_REVISAO', resourceId: document.id, text: 'Verificar encerramento da atividade', createdAt: '2026-10-31T12:00:00Z', readAt: null as string | null }],
    audit: [{ id: '10000000-0000-4000-8000-000000000007', atorId: userId, declaranteId: null, empresaId: companyId, acao: 'UPDATE', recursoTipo: 'documento', recursoId: document.id, versao: 1, momento: '2026-10-31T12:00:00Z', resultado: 'SUCCESS', traceId: 'trace-native-fixture' }],
  };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1/browser/', '/api/v1/');
    const method = route.request().method();
    state.queries.push(`${method} ${url.pathname}${url.search}`);
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const session = { accessToken: 'native-grants-test', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'native-grants-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', message: 'Entre novamente.', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: userId, displayName: 'Perfil criado no backend', email: 'native@example.invalid' }, roles: ['PERFIL_NOVO'], permissions: state.grants, scope: { companyIds: [companyId], unitIds: scopeUnits ?? [unitId], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/users') return state.usersDenied ? json({ code: 'FORBIDDEN', message: 'Detalhe do servidor', requestId: 'test' }, 403) : json(state.users);
    if (path.startsWith('/api/v1/users/') && method !== 'GET') {
      const target = state.users.find(user => path === `/api/v1/users/${user.id}` || path === `/api/v1/users/${user.id}/deactivate`);
      state.commands.push({ method, path, body: route.request().postDataJSON() });
      if (!target) return json({ code: 'NOT_FOUND' }, 404);
      if (method === 'PATCH') {
        if (state.patchConflict) return json({ code: 'DUPLICATE_EMAIL', message: 'privado', requestId: 'test' }, 409);
        Object.assign(target, route.request().postDataJSON()); return json(target);
      }
      if (method === 'POST' && path.endsWith('/deactivate')) { target.active = false; return route.fulfill({ status: 204 }); }
    }
    if (path === '/api/v1/notifications' && method === 'GET') return state.noticesDenied ? json({ code: 'FORBIDDEN', message: 'privado', requestId: 'test' }, 403) : json({ items: state.notices });
    if (path === `/api/v1/notifications/${state.notices[0].id}/read` && method === 'POST') {
      state.commands.push({ method, path, body: route.request().postDataJSON() });
      if (state.markDenied) return json({ code: 'FORBIDDEN', message: 'privado', requestId: 'test' }, 403);
      state.notices[0].readAt = '2026-10-31T13:00:00Z'; return route.fulfill({ status: 204 });
    }
    if (path === '/api/v1/audit-logs') return state.auditDenied ? json({ code: 'FORBIDDEN', message: 'privado', requestId: 'test' }, 403) : json({ items: state.audit.filter(item => !url.searchParams.get('action') || item.acao === url.searchParams.get('action')), total: url.searchParams.get('action') === 'CREATE' ? 0 : 1, page: Number(url.searchParams.get('pageNumber')), pageSize: Number(url.searchParams.get('pageSize')) });
    if (path === '/api/v1/document-types') return json({ items: [], total: 0, page: 1, pageSize: 20 });
    if (path === '/api/v1/documents') return json({ items: [rawDocument ? { id: document.id, documentTypeId: document.typeId, companyId, unitId, title: document.title, secrecyLevel: 'INTERNO', status: 'RASCUNHO' } : document], page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')), total: 1 });
    state.unexpected.push(path);
    return json({ code: 'NOT_CONNECTED', message: 'Rota não conectada.', requestId: 'test' }, 501);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterCredentials(page, 'native@example.invalid');
  return state;
}

test('permissão documento:ler de um perfil novo abre a leitura compatível e a revogação remove o acesso', async ({ page }) => {
  const observed = observe(page);
  const state = await nativeGrants(page, ['documento:ler']);
  await expect(page).toHaveURL(/\/app\/documentos/);
  await expect(page.getByRole('link', { name: 'Documento retornado pela API de teste', exact: true })).toBeVisible();
  expect(observed.paths).toContain('GET /api/v1/browser/documents');
  expect(observed.paths).not.toContain('POST /api/v1/browser/auth/login');
  await expect(page.getByRole('link', { name: 'Novo documento', exact: true })).toHaveCount(0);
  state.grants = [];
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Documento retornado pela API de teste', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Voltar ao início', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/conexao$/);
  expect(state.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('permissões sem módulo conhecido não enviam a pessoa para notificações nem criam um atalho circular', async ({ page }) => {
  const state = await nativeGrants(page, ['recurso_novo:consultar']);
  await expect(page).toHaveURL(/\/app\/conexao$/);
  await expect(page.getByRole('heading', { name: 'Nenhum módulo disponível para estes acessos', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir meu espaço de trabalho', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mais informações: Permissões da conta' }).click();
  await expect(page.getByRole('dialog')).toContainText('recurso_novo:consultar');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mais informações: Permissões da conta' })).toBeFocused();
  expect(state.unexpected).toEqual([]);
});

test('reconhecer a permissão não faz o frontend aceitar um DTO documental incompatível', async ({ page }) => {
  const state = await nativeGrants(page, ['documento:ler'], true);
  await expect(page).toHaveURL(/\/app\/documentos/);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Documento retornado pela API de teste', exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('usuario:ler abre a lista nativa sem exigir unidade, editar contas ou ignorar uma recusa posterior', async ({ page }, testInfo) => {
  const observed = observe(page);
  await page.setViewportSize({ width: 320, height: 900 });
  const state = await nativeGrants(page, ['usuario:ler', 'usuario:criar', 'documento:ler'], false, []);
  await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);
  await expect(page.getByRole('cell', { name: /Pessoa do cadastro nativo/ })).toBeVisible();
  await expect(page.getByText('Escopo da conta · somente leitura', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Convidar|Editar|Desativar/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('usuarios-nativos-mobile.png'), fullPage: true });
  state.usersDenied = true;
  await page.getByRole('button', { name: 'Atualizar usuários', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A API não autorizou');
  await expect(page.getByRole('cell', { name: /Pessoa do cadastro nativo/ })).toHaveCount(0);
  expect(observed.paths.filter(path => /POST.*\/(users|roles)/.test(path))).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('notificações nativas usam POST sem corpo e sincronizam a leitura com o sino', async ({ page }, testInfo) => {
  const observed = observe(page);
  await page.setViewportSize({ width: 320, height: 900 });
  const state = await nativeGrants(page, ['alerta:ler'], false, []);
  await expect(page).toHaveURL(/\/app\/notificacoes$/);
  await expect(page.getByRole('button', { name: 'Marcar como lida', exact: true })).toBeVisible();
  await expect(page.locator('[data-notification-count="1"]')).toBeVisible();
  await page.getByRole('combobox', { name: 'Leitura', exact: true }).selectOption('false');
  await page.getByRole('button', { name: 'Marcar como lida', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhuma notificação', exact: true })).toBeVisible();
  await expect(page.locator('[data-notification-count]')).toHaveCount(0);
  expect(state.commands).toEqual([{ method: 'POST', path: `/api/v1/notifications/${state.notices[0].id}/read`, body: null }]);
  expect(state.queries.filter(query => query.startsWith('GET /api/v1/notifications'))).not.toEqual([]);
  expect(state.queries.filter(query => /notifications\?/.test(query))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('notificacoes-mobile.png'), fullPage: true });
  expect(state.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('recusa ao marcar aviso oculta conteúdo e contador até uma nova leitura autorizada', async ({ page }) => {
  const state = await nativeGrants(page, ['alerta:ler']);
  await expect(page.getByText(state.notices[0].text, { exact: true })).toBeVisible();
  state.markDenied = true;
  await page.getByRole('button', { name: 'Marcar como lida', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível autorizar');
  await expect(page.getByText(state.notices[0].text, { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-notification-count]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Atualizar notificações', exact: true }).click();
  await expect(page.getByText(state.notices[0].text, { exact: true })).toBeVisible();
  await expect(page.locator('[data-notification-count="1"]')).toBeVisible();
});

test('auditoria nativa consulta paginação e filtros reais, confere detalhes e oculta registros recusados', async ({ page }, testInfo) => {
  const observed = observe(page);
  const state = await nativeGrants(page, ['auditoria:ler'], false, []);
  await expect(page).toHaveURL(/\/app\/auditoria$/);
  await page.getByRole('button', { name: `Ver evento ${state.audit[0].id}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('trace-native-fixture');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Ver evento ${state.audit[0].id}`, exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('auditoria-desktop.png'), fullPage: true });
  await page.getByLabel('Ação', { exact: true }).fill('create');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum evento encontrado', exact: true })).toBeVisible();
  expect(state.queries.some(query => query.includes('pageNumber=1') && query.includes('pageSize=20') && query.includes('action=CREATE'))).toBe(true);
  expect(state.queries.filter(query => query.includes('audit-logs') && /unitId=|\/actions/.test(query))).toEqual([]);
  state.auditDenied = true;
  await page.getByRole('button', { name: 'Limpar', exact: true }).click();
  await page.getByRole('button', { name: 'Atualizar auditoria', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A API não autorizou');
  await expect(page.getByRole('button', { name: /Ver evento/ })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('usuários nativos salvam os dados publicados, preservam conflito e impedem desativação própria', async ({ page }) => {
  const observed = observe(page);
  const state = await nativeGrants(page, ['usuario:ler', 'usuario:editar', 'usuario:excluir'], false, []);
  await expect(page.getByRole('button', { name: 'Editar Pessoa do cadastro nativo', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desativar Pessoa do cadastro nativo', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Editar Pessoa do cadastro nativo', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome', exact: true }).fill('Nome editado');
  state.patchConflict = true;
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Este e-mail já está em uso');
  await expect(page.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Nome editado');
  state.patchConflict = false;
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Nome editado person@example.invalid', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(2);
  expect(state.commands.every(command => command.method === 'PATCH' && JSON.stringify(command.body) === JSON.stringify({ name: 'Nome editado', email: 'person@example.invalid' }))).toBe(true);
  expect(state.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});
