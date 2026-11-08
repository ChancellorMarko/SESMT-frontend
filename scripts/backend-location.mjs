import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_BACKEND_PATH = '../SESMT-backend';

/** Resolve the official SESMT-backend checkout; embedded copies inside the frontend are refused. */
export function resolveBackendRoot(settings = {}, workspace = frontendRoot) {
  const candidate = resolve(workspace, settings.SESMT_BACKEND_PATH || DEFAULT_BACKEND_PATH);
  if (!existsSync(candidate)) throw new Error(`Backend não encontrado em ${candidate}. Clone o SESMT-backend ao lado do frontend ou configure SESMT_BACKEND_PATH.`);
  const backend = realpathSync(candidate);
  const insideFrontend = relative(realpathSync(workspace), backend);
  if (insideFrontend === '' || insideFrontend !== '..' && !insideFrontend.startsWith(`..${sep}`) && !isAbsolute(insideFrontend))
    throw new Error('O backend deve ser o repositório SESMT-backend fora da pasta do frontend; cópias embutidas não são aceitas.');
  const entries = ['.git', 'SESMT.slnx', ...['API', 'Application', 'Domain', 'Infrastructure', 'Tests'].map(name => `SESMT.${name}/SESMT.${name}.csproj`)];
  for (const entry of entries) {
    if (!existsSync(join(backend, entry))) throw new Error(`Repositório backend incompleto: ${entry} ausente. Confira SESMT_BACKEND_PATH.`);
  }
  return backend;
}
