import { describe, expect, it } from 'vitest';
import { consultationResults } from './consultation-results';

describe('paginação compatível da consulta', () => {
  it('pagina uma resposta legada sem repetir os registros em todas as páginas', () => {
    const data = Array.from({ length: 23 }, (_, index) => index);
    expect(consultationResults(data, 2)).toEqual({ items: data.slice(10, 20), total: 23, page: 2, pageSize: 10 });
    expect(consultationResults(data, 3).items).toEqual([20, 21, 22]);
  });
  it('preserva o tamanho e os registros de uma resposta já paginada pela API', () => {
    const data = { items: [22, 23], total: 23, page: 12, pageSize: 2 };
    expect(consultationResults(data, 12)).toBe(data);
  });
});
