import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp, simplePdf } from './helpers';

const unitId = '00000000-0000-4000-8000-000000000002';
const origin = `/app/notificacoes?unitId=${unitId}&read=false`;

for (const width of [320, 390, 1440]) {
  test(`notificações em ${width}px voltam do documento e registram somente a leitura explícita`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'PATCH' && /\/notifications\/[^/]+\/read$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
    await loginDemo(page, 'Gestor SESMT');
    await navigateWithinApp(page, origin);
    const list = page.getByRole('region', { name: 'Lista de notificações', exact: true });
    const header = page.getByRole('link', { name: 'Abrir notificações', exact: true });
    await expect(list.getByRole('article')).toHaveCount(3);
    await expect(header).toHaveAccessibleDescription('3 notificações não lidas.');
    const first = list.getByRole('article').first();
    const noticeTitle = await first.getByRole('heading').innerText();
    const documentPath = (await first.getByRole('link', { name: 'Abrir registro →', exact: true }).getAttribute('href'))!;
    await first.getByRole('link', { name: 'Abrir registro →', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Metadados do documento', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar às notificações', exact: true }).click();
    await expect(page).toHaveURL(origin);
    await expect(list.getByRole('article')).toHaveCount(3);
    expect(writes).toEqual([]);
    await first.getByRole('button', { name: `Marcar como lida: ${noticeTitle}`, exact: true }).click();
    await expect(page.getByText(/Leitura registrada:.*A pendência do registro continua sendo acompanhada/)).toBeVisible();
    await expect(list.getByRole('article')).toHaveCount(2);
    await expect(page.getByLabel('Leitura', { exact: true })).toBeFocused();
    await expect(header).toHaveAccessibleDescription('2 notificações não lidas.');
    expect(writes).toHaveLength(1);
    await page.getByLabel('Leitura', { exact: true }).selectOption('true');
    await expect(list.getByRole('article')).toHaveCount(1);
    await expect(list.getByRole('heading', { name: noticeTitle, exact: true })).toBeVisible();
    await expect(list.getByRole('button', { name: /^Marcar como lida:/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Remover filtro: Leitura', exact: true }).click();
    await expect(page).toHaveURL(`/app/notificacoes?unitId=${unitId}`);
    await expect(list.getByRole('article')).toHaveCount(3);
    await expect(page.getByLabel('Leitura', { exact: true })).toBeFocused();
    const documentState = await page.evaluate(async path => {
      const moduleUrl = '/src/shared/api/client.ts'; const { api } = await import(moduleUrl);
      const record = await api.get(path.replace('/app/documentos/', '/documents/'));
      return { status: record.status, revision: record.revision };
    }, documentPath);
    expect(documentState).toEqual({ status: 'ACTIVE', revision: 1 });
    expect(writes).toHaveLength(1); expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`notificacoes-${width}.png`), fullPage: true });
  });
}

test('nova versão aberta pela notificação preserva o retorno ao cancelar e salvar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await loginDemo(page, 'Gestor SESMT');
  await navigateWithinApp(page, origin);
  const list = page.getByRole('region', { name: 'Lista de notificações', exact: true });
  await list.getByRole('article').first().getByRole('link', { name: 'Abrir registro →', exact: true }).click();
  await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
  await expect(page.getByLabel('Título *', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar ao documento', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Voltar às notificações', exact: true })).toHaveAttribute('href', origin);
  await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
  await page.getByLabel('Arquivo da versão *', { exact: true }).setInputFiles(simplePdf('Versao sintetica para verificar retorno a notificacoes'));
  await page.getByLabel('Justificativa da versão *', { exact: true }).fill('Revisão documental para verificar o caminho de retorno.');
  await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Metadados do documento', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar às notificações', exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(list.getByRole('article')).toHaveCount(3);
  await expect(page.getByLabel('Leitura', { exact: true })).toHaveValue('false');
});
