import { describe, expect, it } from 'vitest';
import { addCivilDays, daysUntil, expiryQuery, expiryWindow, positivePage } from './expiry';

describe('consulta preventiva de vencimentos', () => {
  it('conta dias civis ao atravessar ano, ano bissexto e a antiga transição de horário de verão', () => {
    expect(addCivilDays('2026-12-31',7)).toBe('2027-01-07');
    expect(addCivilDays('2024-02-28',2)).toBe('2024-03-01');
    expect(daysUntil('2018-11-05','2018-11-03')).toBe(2);
    expect(daysUntil('2026-10-11','2026-10-11')).toBe(0);
    expect(daysUntil('2026-10-10','2026-10-11')).toBe(-1);
    expect(daysUntil('2026-02-30','2026-10-11')).toBeUndefined();
  });
  it('usa situação vigente e intervalo inclusivo para próximos vencimentos', () => {
    expect(expiryQuery(new URLSearchParams('days=7&q=%20PGR%20'),'2026-10-11')).toEqual({status:'ACTIVE',validUntilFrom:'2026-10-11',validUntilTo:'2026-10-18',q:'PGR'});
    expect(expiryQuery(new URLSearchParams('view=expired&days=90'),'2026-10-11')).toEqual({status:'EXPIRED'});
  });
  it.each(['Infinity','1.5','0','-1','9007199254740992','abc'])('normaliza página inválida %s', value => expect(positivePage(value)).toBe(1));
  it('aceita apenas janelas de consulta previstas e limita o termo da URL', () => {
    expect(expiryWindow('365')).toBe(30);
    expect(expiryWindow('90')).toBe(90);
    expect(expiryQuery(new URLSearchParams({q:'x'.repeat(250)}),'2026-10-11').q).toHaveLength(200);
    expect(() => addCivilDays('2026-02-30',7)).toThrow('Data civil inválida.');
  });
});
