// Explicit user-administration grants keep the setup page stable; module grants remain independent.
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { documentIds as ids, documentDirectory, documentScope, documentFilePolicy, nativeDocumentFixture, nativeVersionFixture, nativeTypeFixture, pdfContent, pdfHash } from './fixtures/native-documents';

// Controlled HTTP contracts, independent of live .NET/PostgreSQL homologation.
async function setup(page: Page, options: { pending?: boolean; readOnly?: boolean } = {}) {
  const state = { item: nativeDocumentFixture(), versions: [] as ReturnType<typeof nativeVersionFixture>[], conflict: false,
    writes: [] as { path: string; body: unknown }[], unexpected: [] as string[], errors: [] as string[] };
  if (options.pending) { state.item = { ...state.item, revision: 2, currentVersionNumber: 1, status: 'EM_REVISAO' }; state.versions = [nativeVersionFixture()]; }
  let signedIn = false;
  await page.emulateMedia({ reducedMotion: 'reduce' }); page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const session = { accessToken: 'native-document-fixture', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
    if (path === '/api/v1/auth/csrf') return json({ csrfToken: 'document-csrf' });
    if (path === '/api/v1/auth/login') { signedIn = true; return json(session); }
    if (path === '/api/v1/auth/refresh') return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', requestId: 'fixture' }, 401);
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Pessoa Fictícia', email: 'documentos@example.invalid' }, roles: ['ADMIN'],
      permissions: ['usuario:ler', 'usuario:editar', 'empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler', 'documento:ler', ...(options.readOnly ? [] : ['documento:criar', 'documento:editar', 'documento:aprovar'])], scope: documentScope, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/users') return json([]);
    if (path === '/api/v1/browser/organization') return json({ ...documentDirectory, establishments: [], jobs: [], jobFunctions: [], workCenters: [] });
    if (path === '/api/v1/document-types' && method === 'GET') return json([nativeTypeFixture()]);
    if (path === `/api/v1/document-types/${ids.type}` && method === 'GET') return json(nativeTypeFixture());
    if (path === '/api/v1/documents/file-policy') return json(documentFilePolicy);
    if (path === '/api/v1/documents' && method === 'POST') {
      const body = request.postDataJSON(); state.writes.push({ path, body }); state.item = { ...state.item, ...body }; return json(state.item, 201);
    }
    const base = `/api/v1/documents/${ids.document}`;
    if (path === base && method === 'GET') return json(state.item);
    if (path === base && method === 'PATCH') {
      const body = request.postDataJSON(); state.writes.push({ path, body });
      expect(request.headers()['idempotency-key']).toBeUndefined();
      if (state.conflict || body.expectedVersion !== state.item.revision) return json({ code: 'CONFLICT', requestId: 'fixture' }, 409);
      state.item = { ...state.item, ...body, revision: state.item.revision + 1 }; return json(state.item);
    }
    if (path === `${base}/versions` && method === 'GET') return json(state.versions);
    if (path === `${base}/versions` && method === 'POST') {
      const body = request.postData()!; state.writes.push({ path, body });
      expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=');
      expect(request.headers()['idempotency-key']).toBeUndefined(); expect(body).not.toContain('name="authorId"');
      expect(body).toContain('name="expectedVersion"\r\n\r\n1'); expect(body).toContain(pdfContent);
      if (state.conflict) return json({ code: 'DOMAIN_VIOLATION', requestId: 'fixture' }, 409);
      state.versions = [nativeVersionFixture()]; state.item = { ...state.item, revision: 2, currentVersionNumber: 1, status: 'EM_REVISAO' }; return json(state.versions[0], 201);
    }
    if (path === `${base}/versions/${ids.version}/review` && method === 'POST') {
      const body = request.postDataJSON(); state.writes.push({ path, body });
      expect(body).toEqual({ expectedVersion: 2, version: 1, decision: 'aceita', reason: null });
      state.versions = [{ ...state.versions[0], state: 'VIGENTE', isCurrent: true, approverId: ids.user, approvedAt: '2026-11-01T12:30:00Z', reviewedAt: '2026-11-01T12:30:00Z' }];
      state.item = { ...state.item, revision: 3, status: 'VIGENTE' }; return json(state.versions[0]);
    }
    if (path === `${base}/versions/${ids.version}/download` && method === 'GET') {
      expect(request.headers().authorization).toBe('Bearer native-document-fixture');
      return route.fulfill({ contentType: 'application/pdf', body: pdfContent, headers: { 'Cache-Control': 'no-store' } });
    }
    state.unexpected.push(`${method} ${path}`); return json({ code: 'NOT_FOUND', requestId: 'fixture' }, 404);
  });
  await page.goto('/login'); await expect(page.locator('[data-auth-scene]')).toHaveAttribute('data-arrival', 'ready');
  await page.getByLabel('E-mail', { exact: true }).fill('documentos@example.invalid'); await page.getByLabel('Senha', { exact: true }).fill('Senha fictícia documental');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click(); await expect(page).toHaveURL(/\/app\/configuracoes\/usuarios$/);
  return state;
}

