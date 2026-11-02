import { describe, expect, it } from 'vitest';
import { checkedRecoveryMessage, passwordResetTokenFromHash, validPasswordResetToken } from './password-recovery';

describe('link de recuperação de senha', () => {
  it('preserva o token base64url nativo sem normalizar maiúsculas ou caracteres', () => {
    const token = 'Aa0_-'.repeat(17) + 'Z';
    expect(token).toHaveLength(86);
    expect(passwordResetTokenFromHash(`#token=${encodeURIComponent(token)}`)).toEqual({ token, invalid: false });
    expect(validPasswordResetToken('demo-reset')).toBe(true);
  });

  it.each(['', '#', '#ajuda', '#section=senha', '?token=token-na-query'])('distingue a ausência do token de um link inválido: %s', hash => {
    expect(passwordResetTokenFromHash(hash)).toEqual({ token: '', invalid: false });
  });

  it.each([
    '#token=', '#token=first&token=second', '#token=same&%74oken=same',
    '#token=%20secret', '#token=secret%20', '#token=secret+value',
    '#token=secret%09value', '#token=secret%00value', '#token=secret%7Fvalue',
    '#token=%E0%A4%A', '#token=%ZZ', '#token=has%2Fslash', '#token=has%2Bequals%3D',
    `#token=${'a'.repeat(513)}`,
  ])('recusa token inválido ou ambíguo: %s', hash => {
    expect(passwordResetTokenFromHash(hash)).toEqual({ token: '', invalid: true });
  });

  it('aceita o limite de tamanho e não remove espaços do segredo fornecido', () => {
    expect(validPasswordResetToken('a'.repeat(512))).toBe(true);
    expect(validPasswordResetToken('a'.repeat(513))).toBe(false);
    expect(validPasswordResetToken(' demo-reset')).toBe(false);
    expect(validPasswordResetToken('demo-reset ')).toBe(false);
  });

  it('é uma leitura pura e não altera o endereço ou histórico do navegador', () => {
    const before = { href: window.location.href, length: history.length };
    passwordResetTokenFromHash('#token=demo-reset');
    expect(window.location.href).toBe(before.href);
    expect(history.length).toBe(before.length);
  });
});

describe('confirmação pública de recuperação', () => {
  it('exibe a mesma orientação pública para respostas válidas diferentes', () => {
    const generic = checkedRecoveryMessage({ message: 'Solicitação recebida.' });
    expect(checkedRecoveryMessage({ message: 'Identidade encontrada.' })).toBe(generic);
    expect(generic).toContain('Se houver uma conta');
  });

  it.each([
    undefined, null, '', [], {}, { message: 123 }, { message: '' }, { message: '   ' },
    { message: 'x'.repeat(501) }, { message: 'Texto\u0000inválido' }, { message: 'Texto\ninválido' },
  ])('não confirma sucesso com resposta fora do contrato: %j', value => {
    expect(() => checkedRecoveryMessage(value)).toThrow('Não foi possível confirmar a solicitação.');
  });
});
