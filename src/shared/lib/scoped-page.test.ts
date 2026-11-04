import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { checkedPage, isRecord, isSafePage, ScopedPageError, scopedQueryError, shortText } from './scoped-page';

const expected = { page: 1, pageSize: 20 };
const valid = { items: [{ id: 'record-a', label: 'Registro permitido' }], total: 1, ...expected };
const record = (item: unknown): item is { id: string; label: string } => isRecord(item) && shortText(item.id) && shortText(item.label);

describe('respostas paginadas de consultas por contexto', () => {
  it('preserva a página recebida sem paginar novamente e aceita página vazia para recuperação', () => {
    expect(checkedPage(valid, expected, record)).toBe(valid);
    expect(checkedPage({ items: [], total: 1, page: 9, pageSize: 20 }, { page: 9, pageSize: 20 }, record).items).toEqual([]);
  });
  it.each([
    undefined, null, [], { ...valid, items: {} }, { ...valid, page: 2 }, { ...valid, pageSize: 0 }, { ...valid, pageSize: 10 },
    { ...valid, total: -1 }, { ...valid, total: Infinity }, { ...valid, total: 0.5 }, { ...valid, total: '1' },
    { ...valid, total: 0 }, { ...valid, items: Array.from({ length: 21 }, (_, index) => ({ id: `r-${index}`, label: 'Registro' })), total: 21 },
    { ...valid, items: [valid.items[0], valid.items[0]], total: 2 },
    ...['', ' ', 'bad/id', 'bad?query', 'bad#fragment', 'bad\\id'].map(id => ({ ...valid, items: [{ id, label: 'Registro' }] })),
    { ...valid, items: [{ id: 'record-a', label: 7 }] },
  ])('rejeita contrato inválido sem expor os registros: %j', value => {
    expect(() => checkedPage(value, expected, record)).toThrow(ScopedPageError);
  });
  it('não aceita metadados que excedam o total a partir da página solicitada', () => {
    expect(() => checkedPage({ ...valid, page: 2 }, { ...expected, page: 2 }, record)).toThrow(ScopedPageError);
  });
  it.each([null, '1', '2', '100'])('aceita a página %s', raw => expect(isSafePage(raw)).toBe(true));
  it.each(['', '0', '-1', '1.5', '01', 'Infinity', 'NaN', '9007199254740992', String(Number.MAX_SAFE_INTEGER)])('bloqueia a página %s', raw => expect(isSafePage(raw)).toBe(false));
  it.each([401, 403, 404])('não revela a mensagem restrita da resposta %s', status => {
    const message = scopedQueryError(new ApiError(status, { code: 'UNAVAILABLE', message: 'Nome restrito de outra unidade', requestId: 'trace' }), 'notificações');
    expect(message).not.toContain('Nome restrito');
    expect(message).toMatch(/sessão|acesso|indisponível/);
  });
  it('preserva uma falha de conexão explicável e oferece fallback para erros sem mensagem', () => {
    expect(scopedQueryError(new Error('Conexão indisponível.'), 'eventos')).toBe('Conexão indisponível.');
    expect(scopedQueryError(undefined, 'eventos')).toContain('Não foi possível consultar eventos');
  });
});