test('cadastra, envia para conferência, aceita e baixa o arquivo nativo autenticado', async ({ page }, testInfo) => {
  const state = await setup(page); await page.goto('/app/documentos/novo');
  const create = page.getByRole('dialog', { name: 'Cadastrar documento', exact: true });
  await expect(create.getByLabel('Unidade', { exact: true })).toHaveValue(ids.unit);
  await create.getByLabel('Tipo documental', { exact: true }).selectOption(ids.type);
  await create.getByLabel('Código', { exact: true }).fill('NR-TESTE'); await create.getByLabel('Título', { exact: true }).fill('Certificado de treinamento');
  await create.getByLabel('Emissão', { exact: true }).fill('2026-10-01'); await create.getByLabel('Válido até', { exact: true }).fill('2027-10-01');
  await create.getByRole('button', { name: 'Cadastrar documento', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/documentos/${ids.document}$`));
  expect(state.writes[0].body).toMatchObject({ ownerId: ids.user, companyId: ids.company, personId: null, links: [], metadata: '{}' });
  await page.getByRole('button', { name: 'Anexar versão', exact: true }).click(); const upload = page.getByRole('dialog', { name: 'Anexar versão', exact: true });
  await upload.getByLabel('Arquivo', { exact: true }).setInputFiles({ name: 'certificado.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfContent) });
  await upload.getByRole('button', { name: 'Enviar para conferência', exact: true }).click(); await expect(page.getByText('Arquivo recebido para conferência.', { exact: true })).toBeVisible();
  expect(state.item.status).toBe('EM_REVISAO'); expect(state.versions[0].isCurrent).toBe(false);
  await page.getByRole('button', { name: 'Aceitar', exact: true }).click(); const review = page.getByRole('dialog', { name: 'Aceitar evidência', exact: true });
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: 'Confirmar aceite', exact: true }).click();
  await expect(page.getByText('Evidência aceita pela API.', { exact: true })).toBeVisible(); await expect(page.getByText('Arquivo vigente', { exact: true })).toBeVisible();
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click(); const download = await waiting;
  expect(download.suggestedFilename()).toBe('NR-TESTE-v1.pdf'); const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk)); expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(pdfHash);
  await page.screenshot({ path: testInfo.outputPath('documento-nativo-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('documento-nativo-mobile.png'), fullPage: true });
  expect(state.writes).toHaveLength(3); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});

test('conflito no envio conserva arquivo e observação sem repetir o POST', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page); await page.goto(`/app/documentos/${ids.document}`);
  await page.getByRole('button', { name: 'Anexar versão', exact: true }).click(); const upload = page.getByRole('dialog', { name: 'Anexar versão', exact: true });
  await upload.getByLabel('Arquivo', { exact: true }).setInputFiles({ name: 'certificado.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfContent) });
  await upload.getByLabel('Observação da versão', { exact: true }).fill('Observação preservada'); state.conflict = true;
  await upload.getByRole('button', { name: 'Enviar para conferência', exact: true }).click(); await expect(upload.getByRole('alert')).toContainText('Seus dados foram mantidos');
  await expect(upload.getByLabel('Observação da versão', { exact: true })).toHaveValue('Observação preservada');
  expect(await upload.getByLabel('Arquivo', { exact: true }).evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe('certificado.pdf');
  await expect(upload.getByRole('button', { name: 'Enviar para conferência', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath('envio-nativo-conflito-mobile.png'), fullPage: true });
  expect(state.writes).toHaveLength(1); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});

test('leitura autorizada não concede comandos por nome do perfil ADMIN', async ({ page }) => {
  const state = await setup(page, { pending: true, readOnly: true }); await page.goto(`/app/documentos/${ids.document}`);
  await expect(page.getByRole('heading', { name: 'Certificado de treinamento', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Baixar arquivo', exact: true })).toBeEnabled();
  for (const name of ['Anexar versão', 'Aceitar', 'Reprovar', 'Vincular a uma PT', 'Editar dados']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});

test('edita pela URL nativa em 320px e mantém versão, contexto e classificação', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page); await page.goto(`/app/documentos/${ids.document}/editar`);
  const dialog = page.getByRole('dialog', { name: 'Editar dados do documento', exact: true });
  await dialog.getByLabel('Título', { exact: true }).fill('Certificado atualizado'); await dialog.getByLabel('Válido até', { exact: true }).fill('2027-12-01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath('editar-dados-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/app/documentos/${ids.document}$`)); await expect(page.getByRole('heading', { name: 'Certificado atualizado', exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: `/api/v1/documents/${ids.document}`, body: {
    expectedVersion: 1, title: 'Certificado atualizado', description: null, issueDate: '2026-10-01', validFromDate: null, validUntilDate: '2027-12-01', secrecyLevel: 'Interno', keywords: [], metadata: '{}',
  } }]);
  expect(state.item.status).toBe('RASCUNHO'); expect(state.item.currentVersionNumber).toBe(0); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});

test('conflito de edição nativa preserva título e não repete PATCH', async ({ page }) => {
  const state = await setup(page); await page.goto(`/app/documentos/${ids.document}`); await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar dados do documento', exact: true }); await dialog.getByLabel('Título', { exact: true }).fill('Rascunho mantido'); state.conflict = true;
  await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Seus dados foram mantidos');
  await expect(dialog.getByLabel('Título', { exact: true })).toHaveValue('Rascunho mantido'); await expect(dialog.getByRole('button', { name: 'Salvar alterações', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1); expect(state.item.revision).toBe(1); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
