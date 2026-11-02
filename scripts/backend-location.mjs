import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));

/** Prefer the API bundled in this branch; preserve explicit external worktrees. */
export function resolveBackendRoot(settings = {}, workspace = frontendRoot) {
  const fallback = existsSync(join(workspace, 'backend', 'SESMT.slnx')) ? 'backend' : '../SESMT-backend';
  const candidate = resolve(workspace, settings.SESMT_BACKEND_PATH || fallback);
  if (!existsSync(candidate)) throw new Error('Confira a pasta backend desta branch ou configure SESMT_BACKEND_PATH para um repositório externo.');
  const backend = realpathSync(candidate);
  const insideFrontend = relative(realpathSync(workspace), backend);
  const bundled = insideFrontend === 'backend';
  if (!bundled && insideFrontend !== '..' && !insideFrontend.startsWith(`..${sep}`) && !isAbsolute(insideFrontend))
    throw new Error('A cópia interna da API deve ficar na pasta backend; outras cópias precisam estar fora da pasta do frontend.');
  const entries = ['SESMT.slnx', ...['API', 'Application', 'Domain', 'Infrastructure', 'Tests'].map(name => `SESMT.${name}/SESMT.${name}.csproj`)];
  if (!bundled) entries.unshift('.git');
  for (const entry of entries) {
    if (!existsSync(join(backend, entry))) throw new Error(`Repositório backend incompleto: ${entry} ausente. Confira SESMT_BACKEND_PATH.`);
  }
  return backend;
}
