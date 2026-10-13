import { describe, expect, it, afterEach, vi } from 'vitest';
import type { PermitOptionsDto } from '../../shared/contracts/work-permits';
import { appointmentFormSchema, appointmentInstant, appointmentLocal, evidenceDatesError, evidenceDownloadAllowed, evidenceFileError, participantError } from './support';

const options: PermitOptionsDto = {
  teams: [{ id: 'team-a', name: 'Equipe A', unitId: 'unit-a', companyId: 'company-a', chiefId: 'person-a', revision: 1, members: [{ workerId: 'person-a', name: 'Pessoa A', serviceFunction: 'Executante' }] }], services: [], responsibles: [],
};
const values = { teamId: 'team-a', serviceTypeId: 'service-a', responsibleId: 'responsible-a', location: 'Local do serviço', startsAt: '2026-10-09T14:00', endsAt: '2026-10-09T16:00', notes: '' };

afterEach(() => vi.unstubAllEnvs());
describe('Agendamento e participantes', () => {
  it('preserva o horário de Brasília ao converter e exibir, independentemente do navegador', () => {
    expect(appointmentInstant('2026-10-09T14:00')).toBe('2026-10-09T17:00:00.000Z');
    expect(appointmentLocal('2026-10-09T17:00:00Z')).toBe('2026-10-09T14:00');
  });
  it('rejeita datas impossíveis e horários fora do relógio', () => {
    expect(appointmentInstant('2026-02-30T10:00')).toBeUndefined();
    expect(appointmentInstant('2026-10-09T24:00')).toBeUndefined();
    expect(appointmentInstant('2026-10-09T10:99')).toBeUndefined();
  });
  it('recusa término igual ou anterior ao início', () => {
    expect(appointmentFormSchema.safeParse(values).success).toBe(true);
    expect(appointmentFormSchema.safeParse({ ...values, endsAt: values.startsAt }).success).toBe(false);
    expect(appointmentFormSchema.safeParse({ ...values, endsAt: '2026-10-09T13:00' }).success).toBe(false);
  });
  it('aceita seleção múltipla e compatibilidade legada, mas recusa seleção vazia, duplicada ou inválida', () => {
    expect(appointmentFormSchema.safeParse(values).success).toBe(true);
    expect(appointmentFormSchema.safeParse({ ...values, serviceTypeIds: ['service-a', 'service-hot'] }).success).toBe(true);
    expect(appointmentFormSchema.safeParse({ ...values, serviceTypeIds: [] }).success).toBe(false);
    expect(appointmentFormSchema.safeParse({ ...values, serviceTypeIds: ['service-a', 'service-a'] }).success).toBe(false);
    expect(appointmentFormSchema.safeParse({ ...values, serviceTypeIds: ['service-a', ' '] }).success).toBe(false);
    expect(appointmentFormSchema.safeParse({ ...values, serviceTypeIds: ['service-hot'] }).success).toBe(false);
    expect(appointmentFormSchema.safeParse({ ...values, serviceTypeIds: ['service-a', ...Array.from({ length: 7 }, (_value, index) => `service-${index}`)] }).success).toBe(false);
  });
  it('exige equipe da unidade, participante único da equipe e função no serviço', () => {
    const person = options.teams[0].members[0];
    expect(participantError([person], 'team-a', 'unit-a', options)).toBeUndefined();
    expect(participantError([person], 'team-a', 'unit-b', options)).toContain('unidade');
    expect(participantError([], 'team-a', 'unit-a', options)).toContain('pelo menos');
    expect(participantError([person, person], 'team-a', 'unit-a', options)).toContain('única');
    expect(participantError([{ ...person, workerId: 'outsider' }], 'team-a', 'unit-a', options)).toContain('não pertence');
    expect(participantError([{ ...person, serviceFunction: ' ' }], 'team-a', 'unit-a', options)).toContain('função');
  });
});

describe('Evidências documentais', () => {
  it('exige datas somente quando a matriz pede e recusa datas impossíveis ou invertidas', () => {
    expect(evidenceDatesError({}, '', '')).toBeUndefined();
    expect(evidenceDatesError({ validFromRequired: true }, '', '')).toContain('inicial');
    expect(evidenceDatesError({ validUntilRequired: true }, '', '')).toContain('final');
    expect(evidenceDatesError({}, '2026-02-30', '')).toContain('válidas');
    expect(evidenceDatesError({}, '2026-10-09', '2026-10-08')).toContain('posterior');
    expect(evidenceDatesError({ validFromRequired: true, validUntilRequired: true }, '2026-10-09', '2027-10-09')).toBeUndefined();
  });
  it('recusa arquivos vazios, acima de 5 MB e extensão/MIME incompatível', () => {
    expect(evidenceFileError(new File(['%PDF-1.4'], 'certificado.pdf', { type: 'application/pdf' }))).toBeUndefined();
    expect(evidenceFileError(new File([], 'certificado.pdf', { type: 'application/pdf' }))).toContain('vazio');
    expect(evidenceFileError(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'foto.png', { type: 'image/png' }))).toContain('5 MB');
    expect(evidenceFileError(new File(['conteúdo'], 'certificado.exe', { type: 'application/pdf' }))).toContain('PDF');
  });
  it('permite a origem da aplicação e API HTTPS configurada, recusando scripts e servidores externos', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.sesmt.test/api/v1');
    expect(evidenceDownloadAllowed('blob:https://app.sesmt.test/id', 'https://app.sesmt.test')).toBe(true);
    expect(evidenceDownloadAllowed('https://api.sesmt.test/evidence/1', 'https://app.sesmt.test')).toBe(true);
    expect(evidenceDownloadAllowed('https://externo.test/file.pdf', 'https://app.sesmt.test')).toBe(false);
    expect(evidenceDownloadAllowed('javascript:alert(1)', 'https://app.sesmt.test')).toBe(false);
  });
});
