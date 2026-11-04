import { describe, expect, it } from 'vitest';
import { getDemoAccessUrl } from './demo-access';

const current = 'https://app.example.invalid/login';

describe('endereço explícito da demonstração', () => {
  it('preserva o destino HTTPS configurado e abre os perfis de demonstração', () => {
    const value = getDemoAccessUrl(' https://demo.example.invalid/login?lang=pt-BR ', current);
    const destination = new URL(value!);
    expect(destination.origin).toBe('https://demo.example.invalid');
    expect(destination.pathname).toBe('/login');
    expect(destination.searchParams.get('lang')).toBe('pt-BR');
    expect(destination.searchParams.getAll('demonstracao')).toEqual(['perfis']);
  });

  it('substitui parâmetros repetidos sem copiar dados da página de origem', () => {
    const destination = new URL(getDemoAccessUrl('https://demo.example.invalid/login?demonstracao=antiga&demonstracao=outra', `${current}?email=private%40example.invalid#token=private`)!);
    expect(destination.searchParams.getAll('demonstracao')).toEqual(['perfis']);
    expect(destination.searchParams.has('email')).toBe(false);
    expect(destination.hash).toBe('');
  });

  it.each([
    'http://localhost:5173/login',
    'http://127.0.0.1:5173/login',
    'http://127.0.0.2:5173/login',
    'http://[::1]:5173/login',
  ])('permite uma instância HTTP em loopback: %s', configured => {
    expect(getDemoAccessUrl(configured, 'http://127.0.0.1:5175/login')).toBe(`${configured}?demonstracao=perfis`);
  });

  it.each([
    undefined, null, true, 5173, {}, '', '   ',
    '/login', '//demo.example.invalid/login', 'not a URL',
    'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/login',
    'http://demo.example.invalid/login', 'http://localhost.example.invalid/login',
    'http://127.0.0.1.example.invalid/login',
    'https://user:password@demo.example.invalid/login',
    'https://user@demo.example.invalid/login',
    'https://:password@demo.example.invalid/login',
    'https://app.example.invalid/login',
    'https://app.example.invalid/login?demonstracao=perfis',
    'https://app.example.invalid:443/demonstracao',
  ])('recusa configuração ausente, insegura ou na origem da API: %j', configured => {
    expect(getDemoAccessUrl(configured, current)).toBeUndefined();
  });

  it('recusa uma página de origem que não pode ser validada', () => {
    expect(getDemoAccessUrl('https://demo.example.invalid/login', 'not a URL')).toBeUndefined();
    expect(getDemoAccessUrl('https://demo.example.invalid/login', 'javascript:alert(1)')).toBeUndefined();
  });
});
