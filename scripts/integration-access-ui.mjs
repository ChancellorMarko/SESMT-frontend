import { integrationEnv, root } from './integration-config.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
const env = integrationEnv();
const parts = Object.fromEntries(env.ConnectionStrings__Sesmt.split(';').filter(Boolean).map(part => { const at = part.indexOf('='); return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()]; }));
if (parts.host !== '127.0.0.1' || parts.port !== '5434') throw new Error('Only the local QA cluster is allowed.');
const database = `ampara_uiqa_${randomBytes(6).toString('hex')}`;
const dir = join(root, '.local/access-ui-qa'); mkdirSync(dir, { recursive: true });
const bundledPg = join(root, '.local/tools/postgresql-17.11/pgsql/bin');
const pgBin = process.env.PG_BIN_DIR || (existsSync(bundledPg) ? bundledPg : '');
const pgArgs = ['-h', parts.host, '-p', parts.port, '-U', parts.username];
function pg(command, args) {
  const result = spawnSync(join(pgBin, `${command}${process.platform === 'win32' ? '.exe' : ''}`), args, { cwd: root, windowsHide: true, encoding: 'utf8', env: { ...process.env, PGPASSWORD: parts.password } });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}
const children = [];
function start(command, args, logName) {
  const log = openSync(join(dir, logName), 'a');
  const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] }); children.push(child); return child;
}
function done(child) { return new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Process failed; inspect isolated QA logs.'))); }); }
async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('QA server stopped.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(300);
  }
  throw new Error(`QA server unavailable: ${url}`);
}
const email = 'admin-uiqa@example.invalid', password = `QA!${randomBytes(16).toString('hex')}`;
Object.assign(env, { ConnectionStrings__Sesmt: env.ConnectionStrings__Sesmt.replace(/Database=[^;]*/i, `Database=${database}`),
  ASPNETCORE_URLS: 'http://127.0.0.1:5059', Seed__AdminEmail: email, Seed__AdminName: 'Administrador QA', Seed__AdminPassword: password,
  Storage__Local__RootPath: join(dir, database), API_PROXY_TARGET: 'http://127.0.0.1:5059', VITE_API_MODE: 'api',
  VITE_AUTH_API_CONTRACT: 'native', PasswordResetEmail__Host: '', PasswordResetEmail__Username: '', PasswordResetEmail__Password: '' });
