import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { integrationEnv, localConfig, root } from './integration-config.mjs';
import { resolveBackendRoot } from './backend-location.mjs';

const children = new Set();
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
function run(command, args, env, background = false, cwd = root) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  const done = new Promise((resolve, reject) => {
    child.once('spawn', () => children.add(child));
    child.once('error', () => reject(new Error(`Não foi possível executar ${command}. Confira os requisitos em INTEGRACAO.md.`)));
    child.once('exit', code => { children.delete(child); code === 0 || stopping ? resolve() : reject(new Error(`${command} terminou com código ${code}.`)); });
  });
  if (background) {
    void done.then(() => { if (!stopping) shutdown(1); }, error => { console.error(error.message); shutdown(1); });
    return child;
  }
  return done;
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`A porta ${port} está ocupada. Encerre o processo que a utiliza antes de iniciar a integração.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function databaseAvailable(connection) {
  const parts = Object.fromEntries(connection.split(';').filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
  }));
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: parts.host || '127.0.0.1', port: Number(parts.port || 5432) });
    const fail = () => { socket.destroy(); reject(new Error('PostgreSQL indisponível. Inicie o banco com npm run integration:db ou configure um banco local em .env.integration.local.')); };
    socket.setTimeout(2000, fail);
    socket.once('error', fail);
    socket.once('connect', () => { socket.destroy(); resolve(); });
  });
}
async function main() {
  const action = process.argv[2];
  if (action === 'setup') {
    if (existsSync(localConfig)) { console.log('Configuração local já existe; nenhum valor foi alterado.'); return; }
    const databasePassword = randomBytes(24).toString('hex');
    writeFileSync(localConfig, [
      '# Exclusivo do ambiente de integração local. Não versionar.',
      'SESMT_BACKEND_PATH=backend',
      `INTEGRATION_DB_PASSWORD=${databasePassword}`,
      `ConnectionStrings__Sesmt=Host=127.0.0.1;Port=5434;Database=ampara_integration;Username=ampara;Password=${databasePassword}`,
      `Jwt__SigningKey=${randomBytes(48).toString('hex')}`,
      'Jwt__Issuer=SESMT.API', 'Jwt__Audience=SESMT.Client',
      'Seed__AdminEmail=admin@ampara.local', 'Seed__AdminName=Administrador local',
      `Seed__AdminPassword=${randomBytes(24).toString('base64url')}aA1!`,
      'Storage__Local__RootPath=.local/storage', '',
    ].join('\n'), { flag: 'wx', mode: 0o600 });
    console.log(`Configuração criada em ${fileURLToPath(localConfig)}. Consulte nesse arquivo as credenciais locais do administrador.`);
    return;
  }
  const env = integrationEnv();
  // Select the API in this branch even when an older local file points elsewhere.
  if (process.argv.includes('--bundled')) env.SESMT_BACKEND_PATH = 'backend';
  if (action === 'db') {
    await run('docker', ['compose', '--env-file', '.env.integration.local', '-f', 'compose.integration.yml', 'up', '-d', '--wait', 'database'], env);
    return;
  }
  const backendRoot = resolveBackendRoot(env);
  const infrastructure = join(backendRoot, 'SESMT.Infrastructure');
  const startup = join(backendRoot, 'SESMT.API');
  if (action === 'test') {
    await run('dotnet', ['test', join(backendRoot, 'SESMT.slnx'), '--nologo'], env, false, backendRoot);
    return;
  }
  if (action === 'schema') {
    await run('dotnet', ['tool', 'restore'], env);
    await run('dotnet', ['ef', 'migrations', 'has-pending-model-changes', '--project', infrastructure, '--startup-project', startup], env);
    return;
  }
  if (!['dev', 'migrate'].includes(action)) throw new Error('Ação esperada: setup, db, migrate, schema ou dev.');
  await databaseAvailable(env.ConnectionStrings__Sesmt);
  if (action === 'migrate') {
    await run('dotnet', ['tool', 'restore'], env);
    await run('dotnet', ['ef', 'database', 'update', '--project', infrastructure, '--startup-project', startup], env);
    return;
  }
  await freePort(5047); await freePort(5175);
  console.log(`Backend selecionado: ${backendRoot}`);
  run('dotnet', ['run', '--project', startup, '--no-launch-profile'], env, true, backendRoot);
  let ready = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try { const response = await fetch('http://127.0.0.1:5047/health', { signal: AbortSignal.timeout(1000) }); ready = response.ok; } catch { /* API ainda iniciando. */ }
    if (ready) break;
    await delay(500);
  }
  if (stopping) return;
  if (!ready) throw new Error('A API não iniciou. Confira a configuração e execute npm run integration:migrate antes de tentar novamente.');
  run(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort', '--mode', 'integration'], env, true);
  console.log('Ampara integrado: http://127.0.0.1:5175/login · API http://127.0.0.1:5047 · Ctrl+C encerra os dois.');
}
main().catch(error => { console.error(error.message); shutdown(1); });
