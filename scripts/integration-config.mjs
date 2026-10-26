import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const localConfig = new URL('../.env.integration.local', import.meta.url);
export function integrationEnv() {
  let values;
  try { values = parseEnv(readFileSync(localConfig, 'utf8')); }
  catch { throw new Error('Execute npm run integration:setup para criar a configuração local.'); }
  for (const name of ['ConnectionStrings__Sesmt', 'Jwt__SigningKey', 'Seed__AdminEmail', 'Seed__AdminPassword']) {
    if (!values[name]) throw new Error(`Configure ${name} em .env.integration.local.`);
  }
  return {
    ...process.env, ...values,
    ASPNETCORE_ENVIRONMENT: 'Development',
    ASPNETCORE_URLS: 'http://127.0.0.1:5047',
    VITE_API_MODE: 'api', VITE_API_BASE_URL: '/api/v1',
    VITE_ACCOUNT_INVITATIONS_ENABLED: 'false',
    API_PROXY_TARGET: 'http://127.0.0.1:5047',
  };
}
