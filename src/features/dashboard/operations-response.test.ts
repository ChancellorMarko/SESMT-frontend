import { describe, expect, it } from 'vitest';
import { ScopedPageError } from '../../shared/lib/scoped-page';
import { checkedOperationsDashboard, checkedOperationsOptions, OperationsResponseError } from './operations-response';

const criteria = { unitId: 'unit-a', from: '', to: '', teamId: '', serviceId: '', location: '' };
const appointment = () => ({
  id: 'appointment-a', unitId: 'unit-a', teamId: 'team-a', serviceTypeId: 'service-a', serviceTypeIds: ['service-a', 'service-b'],
  code: 'AG 123', teamName: 'Equipe Alfa', serviceLabel: 'Altura e eletricidade', responsibleName: 'Técnica Demo',
  location: 'Pátio   de Inspeção', startsAt: '2026-10-18T01:00:00Z', endsAt: '2026-10-18T04:00:00Z', status: 'CONFIRMED',
});
const permit = () => ({ id: 'permit-a', code: 'PT 123', operationStatus: 'COMPLETED', reviewStatus: 'PENDING_REVIEW', version: 1, revision: 2,
  appointment: { ...appointment(), id: 'appointment-b', status: 'ATTENDANCE_OPENED', permitId: 'permit-a' } });
const dashboard = () => ({ generatedAt: '2026-10-18T12:00:00Z', appointments: 2, activePermits: 0, blockedAppointments: 0, pendingReviews: 1,
  nextAppointments: [appointment()], pendingPermits: [permit()] });
const options = () => ({ teams: [{ id: 'team-a', name: 'Equipe Alfa', unitId: 'unit-a' }], services: [{ id: 'service-a', name: 'Altura' }], responsibles: [{ id: 'responsible-a', name: 'Técnica Demo' }] });

