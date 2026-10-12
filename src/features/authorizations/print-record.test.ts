import { describe, expect, it } from 'vitest';
import type { AuthorizationReleaseDto } from '../../shared/contracts/work-authorizations';
import { authorizationWindowNotice } from './print-record';

const release = (start: string, end: string) => ({ validFrom: start, validUntil: end }) as AuthorizationReleaseDto;
describe('janela impressa da AT', () => {
  const start = '2026-10-10T12:00:00Z', end = '2026-10-10T18:00:00Z';
  it('distingue início futuro, curso e término inclusivo sem mudar o registro', () => {
    const record = { status: 'AUTHORIZED' as const, releases: [release(start, end)] };
    expect(authorizationWindowNotice(record, Date.parse(start) - 1)).toContain('ainda não começou');
    expect(authorizationWindowNotice(record, Date.parse(start))).toContain('em curso');
    expect(authorizationWindowNotice(record, Date.parse(end))).toContain('terminou');
    expect(record.status).toBe('AUTHORIZED');
  });
  it('usa a última rodada e não anuncia vigência em estado suspenso ou terminal', () => {
    const releases = [release(start, end), release('2026-10-11T12:00:00Z', '2026-10-11T18:00:00Z')];
    expect(authorizationWindowNotice({ status: 'AUTHORIZED', releases }, Date.parse(end))).toContain('ainda não começou');
    for (const status of ['DRAFT', 'SUSPENDED', 'CLOSED', 'CANCELED'] as const) expect(authorizationWindowNotice({ status, releases }, Date.parse(start))).toBeUndefined();
  });
  it('não presume vigência com uma janela ausente ou inválida', () => {
    expect(authorizationWindowNotice({ status: 'AUTHORIZED', releases: [] })).toContain('Sem janela');
    for (const item of [release('inválido', end), release(end, start)]) expect(authorizationWindowNotice({ status: 'AUTHORIZED', releases: [item] })).toContain('indisponível');
  });
});
