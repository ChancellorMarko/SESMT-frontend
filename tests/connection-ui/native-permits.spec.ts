// Explicit user-administration grants keep the setup page stable; module grants remain independent.
import { expect, test, type Page } from '@playwright/test';
import { declarationFixture, historyFixture, permitFixture, permitIds as ids } from './fixtures/native-permits';
import { nativeOrganizationFixture, nativeResponsibleFixture, nativeServicesFixture } from './fixtures/native-operations';
import { checklistIds, templateFixture, laterTemplateFixture } from './fixtures/native-checklists';
import { scienceFixture, scienceParticipantFixture } from './fixtures/native-science';
import type { NativePermit } from '../../src/features/native-permits/contracts';

// HTTP contracts are controlled; this suite does not homologate .NET/PostgreSQL.
async function setup(page: Page, grants = ['pt:liberar', 'pt:iniciar', 'pt:editar'], options: { executing?: boolean; modelsDenied?: boolean; missingPinned?: boolean; noClosing?: boolean; completeContract?: boolean } = {}) {
  const state = { item: permitFixture(), ready: true, conflict: false, denied: false, wrongItem: false,
    modelsDenied: options.modelsDenied ?? false,
    requests: [] as string[], commands: [] as { path: string; body: Record<string, unknown> }[], unexpected: [] as string[], errors: [] as string[] };
  if (options.executing) state.item = { ...state.item, status: 'EM_EXECUCAO', startedAt: '2026-10-31T11:00:00Z' };
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
    if (path === '/api/v1/auth/me') return json({ user: { id: ids.user, displayName: 'Pessoa da operação', email: 'operacao@example.invalid' }, roles: ['ADMIN'], permissions: ['usuario:ler', 'usuario:editar', 'empresa:ler', 'unidade:ler', 'setor:ler', 'cargo:ler', 'pt:ler', ...grants], scope: { companyIds: [ids.company], unitIds: [ids.unit], sectorIds: [], teamIds: [], ownOnly: false }, accessExpiresAt: session.accessExpiresAt });
    if (path === '/api/v1/organization') return json({ ...nativeOrganizationFixture, establishments: [], sectors: [], jobs: [], jobFunctions: [], workCenters: [] });
    if (path === '/api/v1/users') return json([nativeResponsibleFixture]);
    if (path === '/api/v1/work-permits/services') return json(nativeServicesFixture);
    if (path === '/api/v1/work-permits/pt-templates' && method === 'GET') {
      if (state.modelsDenied) return json({ code: 'FORBIDDEN', message: 'Informação privada', requestId: 'test' }, 403);
      const model = options.noClosing ? { ...templateFixture(), closingQuestions: [] } : templateFixture();
      return json(options.missingPinned ? [laterTemplateFixture()] : [model, laterTemplateFixture()]);
    }
    if (path === `/api/v1/work-permits/pts/${ids.permit}` && method === 'GET') return json({ id: state.item.id, versao: state.item.version,
      statusOperacional: state.item.status.toLowerCase(), statusRevisao: state.item.reviewStatus.toLowerCase(),
      participanteIds: state.item.participants.map(p => p.userId), templateVersionIds: state.item.templateVersionIds,
      ...(options.completeContract ? { pinnedTemplates: [templateFixture()] } : {}) });
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
      if (path === `${base}/declarations`) return json(options.completeContract ? scienceFixture(state.item) : declarationFixture(state.item));
      if (path === `${base}/eligibility`) return json({ ready: state.ready, issues: state.ready ? [] : [{ code: 'CIENCIA_PENDENTE', participantUserId: ids.user, documentTypeId: null, serviceCode: null }] });
      if (path === `${base}/review`) return json({ permitId: state.item.id, version: state.item.version, reviewStatus: state.item.reviewStatus, submittedBy: ids.user, submittedAt: '2026-10-31T12:00:00Z',
        reviewedBy: null, reviewedAt: null, reviewNote: null, canReview: false, canResubmit: false, previousClosings: [] });
    }
    if (path.startsWith(base + '/') && (method === 'POST' || method === 'PATCH')) {
      const body = route.request().postDataJSON() as Record<string, unknown>; state.commands.push({ path, body });
      if (state.conflict || body.expectedVersion !== state.item.version) return json({ code: 'DOMAIN_VIOLATION', message: 'Informação privada', requestId: 'test' }, 409);
      const action = path.split('/').at(-1)!;
      if (action === 'acknowledge') {
        expect(options.completeContract).toBe(true); expect(body.contentHash).toBe(scienceFixture(state.item).contentHash);
        expect(route.request().headers()['idempotency-key']).toBeUndefined();
        const participant = scienceParticipantFixture(state.item, String(body.confirmedName));
        state.item = { ...state.item, version: state.item.version + 1, participants: [participant] }; return json(participant);
      }
      else if (action === 'release') state.item = { ...state.item, status: 'LIBERADA', releasedAt: '2026-10-31T12:00:00Z', authorizedFrom: String(body.authorizedFrom), authorizedUntil: String(body.authorizedUntil), releaseConditions: String(body.conditions) };
      else if (action === 'start') state.item = { ...state.item, status: 'EM_EXECUCAO', startedAt: '2026-10-31T12:00:00Z' };
      else if (action === 'suspend') state.item = { ...state.item, status: 'SUSPENSA', suspendedAt: '2026-10-31T12:00:00Z', suspensionReason: String(body.reason) };
      else if (action === 'resume') state.item = { ...state.item, status: 'EM_EXECUCAO' };
      else if (action === 'cancel') state.item = { ...state.item, status: 'CANCELADA', cancelledAt: '2026-10-31T12:00:00Z', cancellationReason: String(body.reason) };
      else if (action === 'observations') state.item = { ...state.item, observations: [...state.item.observations!, { id: ids.event, actorId: ids.user, recordedAt: '2026-10-31T12:00:00Z', text: String(body.observation) }] };
      else if (action === 'checklist' && method === 'PATCH') { state.item = { ...state.item, contentVersion: state.item.contentVersion + 1, checklistAnswers: body.answers as NativePermit['checklistAnswers'] }; state.ready = false; }
      else if (action === 'complete') state.item = { ...state.item, status: 'CONCLUIDA', reviewStatus: 'AGUARDANDO_REVISAO', completedAt: '2026-10-31T12:00:00Z', actualEnd: String(body.actualEnd), completionSummary: String(body.summary), closingAnswers: body.closingAnswers as NativePermit['checklistAnswers'] };
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
  await expect(menu.getByRole('link', { name: 'Modelos de permissão de trabalho', exact: true })).toHaveCount(0);
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
  await page.getByLabel('Atividade de').fill('2026-10-31'); await page.getByLabel('Atividade até').fill('2026-10-31'); await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Somente unidade selecionada' }).check(); await detail(page);
  await action(page, 'Cancelar PT', { label: 'Motivo', value: 'Atividade retirada da programação' });
  expect(state.commands).toEqual([{ path: `/api/v1/work-permits/${ids.permit}/cancel`, body: { expectedVersion: 4, reason: 'Atividade retirada da programação' } }]);
  await page.getByRole('link', { name: 'Voltar às PTs', exact: true }).click(); await expect(page.getByLabel('Situação operacional')).toHaveValue('EM_VERIFICACAO'); await expect(page.getByRole('heading', { name: 'Nenhuma PT encontrada' })).toBeVisible();
  await page.getByLabel('Situação operacional').selectOption('CANCELADA'); await page.getByRole('button', { name: 'Buscar', exact: true }).click(); await expect(page.getByRole('link', { name: state.item.title })).toBeVisible();
  const query = state.requests.filter(value => value.includes('/work-permits/search?')).at(-1)!; expect(query).toContain(`locationId=${ids.unit}`); expect(query).toContain('to=2026-11-01T03%3A00%3A00.000Z'); expect(query).not.toContain('unitId='); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
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
  await expect(page.getByText('Sem pendências', { exact: true })).toHaveCount(0); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
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

async function loadChecklists(page: Page) {
  await page.getByRole('button', { name: 'Carregar checklists', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abertura', exact: true })).toBeVisible();
}
test('checklist fixado usa PATCH, preserva precisão decimal e não libera a operação ao salvar', async ({ page }) => {
  const state = await setup(page); await detail(page); expect(state.requests.some(request => request.includes('/pt-templates'))).toBe(false);
  await loadChecklists(page); await page.getByRole('button', { name: 'Preencher checklist', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preencher checklist', exact: true });
  await expect(dialog).toContainText('Manutenção em altura · versão 2'); await expect(dialog).not.toContainText('Pergunta da versão posterior');
  await dialog.getByLabel('Isolamento realizado?', { exact: true }).selectOption('false'); await dialog.getByLabel('Medição registrada', { exact: true }).fill('9007199254740993');
  await dialog.getByLabel('Condições observadas', { exact: true }).fill('Conferência em andamento');
  await dialog.getByRole('button', { name: 'Salvar respostas', exact: true }).click(); await expect(page.getByText('Operação confirmada pela API.', { exact: true })).toBeVisible();
  expect(state.commands[0].body).toEqual({ expectedVersion: 4, answers: [{ perguntaId: checklistIds.boolean, valor: 'false', justificativa: null }, { perguntaId: checklistIds.number, valor: '9007199254740993', justificativa: null }, { perguntaId: checklistIds.text, valor: 'Conferência em andamento', justificativa: null }] });
  expect(state.requests.some(request => request === `PATCH /api/v1/work-permits/${ids.permit}/checklist`)).toBe(true); expect(state.item.status).toBe('EM_VERIFICACAO'); expect(state.item.contentVersion).toBe(4);
  await expect(page.getByText('Ciência pendente', { exact: true })).toBeVisible(); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
test('preenchimento parcial não inventa respostas e conflito conserva o rascunho', async ({ page }) => {
  const state = await setup(page); await detail(page); await loadChecklists(page); await page.getByRole('button', { name: 'Preencher checklist', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Preencher checklist', exact: true }); await dialog.getByRole('button', { name: 'Salvar respostas', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.commands[0].body).toEqual({ expectedVersion: 4, answers: [] });
  await page.getByRole('button', { name: 'Preencher checklist', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Preencher checklist', exact: true });
  await dialog.getByLabel('Condições observadas', { exact: true }).fill('Rascunho preservado'); state.conflict = true;
  await dialog.getByRole('button', { name: 'Salvar respostas', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Seus dados foram mantidos'); await expect(dialog.getByLabel('Condições observadas', { exact: true })).toHaveValue('Rascunho preservado'); await expect(dialog.getByRole('button', { name: 'Salvar respostas', exact: true })).toBeDisabled();
  expect(state.commands[1].body.expectedVersion).toBe(5); expect(state.commands).toHaveLength(2); expect(state.errors).toEqual([]);
});
test('encerramento exige verificações e término válido, concluindo com revisão pendente', async ({ page }) => {
  const state = await setup(page, ['pt:concluir'], { executing: true }); await detail(page); await loadChecklists(page); await page.getByRole('button', { name: 'Encerrar serviço', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Encerrar serviço', exact: true });
  await dialog.getByRole('button', { name: 'Confirmar encerramento', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('obrigatória'); expect(state.commands).toEqual([]);
  await dialog.getByLabel('Área conferida após o serviço?', { exact: true }).selectOption('false'); await dialog.getByLabel('Quantidade conferida', { exact: true }).fill('0'); await dialog.getByLabel('Condição final', { exact: true }).fill('Área limpa');
  await dialog.getByRole('button', { name: 'Confirmar encerramento', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('impede o encerramento'); expect(state.commands).toEqual([]);
  await dialog.getByLabel('Área conferida após o serviço?', { exact: true }).selectOption('true'); await dialog.getByLabel('Resumo do encerramento', { exact: true }).fill('Serviço concluído e área conferida'); await dialog.getByLabel('Término efetivo (Brasília)', { exact: true }).fill('2026-10-31T10:00'); await dialog.getByRole('checkbox', { name: /Confirmo as verificações/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar encerramento', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('entre o início do serviço e agora'); expect(state.commands).toEqual([]);
  await dialog.getByLabel('Término efetivo (Brasília)', { exact: true }).fill('2026-10-31T08:30:45'); await dialog.getByRole('button', { name: 'Confirmar encerramento', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Resumo da PT' }).getByText('Aguardando revisão', { exact: true })).toBeVisible(); expect(state.commands[0]).toEqual({ path: `/api/v1/work-permits/${ids.permit}/complete`, body: { expectedVersion: 4, summary: 'Serviço concluído e área conferida', actualEnd: '2026-10-31T11:30:45.000Z', closingAnswers: [{ perguntaId: checklistIds.closingBoolean, valor: 'true', justificativa: null }, { perguntaId: checklistIds.closingNumber, valor: '0', justificativa: null }, { perguntaId: checklistIds.closingText, valor: 'Área limpa', justificativa: null }] } });
  expect(state.item.status).toBe('CONCLUIDA'); expect(state.item.contentVersion).toBe(3); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
test('recusa do catálogo não bloqueia a consulta da PT nem concede edição', async ({ page }) => {
  const state = await setup(page, [], { modelsDenied: true }); await detail(page); await page.getByRole('button', { name: 'Carregar checklists', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('não autorizou a leitura dos modelos'); await expect(page.getByRole('heading', { name: state.item.title, exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /Preencher checklist|Encerrar serviço/ })).toHaveCount(0);
  await expect(page.getByText('Isolamento realizado?', { exact: true })).toHaveCount(0); expect(state.commands).toEqual([]); expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]);
});
test('modelo fixado ausente não é substituído pela versão nova', async ({ page }) => {
  const state = await setup(page, ['pt:editar'], { missingPinned: true }); await detail(page); await page.getByRole('button', { name: 'Carregar checklists', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível conferir as versões fixadas'); await expect(page.getByRole('button', { name: 'Preencher checklist', exact: true })).toHaveCount(0); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('modelos sem perguntas de encerramento não habilitam conclusão', async ({ page }) => {
  const state = await setup(page, ['pt:concluir'], { executing: true, noClosing: true }); await detail(page); await loadChecklists(page);
  await expect(page.getByRole('button', { name: 'Encerrar serviço', exact: true })).toBeDisabled(); await page.getByRole('button', { name: 'Encerramento', exact: true }).click(); await expect(page.getByText('Há modelo sem verificações de encerramento. A conclusão depende dessas perguntas no backend.')).toBeVisible(); expect(state.commands).toEqual([]); expect(state.errors).toEqual([]);
});
test('checklist em 320px aceita decimal local e mantém o formulário dentro da tela', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 }); const state = await setup(page); await detail(page); await loadChecklists(page); await page.getByRole('button', { name: 'Preencher checklist', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preencher checklist', exact: true }); await dialog.getByLabel('Isolamento realizado?', { exact: true }).selectOption('true'); await dialog.getByLabel('Medição registrada', { exact: true }).fill('1,25');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath('checklist-nativo-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Salvar respostas', exact: true }).click(); await expect(dialog).toHaveCount(0); expect((state.commands[0].body.answers as { valor: string }[])[1].valor).toBe('1.25'); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('operador consulta perguntas fixadas sem CONFIG e registra sua ciência integral', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const state = await setup(page, ['pt:editar'], { modelsDenied: true, completeContract: true }); await detail(page); await loadChecklists(page);
  await page.getByText('Visualizar perguntas e respostas', { exact: true }).click();
  await expect(page.getByText('Isolamento realizado?', { exact: true })).toBeVisible();
  expect(state.requests.some(request => request.includes('/pt-templates'))).toBe(false);
  await page.getByRole('button', { name: 'Registrar minha ciência', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar minha ciência', exact: true });
  await expect(dialog.getByText(scienceFixture().declarations[0].text, { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Li as declarações/ }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ciencia-nativa-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Confirmar minha ciência', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByText('Sua ciência está registrada para o conteúdo atual.', { exact: true })).toBeVisible();
  expect(state.commands).toEqual([{ path: `/api/v1/work-permits/${ids.permit}/acknowledge`, body: {
    expectedVersion: 4, contentVersion: 3, participantUserId: ids.user, confirmedName: 'Pessoa da operação', identificationMethod: 'Sessão autenticada', confirmation: true, contentHash: scienceFixture().contentHash,
  } }]);
  expect(state.item.status).toBe('EM_VERIFICACAO'); expect(state.item.contentVersion).toBe(3); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('conflito de ciência conserva o nome e não repete a confirmação', async ({ page }) => {
  const state = await setup(page, ['pt:editar'], { completeContract: true }); await detail(page);
  await page.getByRole('button', { name: 'Registrar minha ciência', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Registrar minha ciência', exact: true });
  await dialog.getByLabel('Seu nome completo', { exact: true }).fill('Pessoa da operação conferida'); await dialog.getByRole('checkbox', { name: /Li as declarações/ }).check(); state.conflict = true;
  await dialog.getByRole('button', { name: 'Confirmar minha ciência', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Seus dados foram mantidos');
  await expect(dialog.getByLabel('Seu nome completo', { exact: true })).toHaveValue('Pessoa da operação conferida'); await expect(dialog.getByRole('button', { name: 'Confirmar minha ciência', exact: true })).toBeDisabled();
  expect(state.commands).toHaveLength(1); expect(state.item.participants[0].acknowledgedAt).toBeNull(); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