describe('resposta do painel operacional', () => {
  it('aceita os campos consumidos no painel sem exigir o DTO inteiro da PT', () => {
    const response = dashboard();
    const result = checkedOperationsDashboard(response, criteria);
    expect(result).toBe(response);
    expect(result.pendingPermits[0].version).toBe(1);
  });

  it('aceita uma correção devolvida e filtros de serviço secundário e local normalizado', () => {
    const response = dashboard(); response.pendingPermits[0].reviewStatus = 'RETURNED';
    expect(checkedOperationsDashboard(response, { ...criteria, teamId: 'team-a', serviceId: 'service-b', location: '  PATIO de   inspecao  ' })).toBe(response);
  });

  it('preserva a interseção de dias civis de São Paulo quando o início pertence ao dia UTC seguinte', () => {
    const response = dashboard();
    expect(checkedOperationsDashboard(response, { ...criteria, from: '2026-10-17', to: '2026-10-17' })).toBe(response);
    expect(checkedOperationsDashboard(response, { ...criteria, from: '2026-10-18', to: '2026-10-18' })).toBe(response);
    expect(() => checkedOperationsDashboard(response, { ...criteria, from: '2026-10-19' })).toThrow(OperationsResponseError);
    expect(() => checkedOperationsDashboard(response, { ...criteria, to: '2026-10-16' })).toThrow(OperationsResponseError);
  });

  it.each(['unitId', 'teamId', 'serviceId', 'location'] as const)('recusa resultado que não corresponde ao filtro %s', key => {
    expect(() => checkedOperationsDashboard(dashboard(), { ...criteria, [key]: 'outro-valor' })).toThrow(ScopedPageError);
  });

  it.each(['nextAppointments', 'pendingPermits'] as const)('recusa unidade indevida em %s mesmo sem filtros opcionais', key => {
    const response = dashboard();
    if (key === 'nextAppointments') response.nextAppointments[0].unitId = 'unit-b'; else response.pendingPermits[0].appointment.unitId = 'unit-b';
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it.each([
    { from: '2026-02-30' }, { to: '18/10/2026' }, { from: '2026-10-19', to: '2026-10-18' }, { unitId: '' }, { teamId: '../team' }, { serviceId: 'service?q=1' },
  ])('recusa critérios inválidos mesmo para uma resposta vazia %j', invalid => {
    expect(() => checkedOperationsDashboard({ ...dashboard(), nextAppointments: [], pendingPermits: [] }, { ...criteria, ...invalid })).toThrow(ScopedPageError);
  });

  it.each(['appointments', 'activePermits', 'blockedAppointments', 'pendingReviews'])('recusa contadores %s negativos, fracionários ou inseguros', key => {
    for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '1', null]) {
      expect(() => checkedOperationsDashboard({ ...dashboard(), [key]: invalid }, criteria)).toThrow(ScopedPageError);
    }
  });

  it.each(['', 'amanhã', '2026-02-30T12:00:00Z', '2026-10-18T12:00:00'])('recusa data de atualização inválida ou ambígua %s', generatedAt => {
    expect(() => checkedOperationsDashboard({ ...dashboard(), generatedAt }, criteria)).toThrow(ScopedPageError);
  });

  it.each(['nextAppointments', 'pendingPermits'] as const)('recusa IDs repetidos ou inseguros em %s', key => {
    const response = dashboard();
    expect(() => checkedOperationsDashboard({ ...response, [key]: [response[key][0], response[key][0]] }, criteria)).toThrow(ScopedPageError);
    expect(() => checkedOperationsDashboard({ ...response, [key]: [{ ...response[key][0], id: 'id/fora' }] }, criteria)).toThrow(ScopedPageError);
  });

  it('não aceita a mesma agenda simultaneamente na programação e na fila de encerramentos', () => {
    const response = dashboard(); response.pendingPermits[0].appointment.id = response.nextAppointments[0].id;
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it.each(['CANCELED', 'ATTENDANCE_OPENED', 'UNKNOWN'])('recusa agenda %s na lista de próximos serviços', status => {
    const response = dashboard(); response.nextAppointments[0].status = status;
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it.each(['', '2026-02-30T01:00:00Z', '2026-10-18T01:00:00', 'inválida'])('recusa início inválido ou ambíguo %s', startsAt => {
    const response = dashboard(); response.nextAppointments[0].startsAt = startsAt;
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it.each(['2026-10-18T00:00:00Z', '2026-10-18T01:00:00Z', 'inválida'])('recusa fim que não sucede o início %s', endsAt => {
    const response = dashboard(); response.pendingPermits[0].appointment.endsAt = endsAt;
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it.each([[], ['service-a', 'service-a'], ['service-b'], ['service-a', '../service']].map(serviceTypeIds => ({ serviceTypeIds })))('recusa conjunto de serviços incoerente $serviceTypeIds', ({ serviceTypeIds }) => {
    const response = dashboard(); response.nextAppointments[0].serviceTypeIds = serviceTypeIds;
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it('aceita o contrato legado de serviço único sem lista explícita', () => {
    const response = dashboard();
    const next = { ...response.nextAppointments[0], serviceTypeIds: undefined };
    const pending = { ...response.pendingPermits[0], appointment: { ...response.pendingPermits[0].appointment, serviceTypeIds: undefined } };
    expect(checkedOperationsDashboard({ ...response, nextAppointments: [next], pendingPermits: [pending] }, { ...criteria, serviceId: 'service-a' }).appointments).toBe(2);
  });

  it.each([
    { operationStatus: 'EXECUTING' }, { reviewStatus: 'VALIDATED' }, { reviewStatus: 'NOT_SUBMITTED' }, { version: 0 }, { revision: -1 }, { version: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
  ])('recusa PT sem encerramento ou versão válida %j', invalid => {
    const response = dashboard(); response.pendingPermits = [{ ...response.pendingPermits[0], ...invalid }];
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it('recusa PT cuja agenda não está em atendimento ou aponta para outra PT', () => {
    const response = dashboard(); response.pendingPermits[0].appointment.status = 'CONFIRMED';
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
    response.pendingPermits[0].appointment.status = 'ATTENDANCE_OPENED'; response.pendingPermits[0].appointment.permitId = 'other-permit';
    expect(() => checkedOperationsDashboard(response, criteria)).toThrow(ScopedPageError);
  });

  it.each([null, [], {}, { ...dashboard(), nextAppointments: null }, { ...dashboard(), pendingPermits: {} }])('recusa envelope sem listas válidas', value => {
    expect(() => checkedOperationsDashboard(value, criteria)).toThrow(ScopedPageError);
  });
});

describe('opções dos filtros operacionais', () => {
  it('aceita somente os dados necessários aos selects, sem exigir membros ou configuração de modelos', () => {
    const response = options();
    expect(checkedOperationsOptions(response, 'unit-a')).toBe(response);
    expect(checkedOperationsOptions({ teams: [], services: [], responsibles: [] }, 'unit-a').teams).toEqual([]);
  });

  it('recusa equipes de outra unidade, inativas ou sem identificação do escopo', () => {
    for (const invalid of [{ unitId: 'unit-b' }, { unitId: undefined }, { status: 'INACTIVE' }]) {
      const response = options();
      expect(() => checkedOperationsOptions({ ...response, teams: [{ ...response.teams[0], ...invalid }] }, 'unit-a')).toThrow(ScopedPageError);
    }
  });

  it.each(['teams', 'services', 'responsibles'] as const)('recusa identidades duplicadas, inseguras ou nomes vazios em %s', key => {
    const response = options();
    expect(() => checkedOperationsOptions({ ...response, [key]: [response[key][0], response[key][0]] }, 'unit-a')).toThrow(ScopedPageError);
    expect(() => checkedOperationsOptions({ ...response, [key]: [{ ...response[key][0], id: 'item?fora' }] }, 'unit-a')).toThrow(ScopedPageError);
    expect(() => checkedOperationsOptions({ ...response, [key]: [{ ...response[key][0], name: '  ' }] }, 'unit-a')).toThrow(ScopedPageError);
  });
});
