import { describe, expect, it } from 'vitest';
import { agendaReturnSearch, permitAgendaDestination, permitAgendaNavigation, type PermitAgendaNavigation } from './permit-agenda-navigation';

const search = '?q=Equipe+Jo%C3%A3o&status=ATTENDANCE_OPENED&teamId=team-a&responsibleId=operator-a&serviceTypeId=service-a&location=Galp%C3%A3o+2&from=2026-10-01&to=2026-10-31&eligibility=blocked&order=TEAM&view=calendar&calendarMode=week&calendarDate=2026-10-19&day=2026-10-20';
const value: PermitAgendaNavigation['permitAgendaReturnTo'] = { permitId: 'permit-a', appointmentId: 'appointment-a', unitId: 'unit-a', sessionKey: 'session-a', source: 'agenda', search };
const origin: PermitAgendaNavigation = { permitAgendaReturnTo: value };
const read = (state: unknown) => permitAgendaNavigation(state, 'session-a', 'unit-a', 'permit-a');

describe('consulta de retorno à agenda', () => {
  it.each(['', '?', '?q=Setor%23A', '?location=Pasta%5CBloco', '?q=Servi%C3%A7o+com+espa%C3%A7os', '?unitId=unit-a', search, '?view=list&calendarMode=month&calendarDate=2026-10-19&day=none', '?calendarDate=2026-10-19&day=2026-10-20', '?from=2024-02-29&to=2024-02-29', '?to=2026-10-19', '?order=START_ASC', '?order=START_DESC', '?status=REQUESTED', '?status=CONFIRMED', '?status=CANCELED'])('preserva exatamente a consulta válida %s', query => {
    expect(agendaReturnSearch(query, 'unit-a')).toBe(query);
  });
  it.each([
    undefined, null, [], {}, 1, 'q=Equipe', '/app/agenda?q=Equipe', 'https://example.test', '//example.test',
    '?q=Espaço literal', '?q=a\n', '?q=a#b', '?q=a\\b', '?q=%00', '?q=%0A', '?q=%7F', '?q=%', '?q=%GG', '?q=%C3',
    '?unitId=other', '?unitId=', '?unitId=unit-a&unitId=unit-a', '?q=a&q=b', '?%71=a&q=b', '?q=a&unknown=b', '?tab=permits', '?page=2',
    '?status=UNKNOWN', '?status=', '?status=__proto__', '?status=toString', '?eligibility=ready', '?eligibility=', '?order=', '?order=__proto__', '?order=TEAM&order=TEAM',
    '?view=year', '?view=', '?calendarMode=day', '?calendarMode=', '?calendarDate=2026-02-30', '?calendarDate=', '?day=2026-02-30', '?day=',
    '?from=2026-10-20&to=2026-10-19', '?from=2025-02-29', '?to=', '?from=2026-10-19T00:00:00Z',
    '?teamId=team/a', '?teamId=', '?responsibleId=..', '?serviceTypeId=%2F', `?q=${'a'.repeat(2001)}`, `?location=${'a'.repeat(2001)}`, `?q=${'a'.repeat(4096)}`,
  ])('rejeita a consulta inválida %j', query => { expect(agendaReturnSearch(query, 'unit-a')).toBeUndefined(); });
  it('exige a unidade ativa mesmo na consulta vazia', () => {
    expect(agendaReturnSearch('', undefined)).toBeUndefined();
  });
});

