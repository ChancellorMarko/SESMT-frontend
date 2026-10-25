import { expect, test, type Page } from '@playwright/test';
import { openModule, loginDemo, navigateWithinApp } from './helpers';

const unitId = '00000000-0000-4000-8000-000000000002';

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('consulta documentos por critérios combinados e retorna ao mesmo resultado', async ({ page }) => {
  await loginDemo(page, 'Auditor');
  await navigateWithinApp(page, `/app/consulta?tab=documents&unitId=${unitId}`);
  await page.getByRole('searchbox', { name: 'Buscar título ou código' }).fill('PROC-2026-002');
  await page.getByLabel('Tipo documental', { exact: true }).selectOption({ label: 'Procedimento operacional' });
  await page.getByLabel('Situação', { exact: true }).selectOption('ACTIVE');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await expect(page).toHaveURL(/tab=documents.*q=PROC-2026-002/);
  const result = page.getByRole('table', { name: 'Resultados da consulta documental' });
  await expect(result.locator('tbody tr')).toHaveCount(1);
  await expect(result).toContainText('Orientação de segurança · Produção');
  await result.getByRole('link', { name: /^Abrir Orientação/ }).click();
  await expect(page).toHaveURL(/\/app\/documentos\//);
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar título ou código' })).toHaveValue('PROC-2026-002');
  await expect(page.getByLabel('Situação', { exact: true })).toHaveValue('ACTIVE');
  await expect(page.getByLabel('Tipo documental', { exact: true })).toHaveValue('00000000-0000-4000-8000-000000000061');
  await expect(result.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar título ou código' })).toHaveValue('');
  await expect(result.locator('tbody tr')).toHaveCount(7);
});

test('pagina resultados reais da demonstração e oferece retorno de página fora do total', async ({ page }) => {
  await loginDemo(page);
  // Create fixtures through the same API used by the frontend, without intercepting responses.
  await page.evaluate(async () => {
    const clientUrl = '/src/shared/api/client.ts';
    const { api } = await import(clientUrl);
    const unitId = '00000000-0000-4000-8000-000000000002';
    const documents = await api.get('/documents', { query: { unitId, pageSize: 100 } });
    const reference = documents.items.find((document: { typeId: string }) => document.typeId.endsWith('000061'));
    for (let index = 1; index <= 12; index++) {
      await api.post('/documents', { ...reference, code: `CONSULTA-E2E-${String(index).padStart(2, '0')}`, title: `Consulta paginada ${index}`, status: undefined, id: undefined });
    }
  });
  await navigateWithinApp(page, `/app/consulta?tab=documents&q=CONSULTA-E2E&unitId=${unitId}`);
  const table = page.getByRole('table', { name: 'Resultados da consulta documental' });
  await expect(table.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByText('12 documento(s) encontrado(s) · Página 1 de 2')).toBeVisible();
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
  await table.getByRole('link', { name: /^Abrir Consulta paginada/ }).first().click();
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await navigateWithinApp(page, `/app/consulta?tab=documents&q=CONSULTA-E2E&page=99&unitId=${unitId}`);
  await expect(page.getByRole('heading', { name: 'Nenhum documento encontrado' })).toBeVisible();
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(table.locator('tbody tr')).toHaveCount(2);
});

test('consulta PT por equipe e situação e preserva filtros ao voltar do detalhe', async ({ page }) => {
  await loginDemo(page, 'Técnico de segurança');
  await navigateWithinApp(page, `/app/consulta?tab=permits&unitId=${unitId}`);
  await page.getByRole('searchbox', { name: 'Buscar PT' }).fill('PT-DEMO-230');
  await page.getByLabel('Situação operacional', { exact: true }).selectOption('COMPLETED');
  await page.getByLabel('Revisão do encerramento', { exact: true }).selectOption('PENDING_REVIEW');
  await page.getByLabel('Equipe operacional', { exact: true }).selectOption('00000000-0000-4000-8000-000000000200');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  const table = page.getByRole('table', { name: 'Resultados da consulta de PTs' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await table.getByRole('link', { name: 'Abrir PT-DEMO-230', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Voltar à consulta', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar à consulta', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar PT' })).toHaveValue('PT-DEMO-230');
  await expect(page.getByLabel('Revisão do encerramento', { exact: true })).toHaveValue('PENDING_REVIEW');
  await expect(page.getByLabel('Situação operacional', { exact: true })).toHaveValue('COMPLETED');
  await expect(page.getByLabel('Equipe operacional', { exact: true })).toHaveValue('00000000-0000-4000-8000-000000000200');
  expect(new URL(page.url()).searchParams.getAll('tab')).toEqual(['permits']);
});

test('consulta explica critérios inválidos recebidos por link e recupera ao limpar os filtros', async ({ page }) => {
  await loginDemo(page, 'Auditor');
  for (const [tab, filter] of [['documents', 'status=INVALID'], ['documents', 'validUntilFrom=2026-02-30'], ['permits', 'reviewStatus=INVALID']]) {
    const queries: string[] = [];
    const collect = (request: import('@playwright/test').Request) => {
      if (/\/api\/v1\/(documents|work-permits)\?/.test(request.url())) queries.push(request.url());
    };
    page.on('request', collect);
    await navigateWithinApp(page, `/app/consulta?tab=${tab}&${filter}&unitId=${unitId}`);
    await expect(page.getByRole('alert').filter({ hasText: 'Filtros da consulta inválidos.' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    expect(queries).toEqual([]);
    page.off('request', collect);
    await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Filtros da consulta inválidos.' })).toHaveCount(0);
    await expect(page).toHaveURL(`/app/consulta?tab=${tab}&unitId=${unitId}`);
  }
});

test('trabalhador não acessa PT pela aba forjada e só consulta o documento individual autorizado', async ({ page }) => {
  await loginDemo(page, 'Trabalhador');
  // Request the forbidden tab, then verify the route canonicalized by the access rules.
  await page.evaluate(target => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/app/consulta?tab=permits&unitId=${unitId}`);
  await expect(page).toHaveURL(`/app/consulta?tab=documents&unitId=${unitId}`);
  await expect(page.getByRole('tab', { name: /Permissões de trabalho/ })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Buscar PT' })).toHaveCount(0);
  const table = page.getByRole('table', { name: 'Resultados da consulta documental' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(table).toContainText('Comprovante de orientação individual');
  await expect(table).not.toContainText('Inventário de riscos');
  await navigateWithinApp(page, '/app/pts/00000000-0000-4000-8000-000000000230');
  await expect(page.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true })).toBeVisible();
});

for (const width of [320, 390]) {
  test(`consulta e convite ativo funcionam sem transbordamento a ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 });
    await loginDemo(page, 'Auditor');
    await navigateWithinApp(page, `/app/consulta?tab=documents&unitId=${unitId}`);
    await expect(page.getByRole('heading', { name: 'Central de consulta unificada' })).toBeVisible();
    const docs = page.getByRole('tab', { name: 'Documentos controlados', exact: true });
    const permits = page.getByRole('tab', { name: /Permissões de trabalho/ });
    await docs.focus(); await page.keyboard.press('ArrowRight');
    await expect(permits).toBeFocused(); await expect(permits).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('table', { name: 'Resultados da consulta de PTs' })).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: `test-results/consulta-${width}.png`, fullPage: true });
    await page.goto('/convite/tok-equipe-civil-2026');
    await expect(page.getByRole('heading', { name: 'Equipe de manutenção · demonstração', exact: true })).toBeVisible();
    await expect(page.getByText('Convite válido', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Participantes vinculados (3)', exact: true })).toBeVisible();
    await expect(page.getByText('Organização Exemplo', { exact: true })).toBeVisible();
    await expectNoOverflow(page); expect(errors).toEqual([]);
  });
}

test('convites expirado, revogado e inválido explicam estado sem exibir a equipe', async ({ page }) => {
  for (const [token, status] of [['tok-equipe-expirada', 'Expirado'], ['tok-equipe-revogada', 'Revogado']]) {
    await page.goto(`/convite/${token}`);
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Participantes vinculados/ })).toHaveCount(0);
    await expect(page.getByText('Camila Demo', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Instruções operacionais de segurança' })).toHaveCount(0);
    const result = await page.evaluate(async path => {
      const response = await fetch(`/api/v1/team-invites/public/${path}`);
      return response.json();
    }, token);
    expect(result.members).toEqual([]); expect(result.chiefName).toBe('');
    await expectNoOverflow(page);
  }
  await page.goto('/convite/inexistente');
  await expect(page.getByRole('heading', { name: 'Convite inválido ou não encontrado', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Acessar plataforma Ampara', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('gestor gera um convite pela interface, consulta e revoga o mesmo link', async ({ page }) => {
  await loginDemo(page);
  await openModule(page, 'Equipes');
  const button = page.getByRole('button', { name: 'Convites por link da equipe Equipe de manutenção · demonstração', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Convites da equipe: Equipe de manutenção · demonstração', exact: true });
  await dialog.getByLabel('Validade do link', { exact: true }).selectOption('24');
  await dialog.getByRole('button', { name: 'Gerar link de convite', exact: true }).click();
  await expect(dialog.getByText('Novo link de convite gerado com sucesso!', { exact: true })).toBeVisible();
  const input = dialog.getByRole('textbox', { name: /^Link de convite inv-/ });
  const shareUrl = await input.inputValue();
  await input.locator('..').getByRole('link', { name: 'Abrir convite nesta demonstração', exact: true }).click();
  await expect(page).toHaveURL(shareUrl);
  await expect(page.getByText('Convite válido', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Participantes vinculados (3)', exact: true })).toBeVisible();
  await page.goBack();
  await button.click();
  await input.locator('..').getByRole('button', { name: 'Revogar convite', exact: true }).click();
  await expect(dialog.getByText('Convite revogado com sucesso.', { exact: true })).toBeVisible();
  await input.locator('..').getByRole('link', { name: 'Abrir convite nesta demonstração', exact: true }).click();
  await expect(page.getByText('Revogado', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Participantes vinculados/ })).toHaveCount(0);
});
