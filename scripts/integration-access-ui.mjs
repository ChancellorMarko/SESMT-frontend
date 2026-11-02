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
  await page.getByRole('button', { name: /Unidades/ }).click(); await page.getByRole('cell', { name: /Unidade QA/ }).waitFor();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5185/app/organizacao'); await page.getByRole('heading', { name: 'Organização', exact: true }).waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile: no page overflow at 390px');
  await page.screenshot({ path: join(dir, 'organization-mobile.png'), fullPage: true });
  check(report.pageErrors.length === 0, 'Browser: no JavaScript errors');
} catch (error) {
  report.failure = error.message;
  if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true }); report.visibleFailure = await page.getByRole('alert').allTextContents(); } }
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