describe('retorno da PT à origem operacional', () => {
  it('preserva agenda, filtros e calendário usando destino fixo e remove campos desconhecidos', () => {
    const result = read({ permitAgendaReturnTo: { ...value, pathname: 'https://example.test', fromConsulta: true, extra: true }, ignored: true });
    expect(result).toEqual(origin);
    expect(permitAgendaDestination(result!)).toEqual({ to: `/app/agenda${search}`, label: 'Voltar à agenda', state: undefined });
  });
  it('retorna ao atendimento com sua consulta da agenda preservada', () => {
    const result = read({ permitAgendaReturnTo: { ...value, source: 'appointment' } });
    expect(permitAgendaDestination(result!)).toEqual({ to: '/app/agenda/appointment-a', label: 'Voltar ao atendimento', state: { fromSearch: search } });
  });
  it.each([
    null, [], {}, { permitAgendaReturnTo: [] }, { fromConsulta: true, fromSearch: search },
    ...[{ unitId: 'unit-b' }, { sessionKey: 'session-b' }, { permitId: 'permit-b' }, { appointmentId: '' }, { appointmentId: '..' }, { appointmentId: 'appointment/a' }, { appointmentId: '%2F' }, { appointmentId: 'https://example.test' }, { appointmentId: 'a'.repeat(201) }, { source: 'consultation' }, { source: null }, { search: '?tab=permits' }].map(change => ({ permitAgendaReturnTo: { ...value, ...change } })),
  ])('descarta origem malformada ou incompatível %j', state => { expect(read(state)).toBeUndefined(); });
  it('revalida a permissão, sessão, unidade, PT e atendimento carregado', () => {
    expect(permitAgendaNavigation(origin, 'session-a', 'unit-a', 'permit-a', false)).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-b', 'unit-a', 'permit-a')).toBeUndefined();
    expect(permitAgendaNavigation(origin, '', 'unit-a', 'permit-a')).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-a', 'unit-b', 'permit-a')).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-a', undefined, 'permit-a')).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-a', 'unit-a', 'permit-b')).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-a', 'unit-a', undefined)).toBeUndefined();
    expect(permitAgendaNavigation({ permitAgendaReturnTo: { ...value, permitId: '../permit' } }, 'session-a', 'unit-a', '../permit')).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-a', 'unit-a', 'permit-a', true, true, 'appointment-b')).toBeUndefined();
    expect(permitAgendaNavigation(origin, 'session-a', 'unit-a', 'permit-a', true, true, 'appointment-a')).toEqual(origin);
  });
  it('preserva a origem de pendências apenas no atendimento e sanitiza seu estado', () => {
    const readinessReturnTo = { unitId: 'unit-a', search: '?unitId=unit-a&q=Jo%C3%A3o&status=pending&teamId=team-a' };
    const state = { permitAgendaReturnTo: { ...value, source: 'appointment', readinessReturnTo: { ...readinessReturnTo, pathname: '/app/pendencias', ignored: true } } };
    const result = read(state);
    expect(result?.permitAgendaReturnTo.readinessReturnTo).toEqual(readinessReturnTo);
    expect(permitAgendaDestination(result!)).toEqual({ to: '/app/agenda/appointment-a', label: 'Voltar ao atendimento', state: { fromSearch: search, readinessReturnTo } });
    expect(read({ permitAgendaReturnTo: { ...value, readinessReturnTo } })?.permitAgendaReturnTo).not.toHaveProperty('readinessReturnTo');
    expect(permitAgendaNavigation(state, 'session-a', 'unit-a', 'permit-a', true, false)?.permitAgendaReturnTo).not.toHaveProperty('readinessReturnTo');
  });
  it.each([
    null, [], { unitId: 'unit-b', search: '?unitId=unit-b' }, { unitId: 'unit-a', search: '?q=Equipe' },
    { unitId: 'unit-a', search: '?unitId=unit-a&status=UNKNOWN' }, { unitId: 'unit-a', search: '?unitId=unit-a&unitId=unit-a' },
    { unitId: 'unit-a', search: 'https://example.test' }, { unitId: 'unit-a', search: '?unitId=unit-a', pathname: '//example.test' },
  ])('remove pendências inválidas sem perder o atendimento autorizado %j', readinessReturnTo => {
    const result = read({ permitAgendaReturnTo: { ...value, source: 'appointment', readinessReturnTo } });
    expect(result).toEqual({ permitAgendaReturnTo: { ...value, source: 'appointment' } });
    expect(permitAgendaDestination(result!).to).toBe('/app/agenda/appointment-a');
  });
});
