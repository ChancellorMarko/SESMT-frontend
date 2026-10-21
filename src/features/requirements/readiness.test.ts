import { describe, expect, it } from 'vitest';
import type { DocumentaryReadinessRowDto } from '../../shared/contracts/requirements';
import { checkedReadiness, filterReadiness, readinessCounts, readinessCriteriaError, readinessCsv, ReadinessResponseError } from './readiness';

const example = (appointmentId = 'a'): DocumentaryReadinessRowDto => ({ appointmentId, appointmentCode: `AG-${appointmentId}`, teamId: 'team-a', teamName: 'Equipe manutenção', serviceTypeId: 'maintenance', serviceLabel: 'Manutenção', location: 'Área Sul', startsAt: '2026-10-10T09:00:00-03:00', endsAt: '2026-10-10T10:00:00-03:00', eligibility: { appointmentId, checkedAt: '2026-10-10T08:00:00-03:00', requirementVersion: 'DEMO-1', eligible: false, participants: [
  { workerId: 'camila', name: 'Camila', serviceFunction: 'Executante', eligible: true, items: [{ requirementId: 'common', label: 'Capacitação', description: 'Critério demo', restricted: false, status: 'APPROVED' }] },
  { workerId: 'bruno', name: 'Bruno', serviceFunction: 'Apoio', eligible: false, items: [{ requirementId: 'common', label: 'Capacitação', description: 'Critério demo', restricted: false, status: 'PENDING', reason: 'Confira o documento.' }, { requirementId: 'restricted', label: 'Conferência restrita', description: 'Administrativa', restricted: true, status: 'MISSING', reason: 'Dado indevido que não pode entrar no CSV', fileName: 'restrito.pdf', validUntil: '2030-12-10' }] },
] } });
const base = { query: '', teamId: '', serviceTypeId: '', status: 'pending' };
describe('consulta de pendências por atendimento', () => {
  it('filtra também o segundo serviço agendado e preserva o fallback de registros antigos', () => {
    const row = { ...example(), serviceTypeIds: ['maintenance', 'confined'], services: [{ id: 'maintenance', name: 'Manutenção' }, { id: 'confined', name: 'Espaço confinado' }], serviceLabel: 'Manutenção + Espaço confinado' };
    expect(filterReadiness([row], { ...base, serviceTypeId: 'confined' })).toHaveLength(1);
    expect(filterReadiness([example()], { ...base, serviceTypeId: 'maintenance' })).toHaveLength(1);
    expect(filterReadiness([{ ...row, serviceTypeIds: [] }], { ...base, serviceTypeId: 'maintenance' })).toHaveLength(1);
  });
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
  it('não amplia a consulta quando a situação é desconhecida', () => {
    expect(filterReadiness([example()], { ...base, status: 'READY' })).toEqual([]);
  });
  it.each(['status=unknown', 'status=', 'q=um&q=dois', 'teamId=a&teamId=b', 'unitId=a&unitId=b', 'extra=1', 'teamId=', 'serviceTypeId=a%2Fb', 'q=%00'])('identifica critérios inválidos: %s', criteria => {
    expect(readinessCriteriaError(new URLSearchParams(criteria))).not.toBe('');
  });
  it('aceita os filtros existentes sem exigir uma unidade no contrato legado', () => {
    expect(readinessCriteriaError(new URLSearchParams('q=Manuten%C3%A7%C3%A3o&status=pending&teamId=team-a&serviceTypeId=maintenance&unitId=unit-a'))).toBe('');
    const response = { generatedAt: example().eligibility.checkedAt, rows: [example()] };
    expect(checkedReadiness(response, 'unit-a')).toBe(response);
    response.rows[0].eligibility.unitId = 'unit-a';
    expect(checkedReadiness(response, 'unit-a')).toBe(response);
  });
  it.each(['unit', 'appointment', 'duplicateAppointment', 'duplicatePerson', 'duplicateRequirement', 'status', 'shape', 'period'] as const)('recusa resposta incompatível: %s', defect => {
    const response = { generatedAt: example().eligibility.checkedAt, rows: [example()] };
    const row = response.rows[0];
    if (defect === 'unit') row.eligibility.unitId = 'unit-b';
    if (defect === 'appointment') row.eligibility.appointmentId = 'another';
    if (defect === 'duplicateAppointment') response.rows.push(example());
    if (defect === 'duplicatePerson') row.eligibility.participants.push(structuredClone(row.eligibility.participants[0]));
    if (defect === 'duplicateRequirement') row.eligibility.participants[0].items.push(structuredClone(row.eligibility.participants[0].items[0]));
    if (defect === 'status') Object.assign(row.eligibility.participants[0].items[0], { status: 'UNKNOWN' });
    if (defect === 'shape') Object.assign(row, { eligibility: {} });
    if (defect === 'period') row.endsAt = row.startsAt;
    expect(() => checkedReadiness(response, 'unit-a')).toThrow(ReadinessResponseError);
  });
  it('inclui no CSV a pessoa sem requisitos configurados, com aviso de conferência', () => {
    const row = example(); row.eligibility.participants[1].items = [];
    const csv = readinessCsv(filterReadiness([row], base));
    expect(csv).toContain('Bruno'); expect(csv).toContain('Matriz sem requisitos aplicáveis');
    expect(csv).toContain('Confira a configuração da matriz antes de liberar.');
    expect(csv.split('\r\n')).toHaveLength(2);
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
