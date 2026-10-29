import { expect, test, type Page } from '@playwright/test';

// Browser integration contract tests. Database/JWT enforcement is covered by the backend HTTP suite.
const companyId = '10000000-0000-4000-8000-000000000001';
const unitId = '10000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000003';
const workerId = '10000000-0000-4000-8000-000000000004';
const docId = '10000000-0000-4000-8000-000000000005';
const typeId = '10000000-0000-4000-8000-000000000006';
const versionId = '10000000-0000-4000-8000-000000000007';
const nativeType = { id: typeId, code: 'PROC', name: 'Procedimento', category: 'SST', defaultAccessClass: 'INTERNAL', sourceReadOnly: true, revision: null, requiredFields: null, allowedAccessClasses: null, allowedMimeTypes: null, maxFileSizeBytes: null, renewalPolicy: null, retentionPolicyReference: null, workflow: null, requiresApproval: true, requiresSignature: false, periodicityInDays: 365, retentionPeriodInYears: 5, schemaVersion: 3 };
const nativeWorker = { id: workerId, fullName: 'Pessoa cadastrada na API', registration: '001', companyId, unitId, sectorId: null, jobId: null, employmentType: null, admissionDate: '2020-01-01', status: 'ACTIVE', revision: null, sourceReadOnly: true };
const nativeDocument = { id: docId, code: 'DOC-001', title: 'Relatório de inspeção', companyId, unitId: null, sectorId: null, typeId, ownerId: userId, accessClass: 'INTERNAL', issueDate: '2026-10-01', validFrom: null, validUntil: '2099-01-01', status: 'DRAFT', currentVersionId: versionId, activeVersionId: null, activeVersionIds: [], workerIds: [workerId], responsibleIds: [], keywords: [], availableActions: [], revision: null, sourceReadOnly: true };

