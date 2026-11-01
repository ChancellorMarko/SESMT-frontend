import { expect, test, type Page } from '@playwright/test';
import { declarationFixture, historyFixture, permitFixture, permitIds as ids } from './fixtures/native-permits';
import { nativeOrganizationFixture, nativeResponsibleFixture } from './fixtures/native-operations';

// HTTP contracts are controlled; this suite does not homologate .NET/PostgreSQL.
async function setup(page: Page, grants = ['pt:liberar', 'pt:iniciar', 'pt:editar']) {
  const state = { item: permitFixture(), ready: true, conflict: false, denied: false, wrongItem: false,
    requests: [] as string[], commands: [] as { path: string; body: Record<string, unknown> }[], unexpected: [] as string[], errors: [] as string[] };
  let signedIn = false;
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api/v1/browser/', '/api/v1/'), method = route.request().method();
    state.requests.push(`${method} ${url.pathname}${url.search}`);
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const session = { accessToken: 'native-permits-fixture', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'native-permits-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', message: 'Entre novamente.', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Pessoa da operação', email: 'operacao@example.invalid' }, roles: ['ADMIN'], permissions: ['usuario:ler', 'empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler', ...grants], scope: { companyIds: [ids.company], unitIds: [ids.unit], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/organization') return json({ ...nativeOrganizationFixture, establishments: [], sectors: [], jobs: [], jobFunctions: [], workCenters: [] });
    if (path === '/api/v1/users') return json([nativeResponsibleFixture]);
    if (path === '/api/v1/work-permits/search' && method === 'GET') {
      if (state.denied) return json({ code: 'FORBIDDEN', message: 'Informação privada', requestId: 'test' }, 403);
      const matches = (!url.searchParams.get('status') || state.item.status === url.searchParams.get('status')) && (!url.searchParams.get('q') || `${state.item.title} ${state.item.serviceCode}`.toLowerCase().includes(url.searchParams.get('q')!.toLowerCase()));
      return json({ items: matches ? [state.item] : [], total: matches ? 1 : 0, page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')) });
    }
    const base = `/api/v1/work-permits/${ids.permit}`;
    if (path.startsWith(base) && method === 'GET') {
      if (state.denied) return json({ code: 'FORBIDDEN', message: 'Informação privada', requestId: 'test' }, 403);
      if (path === base) return json({ ...state.item, id: state.wrongItem ? ids.team : state.item.id });
      if (path === `${base}/history`) return json(historyFixture());
      if (path === `${base}/declarations`) return json(declarationFixture(state.item));
      if (path === `${base}/eligibility`) return json({ ready: state.ready, issues: state.ready ? [] : [{ code: 'CIENCIA_PENDENTE', participantUserId: ids.user, documentTypeId: null, serviceCode: null }] });
    }
    if (path.startsWith(base + '/') && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>; state.commands.push({ path, body });
      if (state.conflict || body.expectedVersion !== state.item.version) return json({ code: 'DOMAIN_VIOLATION', message: 'Informação privada', requestId: 'test' }, 409);
      const action = path.split('/').at(-1)!;
      if (action === 'release') state.item = { ...state.item, status: 'LIBERADA', releasedAt: '2026-10-31T12:00:00Z', authorizedFrom: String(body.authorizedFrom), authorizedUntil: String(body.authorizedUntil), releaseConditions: String(body.conditions) };
      else if (action === 'start') state.item = { ...state.item, status: 'EM_EXECUCAO', startedAt: '2026-10-31T12:00:00Z' };
      else if (action === 'suspend') state.item = { ...state.item, status: 'SUSPENSA', suspendedAt: '2026-10-31T12:00:00Z', suspensionReason: String(body.reason) };
      else if (action === 'resume') state.item = { ...state.item, status: 'EM_EXECUCAO' };
      else if (action === 'cancel') state.item = { ...state.item, status: 'CANCELADA', cancelledAt: '2026-10-31T12:00:00Z', cancellationReason: String(body.reason) };
      else if (action === 'observations') state.item = { ...state.item, observations: [...state.item.observations!, { id: ids.event, actorId: ids.user, recordedAt: '2026-10-31T12:00:00Z', text: String(body.observation) }] };
      else { state.unexpected.push(`${method} ${path}`); return json({}, 404); }
      state.item.version++; return json(state.item);
    }
    state.unexpected.push(`${method} ${path}`); return json({ code: 'NOT_FOUND', requestId: 'test' }, 404);
  });
  await page.goto('/login'); await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('operacao@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia da operação'); await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await expect(menu.getByRole('link', { name: 'Modelo de permissão de trabalho', exact: true })).toHaveCount(0);
  await menu.getByRole('link', { name: 'Permissões de trabalho', exact: true }).click();
  await expect(page.getByRole('link', { name: state.item.title, exact: true })).toBeVisible(); return state;
}
async function detail(page: Page) { await page.getByRole('link', { name: 'Manutenção da cobertura', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Manutenção da cobertura', exact: true })).toBeVisible(); }
async function action(page: Page, name: string, text?: { label: string; value: string }) {
  await page.getByRole('button', { name, exact: true }).click(); const dialog = page.getByRole('dialog', { name, exact: true });
  if (text) await dialog.getByLabel(text.label, { exact: true }).fill(text.value);
  await dialog.getByRole('checkbox', { name: /Confirmo/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar operação', exact: true }).click();
  await expect(page.getByText('Operação confirmada pela API.', { exact: true })).toBeVisible(); await expect(dialog).toHaveCount(0);
}
test('consulta nativa preserva filtros e cancela com estado português e versão real', async ({ page }) => {
  const state = await setup(page); await page.getByLabel('Buscar atividade ou serviço').fill('altura'); await page.getByLabel('Situação operacional', { exact: true }).selectOption('EM_VERIFICACAO');
  await page.getByLabel('Atividade de (UTC)').fill('2026-10-31'); await page.getByLabel('Atividade até (UTC)').fill('2026-10-31'); await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Somente unidade selecionada' }).check(); await detail(page);
  await action(page, 'Cancelar PT', { label: 'Motivo', value: 'Atividade retirada da programação' });
  expect(state.commands).toEqual([{ path: `/api/v1/work-permits/${ids.permit}/cancel`, body: { expectedVersion: 4, reason: 'Atividade retirada da programação' } }]);
  await page.getByRole('link', { name: 'Voltar às PTs', exact: true }).click(); await expect(page.getByLabel('Situação operacional')).toHaveValue('EM_VERIFICACAO'); await expect(page.getByRole('heading', { name: 'Nenhuma PT encontrada' })).toBeVisible();
  await page.getByLabel('Situação operacional').selectOption('CANCELADA'); await page.getByRole('button', { name: 'Buscar', exact: true }).click(); await expect(page.getByRole('link', { name: state.item.title })).toBeVisible();
  const query = state.requests.filter(value => value.includes('/work-permits/search?')).at(-1)!; expect(query).toContain(`locationId=${ids.unit}`); expect(query).toContain('to=2026-11-01T00%3A00%3A00.000Z'); expect(query).not.toContain('unitId='); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
test('libera, inicia, observa, suspende e retoma pelos comandos nativos versionados', async ({ page }) => {
  const state = await setup(page); await detail(page);
  await action(page, 'Liberar PT', { label: 'Condições da liberação', value: 'Área isolada e equipe orientada' });
  expect(state.commands[0].body).toMatchObject({ expectedVersion: 4, authorizedFrom: '2026-10-31T10:00:00.000Z', authorizedUntil: '2026-10-31T20:00:00.000Z', confirmation: true });
  await action(page, 'Iniciar serviço'); await action(page, 'Registrar observação', { label: 'Observação', value: 'Conferência periódica registrada' });
  await action(page, 'Suspender serviço', { label: 'Motivo', value: 'Mudança das condições de trabalho' }); await action(page, 'Retomar serviço');
  expect(state.commands.map(value => value.body.expectedVersion)).toEqual([4, 5, 6, 7, 8]); expect(state.item.status).toBe('EM_EXECUCAO'); expect(state.item.contentVersion).toBe(3);
  await expect(page.getByRole('button', { name: 'Cancelar PT', exact: true })).toHaveCount(0); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
test('conflito preserva o motivo e impede reenvio sem atualizar a PT', async ({ page }) => {
  const state = await setup(page); await detail(page); await page.getByRole('button', { name: 'Cancelar PT', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancelar PT', exact: true }); await dialog.getByLabel('Motivo').fill('Programação alterada'); await dialog.getByRole('checkbox', { name: /Confirmo/ }).check(); state.conflict = true;
  await dialog.getByRole('button', { name: 'Confirmar operação' }).click(); await expect(dialog.getByRole('alert')).toContainText('Seus dados foram mantidos'); await expect(dialog.getByLabel('Motivo')).toHaveValue('Programação alterada'); await expect(dialog.getByRole('button', { name: 'Confirmar operação' })).toBeDisabled();
  await expect(dialog).not.toContainText('Informação privada'); expect(state.commands).toHaveLength(1); expect(state.commands[0].body.expectedVersion).toBe(4); expect(state.errors).toEqual([]);
});
test('pendências bloqueiam liberação e ausência de grants não é substituída pelo perfil ADMIN', async ({ page }) => {
  const state = await setup(page, []); await detail(page); await expect(page.getByRole('button', { name: /Liberar PT|Cancelar PT|Iniciar serviço/ })).toHaveCount(0);
  state.ready = false; await page.getByRole('button', { name: 'Atualizar PT', exact: true }).click(); await expect(page.getByText('Ciência pendente', { exact: true })).toBeVisible();
  await expect(page.getByText('Sem pendências nesta consulta')).toHaveCount(0); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('PT de outro ID ou consulta recusada ocultam os dados em cache', async ({ page }) => {
  const state = await setup(page); await detail(page); await expect(page.getByRole('button', { name: 'Liberar PT', exact: true })).toBeEnabled(); state.wrongItem = true;
  await page.getByRole('button', { name: 'Atualizar PT', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('Não foi possível conferir esta PT'); await expect(page.getByRole('heading', { name: state.item.title, exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Liberar PT', exact: true })).toHaveCount(0);
  state.wrongItem = false; state.denied = true; await page.getByRole('button', { name: 'Atualizar PT', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('não autorizada'); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('detalhe e liberação cabem em 320px com validação de janela antes do POST', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page); await detail(page);
  await expect(page.getByRole('button', { name: 'Liberar PT', exact: true })).toBeEnabled(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pt-nativa-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Liberar PT', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Liberar PT', exact: true }); await dialog.getByLabel('Condições da liberação').fill('Condições conferidas'); await dialog.getByLabel('Autorizada até (Brasília)').fill('2026-10-31T23:00'); await dialog.getByRole('checkbox', { name: /Confirmo/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar operação' }).click(); await expect(dialog.getByRole('alert')).toContainText('dentro do agendamento'); expect(state.commands).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('liberacao-pt-mobile.png'), fullPage: true }); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
