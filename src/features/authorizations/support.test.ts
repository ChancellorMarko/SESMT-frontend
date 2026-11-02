import { describe, expect, it } from 'vitest';
import { authorizationWindowError } from './support';

describe('Período declarado para autorização da AT', () => {
  const appointment = { startsAt: '2026-10-11T12:00:00Z', endsAt: '2026-10-11T18:00:00Z' };
  const now = Date.parse('2026-10-11T13:00:00Z');
  it('admite o término previsto e rejeita ultrapassar o atendimento', () => {
    expect(authorizationWindowError(appointment.endsAt, appointment, now)).toBeUndefined();
    expect(authorizationWindowError('2026-10-11T18:01:00Z', appointment, now)).toMatch(/ultrapassar/);
  });
  it('exige fim posterior ao horário atual e ao início futuro do atendimento', () => {
    expect(authorizationWindowError('2026-10-11T13:00:00Z', appointment, now)).toMatch(/posterior/);
    expect(authorizationWindowError('2026-10-11T12:00:00Z', appointment, Date.parse('2026-10-11T11:00:00Z'))).toMatch(/posterior/);
    expect(authorizationWindowError('2026-10-11T14:00:00Z', appointment, now)).toBeUndefined();
  });
  it('explica o atendimento já terminado e não presume datas inválidas', () => {
    expect(authorizationWindowError(appointment.endsAt, appointment, Date.parse(appointment.endsAt))).toMatch(/já terminou/);
    expect(authorizationWindowError('data inválida', appointment, now)).toMatch(/Confira/);
    expect(authorizationWindowError(appointment.endsAt, { ...appointment, startsAt: appointment.endsAt }, now)).toMatch(/Confira/);
  });
});
