import { describe, expect, it } from 'vitest';
import { resolveAuthContract } from './auth-contract';

describe('contrato de autenticação por ambiente', () => {
  it.each([undefined, '', 'native', 'unrecognized'])('modo API usa os caminhos nativos por padrão: %s', configured => {
    expect(resolveAuthContract('api', configured)).toEqual({
      kind: 'native', mePath: '/auth/me', forgotPasswordPath: '/auth/forgot-password', resetPasswordPath: '/auth/reset-password',
    });
  });

  it('o adaptador de desenvolvimento precisa ser selecionado explicitamente em modo API', () => {
    expect(resolveAuthContract('api', 'adapter')).toEqual({
      kind: 'adapter', mePath: '/me', forgotPasswordPath: '/auth/password/forgot', resetPasswordPath: '/auth/password/reset',
    });
  });

  it.each([undefined, 'native', 'adapter'])('demonstração continua com o contrato dos dados sintéticos: %s', configured => {
    expect(resolveAuthContract('demo', configured)).toEqual(resolveAuthContract('api', 'adapter'));
  });
});
