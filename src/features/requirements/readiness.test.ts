import { describe, expect, it } from 'vitest';
import type { DocumentaryReadinessRowDto } from '../../shared/contracts/requirements';
import { filterReadiness, readinessCounts, readinessCsv } from './readiness';

const example = (appointmentId = 'a'): DocumentaryReadinessRowDto => ({ appointmentId, appointmentCode: `AG-${appointmentId}`, teamId: 'team-a', teamName: 'Equipe manutenção', serviceTypeId: 'maintenance', serviceLabel: 'Manutenção', location: 'Área Sul', startsAt: '2026-10-10T09:00:00-03:00', endsAt: '2026-10-10T10:00:00-03:00', eligibility: { appointmentId, checkedAt: '2026-10-10T08:00:00-03:00', requirementVersion: 'DEMO-1', eligible: false, participants: [
  { workerId: 'camila', name: 'Camila', serviceFunction: 'Executante', eligible: true, items: [{ requirementId: 'common', label: 'Capacitação', description: 'Critério demo', restricted: false, status: 'APPROVED' }] },
  { workerId: 'bruno', name: 'Bruno', serviceFunction: 'Apoio', eligible: false, items: [{ requirementId: 'common', label: 'Capacitação', description: 'Critério demo', restricted: false, status: 'PENDING', reason: 'Confira o documento.' }, { requirementId: 'restricted', label: 'Conferência restrita', description: 'Administrativa', restricted: true, status: 'MISSING', reason: 'Dado indevido que não pode entrar no CSV', fileName: 'restrito.pdf', validUntil: '2030-12-10' }] },
] } });
const base = { query: '', teamId: '', serviceTypeId: '', status: 'pending' };
describe('consulta de pendências por atendimento', () => {
  it('combina busca sem acentos, função e contexto sem incluir outras pessoas', () => {
    const groups = filterReadiness([example()], { ...base, query: 'BRUNO manutencao sul' });
    expect(groups).toHaveLength(1);
    expect(groups[0].people.map(person => person.workerId)).toEqual(['bruno']);
    expect(filterReadiness([example()], { ...base, query: 'Camila' })).toEqual([]);
    expect(filterReadiness([example()], { ...base, teamId: 'outside' })).toEqual([]);
    expect(filterReadiness([example()], { ...base, serviceTypeId: 'other' })).toEqual([]);
  });
  it('conta pessoas únicas e pendências por pessoa e atendimento', () => {
    const groups = filterReadiness([example(), example('b')], base);
    expect(readinessCounts(groups)).toEqual({ appointments: 2, people: 1, pending: 4 });
    expect(filterReadiness([example()], { ...base, status: 'ready' })[0].people[0].workerId).toBe('camila');
  });
  it('exporta texto literal e situação administrativa mínima dos requisitos restritos', () => {
    const row = example(); row.teamName = '  =HYPERLINK("https://example.test")'; row.location = '@COMANDO';
    const csv = readinessCsv(filterReadiness([row], base));
    expect(csv).toContain('"\'  =HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"\'@COMANDO"');
    expect(csv).toContain('Conferência restrita por profissional autorizado.');
    expect(csv).not.toContain('Dado indevido');
    expect(csv).not.toContain('restrito.pdf');
    expect(csv).not.toContain('2030-12-10');
    expect(csv).toContain('Aguardando conferência');
  });
});
