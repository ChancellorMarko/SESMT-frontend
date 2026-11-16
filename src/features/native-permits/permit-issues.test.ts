import { describe, expect, it } from 'vitest';
import { describeIssues } from './permit-issues';

const a = 'aaaaaaaa-0000-4000-8000-000000000001', b = 'bbbbbbbb-0000-4000-8000-000000000002', type = 'cccccccc-0000-4000-8000-000000000003';
const permit = { participants: [
  { userId: a, responsibility: 'Executante', acknowledgedAt: null, acknowledgedVersion: null, acknowledgements: [] },
  { userId: b, responsibility: 'Vigia', acknowledgedAt: null, acknowledgedVersion: null, acknowledgements: [] },
] } as never;
const issue = (code: string, participantUserId: string | null = null, documentTypeId: string | null = null, serviceCode: string | null = null) => ({ code, participantUserId, documentTypeId, serviceCode });

describe('pendências da PT', () => {
  it('nomeia pessoa, documento e serviço com os dados disponíveis', () => {
    const [document, science] = describeIssues([issue('DOCUMENTO_AUSENTE', a.toUpperCase(), type, 'ALTURA'), issue('CIENCIA_PENDENTE', b)], permit, {
      userNames: new Map([[a, 'Ana Lima']]), documentTypeNames: new Map([[type, 'Certificado NR-35']]), serviceNames: new Map([['ALTURA', 'Trabalho em altura']]),
    });
    expect(document).toMatchObject({ title: 'Documento ausente', subject: 'Ana Lima', detail: 'Certificado NR-35 · Serviço: Trabalho em altura · Executante' });
    expect(document.next).toMatch(/Cadastre o documento/);
    expect(science).toMatchObject({ title: 'Ciência pendente', subject: 'Participante 2', detail: 'Vigia' });
  });
  it('não inventa nomes: sem consulta permitida, usa a posição e o tipo genérico', () => {
    const [item] = describeIssues([issue('DOCUMENTO_AUSENTE', a, type)], permit);
    expect(item).toMatchObject({ subject: 'Participante 1', detail: 'Tipo documental exigido · Executante' });
    expect(describeIssues([issue('CIENCIA_PENDENTE', 'dddddddd-0000-4000-8000-000000000004')], permit)[0].subject).toBe('Pessoa fora da lista de participantes');
    expect(describeIssues([issue('CODIGO_NOVO')], permit)[0]).toMatchObject({ title: 'Pendência informada pela API', subject: undefined });
  });
  it('identifica a própria conta', () => {
    expect(describeIssues([issue('CIENCIA_PENDENTE', b)], permit, { currentUserId: b.toUpperCase() })[0].subject).toBe('Você');
  });
});
