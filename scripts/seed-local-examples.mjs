import { integrationEnv, root } from './integration-config.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = integrationEnv();
const parts = Object.fromEntries(env.ConnectionStrings__Sesmt.split(';').filter(Boolean).map(part => { const at = part.indexOf('='); return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()]; }));
const preview = join(root, '.local/fullstack-preview/credentials.json');
const state = existsSync(preview) ? JSON.parse(readFileSync(preview, 'utf8')) : { database: parts.database, email: env.Seed__AdminEmail, password: env.Seed__AdminPassword };
if (!state || !/^ampara_fullstack_preview_[0-9]{8}$/.test(state.database) || typeof state.email !== 'string')
  throw new Error('Inicie primeiro a prévia local integrada com seu banco separado. A carga não usa o banco original da equipe.');
if (parts.host !== '127.0.0.1' || parts.port !== '5434') throw new Error('A carga exige o cluster local da prévia.');
const dir = join(root, '.local/fullstack-preview'), accessPath = join(dir, 'example-access.json');
mkdirSync(dir, { recursive: true });
const previous = existsSync(accessPath) ? JSON.parse(readFileSync(accessPath, 'utf8')) : null;
if (previous && previous.database !== state.database) throw new Error('As credenciais de exemplos pertencem a outro banco.');
const credentialKnown = typeof previous?.password === 'string' && previous.password.length >= 16;
const password = credentialKnown ? previous.password : `Exemplo!${randomBytes(12).toString('hex')}`;
// Persist a new candidate before the transaction, so interruption cannot lose its password.
// The API verifies the candidate against existing hashes before it is advertised as usable.
if (!previous) writeFileSync(accessPath, JSON.stringify({ database: state.database, password, pending: true, accounts: [] }, null, 2), { mode: 0o600, flag: 'wx' });
const bundledPg = join(root, '.local/tools/postgresql-17.11/pgsql/bin');
const pgBin = process.env.PG_BIN_DIR || (existsSync(bundledPg) ? bundledPg : '');
const backupDir = join(root, '.local/backups'); mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `${state.database}-before-examples-${Date.now()}.dump`);
const dump = spawnSync(join(pgBin, `pg_dump${process.platform === 'win32' ? '.exe' : ''}`), ['-h', parts.host, '-p', parts.port, '-U', parts.username, '-d', state.database, '-Fc', '-f', backup],
  { cwd: root, env: { ...process.env, PGPASSWORD: parts.password }, encoding: 'utf8', windowsHide: true });
if (dump.status !== 0 || dump.error) throw new Error('Não foi possível concluir o backup; a carga não foi executada.');
Object.assign(env, { ConnectionStrings__Sesmt: env.ConnectionStrings__Sesmt.replace(/Database=[^;]*/i, `Database=${state.database}`),
  Seed__AdminEmail: state.email, Seed__AdminPassword: state.password, Seed__AdminName: 'Administrador local',
  SESMT_SEED_EXAMPLES: '1', SESMT_EXAMPLE_PASSWORD: password, Storage__Local__RootPath: join(dir, 'storage') });
const build = spawnSync('dotnet', ['build', 'backend/SESMT.API/SESMT.API.csproj', '-c', 'Release', '--nologo', '--verbosity', 'quiet'], { cwd: root, env, encoding: 'utf8', windowsHide: true });
if (build.status !== 0 || build.error) throw new Error('A compilação da API falhou; a carga não foi executada.');
const child = spawn('dotnet', ['backend/SESMT.API/bin/Release/net10.0/SESMT.API.dll'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
writeFileSync(join(dir, 'example-seed.log'), output);
if (exitCode !== 0) throw new Error('A carga foi interrompida; consulte .local/fullstack-preview/example-seed.log. Nenhum cadastro anterior é substituído.');
const line = output.split(/\r?\n/).find(text => text.startsWith('EXAMPLE_SEED_RESULT:'));
if (!line) throw new Error('A API não confirmou a conclusão da carga.');
const result = JSON.parse(line.slice('EXAMPLE_SEED_RESULT:'.length));
if (result.CompanyId !== 'e76a12c0-20aa-4d00-8000-000000000001') throw new Error('O recibo pertence a outro conjunto.');
const access = { database: state.database, companyId: result.CompanyId, password: result.CredentialsMatch ? password : null, accounts: result.Accounts };
writeFileSync(accessPath, JSON.stringify(access, null, 2), { mode: 0o600 });
writeFileSync(join(dir, 'example-seed-report.json'), JSON.stringify({ ...result, backup }, null, 2));
console.log(JSON.stringify({ alreadyPresent: result.AlreadyPresent, users: result.Users, workers: result.Workers, units: result.Units, teams: result.Teams, documents: result.Documents, appointments: result.Appointments, permits: result.Permits, credentialsFile: '.local/fullstack-preview/example-access.json' }));
