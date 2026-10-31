import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));

/** The API is owned by its separate repository, including when a worktree is used. */
export function resolveBackendRoot(settings = {}, workspace = frontendRoot) {
  const candidate = resolve(workspace, settings.SESMT_BACKEND_PATH || '../SESMT-backend');
  if (!existsSync(candidate)) throw new Error('Clone o repositório SESMT-backend ao lado do frontend ou configure SESMT_BACKEND_PATH em .env.integration.local.');
  const backend = realpathSync(candidate);
  const insideFrontend = relative(realpathSync(workspace), backend);
  if (insideFrontend !== '..' && !insideFrontend.startsWith(`..${sep}`) && !isAbsolute(insideFrontend))
    throw new Error('O backend deve estar em um repositório separado, fora da pasta do frontend.');
  for (const entry of ['.git', 'SESMT.slnx', 'SESMT.API/SESMT.API.csproj', 'SESMT.Infrastructure/SESMT.Infrastructure.csproj']) {
    if (!existsSync(join(backend, entry))) throw new Error(`Repositório backend incompleto: ${entry} ausente. Confira SESMT_BACKEND_PATH.`);
  }
  return backend;
}
