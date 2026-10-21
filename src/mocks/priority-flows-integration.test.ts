import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetDemo } from './handlers';
import { id, UNIT_A } from './fixtures';
import type { PublicInviteAppointmentDto, PublicInviteAppointmentWriteDto, PublicTeamInviteDto, TeamInviteDto } from '../shared/contracts/teams';
import type { SessionDto } from '../shared/contracts';
import type { AppointmentDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { SignatureRepresentationDto } from '../shared/contracts/signature-representation';

const server = setupServer(...handlers);
let token = '';
const send = (method: string, path: string, body?: unknown, revision?: number, key?: string, anonymous = false) => fetch(`http://localhost/api/v1${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...(!anonymous ? { 'X-CSRF-Token': 'demo-csrf', ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {}), ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
async function login(role = 'gestor') {
  token = '';
  const response = await send('POST', '/auth/login', { email: `${role}@demo.sesmt.local`, password: 'Demo123!' });
  expect(response.status).toBe(200); const result = await response.json();
  const session: SessionDto = role === 'admin' ? await (await send('POST', '/auth/mfa/verify', { challengeId: result.challengeId, code: '123456' })).json() : result;
  token = session.accessToken;
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => { resetDemo(); token = ''; });
afterEach(() => server.resetHandlers());
afterAll(() => { resetDemo(); server.close(); });

describe('prioridades pelo adaptador HTTP de demonstração', () => {
  const publicPath = '/team-invites/public/tok-equipe-civil-2026';
  async function requestInput(): Promise<PublicInviteAppointmentWriteDto> {
    const invite = await (await send('GET', publicPath, undefined, undefined, undefined, true)).json() as PublicTeamInviteDto;
    return { serviceTypeIds: invite.services!.slice(0, 2).map(service => service.id), location: 'Galpão de teste', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(), participants: [{ memberId: invite.members[0].memberId!, serviceFunction: 'Executante' }], declarantName: 'Solicitante de teste', acknowledged: true };
  }
  it('pedido anônimo aparece solicitado na agenda, exige responsável e não cria PT', async () => {
    const input = await requestInput();
    const response = await send('POST', `${publicPath}/appointments`, input, undefined, 'public-request-once', true);
    expect(response.status).toBe(200); const receipt = await response.json() as PublicInviteAppointmentDto;
    expect(receipt.status).toBe('REQUESTED'); expect(receipt.participants[0]).not.toHaveProperty('workerId');
    expect((await send('GET', `/appointments/${receipt.id}`, undefined, undefined, undefined, true)).status).toBe(401);
    const repeated = await (await send('POST', `${publicPath}/appointments`, input, undefined, 'public-request-once', true)).json();
    expect(repeated.id).toBe(receipt.id);
    await login();
    const agendaResponse = await send('GET', `/appointments?unitId=${UNIT_A}`); expect(agendaResponse.status).toBe(200);
    const agenda = await agendaResponse.json() as AppointmentDto[];
    expect(agenda.filter(item => item.id === receipt.id)).toHaveLength(1);
    const appointment = await (await send('GET', `/appointments/${receipt.id}`)).json() as AppointmentDto;
    expect(appointment).toMatchObject({ status: 'REQUESTED', responsibleId: '', responsibleName: 'A designar', revision: 1 }); expect(appointment.permitId).toBeUndefined();
    const period = { confirmedStartsAt: input.startsAt, confirmedEndsAt: input.endsAt };
    expect((await send('POST', `/appointments/${receipt.id}/confirm`, period, 1)).status).toBe(422);
    for (const invalid of [{ note: 123 }, { note: 'x'.repeat(301) }, { confirmedStartsAt: 123 }, { confirmedEndsAt: '2030-02-30T12:00:00Z' }, { confirmedEndsAt: '' }, { responsibleId: null }, { status: 'CONFIRMED' }]) {
      const rejected = await send('POST', `/appointments/${receipt.id}/confirm`, { ...period, responsibleId: id(25), ...invalid }, 1);
      expect(rejected.status).toBe(422);
      const current = await (await send('GET', `/appointments/${receipt.id}`)).json() as AppointmentDto;
      expect(current).toMatchObject({ status: 'REQUESTED', revision: 1, responsibleId: '' }); expect(current.history).toEqual(appointment.history);
    }
    const confirmedResponse = await send('POST', `/appointments/${receipt.id}/confirm`, { ...period, responsibleId: id(25) }, 1);
    expect(confirmedResponse.status).toBe(200);
    const confirmed = await confirmedResponse.json() as AppointmentDto;
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', responsibleId: id(25), revision: 2 }); expect(confirmed.permitId).toBeUndefined();
    const limited = await (await send('GET', `${publicPath}/appointments`, undefined, undefined, undefined, true)).json() as PublicInviteAppointmentDto[];
    expect(limited).toHaveLength(1); expect(limited[0]).toMatchObject({ id: receipt.id, status: 'CONFIRMED', confirmedStartsAt: input.startsAt });
    expect(limited[0]).not.toHaveProperty('history'); expect(limited[0]).not.toHaveProperty('notes'); expect(limited[0]).not.toHaveProperty('responsibleId');
    const other = await (await send('POST', '/team-invites', { teamId: id(200), validityHours: 24 })).json() as TeamInviteDto;
    expect(await (await send('GET', `/team-invites/public/${other.token}/appointments`, undefined, undefined, undefined, true)).json()).toEqual([]);
  }, 10_000); // This scenario includes 26 sequential requests with the demo's 180 ms latency.
  it('revogação impede consulta e repetição de pedido, sem retirar a solicitação da agenda', async () => {
    const input = await requestInput();
    const created = await (await send('POST', `${publicPath}/appointments`, input, undefined, 'before-revoke', true)).json() as PublicInviteAppointmentDto;
    await login();
    const invites = await (await send('GET', `/team-invites?teamId=${id(200)}`)).json() as TeamInviteDto[];
    const invite = invites.find(item => item.token === 'tok-equipe-civil-2026')!;
    expect((await send('POST', `/team-invites/${invite.id}/revoke`)).status).toBe(200);
    expect((await send('GET', `${publicPath}/appointments`, undefined, undefined, undefined, true)).status).toBe(410);
    expect((await send('POST', `${publicPath}/appointments`, input, undefined, 'before-revoke', true)).status).toBe(410);
    expect((await send('GET', `/appointments/${created.id}`)).status).toBe(200);
  });
  it('perfil pessoal exige sessão, confirmação e revisão e preserva a versão na PT', async () => {
    expect((await send('GET', '/me/signature-representation')).status).toBe(401);
    await login('tecnico'); expect((await send('GET', '/me/signature-representation')).status).toBe(403);
    await login(); expect(await (await send('GET', '/me/signature-representation')).json()).toBeNull();
    const payload = { method: 'TYPED', representation: 'Marina Demo', confirmed: true };
    expect((await send('PUT', '/me/signature-representation', payload)).status).toBe(428);
    expect((await send('PUT', '/me/signature-representation', { ...payload, userId: id(23) }, 0)).status).toBe(422);
    const response = await send('PUT', '/me/signature-representation', payload, 0); expect(response.status).toBe(200);
    const profile = await response.json() as SignatureRepresentationDto;
    const permitPath = `/work-permits/${id(230)}`;
    const permit = await (await send('GET', permitPath)).json() as WorkPermitDto;
    expect(permit.reviewStatus).toBe('PENDING_REVIEW');
    const newProfile = await (await send('PUT', '/me/signature-representation', payload, 1)).json() as SignatureRepresentationDto;
    const review = { decision: 'APPROVE', comment: '', signatureProfileId: profile.id, signatureProfileVersion: profile.version };
    expect((await send('POST', `${permitPath}/review`, review, permit.revision)).status).toBe(409);
    const unchanged = await (await send('GET', permitPath)).json() as WorkPermitDto;
    expect(unchanged.reviewStatus).toBe('PENDING_REVIEW'); expect(unchanged.revision).toBe(permit.revision); expect(unchanged.snapshots[0].signatureProfileId).toBeUndefined();
    const approvedResponse = await send('POST', `${permitPath}/review`, { ...review, signatureProfileVersion: newProfile.version }, permit.revision);
    expect(approvedResponse.status).toBe(200); const approved = await approvedResponse.json() as WorkPermitDto;
    expect(approved.reviewStatus).toBe('VALIDATED'); expect(approved.snapshots[0]).toMatchObject({ signatureProfileId: profile.id, signatureProfileVersion: 2, reviewedBy: id(20), signatureRepresentation: 'Marina Demo' });
    await send('PUT', '/me/signature-representation', payload, 2);
    const historical = await (await send('GET', permitPath)).json() as WorkPermitDto;
    expect(historical.snapshots).toEqual(approved.snapshots);
    await login('admin'); expect((await send('GET', '/me/signature-representation')).status).toBe(403);
  });
});
