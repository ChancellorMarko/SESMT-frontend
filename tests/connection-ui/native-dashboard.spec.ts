import { expect, test, type Page } from '@playwright/test';
import { dashboardCompany, dashboardOtherUnit, dashboardUnit, emptyNativeDashboard, nativeDashboardFixture } from './fixtures/native-dashboard';

// HTTP contract tests against Vite. The real .NET API/PostgreSQL is not replaced
// or declared homologated by these browser scenarios.
async function openDashboard(page: Page) {
  const state = { denied: false, invalid: false, otherUnit: false, empty: false, requests: [] as string[], unexpected: [] as string[], errors: [] as string[] };
  let signedIn = false;
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
    state.requests.push(`${method} ${path}${url.search}`);
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const session = { accessToken: 'dashboard-fixture-token', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'dashboard-fixture-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', message: 'Entre novamente.', requestId: 'test' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: '50000000-0000-4000-8000-000000000001', displayName: 'Operadora de campo', email: 'dashboard@example.invalid' }, roles: ['PERFIL_PERSONALIZADO'], permissions: ['pt:ler'], scope: { companyIds: [dashboardCompany], unitIds: [dashboardUnit, dashboardOtherUnit], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    const endpoint = path.startsWith('/api/v1/dashboard/') ? path.slice('/api/v1/dashboard/'.length) : '';
    if (['summary', 'appointments', 'document-pendencies', 'review-pendencies', 'activity-evolution'].includes(endpoint)) {
      if (state.denied) return json({ code: 'FORBIDDEN', message: 'Detalhe privado do servidor', requestId: 'test' }, 403);
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!from || !to) { state.unexpected.push('Período ausente'); return json({}, 400); }
      const data = state.empty ? emptyNativeDashboard(from, to) : nativeDashboardFixture(from, to);
      if (state.invalid) data.summary.emExecucao = -1;
      if (url.searchParams.get('localId') === dashboardOtherUnit || state.otherUnit) {
        for (const item of [...data.appointments, ...data.documents, ...data.reviews]) item.localId = dashboardOtherUnit;
        for (const item of data.appointments) item.title = 'Atividade da segunda unidade';
      }
      const responses = { summary: data.summary, appointments: data.appointments, 'document-pendencies': data.documents, 'review-pendencies': data.reviews, 'activity-evolution': data.evolution };
      return json(responses[endpoint as keyof typeof responses]);
    }
    state.unexpected.push(`${method} ${path}`);
    return json({ code: 'NOT_FOUND', message: 'Rota não prevista.', requestId: 'test' }, 404);
  });
  await page.goto('/login');
  await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('dashboard@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('Senha de teste do dashboard');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
  await expect(page.getByRole('region', { name: 'Atividades no período', exact: true })).toBeVisible();
  return state;
}

test('dashboard nativo apresenta indicadores, listas e histórico nos endpoints publicados', async ({ page }, testInfo) => {
  const state = await openDashboard(page);
  const activity = page.getByRole('region', { name: 'Atividades no período', exact: true });
  await expect(activity.getByRole('cell', { name: /Inspeção da caldeira/ })).toBeVisible();
  await expect(activity.getByRole('row')).toHaveCount(6);
  await activity.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(activity.getByText('Atividade 6', { exact: true })).toBeVisible();
  await expect(activity.getByText('Sem PT vinculada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revisões (1)', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Encerramento', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mais informações: Movimentações de PT', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Uma mesma PT pode gerar mais de uma movimentação');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mais informações: Movimentações de PT', exact: true })).toBeFocused();
  await page.getByText('Ver dados por mês', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tabela mensal de movimentações', exact: true }).getByRole('row')).toHaveCount(13);
  const reads = state.requests.filter(request => request.startsWith('GET /api/v1/dashboard/'));
  expect(reads).toHaveLength(5);
  expect(reads.every(request => request.includes('from=2025-11-01T00') && request.includes('to=2026-10-31T23') && !request.includes('unitId'))).toBe(true);
  expect(state.requests.some(request => /\/permit-dashboard|\/permit-options|\/operations\/dashboard|\/browser\/dashboard/.test(request))).toBe(false);
  await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  const navigation = page.getByRole('dialog', { name: 'Navegação', exact: true });
  await expect(navigation.getByRole('link', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Inspeções de segurança', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Permissões de trabalho', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByText('Ver dados por mês', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('dashboard-nativo-desktop.png'), fullPage: true });
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('filtros e troca da unidade usam localId sem deixar o resultado anterior visível', async ({ page }) => {
  const state = await openDashboard(page);
  await page.getByRole('combobox', { name: 'Abrangência', exact: true }).selectOption('unit');
  const before = state.requests.length;
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect.poll(() => state.requests.slice(before).filter(request => request.includes(`localId=${dashboardUnit}`)).length).toBe(5);
  await page.getByRole('combobox', { name: 'Unidade de trabalho', exact: true }).selectOption(dashboardOtherUnit);
  await expect(page.getByRole('region', { name: 'Atividades no período', exact: true }).getByRole('cell', { name: /Inspeção da caldeira/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Atividades no período', exact: true }).getByRole('cell', { name: /Atividade da segunda unidade/ })).toHaveCount(5);
  expect(state.requests.filter(request => request.includes(`localId=${dashboardOtherUnit}`))).toHaveLength(5);
  const count = state.requests.length;
  await page.getByLabel('De (UTC)', { exact: true }).fill('2020-01-01');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('até 36 meses');
  expect(state.requests).toHaveLength(count);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('recusas e respostas inválidas ocultam o painel e só uma resposta válida recupera os dados', async ({ page }) => {
  const state = await openDashboard(page);
  state.denied = true;
  await page.getByRole('button', { name: 'Atualizar painel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A API não autorizou');
  await expect(page.getByRole('region', { name: 'Atividades no período', exact: true })).toHaveCount(0);
  await expect(page.getByRole('definition')).toHaveCount(0);
  state.denied = false; state.invalid = true;
  await page.getByRole('button', { name: 'Atualizar painel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível conferir');
  await expect(page.getByRole('definition')).toHaveCount(0);
  state.invalid = false;
  await page.getByRole('button', { name: 'Atualizar painel', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Atividades no período', exact: true })).toBeVisible();
  state.empty = true;
  await page.getByRole('button', { name: 'Atualizar painel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhuma atividade encontrada', exact: true })).toBeVisible();
  await expect(page.getByText(/100%|Tudo em dia|Em conformidade/)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('dashboard e dados mensais ficam acessíveis em 320px, sem transbordar a página', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const state = await openDashboard(page);
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByText('Ver dados por mês', { exact: true }).click();
  const table = page.getByRole('region', { name: 'Tabela mensal de movimentações', exact: true });
  await expect(table.getByRole('columnheader', { name: 'Conclusões', exact: true })).toBeVisible();
  await table.focus(); await expect(table).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-nativo-mobile.png'), fullPage: true });
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