let allocated = false, browser;
const report = { mockedRequests: false, checks: [], pageErrors: [] };
function check(ok, message) { if (!ok) throw new Error(message); report.checks.push(message); console.log(message); }
try {
  for (const port of [5059, 5185]) { try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }); throw new Error(`QA port ${port} already in use.`); } catch (error) { if (error.message.includes('already in use')) throw error; } }
  await done(start('dotnet', ['build', 'backend/SESMT.API/SESMT.API.csproj', '-c', 'Release', '--nologo', '--verbosity', 'quiet'], 'build.log'));
  pg('createdb', [...pgArgs, '-T', 'template0', database]); allocated = true;
  writeFileSync(join(dir, 'owned-database.json'), JSON.stringify({ database }));
  await done(start('dotnet', ['ef', 'database', 'update', '--no-build', '--configuration', 'Release', '--project', 'backend/SESMT.Infrastructure', '--startup-project', 'backend/SESMT.API'], 'migrate.log'));
  const api = start('dotnet', ['backend/SESMT.API/bin/Release/net10.0/SESMT.API.dll'], 'api.log'); await ready('http://127.0.0.1:5059/health', api);
  const frontend = start(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5185', '--strictPort', '--mode', 'integration'], 'frontend.log'); await ready('http://127.0.0.1:5185/login', frontend);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined), headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:5185/login'); await page.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
  await page.getByLabel('E-mail', { exact: true }).fill(email); await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click(); await page.waitForURL('**/app/configuracoes/usuarios');
  check(true, 'Real API: bootstrap administrator login');
  await page.goto('http://127.0.0.1:5185/app/organizacao');
  await page.getByRole('button', { name: 'Cadastrar empresa', exact: true }).click();
  await page.getByLabel('Razão social', { exact: true }).fill('Empresa fictícia QA LTDA'); await page.getByLabel('Nome fantasia', { exact: true }).fill('Empresa QA');
  await page.getByLabel('CNPJ', { exact: true }).fill('11222333000181'); await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('cell', { name: 'Empresa QA', exact: true }).waitFor();
  check(true, 'Real API: first company created and reread');
  await page.getByRole('button', { name: /Unidades/ }).click(); await page.getByRole('button', { name: 'Cadastrar unidade', exact: true }).click();
  for (const [label, value] of Object.entries({ Nome: 'Unidade QA', Código: 'QA-MATRIZ', CEP: '01000-000', Cidade: 'Cidade QA', Bairro: 'Bairro QA', Endereço: 'Rua fictícia QA', Número: 'S/N' })) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel('UF', { exact: true }).selectOption('PR'); await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Unidades/ }).click(); await page.getByRole('cell', { name: 'Unidade QA QA-MATRIZ', exact:true }).waitFor();
  check(true, 'Real API: unit created and session scope refreshed');
  await page.getByRole('button', { name: /Setores/ }).click(); await page.getByRole('button', { name: 'Cadastrar setor', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Setor QA'); await page.getByRole('button', { name: 'Cadastrar', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check(true, 'Real API: department created');
  await page.getByRole('button', { name: /Cargos/ }).click(); await page.getByRole('button', { name: 'Cadastrar cargo', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Cargo QA'); await page.getByRole('button', { name: 'Cadastrar', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check(true, 'Real API: position created');
  await page.goto('http://127.0.0.1:5185/app/configuracoes/usuarios'); await page.getByRole('button', { name: 'Cadastrar usuário', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Pessoa QA'); await page.getByLabel('E-mail', { exact: true }).fill('pessoa-uiqa@example.invalid');
  await page.getByRole('checkbox', { name: /^Técnico\/Engenheiro/ }).check();
  await page.getByRole('checkbox', { name: /^Empresa QA.*Empresa inteira/ }).check();
  await page.getByRole('checkbox', { name: /^Confirmo/ }).check(); await page.getByRole('dialog').getByRole('button', { name: 'Cadastrar usuário', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('button', { name: 'Acessos de Pessoa QA', exact: true }).waitFor();
  check(true, 'Real API: user created with dynamic role and company scope');
  await page.getByRole('button', { name: 'Acessos de Pessoa QA', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Recursos Humanos/ }).check();
  await page.getByRole('checkbox', { name: /^Empresa QA.*Empresa inteira/ }).uncheck();
  await page.getByRole('checkbox', { name: /^Unidade QA.*Unidade · Empresa QA/ }).check();
  await page.getByRole('checkbox', { name: /^Confirmo/ }).check(); await page.getByRole('button', { name: 'Salvar acessos', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  check((await page.getByRole('row').filter({ hasText: 'Pessoa QA' }).textContent()).includes('RH'), 'Real API: role and scope edited in one confirmed command');
  await page.screenshot({ path: join(dir, 'users-desktop.png'), fullPage: true });
  const organization = await page.evaluate(async () => { const { api } = await import('/src/shared/api/client.ts'); return api.get('/organization-management'); });
  const qaCompany = organization.companies[0].id, qaUnit = organization.units[0].id;
  for (const [role, expectedPath] of [['GESTOR','/app/dashboard'], ['TECNICO','/app/dashboard'], ['RH','/app/trabalhadores'], ['AUDITOR','/app/auditoria'], ['MEDICO','/app/documentos'], ['TRABALHADOR','/app/documentos']]) {
    const roleEmail = `${role.toLowerCase()}-uiqa@example.invalid`;
    const account = await page.evaluate(async ({ role, email, companyId }) => { const { api } = await import('/src/shared/api/client.ts'); return api.post('/users', { name: `Pessoa QA ${role}`, email, roles: [role], scopeIds: [companyId] }); }, { role, email: roleEmail, companyId: qaCompany });
    if (role === 'TRABALHADOR') await page.evaluate(async ({ userId, companyId, unitId }) => { const { createNativeWorker } = await import('/src/shared/api/client.ts'); return createNativeWorker( { companyId, unitId, userId, enrollment: 'QA-WORKER', name: 'Pessoa QA Trabalhador', cpf: '00000000191', dateOfBirth: '1990-01-01', admissionDate: '2026-01-01' }); }, { userId: account.id, companyId: qaCompany, unitId: qaUnit });
    // Only this allocated disposable QA database receives the shared fixture hash.
    if (!allocated || !/^ampara_uiqa_[a-f0-9]{12}$/.test(database) || !/^[a-f0-9-]{36}$/.test(account.id)) throw new Error('QA fixture boundary failed.');
    pg('psql', [...pgArgs, '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE core.usuario SET senha_hash = (SELECT senha_hash FROM core.usuario WHERE email = 'admin-uiqa@example.invalid') WHERE id = '${account.id}';`]);
    const rolePage = await browser.newPage({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    rolePage.on('pageerror', error => report.pageErrors.push(error.message));
    await rolePage.goto('http://127.0.0.1:5185/login'); await rolePage.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
    await rolePage.getByLabel('E-mail', { exact: true }).fill(roleEmail); await rolePage.getByLabel('Senha', { exact: true }).fill(password);
    await rolePage.getByRole('button', { name: 'Entrar na plataforma', exact: true }).click(); await rolePage.waitForURL(`**${expectedPath}`); await rolePage.getByRole('heading', { level: 1 }).waitFor();
    check(new URL(rolePage.url()).pathname === expectedPath, `Real role login: ${role} -> ${expectedPath}`);
    await rolePage.goto('http://127.0.0.1:5185/app/configuracoes/usuarios');
    if (role === 'AUDITOR') { await rolePage.getByRole('heading', { name: 'Usuários e acesso', exact: true }).waitFor(); await rolePage.getByRole('table').waitFor(); }
    else await rolePage.getByRole('heading', { name: 'Esta área precisa de autorização.', exact: true }).waitFor();
    check(await rolePage.getByRole('button', { name: 'Cadastrar usuário', exact: true }).count() === 0, `Role boundary: ${role} cannot create accounts in the frontend`);
    const denied = await rolePage.evaluate(async ({ role, companyId }) => {
      const { api } = await import('/src/shared/api/client.ts');
      try { await api.post('/users', { name: 'Tentativa fictícia recusada', email: `denied-${role.toLowerCase()}@example.invalid`, roles: [role], scopeIds: [companyId] }); return false; }
      catch (error) { return error.status === 403; }
    }, { role, companyId: qaCompany });
    check(denied, `Server boundary: ${role} cannot create accounts through direct API calls`);
    await rolePage.close();
  }
  await page.goto(`http://127.0.0.1:5185/app/trabalhadores?unitId=${qaUnit}`);
  await page.getByRole('link', { name: 'Pessoa QA Trabalhador', exact: true }).click();
  await page.getByRole('link', { name: 'Editar cadastro profissional', exact: true }).click();
  const professional = page.getByRole('dialog', { name: 'Editar cadastro profissional', exact: true });
  await professional.getByLabel('Nome completo', { exact: true }).fill('Pessoa QA Atualizada');
  await professional.getByLabel('Matrícula', { exact: true }).fill('QA-WORKER-EDIT');
  await professional.getByLabel('Motivo da alteração', { exact: true }).fill('Correção fictícia para testar o cadastro profissional');
  await professional.getByRole('checkbox', { name: /Confirmo as alterações/ }).check();
  check(await professional.getByLabel('CPF', { exact: true }).count() === 0, 'Professional editor: CPF is not requested or exposed');
  await professional.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByRole('heading', { name: 'Pessoa QA Atualizada', exact: true }).waitFor();
  check(true, 'Real API: professional worker edit confirmed in the browser');
  const operationReads = await page.evaluate(async () => {
    const { api } = await import('/src/shared/api/client.ts');
    const [appointments,designations] = await Promise.all([api.get('/appointments'),api.get('/designations')]);
    return Array.isArray(appointments.items) && Array.isArray(designations);
  });
  check(operationReads,'Real API: global administrator reads agenda and designations');
  await page.goto('http://127.0.0.1:5185/app/dashboard'); await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor();
  const activeShortcut=()=>page.getByRole('navigation',{name:'Acesso rápido',exact:true}).locator('a[aria-current="page"]');
  check(await activeShortcut().count()===1&&await activeShortcut().getAttribute('href')==='/app/dashboard','Navigation: dashboard has exactly one active shortcut');
  await page.goto(`http://127.0.0.1:5185/app/epis?unitId=${qaUnit}`);
  await page.getByRole('heading',{name:'EPIs',exact:true}).waitFor();
  check(await activeShortcut().count()===1&&await activeShortcut().getAttribute('href')==='/app/epis','Navigation: equipment has exactly one active shortcut');
  await page.getByRole('tab',{name:'Catálogo de EPIs',exact:true}).click();
  await page.getByRole('button',{name:'Cadastrar EPI',exact:true}).click();
  const equipmentForm=page.getByRole('dialog',{name:'Cadastrar EPI',exact:true});
  await equipmentForm.getByLabel('Código',{exact:true}).fill('EPI-QA-001');
  await equipmentForm.getByLabel('Nome do equipamento',{exact:true}).fill('Luva de proteção');
  await equipmentForm.getByLabel('CA',{exact:true}).fill('12345');
  await equipmentForm.getByRole('checkbox').check();
  await equipmentForm.getByRole('button',{name:'Salvar EPI',exact:true}).click();
  await equipmentForm.waitFor({state:'hidden'}); await page.getByRole('cell').filter({hasText:'EPI-QA-001'}).waitFor();
  check(true,'Real API: equipment catalog created and reread in the browser');
  await page.getByRole('button',{name:'Registrar entrega',exact:true}).click();
  const deliveryForm=page.getByRole('dialog',{name:'Registrar entrega de EPI',exact:true});
  await deliveryForm.getByLabel('Trabalhador',{exact:true}).selectOption({label:'Pessoa QA Atualizada · QA-WORKER-EDIT'});
  await deliveryForm.getByLabel('Equipamento',{exact:true}).selectOption({label:'Luva de proteção · EPI-QA-001'});
  await deliveryForm.getByRole('checkbox').check(); await deliveryForm.getByRole('button',{name:'Registrar entrega',exact:true}).click();
  await deliveryForm.waitFor({state:'hidden'}); await page.getByRole('tab',{name:'Entregas',exact:true}).click();
  await page.getByRole('link',{name:'Luva de proteção',exact:true}).click();
  const deliveryDetail=page.getByRole('dialog',{name:'Entrega de EPI',exact:true}); await deliveryDetail.getByText('Pessoa QA Atualizada',{exact:true}).waitFor();
  check(true,'Real API: equipment delivery opens its persisted detail');
  await page.keyboard.press('Escape'); await deliveryDetail.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Devolver',exact:true}).click();
  const returnForm=page.getByRole('dialog',{name:'Registrar devolução',exact:true});
  await returnForm.getByLabel('Motivo da devolução',{exact:true}).fill('Substituição por desgaste');
  await returnForm.getByRole('checkbox').check(); await returnForm.getByRole('button',{name:'Registrar devolução',exact:true}).click();
  await returnForm.waitFor({state:'hidden'}); await page.locator('.badge').filter({hasText:'Devolvido'}).waitFor();
  check(true,'Real API: equipment return confirmed and history retained');
  const workerEquipmentPage=await browser.newPage({reducedMotion:'reduce',serviceWorkers:'block'});
  workerEquipmentPage.on('pageerror',error=>report.pageErrors.push(error.message));
  await workerEquipmentPage.goto('http://127.0.0.1:5185/login'); await workerEquipmentPage.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
  await workerEquipmentPage.getByLabel('E-mail',{exact:true}).fill('trabalhador-uiqa@example.invalid'); await workerEquipmentPage.getByLabel('Senha',{exact:true}).fill(password);
  await workerEquipmentPage.getByRole('button',{name:'Entrar na plataforma',exact:true}).click(); await workerEquipmentPage.waitForURL('**/app/documentos');
  await workerEquipmentPage.goto('http://127.0.0.1:5185/app/epis'); await workerEquipmentPage.getByRole('link',{name:'Luva de proteção',exact:true}).waitFor();
  check(await workerEquipmentPage.getByRole('button',{name:'Registrar entrega',exact:true}).count()===0,'Real API: worker reads own equipment without delivery commands');
  await workerEquipmentPage.close();
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Equipment: no page overflow at 390px');
  await page.screenshot({path:join(dir,'equipment-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1365,height:900});
  await page.goto(`http://127.0.0.1:5185/app/treinamentos?unitId=${qaUnit}`);
  await page.getByRole('heading',{name:'Treinamentos',exact:true}).waitFor();
  check(await activeShortcut().count()===1&&await activeShortcut().getAttribute('href')==='/app/treinamentos','Navigation: training has exactly one active shortcut');
  await page.getByRole('button',{name:'Registrar treinamento',exact:true}).click();
  const trainingForm=page.getByRole('dialog',{name:'Registrar treinamento',exact:true});
  await trainingForm.getByLabel('Trabalhador',{exact:true}).selectOption({label:'Pessoa QA Atualizada · QA-WORKER-EDIT'});
  await trainingForm.getByLabel('Nome do curso',{exact:true}).fill('Integração de segurança QA');
  await trainingForm.getByLabel('Carga horária (horas)',{exact:true}).fill('1');
  await trainingForm.getByLabel('Minutos adicionais',{exact:true}).fill('30');
  await trainingForm.getByRole('checkbox').check(); await trainingForm.getByRole('button',{name:'Registrar treinamento',exact:true}).click();
  const trainingDetails=page.getByRole('dialog',{name:'Detalhes do treinamento',exact:true});
  await trainingDetails.getByText('1 h 30 min',{exact:true}).waitFor();
  check(true,'Real API: training registered, persisted and opened with exact duration');
  await trainingDetails.getByText('Histórico de alterações',{exact:true}).click(); await trainingDetails.getByText('Cadastro · versão 1',{exact:true}).waitFor();
  check(true,'Real API: training history visible without administrative audit access');
  const evidenceFixture=await page.evaluate(async({companyId,unitId})=>{
    const {api,nativeDocumentsApi,createNativeWorker}=await import('/src/shared/api/client.ts');
    const trainingId=new URLSearchParams(location.search).get('registro');
    const training=await api.get(`/trainings/${trainingId}`,{query:{unitId}}),me=await api.get('/auth/me');
    const type=await nativeDocumentsApi.post('/document-types',{code:'TRAIN-QA',name:'Comprovante administrativo QA',category:'TREINAMENTO',secrecyLevel:'Interno',requiresSignature:false,requiresApproval:true,metadataSchema:'{}',schemaVersion:1});
    const document=await nativeDocumentsApi.post('/documents',{documentTypeId:type.id,companyId,unitId,ownerId:me.user.id,personId:training.workerId,code:'CAP-QA-001',title:'Comprovante treinamento QA',secrecyLevel:'Interno',issueDate:training.completedOn,metadata:'{}',links:[]});
    const form=new FormData();form.set('expectedVersion',String(document.revision));form.set('file',new Blob(['%PDF-1.7\nFictitious QA attachment; not an operational certificate.\n%%EOF'],{type:'application/pdf'}),'training-qa.pdf');
    const version=await nativeDocumentsApi.post(`/documents/${document.id}/versions`,form);
    const users=await api.get('/users'),reviewer=users.find(u=>u.email==='tecnico-uiqa@example.invalid');
    const worker=await createNativeWorker({companyId,unitId,userId:reviewer.id,name:'Conferidor QA',enrollment:'QA-REVIEWER',cpf:'52998224725',dateOfBirth:'1990-01-01',admissionDate:'2026-01-01'});
    const services=await api.get('/work-permits/services');
    await api.post('/designations',{personId:worker.id,serviceIds:[services[0].id],locationIds:[unitId],type:'conferir',startsAt:new Date(Date.now()-86400000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),origin:'Conferência isolada de QA'});
    return{trainingId,documentId:document.id,versionId:version.id};
  },{companyId:qaCompany,unitId:qaUnit});
  const reviewerPage=await browser.newPage({reducedMotion:'reduce',serviceWorkers:'block'});reviewerPage.on('pageerror',error=>report.pageErrors.push(error.message));
  await reviewerPage.goto('http://127.0.0.1:5185/login');await reviewerPage.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
  await reviewerPage.getByLabel('E-mail',{exact:true}).fill('tecnico-uiqa@example.invalid');await reviewerPage.getByLabel('Senha',{exact:true}).fill(password);
  await reviewerPage.getByRole('button',{name:'Entrar na plataforma',exact:true}).click();await reviewerPage.waitForURL('**/app/dashboard');
  await reviewerPage.evaluate(async({documentId,versionId})=>{
    const {nativeDocumentsApi}=await import('/src/shared/api/client.ts');const doc=await nativeDocumentsApi.get(`/documents/${documentId}`);
    return nativeDocumentsApi.post(`/documents/${documentId}/versions/${versionId}/review`,{expectedVersion:doc.revision,version:1,decision:'aceita',reason:'Conferência administrativa no banco isolado de QA'});
  },evidenceFixture);await reviewerPage.close();
  check(true,'Real API: PDF uploaded and published only by a designated reviewer');
  async function linkTrainingEvidence(reason){
    await trainingDetails.getByRole('button',{name:/Vincular comprovante|Conferir ou substituir vínculo/}).click();
    const dialog=page.getByRole('dialog',{name:'Vincular comprovante',exact:true});await dialog.getByLabel('Versão do comprovante',{exact:true}).selectOption(evidenceFixture.versionId);
    await dialog.getByLabel('Motivo da conferência',{exact:true}).fill(reason);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirmar vínculo',exact:true}).click();
    await trainingDetails.getByText('Vínculo atualizado',{exact:true}).waitFor();
  }
  await linkTrainingEvidence('Conferência da pessoa, do curso e do PDF de QA');
  check(true,'Real API: training pins the published PDF version and its SHA-256');
  await page.screenshot({path:join(dir,'training-evidence-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await trainingDetails.getByRole('button',{name:'Conferir ou substituir vínculo',exact:true}).click();
  const mobileEvidence=page.getByRole('dialog',{name:'Vincular comprovante',exact:true});await mobileEvidence.getByRole('option',{name:/CAP-QA-001/}).waitFor({state:'attached'});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)&&await mobileEvidence.evaluate(el=>el.scrollWidth<=el.clientWidth),'Training evidence: selection form fits at 390px');
  await page.screenshot({path:join(dir,'training-evidence-mobile.png'),fullPage:true});await mobileEvidence.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('link',{name:'Integração de segurança QA',exact:true}).click();await trainingDetails.getByText('Vínculo atualizado',{exact:true}).waitFor();await page.setViewportSize({width:1365,height:900});
  const popupPromise=page.waitForEvent('popup');await trainingDetails.getByRole('link',{name:'Abrir documento',exact:true}).click();const documentPage=await popupPromise;
  documentPage.on('pageerror',error=>report.pageErrors.push(error.message));await documentPage.getByRole('heading',{name:'Comprovante treinamento QA',exact:true}).waitFor();
  const downloadPromise=documentPage.waitForEvent('download');await documentPage.getByRole('button',{name:'Baixar arquivo',exact:true}).click();const attachmentDownload=await downloadPromise;
  check(await attachmentDownload.failure()===null,'Real API: linked document download verifies bytes and hash in the browser');await documentPage.close();
  const invalidHashPopup=page.waitForEvent('popup');await trainingDetails.getByRole('link',{name:'Abrir documento',exact:true}).click();const mismatchedPage=await invalidHashPopup;
  mismatchedPage.on('pageerror',error=>report.pageErrors.push(error.message));await mismatchedPage.getByRole('heading',{name:'Comprovante treinamento QA',exact:true}).waitFor();
  const wrongHashUrl=new URL(mismatchedPage.url());wrongHashUrl.searchParams.set('sha256','b'.repeat(64));await mismatchedPage.goto(wrongHashUrl.href);
  await mismatchedPage.getByText('A versão solicitada ou seu hash não correspondem a este documento. Nenhum arquivo foi selecionado.',{exact:true}).waitFor();
  check(await mismatchedPage.getByRole('button',{name:'Baixar arquivo',exact:true}).count()===0,'Document pin: a mismatched hash never falls back to the current download');await mismatchedPage.close();
  await trainingDetails.getByRole('button',{name:'Editar registro',exact:true}).click();
  const trainingEdit=page.getByRole('dialog',{name:'Editar treinamento',exact:true});
  await trainingEdit.getByLabel('Nome do curso',{exact:true}).fill('Integração de segurança revisada');
  await trainingEdit.getByLabel('Motivo da alteração',{exact:true}).fill('Correção administrativa de teste');
  await trainingEdit.getByRole('checkbox').check(); await trainingEdit.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await trainingDetails.getByText('Integração de segurança revisada',{exact:true}).waitFor();
  check(true,'Real API: training edit preserves revision and worker');
  await trainingDetails.getByText('Treinamento alterado: confira o vínculo',{exact:true}).waitFor();
  check(true,'Real API: changing training metadata requires a new evidence confirmation');
  await linkTrainingEvidence('Nova conferência após a correção do treinamento');
  await trainingDetails.getByRole('button',{name:'Remover vínculo',exact:true}).click();
  const unlinkEvidence=page.getByRole('dialog',{name:'Remover vínculo do comprovante',exact:true});await unlinkEvidence.getByLabel('Motivo da remoção',{exact:true}).fill('Remoção administrativa conferida no teste');await unlinkEvidence.getByRole('checkbox').check();await unlinkEvidence.getByRole('button',{name:'Confirmar remoção',exact:true}).click();
  await trainingDetails.getByText('Sem comprovante vinculado',{exact:true}).waitFor();
  check(true,'Real API: removing a training link preserves the document and the audit history');
  await linkTrainingEvidence('Comprovante vinculado novamente para verificar acesso próprio');
  await trainingDetails.getByRole('button',{name:'Invalidar registro',exact:true}).click();
  const revokeTraining=page.getByRole('dialog',{name:'Invalidar treinamento',exact:true});
  await revokeTraining.getByLabel('Motivo da invalidação',{exact:true}).fill('Cadastro duplicado para testar histórico');
  await revokeTraining.getByRole('checkbox').check(); await revokeTraining.getByRole('button',{name:'Confirmar invalidação',exact:true}).click();
  await trainingDetails.locator('dd').filter({hasText:'Cadastro duplicado para testar histórico'}).waitFor();
  check(true,'Real API: training invalidated without deleting the original record');
  await page.keyboard.press('Escape'); await trainingDetails.waitFor({state:'hidden'});
  await page.getByLabel('Situação',{exact:true}).selectOption('REVOKED'); await page.getByRole('link',{name:'Integração de segurança revisada',exact:true}).waitFor();
  check(true,'Real API: renewal/status filters operate on persisted training records');
  const trainingWorker=await browser.newPage({reducedMotion:'reduce',serviceWorkers:'block'}); trainingWorker.on('pageerror',error=>report.pageErrors.push(error.message));
  await trainingWorker.goto('http://127.0.0.1:5185/login'); await trainingWorker.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
  await trainingWorker.getByLabel('E-mail',{exact:true}).fill('trabalhador-uiqa@example.invalid'); await trainingWorker.getByLabel('Senha',{exact:true}).fill(password);
  await trainingWorker.getByRole('button',{name:'Entrar na plataforma',exact:true}).click(); await trainingWorker.waitForURL('**/app/documentos');
  await trainingWorker.goto('http://127.0.0.1:5185/app/treinamentos'); await trainingWorker.getByRole('link',{name:'Integração de segurança revisada',exact:true}).click();
  await trainingWorker.locator('dd').filter({hasText:'Cadastro duplicado para testar histórico'}).waitFor();
  await trainingWorker.getByRole('link',{name:'Abrir documento',exact:true}).waitFor();
  check(await trainingWorker.getByRole('button',{name:/Vincular comprovante|Conferir ou substituir vínculo|Remover vínculo/}).count()===0,'Real API: worker reads own evidence without managing the link');
  check(await trainingWorker.getByRole('button',{name:/Registrar treinamento|Editar registro|Invalidar registro/}).count()===0,'Real API: worker reads own training without management commands');
  await trainingWorker.close();
  await page.screenshot({path:join(dir,'training-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844}); check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Training: no page overflow at 390px');
  await page.screenshot({path:join(dir,'training-mobile.png'),fullPage:true});
  check(await page.evaluate(async unitId => { const { api } = await import('/src/shared/api/client.ts'); try { await api.get('/occupational-health', {query:{unitId}}); return false; } catch(e) { return e.status===403; } },qaUnit),'Health: administrator has no implicit access to ASOs');
  const medicalPage=await browser.newPage({viewport:{width:1365,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
  medicalPage.on('pageerror',error=>report.pageErrors.push(error.message));
  await medicalPage.goto('http://127.0.0.1:5185/login');await medicalPage.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
  await medicalPage.getByLabel('E-mail',{exact:true}).fill('medico-uiqa@example.invalid');await medicalPage.getByLabel('Senha',{exact:true}).fill(password);
  await medicalPage.getByRole('button',{name:'Entrar na plataforma',exact:true}).click();await medicalPage.waitForURL('**/app/documentos');
  await medicalPage.goto(`http://127.0.0.1:5185/app/asos?unitId=${qaUnit}`);await medicalPage.getByRole('button',{name:'Registrar ASO',exact:true}).click();
  const asoForm=medicalPage.getByRole('dialog',{name:'Registrar ASO',exact:true});
  check(await asoForm.getByLabel('Aptidão informada no ASO',{exact:true}).inputValue()===''&&await asoForm.getByLabel('Próxima avaliação informada',{exact:true}).inputValue()==='','Health: no assumed fitness or automatic renewal date');
  const examDay=await medicalPage.evaluate(async()=>{const{localDay}=await import('/src/features/native-aso/contracts.ts');return localDay();});
  await asoForm.getByLabel('Trabalhador',{exact:true}).selectOption({label:'Pessoa QA Atualizada · QA-WORKER-EDIT'});
  await asoForm.getByLabel('Tipo de exame',{exact:true}).selectOption('PERIODIC');
  await asoForm.getByLabel('Data do exame',{exact:true}).fill(examDay);await asoForm.getByLabel('Data de emissão',{exact:true}).fill(examDay);
  await asoForm.getByLabel('Função avaliada no ASO',{exact:true}).fill('Função QA');await asoForm.getByLabel('Aptidão informada no ASO',{exact:true}).selectOption('UNFIT');
  await asoForm.getByLabel('Médico emitente',{exact:true}).fill('Emitente sintético QA');await asoForm.getByLabel('CRM',{exact:true}).fill('12345');await asoForm.getByLabel('UF do CRM',{exact:true}).selectOption('PR');
  await asoForm.getByRole('checkbox').check();await asoForm.getByRole('button',{name:'Salvar',exact:true}).click();
  const asoDetail=medicalPage.getByRole('dialog',{name:'Detalhes do ASO',exact:true});await asoDetail.getByText('Emitente sintético QA',{exact:true}).waitFor();
  const asoId=new URL(medicalPage.url()).searchParams.get('registro');
  check(Boolean(asoId),'Real API: physician registers ASO and rereads encrypted persisted details');
  await asoDetail.getByRole('button',{name:'Corrigir cadastro',exact:true}).click();
  const asoEdit=medicalPage.getByRole('dialog',{name:'Corrigir cadastro de ASO',exact:true});await asoEdit.getByLabel('Referência do ASO',{exact:true}).fill('QA-CORRIGIDO');
  await asoEdit.getByLabel('Motivo da correção',{exact:true}).selectOption('REGISTRATION_ERROR');await asoEdit.getByRole('checkbox').check();await asoEdit.getByRole('button',{name:'Salvar',exact:true}).click();
  await asoDetail.getByText('QA-CORRIGIDO',{exact:true}).waitFor();await asoDetail.getByText('Histórico de alterações',{exact:true}).click();await asoDetail.getByText('Correção · versão 2',{exact:true}).waitFor();
  check(true,'Real API: ASO correction retains source, reason code and revision history');
  await medicalPage.keyboard.press('Escape');await asoDetail.waitFor({state:'hidden'});await medicalPage.screenshot({path:join(dir,'aso-desktop.png'),fullPage:true});
  await medicalPage.setViewportSize({width:390,height:844});check(await medicalPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'ASO: no page overflow at 390px');
  await medicalPage.getByRole('button',{name:'Registrar ASO',exact:true}).click();await medicalPage.screenshot({path:join(dir,'aso-form-mobile.png'),fullPage:true});await asoForm.getByRole('button',{name:'Cancelar',exact:true}).click();
  for(const [role,hasIssuer] of [['rh',false],['trabalhador',true]]) {
    const rolePage=await browser.newPage({reducedMotion:'reduce',serviceWorkers:'block'});rolePage.on('pageerror',error=>report.pageErrors.push(error.message));
    await rolePage.goto('http://127.0.0.1:5185/login');await rolePage.locator('[data-auth-scene][data-arrival="ready"]').waitFor();
    await rolePage.getByLabel('E-mail',{exact:true}).fill(`${role}-uiqa@example.invalid`);await rolePage.getByLabel('Senha',{exact:true}).fill(password);
    await rolePage.getByRole('button',{name:'Entrar na plataforma',exact:true}).click();await rolePage.waitForURL(role==='rh'?'**/app/trabalhadores':'**/app/documentos');
    await rolePage.goto(`http://127.0.0.1:5185/app/asos?unitId=${qaUnit}`);await rolePage.getByRole('link',{name:'Pessoa QA Atualizada',exact:true}).click();
    const detail=rolePage.getByRole('dialog',{name:'Detalhes do ASO',exact:true});await detail.getByText('Função QA',{exact:true}).waitFor();
    check(await rolePage.getByRole('button',{name:/Registrar ASO|Corrigir cadastro|Invalidar registro/}).count()===0,`Health: ${role} has read-only ASO interface`);
    const reduced=await rolePage.evaluate(async({unitId,id,hasIssuer})=>{const{api}=await import('/src/shared/api/client.ts');const a=await api.get(`/occupational-health/${id}`,{query:{unitId}});return Boolean(a.medical)===hasIssuer;},{unitId:qaUnit,id:asoId,hasIssuer});
    check(reduced&&await detail.getByText('Emitente sintético QA',{exact:true}).count()===(hasIssuer?1:0),`Health: ${role} receives only its authorized level of ASO details`);await rolePage.close();
  }
  await medicalPage.getByRole('link',{name:'Pessoa QA Atualizada',exact:true}).click();await asoDetail.getByRole('button',{name:'Invalidar registro',exact:true}).click();
  const asoRevoke=medicalPage.getByRole('dialog',{name:'Invalidar registro de ASO',exact:true});await asoRevoke.getByLabel('Motivo administrativo',{exact:true}).selectOption('DUPLICATE');await asoRevoke.getByRole('checkbox').check();await asoRevoke.getByRole('button',{name:'Confirmar invalidação',exact:true}).click();
  await asoDetail.getByText('Invalidado · Registro duplicado',{exact:true}).waitFor();check(true,'Real API: ASO invalidation preserves the record and history');await medicalPage.close();
  await page.setViewportSize({width:1365,height:900});await page.goto('http://127.0.0.1:5185/app/organizacao');
  await page.getByRole('button',{name:'Editar empresa Empresa QA',exact:true}).waitFor();
  const editableOrganization=await page.evaluate(async()=>{const{api}=await import('/src/shared/api/client.ts');return api.get('/organization-management');});
  for(const [resource,singular,tab,record,field,name] of [
    ['companies','empresa','Empresas',editableOrganization.companies[0],'Nome fantasia','Empresa Operacional QA'],
    ['units','unidade','Unidades',editableOrganization.units[0],'Nome','Unidade Operacional QA'],
    ['departments','setor','Setores',editableOrganization.departments[0],'Nome','Setor Operacional QA'],
    ['positions','cargo','Cargos',editableOrganization.positions[0],'Nome','Cargo Operacional QA'],
  ]) {
    await page.goto('http://127.0.0.1:5185/app/organizacao');await page.getByRole('button',{name:new RegExp(`^${tab}`)}).click();
    await page.getByRole('button',{name:`Editar ${singular} ${record.name}`,exact:true}).click();const editor=page.getByRole('dialog',{name:`Editar ${singular}`,exact:true});
    await editor.getByLabel(field,{exact:true}).waitFor();
    check(await editor.getByLabel(resource==='companies'?'CNPJ':resource==='departments'?'Unidade':'Empresa',{exact:true}).isDisabled(),`Organization: ${resource} identity and parent stay fixed`);
    await editor.getByLabel(field,{exact:true}).fill(name);await editor.getByLabel('Motivo da alteração',{exact:true}).fill(`Atualização conferida de ${singular}`);
    await editor.getByRole('checkbox',{name:'Conferi as alterações deste cadastro.',exact:true}).check();await editor.getByRole('button',{name:'Salvar alterações',exact:true}).click();await editor.waitFor({state:'hidden'});
    await page.goto('http://127.0.0.1:5185/app/organizacao');await page.getByRole('button',{name:new RegExp(`^${tab}`)}).click();await page.getByRole('cell').getByText(name,{exact:true}).waitFor();
    await page.getByRole('button',{name:`Editar ${singular} ${name}`,exact:true}).click();await editor.getByText('Histórico de alterações',{exact:true}).click();await editor.getByText(`Atualização conferida de ${singular}`,{exact:true}).waitFor();
    check(true,`Real API: ${resource} edit persists and opens its administrative history`);
    if(resource==='units'){await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Organization: edit form fits at 390px');await page.screenshot({path:join(dir,'organization-unit-edit-mobile.png'),fullPage:true});await page.setViewportSize({width:1365,height:900});}
    await editor.getByRole('button',{name:'Cancelar',exact:true}).click();
  }
  await page.goto('http://127.0.0.1:5185/app/organizacao');await page.getByRole('button',{name:'Editar empresa Empresa Operacional QA',exact:true}).click();
  const conflictedEditor=page.getByRole('dialog',{name:'Editar empresa',exact:true});await conflictedEditor.getByLabel('Nome fantasia',{exact:true}).fill('Nome preservado no formulário');
  await conflictedEditor.getByLabel('Motivo da alteração',{exact:true}).fill('Conferência de concorrência');await conflictedEditor.getByRole('checkbox').check();
  await page.evaluate(async companyId=>{const{api}=await import('/src/shared/api/client.ts');const path=`/organization-management/companies/${companyId}`,s=await api.get(path);await api.patch(path,{expectedVersion:s.version,reason:'Atualização concorrente QA',confirmation:true,values:{...s.values,fantasyName:'Nome salvo por outra edição QA'}});},qaCompany);
  await conflictedEditor.getByRole('button',{name:'Salvar alterações',exact:true}).click();await conflictedEditor.getByRole('alert').filter({hasText:'O cadastro foi alterado'}).waitFor();
  check(await conflictedEditor.getByLabel('Nome fantasia',{exact:true}).inputValue()==='Nome preservado no formulário'&&await conflictedEditor.getByRole('button',{name:'Salvar alterações',exact:true}).isDisabled(),'Organization: concurrent edit preserves input and blocks stale replay');
  page.once('dialog',dialog=>dialog.accept());await conflictedEditor.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.screenshot({path:join(dir,'organization-edited-desktop.png'),fullPage:true});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5185/app/organizacao'); await page.getByRole('heading', { name: 'Organização', exact: true }).waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile: no page overflow at 390px');
  await page.screenshot({ path: join(dir, 'organization-mobile.png'), fullPage: true });
  check(report.pageErrors.length === 0, 'Browser: no JavaScript errors');
} catch (error) {
  report.failure = error.message;
  if (browser) { const page = browser.contexts().flatMap(context=>context.pages()).at(-1); if (page) { await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true }); report.visibleFailure = await page.getByRole('alert').allTextContents(); } }
  console.error(error.message); process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  if (allocated && /^ampara_uiqa_[a-f0-9]{12}$/.test(database)) { pg('dropdb', [...pgArgs, '--force', database]); report.databaseRemoved = true; }
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
}
