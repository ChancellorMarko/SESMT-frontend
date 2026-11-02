import { expect, test, type Page } from '@playwright/test';
import { editableTeamFixture, teamContext, teamIds as ids, teamPeople, teamScope, teamSummary } from './fixtures/native-teams';
import { nativeOrganizationFixture } from './fixtures/native-operations';

// Controlled browser/API contracts; relational guarantees are exercised by the backend suite.
async function setup(page: Page, writable = true, paginated = false) {
  let signedIn = false;
  const state = { current: editableTeamFixture(), conflict: false, writes: [] as { method: string; body: Record<string, unknown> }[], unexpected: [] as string[], errors: [] as string[] };
  const firstPage = Array.from({ length: 10 }, (_, index) => ({ ...editableTeamFixture(), id: `63000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, name: `Equipe ${index + 1}` }));
  await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const token = { accessToken: 'teams-fixture-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'teams-fixture-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(token); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(token) : json({ code: 'SESSION_EXPIRED', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Pessoa Fictícia', email: 'teams@example.invalid' }, roles: ['ADMIN'], permissions: ['usuario:ler', 'equipe:ler', 'trabalhador:ler', ...(writable ? ['equipe:criar', 'equipe:editar'] : [])], scope: teamScope, accessExpiresAt: token.accessExpiresAt });
    if (path === '/api/v1/users') return json([]);
    if (path === '/api/v1/browser/organization') return json(nativeOrganizationFixture);
    if (path === '/api/v1/teams/management-context') {
      expect(url.searchParams.get('locationId')).toBe(ids.unit); expect(['criar', 'editar']).toContain(url.searchParams.get('action')); return json(teamContext);
    }
    if (path === '/api/v1/browser/workers' && method === 'GET') {
      expect(url.searchParams.get('unitId')).toBe(ids.unit); expect(url.searchParams.get('companyId')).toBe(ids.company); expect(url.searchParams.get('status')).toBe('ACTIVE');
      return json({ items: teamPeople, page: 1, pageSize: 20, total: 2 });
    }
    const person = teamPeople.find(person => path === `/api/v1/browser/workers/${person.id}`); if (person) return json(person);
    if (path === '/api/v1/teams' && method === 'GET') {
      expect(url.searchParams.get('locationId')).toBe(ids.unit);
      return json((paginated && url.searchParams.get('pageNumber') === '1' ? firstPage : [state.current]).map(team => teamSummary(team)));
    }
    if (path.startsWith('/api/v1/teams/') && method === 'GET') {
      const team = [state.current, ...firstPage].find(team => path === `/api/v1/teams/${team.id}`); if (team) return json(team);
    }
    if ((path === '/api/v1/teams' && method === 'POST') || (path === `/api/v1/teams/${ids.team}` && method === 'PATCH')) {
      expect(request.headers().authorization).toBe('Bearer teams-fixture-token'); expect(request.headers()['idempotency-key']).toBeUndefined();
      const body = request.postDataJSON(); state.writes.push({ method, body });
      if (state.conflict) return json({ code: 'CONFLICT', message: 'Revisão alterada', requestId: 'test' }, 409);
      state.current = { ...state.current, ...body, version: method === 'PATCH' ? state.current.version + 1 : 1 }; return json(state.current, method === 'POST' ? 201 : 200);
    }
    state.unexpected.push(`${method} ${path}`); return json({ code: 'NOT_FOUND', requestId: 'test' }, 404);
  });
  await page.goto('/login'); await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('teams@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia para teste');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click(); await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);
  await page.goto(`/app/equipes?unitId=${ids.unit}`); await expect(page.getByRole('table')).toBeVisible(); return state;
}

test('cadastro compacto em 320px seleciona pessoas e confirma os dados salvos', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page);
  await page.getByRole('link', { name: 'Nova equipe', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Cadastrar equipe', exact: true });
  await dialog.getByLabel('Nome da equipe', { exact: true }).fill('Equipe de inspeções');
  await dialog.getByRole('button', { name: 'Definir Alice Trabalhadora como chefe', exact: true }).click(); await dialog.getByRole('button', { name: 'Adicionar Bruno Trabalhador à equipe', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cadastro-equipe-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Cadastrar', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(page.getByRole('table')).toContainText('Equipe de inspeções');
  expect(state.writes).toEqual([{ method: 'POST', body: { name: 'Equipe de inspeções', description: null, chiefId: ids.worker, participantIds: [ids.secondWorker], organizationId: ids.organization, companyId: ids.company, localId: ids.unit } }]);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('edição com revisão retorna à segunda página e atualiza a tabela', async ({ page }, testInfo) => {
  const state = await setup(page, true, true); await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await page.getByRole('link', { name: 'Editar equipe Equipe de manutenção', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Editar equipe', exact: true });
  await dialog.getByLabel('Nome da equipe', { exact: true }).fill('Equipe revisada'); await dialog.getByLabel('Descrição', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Definir Bruno Trabalhador como chefe', exact: true }).click(); await dialog.getByRole('button', { name: 'Adicionar Alice Trabalhadora à equipe', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('edicao-equipe-desktop.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('table')).toContainText('Equipe revisada'); await expect(page.getByRole('navigation', { name: 'Paginação de equipes' })).toContainText('página 2');
  expect(state.writes).toEqual([{ method: 'PATCH', body: { name: 'Equipe revisada', description: null, clearDescription: true, chiefId: ids.secondWorker, participantIds: [ids.worker], expectedVersion: 1 } }]);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('409 preserva a edição e bloqueia repetição com uma revisão obsoleta', async ({ page }) => {
  const state = await setup(page); await page.getByRole('link', { name: 'Editar equipe Equipe de manutenção', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Editar equipe', exact: true });
  await dialog.getByLabel('Nome da equipe', { exact: true }).fill('Edição mantida'); state.conflict = true; await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('dados foram mantidos'); await expect(dialog.getByLabel('Nome da equipe', { exact: true })).toHaveValue('Edição mantida');
  await expect(dialog.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled(); expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('ADMIN somente leitura não recebe comandos de criação ou edição', async ({ page }) => {
  const state = await setup(page, false); await expect(page.getByRole('link', { name: 'Nova equipe', exact: true })).toHaveCount(0); await expect(page.getByRole('link', { name: /Editar equipe/ })).toHaveCount(0);
  await page.goto('/app/equipes/novo'); await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.writes).toEqual([]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
