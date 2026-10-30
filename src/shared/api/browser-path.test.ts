import { describe, expect, it } from 'vitest';
import { resolveApiPath } from './browser-path';

describe('rotas do adaptador na API oficial', () => {
  it.each(['/auth/login', '/auth/csrf', '/auth/refresh', '/auth/logout', '/me', '/organization', '/workers/123/movements', '/documents/123/versions', '/document-types/123'])('encaminha %s à projeção de navegador', path => {
    expect(resolveApiPath(path, 'api', '/browser')).toBe(`/browser${path}`);
  });
  it.each(['/dashboard', '/work-permits', '/workers-extra', '/browser/me', '/auth/mfa/verify'])('preserva outro contrato: %s', path => {
    expect(resolveApiPath(path, 'api', '/browser')).toBe(path);
  });
  it('usa os comandos de senha nativos sem repetir comandos em outra rota', () => {
    expect(resolveApiPath('/auth/password/forgot', 'api', '/browser')).toBe('/auth/forgot-password');
    expect(resolveApiPath('/auth/password/reset', 'api', '/browser')).toBe('/auth/reset-password');
  });
  it.each(['demo', 'api'])('mantém ambientes sem prefixo explícito: %s', mode => {
    expect(resolveApiPath('/auth/login', mode)).toBe('/auth/login');
    expect(resolveApiPath('/me', mode)).toBe('/me');
  });
  it('a demonstração nunca usa a API de navegador', () => {
    expect(resolveApiPath('/documents', 'demo', '/browser')).toBe('/documents');
  });
});