async function connect(page: Page, permissions: string[]) {
  let signedIn = false;
  const unexpected: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const session = { accessToken: 'browser-contract-test', tokenType: 'Bearer', accessExpiresAt: '2099-01-01T00:00:00Z' };
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const paged = (items: unknown[]) => json({ items, page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('pageSize') || 20), total: items.length });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test-csrf' });
    if (path.endsWith('/auth/login')) { signedIn = true; return json(session); }
    if (path.endsWith('/auth/refresh')) return signedIn ? json(session) : json({ code: 'SESSION_EXPIRED', message: 'Entre novamente.', requestId: 'test' }, 401);
    if (path === '/api/v1/me' && signedIn) return json({ user: { id: userId, displayName: 'Conta com acesso', email: 'operator@example.invalid' }, roles: ['GESTOR'], permissions, scope: { companyIds: [companyId], unitIds: [unitId], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/organization' && permissions.includes('organization.read')) return json({ companies: [{ id: companyId, name: 'Empresa cadastrada', status: 'ACTIVE', revision: null, sourceReadOnly: true }], units: [{ id: unitId, companyId, name: 'Unidade cadastrada', status: 'ACTIVE', revision: null, sourceReadOnly: true }], sectors: [], jobs: [], establishments: [], jobFunctions: [], workCenters: [] });
    if (path === '/api/v1/workers' && permissions.includes('workers.read')) return paged([nativeWorker]);
    if (path === `/api/v1/workers/${workerId}` && permissions.includes('workers.read')) return json(nativeWorker);
    if (path === `/api/v1/workers/${workerId}/movements` && permissions.includes('workers.read')) return paged([{ id: versionId, workerId, type: 'ASSIGNMENT', effectiveDate: '2020-01-01', previousAssignment: null, newAssignment: { unitId, sectorId: null, jobId: null }, reason: null, createdAt: '2020-01-01T12:00:00Z', createdBy: null }]);
    if (path === '/api/v1/documents' && permissions.includes('documents.read')) return paged(url.searchParams.has('status') ? [] : [nativeDocument]);
    if (path === `/api/v1/documents/${docId}` && permissions.includes('documents.read')) return json(nativeDocument);
    const version = { id: versionId, documentId: docId, versionNumber: 1, reason: null, status: 'REJECTED', metadataSnapshot: null, file: null, createdAt: '2026-10-01T12:00:00Z', createdBy: userId, approval: null, signatureEvidences: [], availableActions: [], revision: null, sourceReadOnly: true };
    if (path === `/api/v1/documents/${docId}/versions` && permissions.includes('documents.read')) return paged([version]);
    if (path === `/api/v1/documents/${docId}/versions/${versionId}` && permissions.includes('documents.read')) return json(version);
    if (path === `/api/v1/documents/${docId}/history` && permissions.includes('documents.read')) return paged([{ id: '1', documentId: docId, versionId: null, action: 'CREATED', actor: { id: null, displayName: null }, occurredAt: '2026-10-01T12:00:00Z' }]);
    if (path === '/api/v1/document-types' && permissions.includes('documents.read')) return paged([nativeType]);
    if (path === `/api/v1/document-types/${typeId}` && permissions.includes('documents.read')) return json(nativeType);
    unexpected.push(path);
    return json({ code: 'INTEGRATION_PENDING', message: 'Rota não conectada.', requestId: 'test' }, 501);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByTestId('login-preloader')).toHaveCount(0);
  await expect(page.locator('[data-auth-scene]')).not.toHaveAttribute('inert');
  await page.getByLabel('E-mail', { exact: true }).fill('operator@example.invalid');
  await page.getByLabel('Senha', { exact: true }).fill('Senha de teste 2026');
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('operator@example.invalid');
  await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('Senha de teste 2026');
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click();
  return { unexpected, errors };
}

test('login com permissões reais abre documentos, versões e cadastros sem tela intermediária', async ({ page }) => {
  const report = await connect(page, ['documents.read', 'workers.read', 'organization.read']);
  await expect(page).toHaveURL(/\/app\/documentos\?/);
  await page.getByRole('link', { name: 'Relatório de inspeção', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Relatório de inspeção', exact: true })).toBeVisible();
  await expect(page.getByText('Metadados históricos não registrados nesta versão.')).toBeVisible();
  await expect(page.getByText('Arquivo indisponível para consulta.')).toBeVisible();
  await expect(page.getByText('Autor não identificado', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Editar metadados', exact: true })).toHaveCount(0);
  await page.goto(`/app/trabalhadores/${workerId}`);
  await expect(page.getByRole('heading', { name: nativeWorker.fullName, exact: true })).toBeVisible();
  await expect(page.getByText('Vínculo registrado', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Integração administrativa do trabalhador', exact: true })).toHaveCount(0);
  await page.goto('/app/configuracoes/parametros');
  await expect(page.getByText('365 dias', { exact: true })).toBeVisible();
  await expect(page.getByText('5 anos', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('365 dias', { exact: true })).toBeVisible();
  expect(report.unexpected).toEqual([]); expect(report.errors).toEqual([]);
});

test('conta com leitura apenas de trabalhadores entra no cadastro sem integração presumida', async ({ page }) => {
  const report = await connect(page, ['workers.read']);
  await expect(page).toHaveURL(/\/app\/trabalhadores\?/);
  await expect(page.getByRole('link', { name: nativeWorker.fullName, exact: true })).toBeVisible();
  await expect(page.getByLabel('Integração administrativa', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Pendente', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Não informada', { exact: true })).toBeVisible();
  expect(report.unexpected).toEqual([]); expect(report.errors).toEqual([]);
});

test('conta com leitura da organização entra nas unidades sem ações de escrita', async ({ page }) => {
  const report = await connect(page, ['organization.read']);
  await expect(page).toHaveURL(/\/app\/organizacao/);
  await expect(page.getByRole('cell', { name: 'Unidade cadastrada Sem código', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cadastrar unidade/i })).toHaveCount(0);
  expect(report.unexpected).toEqual([]); expect(report.errors).toEqual([]);
});
