import { beforeEach, describe, expect, it } from 'vitest';
import type { AppointmentDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { DesignationDto } from '../shared/contracts/designations';
import { PT_SERVICE_TYPES } from '../shared/lib/service-types';
import { COMPANY, id, makeFixtures, UNIT_A, UNIT_B } from './fixtures';
import { makePermitDemo, type PermitDemoContext } from './work-permits';

const operational = ['appointments.read', 'teams.read', 'permits.read', 'permits.operate', 'eligibility.read', 'eligibility.write', 'appointments.write'];
const context = (userId: number, displayName: string): PermitDemoContext => ({
  user: {
    id: id(userId),
    displayName,
    email: 'demo@example.local',
    roles: [],
    status: 'ACTIVE',
    mfaRequired: false,
    revision: 1,
    scope: { companyIds: [COMPANY], unitIds: [UNIT_A, UNIT_B], teamIds: [], sectorIds: [], ownOnly: false },
  },
  permissions: operational,
  workers: makeFixtures().workers,
  checkUnit: () => {},
});

const technician = () => context(25, 'Diego Demo');
const firefighter = () => context(26, 'Felipe Demo');

describe('integração de designações operacionais com a PT', () => {
  let demo: ReturnType<typeof makePermitDemo>;

  beforeEach(() => {
    demo = makePermitDemo();
  });

  async function call<T>(path: string, method = 'GET', input?: unknown, actor = technician(), rev?: number): Promise<T> {
    const url = new URL(`http://localhost/api/v1${path}`);
    const headers = new Headers();
    if (input) headers.set('Content-Type', 'application/json');
    if (rev !== undefined) headers.set('If-Match', `"${rev}"`);
    const request = new Request(url, { method, headers, body: input ? JSON.stringify(input) : undefined });
    return await demo.route(request, url, url.pathname.replace('/api/v1', ''), actor) as T;
  }

  async function preparePermit(appointmentId = id(221)): Promise<WorkPermitDto> {
    const appointment = await call<AppointmentDto>(`/appointments/${appointmentId}`);
    let permit = await call<WorkPermitDto>(`/appointments/${appointmentId}/open-permit`, 'POST', {}, technician(), appointment.revision);
    const preparation = permit.preparation!;
    preparation.identification = {
      ...preparation.identification,
      serviceProvider: 'Fornecedor Demo',
      workFront: 'Frente Demo',
      activityDescription: 'Inspeção fictícia.',
      riskAnalysisReference: 'AR-DEMO-1',
    };
    preparation.activities = ['overlapping'];
    preparation.checks = preparation.checks.map(item => item.section === 'overlapping' ? { ...item, answer: 'YES' } : item);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/preparation`, 'PATCH', preparation, technician(), permit.revision);
    permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/checklist`, 'PATCH', { items: permit.checklist.map(item => ({ ...item, answer: 'YES' })) }, technician(), permit.revision);
    for (const participant of permit.appointment.participants) {
      permit = await call<WorkPermitDto>(`/work-permits/${permit.id}/sciences`, 'POST', {
        workerId: participant.workerId,
        declarantName: participant.name,
        method: 'TYPED',
        representation: participant.name,
        confirmed: true,
      }, technician(), permit.revision);
    }
    return permit;
  }

  it('permite abrir atendimento quando o responsável possui designação vigente para os serviços', async () => {
    // Diego (id(25)) tem designação abrangente para UNIT_A cobrindo id(210)
    const appointment = await call<AppointmentDto>(`/appointments/${id(220)}`);
    const permit = await call<WorkPermitDto>(`/appointments/${id(220)}/open-permit`, 'POST', {}, technician(), appointment.revision);
    expect(permit.id).toBeDefined();
    expect(permit.operationStatus).toBe('VERIFICATION');
  });

  it('bloqueia abertura quando o responsável não tem designação cobrindo o serviço', async () => {
    // Felipe (id(26)) no UNIT_A só tem designação para id(211) (Inspeções).
    // Criamos um agendamento onde Felipe tenta abrir para serviço de eletricidade (não coberto no UNIT_A):
    const newApp = await call<AppointmentDto>('/appointments', 'POST', {
      unitId: UNIT_A,
      teamId: id(200),
      serviceTypeId: PT_SERVICE_TYPES[4].id,
      serviceTypeIds: [PT_SERVICE_TYPES[4].id], // Eletricidade
      location: 'Subestação Central',
      startsAt: '2026-10-15T08:00:00-03:00',
      endsAt: '2026-10-15T12:00:00-03:00',
      responsibleId: id(26),
      participants: [{ workerId: id(40), serviceFunction: 'Executante' }],
    }, firefighter());

    // Confirmamos o agendamento
    const confirmedApp = await call<AppointmentDto>(`/appointments/${newApp.id}`, 'GET', undefined, firefighter());
    await call(`/appointments/${newApp.id}/confirm`, 'POST', {}, firefighter(), confirmedApp.revision);

    const appToOpen = await call<AppointmentDto>(`/appointments/${newApp.id}`, 'GET', undefined, firefighter());
    await expect(call(`/appointments/${newApp.id}/open-permit`, 'POST', {}, firefighter(), appToOpen.revision))
      .rejects.toMatchObject({
        status: 409,
        code: 'DESIGNATION_REQUIRED',
      });
  });

  it('bloqueia liberação (release) se a designação for revogada após abertura', async () => {
    const permit = await preparePermit(id(221));

    // Revoga a designação ativa de Diego no UNIT_A
    const designations = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}&responsibleId=${id(25)}&status=ACTIVE`);
    const diegoDesig = designations[0];
    await call(`/designations/${diegoDesig.id}/revoke`, 'POST', { reason: 'Revogação urgente de segurança.' }, technician(), diegoDesig.revision);

    // Tentar liberar a PT deve ser bloqueado por falta de designação vigente
    await expect(call(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision))
      .rejects.toMatchObject({
        status: 409,
        code: 'DESIGNATION_REQUIRED',
      });
  });

  it('bloqueia início da execução (start) se a designação for revogada após liberação', async () => {
    const permit = await preparePermit(id(221));
    const released = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);
    expect(released.operationStatus).toBe('RELEASED');

    // Revoga a designação ativa
    const designations = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}&responsibleId=${id(25)}&status=ACTIVE`);
    const diegoDesig = designations[0];
    await call(`/designations/${diegoDesig.id}/revoke`, 'POST', { reason: 'Revogação pós-liberação.' }, technician(), diegoDesig.revision);

    // Tentar iniciar deve ser bloqueado
    await expect(call(`/work-permits/${permit.id}/start`, 'POST', {}, technician(), released.revision))
      .rejects.toMatchObject({
        status: 409,
        code: 'DESIGNATION_REQUIRED',
      });
  });

  it('bloqueia retomada (resume) se a designação for revogada durante a suspensão', async () => {
    const permit = await preparePermit(id(221));
    const released = await call<WorkPermitDto>(`/work-permits/${permit.id}/release`, 'POST', {}, technician(), permit.revision);

    // Suspende a PT
    const suspended = await call<WorkPermitDto>(`/work-permits/${permit.id}/suspend`, 'POST', {
      reason: 'Pausa operacional preventiva.',
      confirmed: true,
    }, technician(), released.revision);
    expect(suspended.operationStatus).toBe('SUSPENDED');

    // Revoga a designação
    const designations = await call<DesignationDto[]>(`/designations?unitId=${UNIT_A}&responsibleId=${id(25)}&status=ACTIVE`);
    const diegoDesig = designations[0];
    await call(`/designations/${diegoDesig.id}/revoke`, 'POST', { reason: 'Revogação em suspensão.' }, technician(), diegoDesig.revision);

    // Tentar retomar deve ser bloqueado pela validação de designação
    await expect(call(`/work-permits/${permit.id}/resume`, 'POST', {
      reason: 'Retomada de atividades.',
      confirmed: true,
      sameTeam: true,
      sameConditions: true,
    }, technician(), suspended.revision)).rejects.toMatchObject({
      status: 409,
      code: 'DESIGNATION_REQUIRED',
    });
  });

  it('bloqueia abertura quando a data do atendimento ultrapassa a janela operacional da designação', async () => {
    // Cria agendamento com data além da vigência máxima da designação de Diego
    // Vigência da seed 600 é futureDay(180). Usamos uma data posterior:
    const farDate = new Date(Date.now() + 250 * 86400000).toISOString().slice(0, 10);
    const newApp = await call<AppointmentDto>('/appointments', 'POST', {
      unitId: UNIT_A,
      teamId: id(200),
      serviceTypeId: id(210),
      serviceTypeIds: [id(210)],
      location: 'Área Futura',
      startsAt: `${farDate}T08:00:00-03:00`,
      endsAt: `${farDate}T12:00:00-03:00`,
      responsibleId: id(25),
      participants: [{ workerId: id(40), serviceFunction: 'Executante' }],
    }, technician());

    const confirmed = await call<AppointmentDto>(`/appointments/${newApp.id}`, 'GET', undefined, technician());
    await call(`/appointments/${newApp.id}/confirm`, 'POST', {}, technician(), confirmed.revision);

    const appToOpen = await call<AppointmentDto>(`/appointments/${newApp.id}`, 'GET', undefined, technician());
    await expect(call(`/appointments/${newApp.id}/open-permit`, 'POST', {}, technician(), appToOpen.revision))
      .rejects.toMatchObject({
        status: 409,
      });
  });
});
