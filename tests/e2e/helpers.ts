import { expect, type Page } from '@playwright/test';

export async function loginDemo(page: Page, role: 'Gestor SESMT' | 'Engenheiro' | 'Técnico de segurança' | 'Bombeiro' | 'RH' | 'Auditor' | 'Administrador' | 'Trabalhador' = 'Gestor SESMT') {
  await page.goto('/login?demonstracao=perfis');
  await page.getByRole('button', { name: role, exact: true }).click();
  if (role === 'Administrador') {
    await expect(page.getByRole('heading', { name: 'Verifique seu acesso' })).toBeVisible();
    await page.getByLabel('Código de verificação').fill('123456');
    await page.getByRole('button', { name: 'Verificar e entrar' }).click();
  }
  await expect(page).toHaveURL(/\/app\/(dashboard|documentos)/);
  // The home redirect updates the URL before the lazy workspace has committed.
  // Wait for that workspace before using shortcuts or capturing its DOM identity.
  await expect(page.locator('main#conteudo')).toBeVisible();
  await expect(page.locator('main#conteudo').getByRole('heading', { level: 1 })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Sair da plataforma' }).click();
  await expect(page).toHaveURL(/\/login$/);
  // Open the explicit selector for a subsequent profile switch without resetting in-memory records.
  await page.getByRole('button', { name: 'Ver demonstrações', exact: true }).click();
}

export async function openModule(page: Page, name: string) {
  const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
  if (!await menu.isVisible()) await page.getByRole('button', { name: 'Abrir navegação', exact: true }).click();
  await menu.getByRole('link', { name, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

export async function navigateWithinApp(page: Page, pathname: string, expectedPath = pathname) {
  // Keep the demo session and let the application router own history and blockers.
  const selectedUnit = await page.evaluate(async (target) => {
    const readUnit = () => document.querySelector<HTMLSelectElement>('select[aria-label="Unidade de trabalho"]')?.value;
    const previousUnit = readUnit();
    // Reuse the app's exact module URL; Vite may append an HMR timestamp.
    const routerUrl = performance.getEntriesByType('resource').find(entry => {
      const url = new URL(entry.name);
      return url.origin === window.location.origin && url.pathname === '/src/app/router.tsx';
    })?.name ?? '/src/app/router.tsx';
    const { getAppRouter } = await import(routerUrl);
    await getAppRouter().navigate(target, { flushSync: true });
    return readUnit() || previousUnit;
  }, pathname);
  const expected = new URL(expectedPath, page.url());
  expected.searchParams.sort();
  await expect(page).toHaveURL(actual => {
    const comparable = new URL(actual.href);
    // Lists may append the selected unit; requested filters and duplicate values stay exact.
    if (expected.pathname.startsWith('/app/') && !expected.searchParams.has('unitId') && selectedUnit
      && comparable.searchParams.getAll('unitId').length === 1 && comparable.searchParams.get('unitId') === selectedUnit) {
      comparable.searchParams.delete('unitId');
    }
    comparable.searchParams.sort();
    return comparable.href === expected.href;
  });
}

export function simplePdf(text = 'Documento sintetico para teste') {
  const safeText = text.replace(/[()\\]/g, '\\$&');
  const stream = `BT /F1 12 Tf 50 750 Td (${safeText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { name: 'documento-teste.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) };
}

export async function createDocument(page: Page, { type = 'Procedimento operacional', title = 'Procedimento de teste E2E', code = 'E2E-PROC-01' } = {}) {
  await openModule(page, 'Documentos');
  await page.getByRole('link', { name: 'Novo documento', exact: true }).click();
  await page.getByLabel('Código *', { exact: true }).fill(code);
  await page.getByLabel('Título *', { exact: true }).fill(title);
  await page.getByRole('combobox', { name: 'Tipo documental *', exact: true }).selectOption({ label: type });
  await page.getByRole('combobox', { name: 'Proprietário *', exact: true }).selectOption({ label: 'Marina Demo' });
  if (type === 'Programa de Gerenciamento de Riscos') await page.getByLabel('Fim da validade', { exact: true }).fill('2030-10-05');
  await page.getByRole('button', { name: 'Criar documento', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return new URL(page.url()).pathname;
}

export async function uploadVersion(page: Page, reason: string) {
  await page.getByRole('link', { name: 'Nova versão', exact: true }).click();
  await page.getByLabel(/Arquivo da versão/).setInputFiles(simplePdf(reason));
  await page.getByLabel(/Justificativa da versão/).fill(reason);
  await page.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Versão \d+$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar para revisão', exact: true })).toBeEnabled({ timeout: 15_000 });
}

export async function reviewAndApprove(page: Page) {
  await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Registrar revisão', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar revisão', exact: true }).click();
  await page.getByLabel('Justificativa *', { exact: true }).fill('Conteúdo conferido no cenário de desenvolvimento.');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Revisão: aceita.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar versão', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Aprovação registrada', { exact: false })).toBeVisible();
}

export async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByText('Publicar versão: operação confirmada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Metadados do documento' }).getByText('Vigente', { exact: true })).toBeVisible();
}
